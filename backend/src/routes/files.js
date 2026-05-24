const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { getServer } = require('../services/serverService');
const {
  listDirectory,
  readFileText,
  writeFileText,
  createDirectory,
  renamePath,
  deletePath,
  resolveSafePath
} = require('../services/fileService');

module.exports = function(db) {
  const router = express.Router();

  // Protect all file manager endpoints
  router.use(requireAuth);

  // Helper to fetch server details and check authority
  function fetchServerInstallPath(serverId) {
    if (!serverId) {
      throw new HttpError(400, 'Server ID parameter is required.');
    }
    const server = getServer(db, parseInt(serverId, 10));
    return server.install_path;
  }

  // GET /api/files (list directory)
  router.get('/', (req, res, next) => {
    const { serverId, relPath } = req.query;
    try {
      const installPath = fetchServerInstallPath(serverId);
      const list = listDirectory(installPath, relPath || '');
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/files/read (read file text)
  router.get('/read', (req, res, next) => {
    const { serverId, relPath } = req.query;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!relPath) throw new HttpError(400, 'File relative path is required.');
      
      const content = readFileText(installPath, relPath);
      res.json({ content });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/files/write (write file text)
  router.post('/write', (req, res, next) => {
    const { serverId, relPath, content } = req.body;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!relPath) throw new HttpError(400, 'File relative path is required.');
      
      writeFileText(installPath, relPath, content || '');
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'write-file', `server:${serverId}`, `Edited file ${relPath}`, req.ip);

      res.json({ message: 'File written successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/files/mkdir (create directory)
  router.post('/mkdir', (req, res, next) => {
    const { serverId, relPath } = req.body;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!relPath) throw new HttpError(400, 'Directory relative path is required.');
      
      createDirectory(installPath, relPath);
      res.status(201).json({ message: 'Directory created successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/files/rename (rename/move)
  router.post('/rename', (req, res, next) => {
    const { serverId, oldRelPath, newRelPath } = req.body;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!oldRelPath || !newRelPath) {
        throw new HttpError(400, 'Both oldRelPath and newRelPath are required.');
      }
      
      renamePath(installPath, oldRelPath, newRelPath);
      res.json({ message: 'Path renamed successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/files (delete file/folder)
  router.delete('/', (req, res, next) => {
    const { serverId, relPath } = req.body;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!relPath) throw new HttpError(400, 'Relative path is required.');
      
      deletePath(installPath, relPath);
      
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.sub, 'delete-file', `server:${serverId}`, `Deleted file/folder ${relPath}`, req.ip);

      res.json({ message: 'Deleted successfully.' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/files/download (download file)
  router.get('/download', (req, res, next) => {
    const { serverId, relPath } = req.query;
    try {
      const installPath = fetchServerInstallPath(serverId);
      if (!relPath) throw new HttpError(400, 'Relative path is required.');
      
      const safePath = resolveSafePath(installPath, relPath);
      if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
        throw new HttpError(404, 'File not found.');
      }
      
      res.download(safePath);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/files/upload (upload file via raw streaming)
  router.post('/upload', (req, res, next) => {
    const { serverid, relpath } = req.headers; // Multer-free raw stream upload mapping headers
    try {
      const installPath = fetchServerInstallPath(serverid);
      if (!relpath) throw new HttpError(400, 'Header relpath is required.');
      
      const safePath = resolveSafePath(installPath, relpath);
      
      // Ensure parent directory exists
      const parent = path.dirname(safePath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      
      const writeStream = fs.createWriteStream(safePath);
      req.pipe(writeStream);
      
      writeStream.on('finish', () => {
        db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.sub, 'upload-file', `server:${serverid}`, `Uploaded file ${relpath}`, req.ip);

        res.json({ message: 'File uploaded successfully.' });
      });
      
      writeStream.on('error', (err) => {
        next(new HttpError(500, `Upload stream failed: ${err.message}`));
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
