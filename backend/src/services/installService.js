const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { resolveSafePath } = require('./fileService');
const { detectConflicts } = require('./conflictDetectionService');
const { HttpError } = require('../middleware/errorHandler');

// Keep track of active downloads in-memory
const activeDownloads = new Map();

function getActiveDownloads(serverId) {
  const list = [];
  for (const [key, download] of activeDownloads.entries()) {
    if (download.serverId === serverId) {
      list.push({
        downloadId: key,
        fileName: download.fileName,
        progress: download.progress,
        status: download.status,
        downloadedBytes: download.downloadedBytes,
        totalBytes: download.totalBytes,
        error: download.error,
      });
    }
  }
  return list;
}

async function downloadModFile(db, serverId, downloadUrl, fileName, options = {}) {
  const { curseforgeModId = null, curseforgeFileId = null, sha1 = null } = options;

  // 1. Resolve server and mods folder
  const server = db.prepare('SELECT install_path FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    throw new HttpError(404, `Server with ID ${serverId} not found.`);
  }

  const modsDir = path.join(server.install_path, 'mods');
  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true });
  }

  const targetPath = resolveSafePath(server.install_path, path.join('mods', fileName));

  // Check if already downloading or installed
  const downloadId = `${serverId}_${fileName}`;
  if (activeDownloads.has(downloadId)) {
    throw new HttpError(400, 'This file is already downloading.');
  }

  const downloadState = {
    serverId,
    fileName,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    status: 'downloading',
    error: null,
  };

  activeDownloads.set(downloadId, downloadState);

  // Run async download to avoid blocking the API request
  (async () => {
    let fileStream = null;
    let tempPath = `${targetPath}.tmp`;

    try {
      logger.info(`Starting download for mod file: ${fileName} from ${downloadUrl}`);
      const res = await fetch(downloadUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/octet-stream, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status} ${res.statusText} when downloading from: ${downloadUrl}`);
      }

      const totalBytes = parseInt(res.headers.get('content-length'), 10) || 0;
      downloadState.totalBytes = totalBytes;

      fileStream = fs.createWriteStream(tempPath);
      const sha1Hash = crypto.createHash('sha1');

      // Stream download natively in Node
      for await (const chunk of res.body) {
        downloadState.downloadedBytes += chunk.length;
        sha1Hash.update(chunk);
        fileStream.write(chunk);

        if (totalBytes > 0) {
          downloadState.progress = Math.round((downloadState.downloadedBytes / totalBytes) * 100);
        }
      }

      // Flush file to disk
      await new Promise((resolve, reject) => {
        fileStream.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify hashes
      downloadState.status = 'verifying';
      const calculatedSha1 = sha1Hash.digest('hex');

      if (sha1 && sha1.toLowerCase() !== calculatedSha1.toLowerCase()) {
        throw new Error(`Checksum mismatch! Expected SHA1: ${sha1}, calculated: ${calculatedSha1}`);
      }

      // Rename temp to target
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      fs.renameSync(tempPath, targetPath);

      // Record in installed_mods table
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
        curseforgeModId ? String(curseforgeModId) : 'manual',
        curseforgeFileId ? String(curseforgeFileId) : 'manual',
        fileName.replace(/\.(jar|zip)$/i, ''),
        fileName,
        downloadState.downloadedBytes,
        calculatedSha1,
        downloadUrl,
        new Date().toISOString(),
        relativeInstalledPath
      );

      // Run conflict detection scanner immediately
      await detectConflicts(db, serverId);

      downloadState.status = 'completed';
      downloadState.progress = 100;
      logger.info(`Successfully installed mod ${fileName} for server ID ${serverId}`);
      
      // Keep completed download in memory for 15 seconds to let UI check it
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 15000);

    } catch (err) {
      logger.error(`Failed to install mod ${fileName} for server ID ${serverId}`, err);
      downloadState.status = 'failed';
      downloadState.error = err.message || 'Unknown download error';
      
      // Cleanup temporary file
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }

      // Keep failed download in memory for 30 seconds
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 30000);
    }
  })();

  return { message: 'Download started in the background.', downloadId };
}

module.exports = {
  getActiveDownloads,
  downloadModFile,
};
