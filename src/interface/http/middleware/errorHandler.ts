import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import type { Logger } from '../../../application/ports/Logger.js';
import { AppError, type ErrorCode } from '../../../domain/errors.js';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500
};

/** Maps every thrown error to the one response shape: { error: { code, message, details? } }. */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = req.header('x-request-id');
    if (err instanceof AppError) {
      res.status(STATUS[err.code]).json(err.toBody());
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'The request is not valid.', details } });
      return;
    }
    // body-parser and multer style errors carry a status
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: { code: 'VALIDATION_FAILED', message: (err as Error).message || 'The request is not valid.' } });
      return;
    }
    logger.error({ err, requestId }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.', details: { requestId } } });
  };
}

/** 404 for unknown /api paths, in the same shape. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `${req.method} ${req.path} is not a route.` } });
}
