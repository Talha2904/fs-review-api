import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Parts = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/**
 * Validates body, query and params with zod schemas and replaces them with the parsed values,
 * so controllers only ever see typed data. A failure goes to the error handler as VALIDATION_FAILED.
 */
export function validate<P extends Parts>(parts: P) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (parts.body) req.body = parts.body.parse(req.body);
      if (parts.query) req.query = parts.query.parse(req.query) as Request['query'];
      if (parts.params) req.params = parts.params.parse(req.params) as Request['params'];
      next();
    } catch (e) {
      next(e);
    }
  };
}

export type Validated<P extends Parts> = {
  body: P['body'] extends ZodTypeAny ? z.infer<P['body']> : unknown;
  query: P['query'] extends ZodTypeAny ? z.infer<P['query']> : unknown;
  params: P['params'] extends ZodTypeAny ? z.infer<P['params']> : unknown;
};
