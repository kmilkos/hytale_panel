const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const { authenticate, issueToken } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

module.exports = function(db) {
  const router = express.Router();

  // POST /api/auth/login
  router.post('/login', async (req, res, next) => {
    const { username, password } = req.body;
    try {
      const user = await authenticate(db, username, password);
      const token = issueToken(user);
      
      // Log audit
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, 'login', 'user', `Successful login for user ${user.username}`, req.ip);
        
      res.json({ token, user });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, (req, res, next) => {
    try {
      const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.sub);
      if (!user) {
        throw new HttpError(404, 'User not found.');
      }
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/change-password
  router.post('/change-password', requireAuth, async (req, res, next) => {
    const { oldPassword, newPassword } = req.body;
    try {
      if (!oldPassword || !newPassword) {
        throw new HttpError(400, 'Old password and new password are required.');
      }
      if (newPassword.length < 8) {
        throw new HttpError(400, 'New password must be at least 8 characters long.');
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
      if (!user) {
        throw new HttpError(404, 'User not found.');
      }

      const matches = await bcrypt.compare(oldPassword, user.password_hash);
      if (!matches) {
        throw new HttpError(400, 'Incorrect old password.');
      }

      const newHash = await bcrypt.hash(newPassword, config.bcryptCost);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(newHash, user.id);

      // Log audit
      db.prepare('INSERT INTO audit_log (user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, 'change-password', 'user', `Password changed successfully`, req.ip);

      res.json({ message: 'Password changed successfully.' });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
