const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Auto-generate JWT_SECRET if missing or too short (minimum 32 chars)
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim().length < 32) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  
  let newEnvContent;
  if (envContent.includes('JWT_SECRET=')) {
    newEnvContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);
  } else {
    newEnvContent = envContent + `\nJWT_SECRET=${jwtSecret}\n`;
  }
  
  try {
    fs.writeFileSync(envPath, newEnvContent, 'utf8');
  } catch (err) {
    console.error('Failed to persist auto-generated JWT_SECRET back to .env:', err.message);
  }
  process.env.JWT_SECRET = jwtSecret;
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '5500', 10),
  dbPath: path.resolve(__dirname, '../../', process.env.DB_PATH || 'data/hytale-manager.db'),
  serversDir: path.resolve(__dirname, '../../', process.env.SERVERS_DIR || 'servers'),
  uploadsDir: path.resolve(__dirname, '../../', process.env.UPLOADS_DIR || 'uploads'),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  bcryptCost: parseInt(process.env.BCRYPT_COST || '10', 10),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  javaHome: process.env.JAVA_HOME || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Ensure required runtime directories exist
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(config.serversDir)) {
  fs.mkdirSync(config.serversDir, { recursive: true });
}
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

module.exports = Object.freeze(config);
