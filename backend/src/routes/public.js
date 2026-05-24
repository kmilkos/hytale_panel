const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // GET /api/public/servers - Get non-sensitive server listing for public views/widgets
  router.get('/servers', (req, res, next) => {
    try {
      const servers = db.prepare(`
        SELECT id, name, slug, description, port, status, created_at, updated_at
        FROM servers
      `).all();

      res.json(servers);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/public/servers/:slug - Retrieve public info of a specific server
  router.get('/servers/:slug', (req, res, next) => {
    const { slug } = req.params;
    try {
      const server = db.prepare(`
        SELECT id, name, slug, description, port, status, created_at, updated_at
        FROM servers
        WHERE slug = ?
      `).get(slug);

      if (!server) {
        return res.status(404).json({ error: 'Server not found.' });
      }

      res.json(server);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
