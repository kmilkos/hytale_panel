const { verifyToken } = require('../services/authService');
const { HttpError } = require('./errorHandler');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Authorization header missing or malformed (use Bearer <token>).'));
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'Authentication required.'));
    }
    if (req.user.role !== role) {
      return next(new HttpError(403, `Access denied: requires ${role} role.`));
    }
    next();
  };
}

function requireServerAccess(minRole, db) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'Authentication required.'));
    }

    // Admins have access to everything
    if (req.user.role === 'admin') {
      return next();
    }

    // Find server ID in parameters, body or query
    let serverId = req.params.id || req.body.serverId || req.query.serverId;
    if (!serverId && req.params.serverId) {
      serverId = req.params.serverId;
    }

    if (!serverId) {
      return next(new HttpError(400, 'Server ID context is missing in request.'));
    }

    const sId = parseInt(serverId, 10);
    if (isNaN(sId)) {
      return next(new HttpError(400, 'Invalid Server ID format.'));
    }

    try {
      // Check if user is mapped to this server in user_servers
      const mapping = db.prepare('SELECT 1 FROM user_servers WHERE user_id = ? AND server_id = ?').get(req.user.sub, sId);
      if (!mapping) {
        return next(new HttpError(403, 'Access denied: you do not have permission to manage this server.'));
      }

      // Check minRole requirement
      // Roles are: admin > operator > viewer
      const userRole = req.user.role; // 'operator' or 'viewer'

      if (minRole === 'operator' && userRole !== 'operator') {
        return next(new HttpError(403, 'Access denied: Operator permissions required.'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireServerAccess,
};
