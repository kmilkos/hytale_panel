const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('../middleware/errorHandler');

async function authenticate(db, username, password) {
  if (!username || !password) {
    throw new HttpError(400, 'Username and password are required.');
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    throw new HttpError(401, 'Invalid username or password.');
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    throw new HttpError(401, 'Invalid username or password.');
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

function issueToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    throw new HttpError(401, 'Invalid or expired token.');
  }
}

module.exports = {
  authenticate,
  issueToken,
  verifyToken,
};
