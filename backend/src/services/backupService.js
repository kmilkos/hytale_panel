const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getServer } = require('./serverService');
const { HttpError } = require('../middleware/errorHandler');

function getBackupsDir(installPath) {
  const backupsDir = path.join(installPath, '.backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  return backupsDir;
}

function createBackup(db, serverId) {
  const server = getServer(db, serverId);
  const backupsDir = getBackupsDir(server.install_path);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.zip' : '.tar.gz';
  const backupFile = `backup-${timestamp}${ext}`;
  const backupPath = path.join(backupsDir, backupFile);
  
  logger.info(`Creating backup for server ${server.slug}: ${backupFile}`);
  
  try {
    if (isWin) {
      // PowerShell Compress-Archive excluding the .backups folder
      const cmd = `powershell -Command "Get-ChildItem -Path '${server.install_path}' -Exclude .backups | Compress-Archive -DestinationPath '${backupPath}' -Force"`;
      execSync(cmd, { stdio: 'inherit' });
    } else {
      // tar command excluding the .backups folder
      const cmd = `tar --exclude='./.backups' -czf "${backupPath}" -C "${server.install_path}" .`;
      execSync(cmd, { stdio: 'inherit' });
    }
    
    const stats = fs.statSync(backupPath);
    logger.info(`Backup created successfully: ${backupFile} (${stats.size} bytes)`);
    
    return {
      filename: backupFile,
      size: stats.size,
      createdAt: new Date(),
    };
  } catch (err) {
    logger.error(`Failed to create backup for server ${server.slug}`, err);
    throw new HttpError(500, `Backup creation failed: ${err.message}`);
  }
}

function listBackups(db, serverId) {
  const server = getServer(db, serverId);
  const backupsDir = getBackupsDir(server.install_path);
  
  try {
    const files = fs.readdirSync(backupsDir);
    return files
      .filter(file => file.startsWith('backup-') && (file.endsWith('.zip') || file.endsWith('.tar.gz')))
      .map(file => {
        const filePath = path.join(backupsDir, file);
        const stat = fs.statSync(filePath);
        return {
          filename: file,
          size: stat.size,
          createdAt: stat.mtime,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    logger.error(`Failed to list backups for server ${server.slug}`, err);
    return [];
  }
}

function restoreBackup(db, serverId, filename) {
  const server = getServer(db, serverId);
  if (server.isRunning) {
    throw new HttpError(400, 'Cannot restore backup while the server is running. Stop the server first.');
  }
  
  const backupsDir = getBackupsDir(server.install_path);
  
  // Validate path safety on filename to prevent folder escape
  const cleanFilename = path.basename(filename);
  const backupPath = path.join(backupsDir, cleanFilename);
  
  if (!fs.existsSync(backupPath)) {
    throw new HttpError(404, `Backup file "${cleanFilename}" not found.`);
  }
  
  logger.info(`Restoring backup for server ${server.slug}: ${cleanFilename}`);
  
  try {
    // 1. Delete all current files inside the server folder except .backups
    const items = fs.readdirSync(server.install_path);
    for (const item of items) {
      if (item === '.backups') continue;
      const itemPath = path.join(server.install_path, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        fs.rmSync(itemPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(itemPath);
      }
    }
    
    // 2. Extract Archive
    const isWin = process.platform === 'win32';
    if (isWin) {
      const cmd = `powershell -Command "Expand-Archive -Path '${backupPath}' -DestinationPath '${server.install_path}' -Force"`;
      execSync(cmd, { stdio: 'inherit' });
    } else {
      const cmd = `tar -xzf "${backupPath}" -C "${server.install_path}"`;
      execSync(cmd, { stdio: 'inherit' });
    }
    
    logger.info(`Backup "${cleanFilename}" restored successfully.`);
  } catch (err) {
    logger.error(`Failed to restore backup for server ${server.slug}`, err);
    throw new HttpError(500, `Backup restoration failed: ${err.message}`);
  }
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
};
