const logger = require('../utils/logger');

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  if (status >= 500) {
    logger.error(`Error processing request ${req.method} ${req.url}:`, err);
  } else {
    logger.warn(`Client request error ${req.method} ${req.url}: ${message}`, err.details);
  }
  
  res.status(status).json({
    error: {
      status,
      message,
      details: err.details || null,
    }
  });
}

module.exports = {
  errorHandler,
  HttpError,
};
