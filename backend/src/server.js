const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const dbConnector = require('./db');
const { runMigrations } = require('./db/migrations');
const { errorHandler } = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFoundHandler');
const authRouter = require('./routes/auth');
const serversRouter = require('./routes/servers');
const filesRouter = require('./routes/files');
const modsRouter = require('./routes/mods');
const systemRouter = require('./routes/system');
const publicRouter = require('./routes/public');
const { verifyToken } = require('./services/authService');
const { serverEvents, sendCommand, startScheduler } = require('./services/serverService');

async function bootstrapAdmin(db) {
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCheck.count === 0) {
    let password = config.adminPassword;
    let isGenerated = false;
    
    if (!password) {
      password = crypto.randomBytes(8).toString('hex'); // 16-char hex
      isGenerated = true;
    }
    
    const hash = await bcrypt.hash(password, config.bcryptCost);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(config.adminUsername, hash, 'admin');
    
    if (isGenerated) {
      process.stderr.write(`\n==================================================\n`);
      process.stderr.write(`  BOOTSTRAP ADMIN USER CREATED SUCCESSFULLY\n`);
      process.stderr.write(`  Username: ${config.adminUsername}\n`);
      process.stderr.write(`  Password: ${password}\n`);
      process.stderr.write(`  Please save this password! You must log in using it.\n`);
      process.stderr.write(`==================================================\n\n`);
    } else {
      logger.info(`Bootstrap admin user created with username: ${config.adminUsername}`);
    }
  }
}

async function startServer() {
  try {
    // 1. Initialize SQLite Database
    const db = dbConnector.connect();
    runMigrations(db);
    
    // 2. Bootstrap Admin User
    await bootstrapAdmin(db);

    // Correct dangling server statuses on start
    db.prepare("UPDATE servers SET status = 'stopped' WHERE status IN ('running', 'stopping')").run();
    logger.info("Dangling server statuses reset to 'stopped' on startup.");
    
    // Start background cron restarts & players poller scheduler
    startScheduler(db);
    
    // 3. Create Express App
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve static files in production
    const distPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      // Fallback for single page app routing
      app.get(/^\/(?!api|ws).*$/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      logger.info(`Serving compiled frontend assets from: ${distPath}`);
    } else {
      logger.warn(`Compiled frontend assets directory not found at: ${distPath}. Server will run in API-only mode.`);
    }
    
    // Simple requests logging
    app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.url}`);
      next();
    });
    
    // Base public API routes
    app.get('/api/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
    
    app.get('/api/public/info', (req, res) => {
      res.json({
        appName: 'Hytale Panel',
        version: '1.0.0',
        environment: config.nodeEnv,
      });
    });
    
    // Mount routers
    app.use('/api/auth', authRouter(db));
    app.use('/api/servers', serversRouter(db));
    app.use('/api/files', filesRouter(db));
    app.use('/api/mods', modsRouter(db));
    app.use('/api/system', systemRouter(db));
    app.use('/api/public', publicRouter(db));
    
    // Express global error handlers
    app.use(notFoundHandler);
    app.use(errorHandler);
    
    // 4. Attach HTTP Server
    const server = http.createServer(app);
    
    // 5. Attach WebSocket Server
    const wss = new WebSocketServer({ noServer: true });
    
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/ws') {
        // Authenticate WebSocket Upgrade using JWT Token in query string
        const token = url.searchParams.get('token');
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        try {
          const user = verifyToken(token);
          wss.handleUpgrade(request, socket, head, (ws) => {
            ws.user = user;
            wss.emit('connection', ws, request);
          });
        } catch (err) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
      } else {
        socket.destroy();
      }
    });

    // Listen to log and status events to broadcast to WebSockets
    serverEvents.on('log', (event) => {
      wss.clients.forEach(client => {
        if (client.readyState === 1 && client.subs && client.subs.has(event.serverId)) {
          client.send(JSON.stringify({ ...event, type: 'log' }));
        }
      });
    });

    serverEvents.on('status', (event) => {
      wss.clients.forEach(client => {
        if (client.readyState === 1 && client.subs && client.subs.has(event.serverId)) {
          client.send(JSON.stringify({ ...event, type: 'status' }));
        }
      });
    });

    serverEvents.on('players', (event) => {
      wss.clients.forEach(client => {
        if (client.readyState === 1 && client.subs && client.subs.has(event.serverId)) {
          client.send(JSON.stringify({ ...event, type: 'players' }));
        }
      });
    });
    
    wss.on('connection', (ws, request) => {
      logger.debug(`New WebSocket client connected: ${ws.user.username}`);
      
      // Initialize client subscriptions Set
      ws.subs = new Set();

      // Auto subscribe to serverId if passed in query params
      const url = new URL(request.url, `http://${request.headers.host}`);
      const serverIdParam = url.searchParams.get('serverId');
      if (serverIdParam) {
        const id = parseInt(serverIdParam, 10);
        if (!isNaN(id)) ws.subs.add(id);
      }
      
      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message);
          
          if (parsed.type === 'ping') {
            return ws.send(JSON.stringify({ type: 'pong' }));
          }

          if (parsed.type === 'subscribe') {
            const id = parseInt(parsed.serverId, 10);
            if (!isNaN(id)) {
              ws.subs.add(id);
              logger.debug(`WebSocket client subscribed to server ${id}`);
              ws.send(JSON.stringify({ type: 'subscribed', serverId: id }));
            }
            return;
          }

          if (parsed.type === 'unsubscribe') {
            const id = parseInt(parsed.serverId, 10);
            if (!isNaN(id)) {
              ws.subs.delete(id);
              logger.debug(`WebSocket client unsubscribed from server ${id}`);
              ws.send(JSON.stringify({ type: 'unsubscribed', serverId: id }));
            }
            return;
          }

          if (parsed.type === 'command') {
            const id = parseInt(parsed.serverId, 10);
            if (isNaN(id) || !parsed.command) {
              return ws.send(JSON.stringify({ type: 'error', message: 'Invalid command request' }));
            }
            sendCommand(db, id, parsed.command);
            return ws.send(JSON.stringify({ type: 'command_sent', serverId: id }));
          }

          ws.send(JSON.stringify({ type: 'error', message: 'Unknown request type' }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message || 'Invalid request format' }));
        }
      });
      
      ws.on('close', () => {
        logger.debug('WebSocket client disconnected.');
      });
    });
    
    // 6. Start HTTP Server listening
    server.listen(config.port, config.host, () => {
      logger.info(`Hytale Panel running at http://${config.host}:${config.port}`);
    });
    
  } catch (err) {
    logger.error('Failed to start Hytale Panel server', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
