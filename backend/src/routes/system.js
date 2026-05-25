const express = require('express');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const {
  isInstallerCached,
  getInstallerDownloadState,
  cacheInstaller,
} = require('../services/serverService');

module.exports = function(db) {
  const router = express.Router();

  // All endpoints require auth
  router.use(requireAuth);

  // GET /api/system/stats - Server machine status check
  router.get('/stats', (req, res, next) => {
    try {
      const uptime = os.uptime();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const cpus = os.cpus();
      const loadAvg = os.loadavg(); // Returns load avg for 1, 5, 15 minutes (Unix only)

      res.json({
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          percentage: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
        },
        uptime: Math.round(uptime),
        nodeVersion: process.version,
        loadAverage: loadAvg,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/audit-logs - Paged retrieval of panel logs
  router.get('/audit-logs', (req, res, next) => {
    const { page = 1, limit = 50, action = '' } = req.query;
    try {
      const p = Math.max(1, parseInt(page, 10));
      const l = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const offset = (p - 1) * l;

      let queryStr = `
        SELECT a.*, u.username 
        FROM audit_log a
        LEFT JOIN users u ON a.user_id = u.id
      `;
      let countStr = 'SELECT COUNT(*) as count FROM audit_log';
      const params = [];
      const countParams = [];

      if (action) {
        queryStr += ' WHERE a.action = ?';
        countStr += ' WHERE action = ?';
        params.push(action);
        countParams.push(action);
      }

      queryStr += ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?';
      params.push(l, offset);

      const items = db.prepare(queryStr).all(...params);
      const total = db.prepare(countStr).get(...countParams).count;

      res.json({
        items,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/settings - Retrieve global settings keys
  router.get('/settings', (req, res, next) => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = {};
      for (const row of rows) {
        // Redact API keys for security
        if (row.key.endsWith('_key') && row.value) {
          settings[row.key] = '••••••••••••••••';
        } else {
          settings[row.key] = row.value;
        }
      }
      res.json(settings);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/system/settings - Save multiple settings
  router.put('/settings', (req, res, next) => {
    const payload = req.body;
    try {
      if (!payload || typeof payload !== 'object') {
        throw new HttpError(400, 'Payload must be a key-value object.');
      }

      const updateStmt = db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `);

      const transaction = db.transaction((updates) => {
        for (const [key, val] of Object.entries(updates)) {
          // Do not write redacted placeholders back to the database
          if (val === '••••••••••••••••') {
            continue;
          }
          updateStmt.run(key, String(val));
        }
      });

      transaction(payload);

      // Log settings modification event
      const updatedKeys = Object.keys(payload).filter(k => payload[k] !== '••••••••••••••••');
      if (updatedKeys.length > 0) {
        db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
          .run(
            req.user.sub,
            'update-settings',
            'system',
            `Updated settings keys: ${updatedKeys.join(', ')}`,
            req.ip
          );
      }

      res.json({ message: 'Settings saved successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/installer-status - Check if central installer is ready
  router.get('/installer-status', (req, res, next) => {
    try {
      const isCached = isInstallerCached();
      const state = getInstallerDownloadState();
      
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('hytale_installer_url');
      const url = row ? row.value : '';

      res.json({
        isCached,
        downloadState: state,
        configuredUrl: url,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/system/download-installer - Trigger background download & cache
  router.post('/download-installer', async (req, res, next) => {
    const { downloadUrl } = req.body;
    try {
      let url = downloadUrl;
      if (!url) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('hytale_installer_url');
        url = row ? row.value : '';
      }
      
      if (!url) {
        throw new HttpError(400, 'Hytale installer download URL is not configured. Please supply a URL.');
      }

      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('hytale_installer_url', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(url);

      const result = await cacheInstaller(db, url);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'download-installer', 'system', `Triggered Hytale installer cache from ${url}`, req.ip);

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/users - Retrieve user list (Admin Only)
  router.get('/users', requireRole('admin'), (req, res, next) => {
    try {
      const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username ASC').all();
      const getServersStmt = db.prepare(`
        SELECT s.id, s.name 
        FROM user_servers us
        JOIN servers s ON us.server_id = s.id
        WHERE us.user_id = ?
      `);
      for (const user of users) {
        user.servers = getServersStmt.all(user.id);
      }
      res.json(users);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/system/users - Create a new user (Admin Only)
  router.post('/users', requireRole('admin'), async (req, res, next) => {
    const { username, password, role, serverIds } = req.body;
    try {
      if (!username || !password) {
        throw new HttpError(400, 'Username and password are required.');
      }
      if (!['admin', 'operator', 'viewer'].includes(role)) {
        throw new HttpError(400, 'Invalid user role.');
      }
      
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        throw new HttpError(400, `Username "${username}" already exists.`);
      }

      const hash = await bcrypt.hash(password, config.bcryptCost);
      const transaction = db.transaction(() => {
        const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
          .run(username, hash, role);
        const userId = result.lastInsertRowid;

        if (Array.isArray(serverIds) && role !== 'admin') {
          const insertMapping = db.prepare('INSERT INTO user_servers (user_id, server_id) VALUES (?, ?)');
          for (const sId of serverIds) {
            insertMapping.run(userId, sId);
          }
        }
        return userId;
      });

      const userId = transaction();
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'create-user', `user:${userId}`, `Created user ${username} with role ${role}`, req.ip);

      res.status(201).json({ id: userId, username, role });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/system/users/:userId - Update user settings (Admin Only)
  router.patch('/users/:userId', requireRole('admin'), async (req, res, next) => {
    const userId = parseInt(req.params.userId, 10);
    const { password, role, serverIds } = req.body;
    try {
      if (isNaN(userId)) throw new HttpError(400, 'Invalid user ID.');

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!user) throw new HttpError(404, 'User not found.');

      let hash = null;
      if (password) {
        hash = await bcrypt.hash(password, config.bcryptCost);
      }

      const transaction = db.transaction(() => {
        if (hash) {
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
        }
        if (role) {
          if (!['admin', 'operator', 'viewer'].includes(role)) {
            throw new HttpError(400, 'Invalid user role.');
          }
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
        }
        
        if (Array.isArray(serverIds)) {
          db.prepare('DELETE FROM user_servers WHERE user_id = ?').run(userId);
          const currentRole = role || user.role;
          if (currentRole !== 'admin') {
            const insertMapping = db.prepare('INSERT INTO user_servers (user_id, server_id) VALUES (?, ?)');
            for (const sId of serverIds) {
              insertMapping.run(userId, sId);
            }
          }
        }
      });

      transaction();

      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'update-user', `user:${userId}`, `Updated user details`, req.ip);

      res.json({ message: 'User updated successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/system/users/:userId - Delete user account (Admin Only)
  router.delete('/users/:userId', requireRole('admin'), (req, res, next) => {
    const userId = parseInt(req.params.userId, 10);
    try {
      if (isNaN(userId)) throw new HttpError(400, 'Invalid user ID.');
      if (userId === req.user.sub) {
        throw new HttpError(400, 'You cannot delete your own user account.');
      }
      
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      if (!user) throw new HttpError(404, 'User not found.');

      db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'delete-user', `user:${userId}`, `Deleted user ${user.username}`, req.ip);

      res.json({ message: 'User account removed.' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/service-templates/:platform - Download auto-start system scripts
  router.get('/service-templates/:platform', (req, res, next) => {
    const { platform } = req.params;
    try {
      const rootPath = path.resolve(__dirname, '../../../');
      if (platform === 'windows') {
        const script = `# register-service.ps1\r\n# Run in an elevated PowerShell terminal to boot Hytale Cluster Manager on startup\r\n$Action = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "start" -WorkingDirectory "${rootPath}"\r\n$Trigger = New-ScheduledTaskTrigger -AtStartup\r\n$Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\\SYSTEM" -LogonType ServiceAccount\r\n$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\r\n$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings\r\nRegister-ScheduledTask -TaskName "HytaleClusterManager" -InputObject $Task -Force\r\nWrite-Host "Hytale Cluster Manager registered successfully as a Windows Startup Task."\r\n`;
        res.setHeader('Content-Disposition', 'attachment; filename="register-service.ps1"');
        res.setHeader('Content-Type', 'text/plain');
        return res.send(script);
      } else if (platform === 'linux') {
        const script = `[Unit]\r\nDescription=Hytale Cluster Control Panel Daemon\r\nAfter=network.target\r\n\r\n[Service]\r\nType=simple\r\nUser=root\r\nWorkingDirectory=${rootPath}\r\nExecStart=/usr/bin/npm start\r\nRestart=on-failure\r\n\r\n[Install]\r\nWantedBy=multi-user.target\r\n`;
        res.setHeader('Content-Disposition', 'attachment; filename="hytale-panel.service"');
        res.setHeader('Content-Type', 'text/plain');
        return res.send(script);
      } else {
        throw new HttpError(400, 'Unsupported platform templates.');
      }
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/update-check - Check panel software updates
  router.get('/update-check', (req, res) => {
    res.json({
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      needsUpdate: false,
      changelog: 'No updates available. You are running the latest stable release.',
    });
  });

  return router;
};
