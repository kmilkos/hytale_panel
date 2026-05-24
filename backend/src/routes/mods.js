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
const { buildCdnUrl } = require('../services/curseForgeService');

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

        // Check for associated configuration or data folders
        const cleanDirName = cleanName.replace(/\.(jar|zip)$/i, '');
        const foldersToCheck = [
          path.join(modsDir, cleanDirName),
          path.join(modsDir, 'config', cleanDirName)
        ];
        const associatedFolders = [];
        for (const fPath of foldersToCheck) {
          if (fs.existsSync(fPath) && fs.statSync(fPath).isDirectory()) {
            associatedFolders.push(path.relative(server.install_path, fPath));
          }
        }

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
          associatedFolders,
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

  // DELETE /api/servers/:serverId/mods - Delete a mod file and handle folders
  router.delete('/server/:serverId', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName, deleteFoldersAction } = req.body; // 'delete' | 'backup' | 'keep'
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');

      const { modsDir, server } = resolveModsDir(serverId);
      const safePath = resolveSafePath(server.install_path, path.join('Server', 'mods', fileName));

      if (!fs.existsSync(safePath)) {
        throw new HttpError(404, 'Mod file not found.');
      }

      // 1. Delete the mod file itself
      fs.unlinkSync(safePath);

      // 2. Identify associated folders
      const cleanName = fileName.replace('.disabled', '');
      const cleanDirName = cleanName.replace(/\.(jar|zip)$/i, '');
      const foldersToCheck = [
        path.join(modsDir, cleanDirName),
        path.join(modsDir, 'config', cleanDirName)
      ];
      
      const processedFolders = [];

      for (const fPath of foldersToCheck) {
        if (fs.existsSync(fPath) && fs.statSync(fPath).isDirectory()) {
          const relativePath = path.relative(server.install_path, fPath);
          
          if (deleteFoldersAction === 'delete') {
            fs.rmSync(fPath, { recursive: true, force: true });
            processedFolders.push({ path: relativePath, action: 'deleted' });
          } else if (deleteFoldersAction === 'backup') {
            const backupsDir = path.join(server.install_path, '.backups', 'mods_data');
            const modBackupDir = path.join(backupsDir, `${cleanDirName}_${Date.now()}`);
            if (!fs.existsSync(modBackupDir)) {
              fs.mkdirSync(modBackupDir, { recursive: true });
            }
            const destSubPath = path.join(modBackupDir, relativePath);
            const destSubDir = path.dirname(destSubPath);
            if (!fs.existsSync(destSubDir)) {
              fs.mkdirSync(destSubDir, { recursive: true });
            }
            fs.renameSync(fPath, destSubPath);
            processedFolders.push({ path: relativePath, action: 'backed_up', backupPath: path.relative(server.install_path, destSubPath) });
          } else {
            processedFolders.push({ path: relativePath, action: 'kept' });
          }
        }
      }

      // Clean up record in DB if it was logged
      db.prepare('DELETE FROM installed_mods WHERE server_id = ? AND (file_name = ? OR file_name = ?)')
        .run(serverId, fileName, cleanName);

      // Log audit trail
      const detailsMsg = `Deleted mod file ${fileName}. Associated folders: ${JSON.stringify(processedFolders)}`;
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'delete-mod', `server:${serverId}`, detailsMsg, req.ip);

      // Re-run conflict detection
      await detectConflicts(db, serverId);

      res.json({ message: 'Mod file deleted successfully.', processedFolders });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:serverId/mods/install-check - Check if backups exist for a mod before installing
  router.get('/server/:serverId/install-check', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName } = req.query;
    try {
      if (!fileName) throw new HttpError(400, 'FileName query parameter is required.');

      const { server } = resolveModsDir(serverId);
      const backupsDir = path.join(server.install_path, '.backups', 'mods_data');
      
      const cleanName = fileName.replace('.disabled', '');
      const cleanDirName = cleanName.replace(/\.(jar|zip)$/i, '');

      const availableBackups = [];

      if (fs.existsSync(backupsDir)) {
        const items = fs.readdirSync(backupsDir);
        for (const item of items) {
          const itemPath = path.join(backupsDir, item);
          if (fs.statSync(itemPath).isDirectory() && item.startsWith(`${cleanDirName}_`)) {
            const timestampPart = item.substring(cleanDirName.length + 1);
            const timestamp = parseInt(timestampPart, 10);
            if (!isNaN(timestamp)) {
              availableBackups.push({
                id: item,
                timestamp: new Date(timestamp).toISOString(),
                dateFormatted: new Date(timestamp).toLocaleString()
              });
            }
          }
        }
      }

      // Sort newest first
      availableBackups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json({
        hasBackup: availableBackups.length > 0,
        backups: availableBackups
      });
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

  // POST /api/servers/:serverId/mods/install - Download mod from CurseForge or direct URL and optionally restore backup
  router.post('/server/:serverId/install', async (req, res, next) => {
    const { serverId } = req.params;
    const { source, modId, fileId, downloadUrl, fileName, sha1, restoreBackupId } = req.body;
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');

      const { server } = resolveModsDir(serverId);

      // Handle restoring a previous data/config folder backup if requested
      if (restoreBackupId) {
        const backupsDir = path.join(server.install_path, '.backups', 'mods_data');
        const safeBackupPath = resolveSafePath(backupsDir, restoreBackupId);
        
        if (fs.existsSync(safeBackupPath)) {
          const logger = require('../utils/logger');
          logger.info(`Restoring associated data backup: ${restoreBackupId} for mod ${fileName}`);
          
          const restoreFolderTree = (src, dest) => {
            if (!fs.existsSync(src)) return;
            const items = fs.readdirSync(src);
            for (const item of items) {
              const srcPath = path.join(src, item);
              const destPath = path.join(dest, item);
              const stat = fs.statSync(srcPath);
              if (stat.isDirectory()) {
                if (!fs.existsSync(destPath)) {
                  fs.mkdirSync(destPath, { recursive: true });
                }
                restoreFolderTree(srcPath, destPath);
              } else {
                fs.copyFileSync(srcPath, destPath);
              }
            }
          };

          restoreFolderTree(safeBackupPath, server.install_path);
          // Delete backup directory after successful restore
          fs.rmSync(safeBackupPath, { recursive: true, force: true });
          logger.info(`Successfully restored data backup: ${restoreBackupId}`);
        }
      }

      let resolvedUrl = downloadUrl || null;
      
      // If CurseForge and URL is missing or null, resolve the real CDN URL via API
      // (CurseForge intentionally omits downloadUrl for some files in the file list)
      if (source === 'curseforge' && modId && fileId && !resolvedUrl) {
        // Pass fileName so the service can fall back to CDN URL without API key
        resolvedUrl = await curseForgeService.getModFileDownloadUrl(db, modId, fileId, fileName);
      }

      // Final safety net: if still no URL but we have fileId + fileName, build CDN URL directly
      if (!resolvedUrl && source === 'curseforge' && fileId && fileName) {
        resolvedUrl = buildCdnUrl(fileId, fileName);
        const logger = require('../utils/logger');
        logger.info(`Using direct CDN URL fallback for ${fileName}: ${resolvedUrl}`);
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
        .run(req.user.sub, 'install-mod', `server:${serverId}`, `Triggered install of mod ${fileName} from ${source || 'direct'}${restoreBackupId ? ' (restored backup ' + restoreBackupId + ')' : ''}`, req.ip);

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
