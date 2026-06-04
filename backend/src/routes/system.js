const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const {
  isInstallerCached,
  getInstallerDownloadState,
  cacheInstaller,
  getDiskUsage,
  abortInstaller,
  resolveServerVersion,
} = require('../services/serverService');

module.exports = function(db) {
  const router = express.Router();

  // All endpoints require auth
  router.use(requireAuth);

  // GET /api/system/stats - Server machine status check
  router.get('/stats', async (req, res, next) => {
    try {
      const uptime = os.uptime();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const cpus = os.cpus();
      const loadAvg = os.loadavg(); // Returns load avg for 1, 5, 15 minutes (Unix only)
      const disk = await getDiskUsage();

      // Fetch active Hytale server performance snapshots
      const runningServers = db.prepare("SELECT id, name, slug, port FROM servers WHERE status = 'running'").all();
      const getLatestMetric = db.prepare("SELECT cpu_percentage, ram_bytes FROM server_metrics WHERE server_id = ? ORDER BY id DESC LIMIT 1");
      
      const activeInstances = [];
      for (const srv of runningServers) {
        const metric = getLatestMetric.get(srv.id);
        activeInstances.push({
          id: srv.id,
          name: srv.name,
          slug: srv.slug,
          port: srv.port,
          cpu: metric ? metric.cpu_percentage : 0,
          ram: metric ? metric.ram_bytes : 0
        });
      }

      res.json({
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        cpus: cpus.map((c, i) => ({ id: i, model: c.model, speed: c.speed, times: c.times })),
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          percentage: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
        },
        disk,
        uptime: Math.round(uptime),
        nodeVersion: process.version,
        loadAverage: loadAvg,
        activeInstances
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/metrics - Retrieve historical host metrics
  router.get('/metrics', (req, res, next) => {
    const limit = parseInt(req.query.limit || '120', 10);
    try {
      const metrics = db.prepare(`
        SELECT cpu_percentage, ram_bytes, disk_bytes, active_servers, recorded_at
        FROM system_metrics
        ORDER BY id DESC
        LIMIT ?
      `).all(limit);
      res.json(metrics.reverse());
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

  // GET /api/system/versions - List available cached Hytale server versions
  router.get('/versions', (req, res, next) => {
    try {
      const versions = [];

      // 1. Get patchlines: release and pre-release
      const patchlines = ['release', 'pre-release'];
      for (const pl of patchlines) {
        let isCached = false;
        let resolvedVersion = null;
        try {
          const cachedRow = db.prepare("SELECT version FROM cached_versions WHERE patchline = ? ORDER BY id DESC LIMIT 1").get(pl);
          if (cachedRow) {
            resolvedVersion = cachedRow.version;
            isCached = isInstallerCached(resolvedVersion);
          }
        } catch (_) {}
        versions.push({
          version: pl,
          isCached,
          isPatchline: true,
          resolvedVersion
        });
      }

      // 2. Query all mapped versions from database
      let dbRows = [];
      try {
        dbRows = db.prepare('SELECT version, patchline FROM cached_versions ORDER BY id DESC').all();
      } catch (_) {
        // Table might not be ready or empty
      }

      for (const row of dbRows) {
        const isCached = isInstallerCached(row.version);
        versions.push({
          version: row.version,
          isCached,
          isPatchline: false,
          patchline: row.patchline
        });
      }

      // 3. Scan physical folders in versions directory to find any other untracked versions
      const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
      const versionsDir = path.join(sharedDir, 'versions');
      if (fs.existsSync(versionsDir)) {
        const items = fs.readdirSync(versionsDir);
        for (const item of items) {
          const itemPath = path.join(versionsDir, item);
          if (fs.statSync(itemPath).isDirectory()) {
            if (!versions.find(v => v.version === item)) {
              const isCached = isInstallerCached(item);
              versions.push({
                version: item,
                isCached,
                isPatchline: false
              });
            }
          }
        }
      }

      res.json(versions);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/system/installer-status - Check if central installer is ready
  router.get('/installer-status', (req, res, next) => {
    const { version = 'release' } = req.query;
    try {
      let targetVersion = version;
      if (targetVersion === 'latest') targetVersion = 'release';
      const isCached = isInstallerCached(db, targetVersion);
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
    const { downloadUrl, version = 'release' } = req.body;
    try {
      let url = downloadUrl;
      if (!url) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('hytale_installer_url');
        url = row ? row.value : '';
      }
      
      if (!url) {
        url = 'https://downloader.hytale.com/hytale-downloader.zip';
      }

      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('hytale_installer_url', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(url);

      let patchline = version;
      if (patchline === 'latest') patchline = 'release';

      const result = await cacheInstaller(db, url, patchline);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'download-installer', 'system', `Triggered Hytale installer cache from ${url}`, req.ip);

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/system/abort-installer - Terminate active installer download/process
  router.post('/abort-installer', async (req, res, next) => {
    try {
      const result = await abortInstaller();
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'abort-installer', 'system', 'Manually aborted Hytale installer process', req.ip);

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/system/check-files - Scans filesystem for manually placed Hytale server cache files and registers them
  router.post('/check-files', async (req, res, next) => {
    try {
      const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
      const versionsDir = path.join(sharedDir, 'versions');
      const detected = [];

      // Helper function to check if a specific version directory is cached
      const verifyVersionCached = (ver) => {
        const dir = path.join(versionsDir, ver);
        const jarPath = path.join(dir, 'Server', 'HytaleServer.jar');
        const assetsPath = path.join(dir, 'Assets.zip');
        return fs.existsSync(jarPath) && fs.existsSync(assetsPath);
      };

      if (fs.existsSync(versionsDir)) {
        const items = fs.readdirSync(versionsDir);
        
        // Prepare database statement to register version
        const insertStmt = db.prepare(`
          INSERT INTO cached_versions (version, folder_name, patchline, cached_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(version) DO UPDATE SET folder_name = excluded.folder_name, cached_at = datetime('now')
        `);

        for (const item of items) {
          const itemPath = path.join(versionsDir, item);
          if (fs.statSync(itemPath).isDirectory()) {
            if (verifyVersionCached(item)) {
              // Determine patchline (guess based on version name)
              let patchline = 'release';
              if (item.toLowerCase().includes('pre') || item.toLowerCase().includes('alpha') || item.toLowerCase().includes('beta') || item.toLowerCase().includes('dev')) {
                patchline = 'pre-release';
              }
              
              // Register in DB
              insertStmt.run(item, item, patchline);
              
              detected.push({
                version: item,
                patchline,
                status: 'verified'
              });
            }
          }
        }
      }

      // Log the action to audit log
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(
          req.user.sub,
          'check-files',
          'system',
          `Scanned cache directories and registered ${detected.length} versions: ${detected.map(d => d.version).join(', ')}`,
          req.ip
        );

      res.json({
        success: true,
        message: `Scan complete. Detected and registered ${detected.length} version(s).`,
        detected
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/system/cache/:version - Delete a cached server version
  router.delete('/cache/:version', (req, res, next) => {
    const { version } = req.params;
    try {
      // 1. Resolve to target version if a patchline is given
      let targetVersion = version;
      if (['release', 'pre-release'].includes(version)) {
        const cachedRow = db.prepare("SELECT version FROM cached_versions WHERE patchline = ? ORDER BY id DESC LIMIT 1").get(version);
        if (cachedRow) {
          targetVersion = cachedRow.version;
        } else {
          throw new HttpError(404, `No cached version found for patchline "${version}"`);
        }
      }

      // 2. Check if any running server is using this version
      const servers = db.prepare('SELECT id, name, status, server_version FROM servers').all();
      const runningUsingServers = [];
      
      for (const s of servers) {
        const resolved = resolveServerVersion(db, s);
        if (resolved === targetVersion) {
          if (s.status === 'running') {
            runningUsingServers.push(s.name);
          }
        }
      }

      if (runningUsingServers.length > 0) {
        throw new HttpError(400, `Cannot delete cache for version "${targetVersion}" because it is currently in use by running server(s): ${runningUsingServers.join(', ')}. Please stop them first.`);
      }

      // 3. Delete directory recursively
      const sharedDir = path.join(__dirname, '..', '..', '..', 'shared');
      const versionDir = path.join(sharedDir, 'versions', targetVersion);
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }

      // 4. Delete from database table cached_versions
      db.prepare('DELETE FROM cached_versions WHERE version = ?').run(targetVersion);

      // 5. Audit Log
      db.prepare(`
        INSERT INTO audit_log (user_id, action, target, details, ip)
        VALUES (?, 'delete-cache', ?, ?, ?)
      `).run(req.user.sub, `cache:${targetVersion}`, `Deleted Hytale server version cache for ${targetVersion}`, req.ip);

      res.json({ message: `Successfully deleted server cache for version "${targetVersion}".` });
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
        const script = `# register-service.ps1\r\n# Run in an elevated PowerShell terminal to boot Hytale Panel on startup\r\n$Action = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "start" -WorkingDirectory "${rootPath}"\r\n$Trigger = New-ScheduledTaskTrigger -AtStartup\r\n$Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\\SYSTEM" -LogonType ServiceAccount\r\n$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\r\n$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings\r\nRegister-ScheduledTask -TaskName "HytaleClusterManager" -InputObject $Task -Force\r\nWrite-Host "Hytale Panel registered successfully as a Windows Startup Task."\r\n`;
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
  router.get('/update-check', async (req, res) => {
    try {
      const rootPkg = require('../../../package.json');
      const currentVersion = rootPkg.version || '1.0.1';
      
      let latestVersion = currentVersion;
      let changelog = 'No updates available. You are running the latest stable release.';
      let needsUpdate = false;

      try {
        const response = await fetch('https://raw.githubusercontent.com/kmilkos/hytale_panel/main/package.json', {
          headers: { 'User-Agent': 'Hytale-Cluster-Manager-Panel' },
          signal: AbortSignal.timeout(5000) // 5s timeout
        });
        if (response.ok) {
          const githubPkg = await response.json();
          if (githubPkg && githubPkg.version) {
            latestVersion = githubPkg.version;
            
            // Compare versions (semver check)
            const parseVersion = (v) => v.split('.').map(Number);
            const curr = parseVersion(currentVersion);
            const lat = parseVersion(latestVersion);
            
            let isNewer = false;
            for (let i = 0; i < 3; i++) {
              const c = curr[i] || 0;
              const l = lat[i] || 0;
              if (l > c) {
                isNewer = true;
                break;
              } else if (l < c) {
                break;
              }
            }
            
            if (isNewer) {
              needsUpdate = true;
              changelog = `A new update (v${latestVersion}) is available on GitHub! Please pull the latest changes to update your panel.`;
            }
          }
        }
      } catch (err) {
        console.error('Failed to check for updates on GitHub:', err.message);
        changelog = `Failed to check for updates: ${err.message}. Local version is ${currentVersion}.`;
      }

      res.json({
        currentVersion,
        latestVersion,
        needsUpdate,
        changelog,
      });
    } catch (err) {
      res.json({
        currentVersion: '1.0.1',
        latestVersion: '1.0.1',
        needsUpdate: false,
        changelog: `Failed to retrieve version information: ${err.message}`,
      });
    }
  });

  return router;
};
