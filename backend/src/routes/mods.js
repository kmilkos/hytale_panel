const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { getServer } = require('../services/serverService');
const { resolveSafePath } = require('../services/fileService');
const curseForgeService = require('../services/curseForgeService');
const nexusModsService = require('../services/nexusModsService');
const { detectConflicts } = require('../services/conflictDetectionService');
const { getActiveDownloads, downloadModFile } = require('../services/installService');

module.exports = function(db) {
  const router = express.Router();

  // Require authentication for all mod endpoints
  router.use(requireAuth);

  // Helper to resolve server mods directory path
  function resolveModsDir(serverId) {
    const server = getServer(db, parseInt(serverId, 10));
    const modsDir = path.join(server.install_path, 'Server', 'mods');
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }
    return { modsDir, server };
  }

  // GET /api/servers/:serverId/mods - List installed mods with status and db metadata
  router.get('/server/:serverId', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const { modsDir, server } = resolveModsDir(serverId);
      const files = fs.readdirSync(modsDir);
      
      // Fetch installed mods records from DB
      const dbMods = db.prepare('SELECT * FROM installed_mods WHERE server_id = ?').all(serverId);
      const dbModsMap = new Map();
      for (const m of dbMods) {
        dbModsMap.set(m.file_name, m);
      }

      // Fetch conflicts
      const conflicts = db.prepare('SELECT * FROM mod_conflicts WHERE server_id = ?').all(serverId);

      const installedList = files.map(filename => {
        const fullPath = path.join(modsDir, filename);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) return null; // Only files for now

        const isActive = !filename.endsWith('.disabled');
        const cleanName = filename.replace('.disabled', '');
        
        // Match with DB metadata
        const dbMeta = dbModsMap.get(cleanName) || dbModsMap.get(filename);
        
        // Find if this mod is involved in any active conflicts
        const modConflicts = conflicts.filter(c => 
          c.mod1_name === cleanName || 
          c.mod1_name === dbMeta?.mod_name ||
          c.mod2_name === cleanName ||
          c.mod2_name === dbMeta?.mod_name
        );

        return {
          fileName: filename,
          isActive,
          size: stat.size,
          mtime: stat.mtime,
          modId: dbMeta?.curseforge_mod_id || 'manual',
          fileId: dbMeta?.curseforge_file_id || 'manual',
          name: dbMeta?.mod_name || cleanName.replace(/\.(jar|zip)$/i, '').replace(/[-_]/g, ' '),
          sha1: dbMeta?.sha1 || null,
          cdnUrl: dbMeta?.cdn_url || null,
          conflicts: modConflicts.map(c => ({
            type: c.conflict_type,
            severity: c.severity,
            details: c.details
          }))
        };
      }).filter(Boolean);

      res.json({
        mods: installedList,
        conflictsCount: conflicts.length
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:serverId/mods/toggle - Toggle mod (.disabled extension toggle)
  router.post('/server/:serverId/toggle', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName } = req.body;
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');
      
      const { modsDir, server } = resolveModsDir(serverId);
      const safeOldPath = resolveSafePath(server.install_path, path.join('Server', 'mods', fileName));
      
      if (!fs.existsSync(safeOldPath)) {
        throw new HttpError(404, 'Mod file not found.');
      }

      let newFileName;
      if (fileName.endsWith('.disabled')) {
        newFileName = fileName.substring(0, fileName.length - 9); // Remove .disabled
      } else {
        newFileName = fileName + '.disabled';
      }

      const safeNewPath = resolveSafePath(server.install_path, path.join('Server', 'mods', newFileName));
      fs.renameSync(safeOldPath, safeNewPath);

      // Log audit trail
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'toggle-mod', `server:${serverId}`, `Toggled mod ${fileName} to ${newFileName}`, req.ip);

      // Re-run conflict detection
      await detectConflicts(db, serverId);

      res.json({ message: 'Mod toggled successfully.', newFileName });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/servers/:serverId/mods - Delete a mod file
  router.delete('/server/:serverId', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName } = req.body;
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');

      const { modsDir, server } = resolveModsDir(serverId);
      const safePath = resolveSafePath(server.install_path, path.join('Server', 'mods', fileName));

      if (!fs.existsSync(safePath)) {
        throw new HttpError(404, 'Mod file not found.');
      }

      fs.unlinkSync(safePath);

      // Clean up record in DB if it was logged
      const cleanName = fileName.replace('.disabled', '');
      db.prepare('DELETE FROM installed_mods WHERE server_id = ? AND (file_name = ? OR file_name = ?)')
        .run(serverId, fileName, cleanName);

      // Log audit trail
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'delete-mod', `server:${serverId}`, `Deleted mod file ${fileName}`, req.ip);

      // Re-run conflict detection
      await detectConflicts(db, serverId);

      res.json({ message: 'Mod file deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:serverId/mods/conflicts - Fetch detected conflicts
  router.get('/server/:serverId/conflicts', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const conflicts = db.prepare('SELECT * FROM mod_conflicts WHERE server_id = ?').all(serverId);
      res.json(conflicts);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:serverId/mods/scan - Trigger manual conflict scan
  router.post('/server/:serverId/scan', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const conflicts = await detectConflicts(db, serverId);
      res.json({ message: 'Scan completed.', conflictsCount: conflicts.length, conflicts });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:serverId/mods/downloads - Get active downloads progress
  router.get('/server/:serverId/downloads', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const list = getActiveDownloads(parseInt(serverId, 10));
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:serverId/mods/install - Download mod from CurseForge or direct URL
  router.post('/server/:serverId/install', async (req, res, next) => {
    const { serverId } = req.params;
    const { source, modId, fileId, downloadUrl, fileName, sha1 } = req.body;
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');

      let resolvedUrl = downloadUrl;
      
      // If CurseForge and URL is missing, resolve URL dynamically
      if (source === 'curseforge' && modId && fileId && !resolvedUrl) {
        resolvedUrl = await curseForgeService.getModFileDownloadUrl(db, modId, fileId);
      }

      if (!resolvedUrl) {
        throw new HttpError(400, 'Could not resolve mod file download URL.');
      }

      const result = await downloadModFile(db, parseInt(serverId, 10), resolvedUrl, fileName, {
        curseforgeModId: modId,
        curseforgeFileId: fileId,
        sha1
      });

      // Log audit log
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'install-mod', `server:${serverId}`, `Triggered install of mod ${fileName} from ${source || 'direct'}`, req.ip);

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/mods/search - Unified browse and search mods
  router.get('/search', async (req, res, next) => {
    const { q = '', source = 'curseforge', categoryId, offset = 0, limit = 20 } = req.query;
    try {
      let results = [];
      const opts = {
        query: q,
        categoryId: categoryId ? parseInt(categoryId, 10) : null,
        offset: parseInt(offset, 10),
        limit: parseInt(limit, 10),
      };

      if (source === 'nexus') {
        results = await nexusModsService.searchMods(db, opts);
      } else {
        // Default to curseforge
        results = await curseForgeService.searchMods(db, opts);
      }

      res.json(results);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/mods/:source/:modId - Retrieve mod details
  router.get('/details/:source/:modId', async (req, res, next) => {
    const { source, modId } = req.params;
    try {
      let details;
      if (source === 'nexus') {
        details = await nexusModsService.getMod(db, modId);
      } else {
        details = await curseForgeService.getMod(db, modId);
      }
      res.json(details);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/mods/:source/:modId/files - Retrieve files list
  router.get('/details/:source/:modId/files', async (req, res, next) => {
    const { source, modId } = req.params;
    try {
      let files = [];
      if (source === 'nexus') {
        files = await nexusModsService.getModFiles(db, modId);
      } else {
        files = await curseForgeService.getModFiles(db, modId);
      }
      res.json(files);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
