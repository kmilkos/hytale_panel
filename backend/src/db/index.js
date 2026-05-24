const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

function connect() {
  if (db) return db;
  
  try {
    logger.info(`Connecting to SQLite database at: ${config.dbPath}`);
    db = new Database(config.dbPath);
    
    // Optimize SQLite settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    return db;
  } catch (err) {
    logger.error('Failed to connect to SQLite database', err);
    throw err;
  }
}

function getDb() {
  if (!db) {
    return connect();
  }
  return db;
}

module.exports = {
  connect,
  getDb,
};
