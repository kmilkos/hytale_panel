const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { getServer, resolveServerVersion, installServerFiles, isInstallerCached } = require('../services/serverService');
const { resolveSafePath } = require('../services/fileService');
const curseForgeService = require('../services/curseForgeService');
const nexusModsService = require('../services/nexusModsService');
const { detectConflicts } = require('../services/conflictDetectionService');
const { getActiveDownloads, downloadModFile } = require('../services/installService');
const { buildCdnUrl } = require('../services/curseForgeService');

function isVersionCompatible(gameVersions, targetVersion) {
  if (!Array.isArray(gameVersions)) return false;
  return (
    gameVersions.includes(targetVersion) ||
    gameVersions.includes('release') ||
    gameVersions.some(gv => targetVersion === gv || targetVersion.startsWith(gv + '.'))
  );
}

module.exports = function(db) {
  const router = express.Router();

  // Require authentication for all mod endpoints
  router.use(requireAuth);

  // Helper to resolve server mods directory path
  function resolveModsDir(serverId) {
    const server = getServer(db, parseInt(serverId, 10));
    const modsDir = path.join(server.install_path, 'mods');
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }
    return { modsDir, server };
  }


  // POST /api/servers/:serverId/mods/toggle - Toggle mod (.disabled extension toggle)
  router.post('/server/:serverId/toggle', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName } = req.body;
    try {
      if (!fileName) throw new HttpError(400, 'FileName is required.');
      
      const { modsDir, server } = resolveModsDir(serverId);
      const safeOldPath = resolveSafePath(server.install_path, path.join('mods', fileName));
      
      if (!fs.existsSync(safeOldPath)) {
        throw new HttpError(404, 'Mod file not found.');
      }

      let newFileName;
      if (fileName.endsWith('.disabled')) {
        newFileName = fileName.substring(0, fileName.length - 9); // Remove .disabled
      } else {
        newFileName = fileName + '.disabled';
      }

      const safeNewPath = resolveSafePath(server.install_path, path.join('mods', newFileName));
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
      const safePath = resolveSafePath(server.install_path, path.join('mods', fileName));

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

  // GET /api/servers/:serverId/mods/configs - Find editable configurations for an installed mod
  router.get('/server/:serverId/configs', async (req, res, next) => {
    const { serverId } = req.params;
    const { fileName } = req.query;
    try {
      if (!fileName) throw new HttpError(400, 'FileName query parameter is required.');

      const { server } = resolveModsDir(serverId);
      const cleanName = fileName.replace('.disabled', '').replace(/\.(jar|zip)$/i, '');
      
      const candidatePaths = [
        path.join(server.install_path, 'mods', cleanName),
        path.join(server.install_path, 'mods', 'config', cleanName),
        path.join(server.install_path, 'config', cleanName)
      ];

      const configs = [];
      const editableExtensions = ['.json', '.toml', '.yml', '.yaml', '.properties', '.txt', '.cfg', '.config', '.ini'];

      function scanFolder(dir) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
        
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            scanFolder(fullPath);
          } else {
            const ext = path.extname(item).toLowerCase();
            if (editableExtensions.includes(ext)) {
              configs.push({
                name: item,
                relPath: path.relative(server.install_path, fullPath).replace(/\\/g, '/'),
                size: stat.size,
                mtime: stat.mtime
              });
            }
          }
        }
      }

      for (const cand of candidatePaths) {
        scanFolder(cand);
      }

      res.json({ configs });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:serverId/mods/updates - Check for available updates on CurseForge
  router.get('/server/:serverId/updates', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const server = getServer(db, parseInt(serverId, 10));
      const version = resolveServerVersion(db, server);
      const dbMods = db.prepare("SELECT * FROM installed_mods WHERE server_id = ? AND curseforge_mod_id != 'manual'").all(serverId);
      const updates = [];

      for (const mod of dbMods) {
        try {
          const files = await curseForgeService.getModFiles(db, mod.curseforge_mod_id, { limit: 20 });
          // Filter files compatible with the server's Hytale version
          const compatibleFiles = files.filter(f => isVersionCompatible(f.gameVersions, version));
          if (compatibleFiles.length === 0) continue;

          const latestFile = compatibleFiles[0];
          const latestFileId = parseInt(latestFile.id, 10);
          const currentFileId = parseInt(mod.curseforge_file_id, 10);

          if (!isNaN(latestFileId) && !isNaN(currentFileId) && latestFileId > currentFileId) {
            const sha1Hash = latestFile.hashes ? latestFile.hashes.find(h => h.algo === 1 || h.algo === 'sha1') : null;
            updates.push({
              fileName: mod.file_name,
              modName: mod.mod_name,
              curseforgeModId: mod.curseforge_mod_id,
              currentFileId: mod.curseforge_file_id,
              latestFileId: latestFile.id,
              latestVersion: latestFile.displayName,
              latestFileName: latestFile.fileName,
              latestFileLength: latestFile.fileLength,
              latestSha1: sha1Hash ? sha1Hash.value : null,
              latestDownloadUrl: latestFile.downloadUrl,
              gameVersion: version,
              gameVersions: latestFile.gameVersions
            });
          }
        } catch (err) {
          const logger = require('../utils/logger');
          logger.warn(`Failed to check updates for mod ID ${mod.curseforge_mod_id}: ${err.message}`);
        }
      }

      res.json({ updates });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:serverId/mods/sync-status - Check if server Hytale version and mods are ready to upgrade to latest
  router.get('/server/:serverId/sync-status', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const server = getServer(db, parseInt(serverId, 10));
      const currentVersion = resolveServerVersion(db, server);

      // Find the latest cached version of the 'release' patchline
      const cachedRow = db.prepare("SELECT version FROM cached_versions WHERE patchline = 'release' ORDER BY id DESC LIMIT 1").get();
      const targetVersion = cachedRow ? cachedRow.version : 'release';

      if (currentVersion === targetVersion) {
        return res.json({
          syncAvailable: false,
          currentVersion,
          targetVersion,
          reason: `Server is already running the latest version (${targetVersion}).`,
          modsToUpdate: []
        });
      }

      // Check if 'release' is cached
      const latestCached = isInstallerCached(db, 'release');
      if (!latestCached) {
        return res.json({
          syncAvailable: false,
          currentVersion,
          targetVersion,
          reason: "Hytale 'release' cache is not downloaded. Please download it in System Settings.",
          modsToUpdate: []
        });
      }

      // Fetch all installed CurseForge mods
      const dbMods = db.prepare("SELECT * FROM installed_mods WHERE server_id = ? AND curseforge_mod_id != 'manual'").all(serverId);
      
      const modsToUpdate = [];
      let allCompatible = true;
      let reason = '';

      for (const mod of dbMods) {
        try {
          const files = await curseForgeService.getModFiles(db, mod.curseforge_mod_id, { limit: 20 });
          // Find the latest file compatible with targetVersion or 'release'
          const latestCompatibleFile = files.find(f => isVersionCompatible(f.gameVersions, targetVersion));

          if (!latestCompatibleFile) {
            allCompatible = false;
            reason = `Mod "${mod.mod_name}" does not have a release compatible with Hytale ${targetVersion}.`;
            break;
          }

          // If the latest compatible file ID is different from current file ID, it needs update
          if (String(latestCompatibleFile.id) !== String(mod.curseforge_file_id)) {
            const sha1Hash = latestCompatibleFile.hashes ? latestCompatibleFile.hashes.find(h => h.algo === 1 || h.algo === 'sha1') : null;
            modsToUpdate.push({
              fileName: mod.file_name,
              modName: mod.mod_name,
              curseforgeModId: mod.curseforge_mod_id,
              currentFileId: mod.curseforge_file_id,
              updateFileId: latestCompatibleFile.id,
              updateVersion: latestCompatibleFile.displayName,
              updateFileName: latestCompatibleFile.fileName,
              updateFileLength: latestCompatibleFile.fileLength,
              updateSha1: sha1Hash ? sha1Hash.value : null,
              updateDownloadUrl: latestCompatibleFile.downloadUrl
            });
          }
        } catch (err) {
          allCompatible = false;
          reason = `Failed to retrieve compatibility info for "${mod.mod_name}": ${err.message}`;
          break;
        }
      }

      res.json({
        syncAvailable: allCompatible,
        currentVersion,
        targetVersion,
        reason: allCompatible ? `All mods are compatible with Hytale ${targetVersion}!` : reason,
        modsToUpdate
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:serverId/mods/sync-upgrade - Upgrade Hytale server and all mods concurrently
  router.post('/server/:serverId/sync-upgrade', async (req, res, next) => {
    const { serverId } = req.params;
    try {
      const server = getServer(db, parseInt(serverId, 10));
      const currentVersion = resolveServerVersion(db, server);

      // Find the latest cached version of the 'release' patchline
      const cachedRow = db.prepare("SELECT version FROM cached_versions WHERE patchline = 'release' ORDER BY id DESC LIMIT 1").get();
      const targetVersion = cachedRow ? cachedRow.version : 'release';

      if (currentVersion === targetVersion) {
        throw new HttpError(400, `Server is already running the latest version (${targetVersion}).`);
      }

      if (server.isRunning) {
        throw new HttpError(400, 'Server must be stopped before performing an upgrade.');
      }

      // Check if 'release' is cached
      const latestCached = isInstallerCached(db, 'release');
      if (!latestCached) {
        throw new HttpError(400, "Central Hytale 'release' cache is missing. Please download it first.");
      }

      // Fetch all installed CurseForge mods
      const dbMods = db.prepare("SELECT * FROM installed_mods WHERE server_id = ? AND curseforge_mod_id != 'manual'").all(serverId);
      
      const modsToUpgrade = [];

      for (const mod of dbMods) {
        const files = await curseForgeService.getModFiles(db, mod.curseforge_mod_id, { limit: 20 });
        // Find the latest file compatible with targetVersion or 'release'
        const latestCompatibleFile = files.find(f => isVersionCompatible(f.gameVersions, targetVersion));

        if (!latestCompatibleFile) {
          throw new HttpError(400, `Mod "${mod.mod_name}" does not have a version compatible with Hytale ${targetVersion}.`);
        }

        // Add to upgrade list if the file ID differs
        if (String(latestCompatibleFile.id) !== String(mod.curseforge_file_id)) {
          const sha1Hash = latestCompatibleFile.hashes ? latestCompatibleFile.hashes.find(h => h.algo === 1 || h.algo === 'sha1') : null;
          modsToUpgrade.push({
            mod,
            file: latestCompatibleFile,
            sha1: sha1Hash ? sha1Hash.value : null
          });
        }
      }

      // Perform updates
      const modsDir = path.join(server.install_path, 'mods');
      if (!fs.existsSync(modsDir)) {
        fs.mkdirSync(modsDir, { recursive: true });
      }

      const crypto = require('crypto');
      const logger = require('../utils/logger');

      for (const upgrade of modsToUpgrade) {
        const { mod, file, sha1 } = upgrade;
        let downloadUrl = file.downloadUrl;

        // Resolve real CurseForge download URL
        if (!downloadUrl) {
          downloadUrl = await curseForgeService.getModFileDownloadUrl(db, mod.curseforge_mod_id, file.id, file.fileName);
        }
        if (!downloadUrl) {
          downloadUrl = curseForgeService.buildCdnUrl(file.id, file.fileName);
        }

        logger.info(`Upgrading mod "${mod.mod_name}" for coordinated server upgrade to Hytale ${targetVersion}: downloading ${file.fileName}`);
        
        // Fetch file synchronously/sequentially
        const resFile = await fetch(downloadUrl, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/octet-stream, */*',
          }
        });

        if (!resFile.ok) {
          throw new Error(`Failed to download mod ${file.fileName}: ${resFile.statusText} (${resFile.status})`);
        }

        const targetPath = resolveSafePath(server.install_path, path.join('mods', file.fileName));
        const tempPath = `${targetPath}.tmp`;
        const fileStream = fs.createWriteStream(tempPath);
        const sha1Hash = crypto.createHash('sha1');

        for await (const chunk of resFile.body) {
          sha1Hash.update(chunk);
          fileStream.write(chunk);
        }

        await new Promise((resolve, reject) => {
          fileStream.end((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        const calculatedSha1 = sha1Hash.digest('hex');
        if (sha1 && sha1.toLowerCase() !== calculatedSha1.toLowerCase()) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          throw new Error(`Checksum mismatch for ${file.fileName}! Expected: ${sha1}, got: ${calculatedSha1}`);
        }

        // Delete old mod file
        const oldPath = resolveSafePath(server.install_path, path.join('mods', mod.file_name));
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }

        // Rename temp to target
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        fs.renameSync(tempPath, targetPath);

        // Delete old database record first to prevent duplicates/violations
        db.prepare('DELETE FROM installed_mods WHERE server_id = ? AND curseforge_mod_id = ? AND curseforge_file_id = ?')
          .run(serverId, String(mod.curseforge_mod_id), String(mod.curseforge_file_id));

        // Insert/Update database record
        const relativeInstalledPath = path.relative(server.install_path, targetPath);
        db.prepare(`
          INSERT INTO installed_mods (
            server_id, curseforge_mod_id, curseforge_file_id, mod_name, file_name,
            file_length, sha1, cdn_url, cdn_url_resolved_at, installed_path, installed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(server_id, curseforge_mod_id, curseforge_file_id) DO UPDATE SET
            file_name = excluded.file_name,
            file_length = excluded.file_length,
            sha1 = excluded.sha1,
            cdn_url = excluded.cdn_url,
            cdn_url_resolved_at = excluded.cdn_url_resolved_at,
            installed_path = excluded.installed_path,
            updated_at = datetime('now')
        `).run(
          serverId,
          String(mod.curseforge_mod_id),
          String(file.id),
          mod.mod_name,
          file.fileName,
          file.fileLength || 0,
          calculatedSha1,
          downloadUrl,
          new Date().toISOString(),
          relativeInstalledPath
        );
      }

      // Re-detect conflicts
      await detectConflicts(db, serverId);

      // Change the server version in database to 'release' channel
      db.prepare("UPDATE servers SET server_version = ?, updated_at = datetime('now') WHERE id = ?")
        .run('release', serverId);

      // Re-deploy server files. Temporarily bypass the 'uninstalled' constraint.
      db.prepare("UPDATE servers SET status = 'uninstalled' WHERE id = ?").run(serverId);
      await installServerFiles(db, serverId);
      db.prepare("UPDATE servers SET status = 'stopped' WHERE id = ?").run(serverId);

      // Add to audit log
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(
          req.user.sub,
          'coordinated-upgrade',
          `server:${serverId}`,
          `Upgraded server Hytale version to release (v${targetVersion}). Upgraded ${modsToUpgrade.length} mods to compatible versions.`,
          req.ip
        );

      res.json({
        success: true,
        message: `Server and mods upgraded successfully to Hytale release (v${targetVersion}).`
      });

    } catch (err) {
      next(err);
    }
  });

  // POST /api/servers/:serverId/mods/install - Download mod from CurseForge or direct URL and optionally restore backup
  router.post('/server/:serverId/install', async (req, res, next) => {
    const { serverId } = req.params;
    const { source, modId, fileId, downloadUrl, fileName, sha1, restoreBackupId, deleteOldFileName } = req.body;
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
        sha1,
        deleteOldFileName
      });

      // Log audit log
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'install-mod', `server:${serverId}`, `Triggered install of mod ${fileName} from ${source || 'direct'}${restoreBackupId ? ' (restored backup ' + restoreBackupId + ')' : ''}`, req.ip);

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/mods/server/:serverId/upload - Upload a mod file manually (raw stream)
  router.post('/server/:serverId/upload', async (req, res, next) => {
    const { serverId } = req.params;
    const filename = req.headers['x-file-name'] || req.query.filename;
    try {
      if (!filename) throw new HttpError(400, 'filename query parameter or x-file-name header is required.');

      const ext = path.extname(filename).toLowerCase();
      if (ext !== '.jar' && ext !== '.zip' && ext !== '.disabled') {
        throw new HttpError(400, 'Only .jar and .zip mod files are allowed.');
      }

      const { modsDir, server } = resolveModsDir(serverId);
      const safePath = resolveSafePath(server.install_path, path.join('mods', filename));

      const writeStream = fs.createWriteStream(safePath);
      req.pipe(writeStream);

      writeStream.on('finish', async () => {
        try {
          const relativeInstalledPath = path.relative(server.install_path, safePath);
          const stat = fs.statSync(safePath);
          
          // Calculate SHA1 checksum
          const fileBuffer = fs.readFileSync(safePath);
          const calculatedSha1 = require('crypto').createHash('sha1').update(fileBuffer).digest('hex');

          db.prepare(`
            INSERT INTO installed_mods (
              server_id, curseforge_mod_id, curseforge_file_id, mod_name, file_name,
              file_length, sha1, cdn_url, cdn_url_resolved_at, installed_path, installed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(server_id, curseforge_mod_id, curseforge_file_id) DO UPDATE SET
              file_name = excluded.file_name,
              file_length = excluded.file_length,
              sha1 = excluded.sha1,
              installed_path = excluded.installed_path,
              updated_at = datetime('now')
          `).run(
            serverId,
            'manual',
            'manual',
            filename.replace(/\.(jar|zip|disabled)$/i, ''),
            filename,
            stat.size,
            calculatedSha1,
            null,
            null,
            relativeInstalledPath
          );

          await detectConflicts(db, serverId);

          db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
            .run(req.user.sub, 'upload-mod', `server:${serverId}`, `Manually uploaded mod file ${filename}`, req.ip);

          res.json({ message: 'Mod uploaded and registered successfully.', fileName: filename });
        } catch (err) {
          next(err);
        }
      });

      writeStream.on('error', (err) => {
        next(new HttpError(500, `Mod upload stream failed: ${err.message}`));
      });
    } catch (err) {
      next(err);
    }
  });

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

  // GET /api/mods/search - Unified browse and search mods
  router.get('/search', async (req, res, next) => {
    const { q = '', source = 'curseforge', categoryId, offset = 0, limit = 20, sortBy = 'featured' } = req.query;
    try {
      let results = [];
      const opts = {
        query: q,
        categoryId: categoryId ? parseInt(categoryId, 10) : null,
        offset: parseInt(offset, 10),
        limit: parseInt(limit, 10),
        sortBy,
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
