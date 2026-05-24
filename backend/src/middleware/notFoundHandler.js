const { HttpError } = require('./errorHandler');

function notFoundHandler(req, res, next) {
  next(new HttpError(404, `Resource not found: ${req.method} ${req.url}`));
}

module.exports = notFoundHandler;
