const express = require('express');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const config = require('../config');
const { requireAuth, requireRole, requireServerAccess } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const {
  getServer,
  startServer,
  stopServer,
  restartServer,
  sendCommand,
  rowToServer,
  getOnlinePlayers,
  installServerFiles,
} = require('../services/serverService');
const {
  createBackup,
  listBackups,
  restoreBackup,
} = require('../services/backupService');

// Validator schemas
const createServerSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Slug must be alphanumeric/dashes only (max 63 chars).').optional(),
  description: z.string().optional(),
  port: z.number().int().min(1024).max(65535).optional(),
});

const updateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  autostart: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  restart_policy: z.enum(['never', 'on-failure', 'always']).optional(),
  restart_delay_s: z.number().int().min(1).max(300).optional(),
  restart_schedule: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Schedule must be in HH:mm format.').or(z.literal('')).nullable().optional(),
  webhook_url: z.string().url().or(z.literal('')).nullable().optional(),
  config_json: z.string().optional(),
});

module.exports = function(db) {
  const router = express.Router();

  // All server routes require authentication
  router.use(requireAuth);

  // GET /api/servers
  router.get('/', (req, res, next) => {
    try {
      let rows;
      if (req.user.role === 'admin') {
        rows = db.prepare('SELECT * FROM servers ORDER BY name ASC').all();
      } else {
        rows = db.prepare(`
          SELECT s.* 
          FROM servers s
          JOIN user_servers us ON us.server_id = s.id
          WHERE us.user_id = ?
          ORDER BY s.name ASC
        `).all(req.user.sub);
      }
      const servers = rows.map(rowToServer);
      res.json(servers);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:id
  router.get('/:id', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      const server = getServer(db, id);
      res.json(server);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers
  router.post('/', requireRole('admin'), async (req, res, next) => {
    try {
      const validated = createServerSchema.parse(req.body);
      
      // Auto-generate slug from name if not provided
      if (!validated.slug) {
        validated.slug = validated.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        if (!validated.slug) {
          validated.slug = 'server-' + Math.random().toString(36).substring(2, 8);
        }
        if (validated.slug.length > 63) {
          validated.slug = validated.slug.substring(0, 63).replace(/-$/, '');
        }
      }
      
      // Ensure slug uniqueness
      const existing = db.prepare('SELECT id FROM servers WHERE slug = ?').get(validated.slug);
      if (existing) {
        throw new HttpError(400, `A server with slug "${validated.slug}" already exists.`);
      }

      const installPath = path.join(config.serversDir, validated.slug);

      // Create installation folder
      if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
      }

      const stmt = db.prepare(`
        INSERT INTO servers (name, slug, description, install_path, port, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const port = validated.port || 25565;
      const result = stmt.run(validated.name, validated.slug, validated.description || '', installPath, port, 'uninstalled');
      
      const serverId = result.lastInsertRowid;

      // Log audit
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'create-server', `server:${serverId}`, `Created server ${validated.slug} at ${installPath}`, req.ip);

      res.status(201).json(getServer(db, serverId));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(new HttpError(400, 'Invalid request input data.', err.errors));
      }
      next(err);
    }
  });

  // PATCH /api/servers/:id
  router.patch('/:id', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      
      // Retrieve server first
      const server = getServer(db, id);
      const validated = updateServerSchema.parse(req.body);

      // Prepare updates dynamically
      const keys = Object.keys(validated);
      if (keys.length === 0) {
        return res.json(server);
      }

      const sets = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => {
        if (k === 'autostart') return validated[k] ? 1 : 0;
        if ((k === 'restart_schedule' || k === 'webhook_url') && validated[k] === '') return null;
        return validated[k];
      });

      db.prepare(`UPDATE servers SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);

      // Log audit
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'update-server', `server:${id}`, `Updated settings: ${keys.join(', ')}`, req.ip);

      res.json(getServer(db, id));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(new HttpError(400, 'Invalid update data.', err.errors));
      }
      next(err);
    }
  });

  // DELETE /api/servers/:id
  router.delete('/:id', requireRole('admin'), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      
      const server = getServer(db, id);
      if (server.isRunning) {
        throw new HttpError(400, 'Cannot delete a running server. Please stop it first.');
      }

      db.prepare('DELETE FROM servers WHERE id = ?').run(id);

      // Log audit
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'delete-server', `server:${id}`, `Deleted server DB record for ${server.slug} (files preserved at ${server.install_path})`, req.ip);

      res.json({ message: `Server database record removed. Files kept at ${server.install_path}` });
    } catch (err) {
      next(err);
    }
  });

  // Actions REST routes

  // POST /api/servers/:id/action (Multiplexed frontend actions)
  router.post('/:id/action', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { action } = req.body;
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      if (!action || !['start', 'stop', 'restart'].includes(action)) {
        throw new HttpError(400, 'Valid action (start, stop, restart) is required.');
      }

      const server = getServer(db, id);
      if (server.status === 'uninstalled') {
        throw new HttpError(400, `Cannot ${action} server. Hytale server files are not installed.`);
      }

      if (action === 'start') {
        await startServer(db, id);
        db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.sub, 'start-server', `server:${id}`, `Started Hytale server process`, req.ip);
      } else if (action === 'stop') {
        await stopServer(db, id);
        db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.sub, 'stop-server', `server:${id}`, `Stopped Hytale server process`, req.ip);
      } else if (action === 'restart') {
        await restartServer(db, id);
        db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.sub, 'restart-server', `server:${id}`, `Restarted Hytale server process`, req.ip);
      }

      res.json({ message: `Server action ${action} executed successfully.` });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/start
  router.post('/:id/start', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      
      const server = getServer(db, id);
      if (server.status === 'uninstalled') {
        throw new HttpError(400, 'Cannot start server. Hytale server files are not installed.');
      }
      
      await startServer(db, id);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'start-server', `server:${id}`, `Started Hytale server process`, req.ip);
        
      res.json({ message: 'Server starting command issued.' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/stop
  router.post('/:id/stop', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      await stopServer(db, id);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'stop-server', `server:${id}`, `Stopped Hytale server process`, req.ip);
        
      res.json({ message: 'Server stopping command issued.' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/restart
  router.post('/:id/restart', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      
      const server = getServer(db, id);
      if (server.status === 'uninstalled') {
        throw new HttpError(400, 'Cannot restart server. Hytale server files are not installed.');
      }
      
      await restartServer(db, id);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'restart-server', `server:${id}`, `Restarted Hytale server process`, req.ip);
        
      res.json({ message: 'Server restarting command issued.' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/install-files (deploy Hytale files from shared cache)
  router.post('/:id/install-files', requireServerAccess('operator', db), async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      const result = await installServerFiles(db, id);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'install-server-files', `server:${id}`, `Installed Hytale server files from central cache`, req.ip);

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/command
  router.post('/:id/command', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { command } = req.body;
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      if (!command) throw new HttpError(400, 'Command string is required.');
      
      sendCommand(db, id, command);
      res.json({ message: 'Command sent successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:id/logs
  router.get('/:id/logs', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit || '100', 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      
      const logs = db.prepare(`
        SELECT id, stream, line, created_at
        FROM server_logs
        WHERE server_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(id, limit);
      
      res.json(logs.reverse());
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:id/players (retrieve online players list)
  router.get('/:id/players', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      const players = getOnlinePlayers(id);
      res.json(players);
    } catch (err) {
      next(err);
    }
  });

  // Backups Routes

  // GET /api/servers/:id/backups (list backups)
  router.get('/:id/backups', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      const backups = listBackups(db, id);
      res.json(backups);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/backups (create backup)
  router.post('/:id/backups', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      const backup = createBackup(db, id);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'create-backup', `server:${id}`, `Created backup file ${backup.filename}`, req.ip);

      res.status(201).json(backup);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/servers/:id/backups (delete backup)
  router.delete('/:id/backups', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { backup_file } = req.body;
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      if (!backup_file) throw new HttpError(400, 'Backup file name is required.');

      const server = getServer(db, id);
      const cleanFilename = path.basename(backup_file);
      const backupsDir = path.join(server.install_path, '.backups');
      const filePath = path.join(backupsDir, cleanFilename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ message: 'Backup file deleted successfully.' });
      } else {
        throw new HttpError(404, 'Backup file not found.');
      }
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/backups/:filename/restore (restore backup)
  router.post('/:id/backups/:filename/restore', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const filename = req.params.filename;
    try {
      if (isNaN(id)) throw new HttpError(400, 'Invalid server ID.');
      if (!filename) throw new HttpError(400, 'Filename is required.');
      
      restoreBackup(db, id, filename);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'restore-backup', `server:${id}`, `Restored backup file ${filename}`, req.ip);

      res.json({ message: 'Backup restored successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // Visual Configuration Editor Routes

  // GET /api/servers/:id/config-files
  router.get('/:id/config-files', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      const server = getServer(db, id);
      const targetDir = path.resolve(server.install_path);
      const files = ['server.json', 'game.json'].filter(f => fs.existsSync(path.join(targetDir, f)));
      
      res.json(files.length > 0 ? files : ['server.json']);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:id/config-files/:filename
  router.get('/:id/config-files/:filename', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { filename } = req.params;
    try {
      if (!['server.json', 'game.json'].includes(filename)) {
        throw new HttpError(400, 'Invalid configuration filename.');
      }
      const server = getServer(db, id);
      const filePath = path.join(path.resolve(server.install_path), filename);
      
      let configObj = {};
      if (fs.existsSync(filePath)) {
        try {
          configObj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (_) {
          configObj = {};
        }
      } else {
        if (filename === 'server.json') {
          configObj = {
            serverName: server.name,
            description: server.description || '',
            port: server.port || 25565,
            maxPlayers: 20,
            bindAddress: '0.0.0.0',
            whitelistEnabled: false,
            announceToMasterServer: false
          };
        }
      }
      res.json(configObj);
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/servers/:id/config-files/:filename
  router.put('/:id/config-files/:filename', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { filename } = req.params;
    const newConfig = req.body;
    try {
      if (!['server.json', 'game.json'].includes(filename)) {
        throw new HttpError(400, 'Invalid configuration filename.');
      }
      if (!newConfig || typeof newConfig !== 'object') {
        throw new HttpError(400, 'Payload must be a valid JSON object.');
      }
      const server = getServer(db, id);
      const filePath = path.join(path.resolve(server.install_path), filename);
      
      fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf8');

      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'edit-config-file', `server:${id}`, `Saved configuration file ${filename}`, req.ip);

      res.json({ message: 'Configuration saved successfully.', config: newConfig });
    } catch (err) {
      next(err);
    }
  });

  // Schedules (Cron Scheduler) Routes

  // GET /api/servers/:id/schedules
  router.get('/:id/schedules', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    try {
      const rows = db.prepare('SELECT * FROM server_schedules WHERE server_id = ? ORDER BY id DESC').all(id);
      const schedules = rows.map(r => ({ ...r, is_active: r.is_active === 1 }));
      res.json(schedules);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:id/schedules
  router.post('/:id/schedules', requireServerAccess('operator', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { name, cron_expression, action, action_payload } = req.body;
    try {
      if (!name || !cron_expression || !action) {
        throw new HttpError(400, 'Name, cron expression, and action are required.');
      }
      const fields = cron_expression.trim().split(/\s+/);
      if (fields.length !== 5) {
        throw new HttpError(400, 'Cron expression must contain exactly 5 fields.');
      }

      db.prepare(`
        INSERT INTO server_schedules (server_id, name, cron_expression, action, action_payload, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(id, name, cron_expression, action, action_payload || '');

      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'create-schedule', `server:${id}`, `Created schedule: ${name} (${action})`, req.ip);

      res.status(201).json({ message: 'Schedule created successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/servers/:id/schedules/:scheduleId
  router.patch('/:id/schedules/:scheduleId', requireServerAccess('operator', db), (req, res, next) => {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    const { name, cron_expression, action, action_payload, is_active } = req.body;
    try {
      if (isNaN(scheduleId)) throw new HttpError(400, 'Invalid schedule ID.');
      
      const keys = [];
      const values = [];
      if (name !== undefined) { keys.push('name = ?'); values.push(name); }
      if (cron_expression !== undefined) {
        const fields = cron_expression.trim().split(/\s+/);
        if (fields.length !== 5) throw new HttpError(400, 'Cron expression must contain exactly 5 fields.');
        keys.push('cron_expression = ?');
        values.push(cron_expression);
      }
      if (action !== undefined) { keys.push('action = ?'); values.push(action); }
      if (action_payload !== undefined) { keys.push('action_payload = ?'); values.push(action_payload); }
      if (is_active !== undefined) { keys.push('is_active = ?'); values.push(is_active ? 1 : 0); }

      if (keys.length > 0) {
        values.push(scheduleId);
        db.prepare(`UPDATE server_schedules SET ${keys.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
      }

      res.json({ message: 'Schedule updated successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/servers/:id/schedules/:scheduleId
  router.delete('/:id/schedules/:scheduleId', requireServerAccess('operator', db), (req, res, next) => {
    const scheduleId = parseInt(req.params.scheduleId, 10);
    try {
      if (isNaN(scheduleId)) throw new HttpError(400, 'Invalid schedule ID.');
      db.prepare('DELETE FROM server_schedules WHERE id = ?').run(scheduleId);
      res.json({ message: 'Schedule deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // Server Performance Metrics Routes

  // GET /api/servers/:id/metrics
  router.get('/:id/metrics', requireServerAccess('viewer', db), (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit || '60', 10);
    try {
      const metrics = db.prepare(`
        SELECT cpu_percentage, ram_bytes, player_count, recorded_at 
        FROM server_metrics 
        WHERE server_id = ? 
        ORDER BY id DESC 
        LIMIT ?
      `).all(id, limit);
      res.json(metrics.reverse());
    } catch (err) {
      next(err);
    }
  });

  return router;
};
