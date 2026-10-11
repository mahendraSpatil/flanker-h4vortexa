// Owner: Archit (frozen; ask before changing) | AppError + Express handlers that always answer { error, message, details? }

/** An expected failure with an API error code, e.g. new AppError('NOT_ANCHORED', 404, 'Record is not anchored yet'). */
export class AppError extends Error {
  /**
   * @param {string} code machine-readable code from the API contract (UPPER_SNAKE_CASE)
   * @param {number} status HTTP status
   * @param {string} message human-readable explanation
   * @param {object} [details] extra structured data, e.g. field errors or the existing recordId
   */
  constructor(code, status, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const MULTER_STATUS = { LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE'] };

function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err.name === 'MulterError') {
    const [status, code] = MULTER_STATUS[err.code] ?? [400, 'UPLOAD_INVALID'];
    return new AppError(code, status, err.message, { field: err.field });
  }
  if (err.type === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 400, 'Request body is not valid JSON');
  }
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && err.expose) {
    return new AppError('BAD_REQUEST', err.status, err.message);
  }
  return null;
}

/** Stand-in handler for routes that exist in the API contract but are not built yet. */
export function notImplemented(req, res, next) {
  next(
    new AppError('NOT_IMPLEMENTED', 501, `${req.method} ${req.originalUrl} is not implemented yet`),
  );
}

export function notFoundHandler(req, res, next) {
  next(new AppError('NOT_FOUND', 404, `No route for ${req.method} ${req.originalUrl}`));
}

// Express 5 forwards errors thrown in (and promises rejected by) async handlers here; no wrapper needed.
// Keep all 4 parameters: Express recognises error handlers by their arity.
export function errorHandler(err, req, res, next) {
  const appError = toAppError(err);
  if (!appError) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: 'INTERNAL', message: 'Unexpected server error' });
    return;
  }
  const body = { error: appError.code, message: appError.message };
  if (appError.details !== undefined) body.details = appError.details;
  res.status(appError.status).json(body);
}
