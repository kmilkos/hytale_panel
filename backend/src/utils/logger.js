const config = require('../config');

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const CURRENT_LEVEL = LEVELS[config.logLevel] !== undefined ? LEVELS[config.logLevel] : LEVELS.info;

function formatMessage(level, message, meta = '') {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

const logger = {
  error(message, error) {
    if (CURRENT_LEVEL >= LEVELS.error) {
      console.error(formatMessage('error', message, error ? { message: error.message, stack: error.stack } : ''));
    }
  },
  warn(message, meta) {
    if (CURRENT_LEVEL >= LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },
  info(message, meta) {
    if (CURRENT_LEVEL >= LEVELS.info) {
      console.info(formatMessage('info', message, meta));
    }
  },
  debug(message, meta) {
    if (CURRENT_LEVEL >= LEVELS.debug) {
      console.debug(formatMessage('debug', message, meta));
    }
  },
};

module.exports = logger;
