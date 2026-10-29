import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/** Gives every request an id, taken from X-Request-Id when a proxy set one, and echoes it back. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
