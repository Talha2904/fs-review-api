// Request-level protections that do not belong to any one route.
import type { NextFunction, Request, Response } from 'express';

import { AppError, forbidden } from '../../../domain/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for the session cookie (ADR 0002): a state-changing request made by a browser must come
 * from one of the app's own origins. Browsers send Origin on every cross-site POST, PUT and DELETE,
 * including the multipart and form posts that skip the CORS preflight; Sec-Fetch-Site covers the rest.
 * Requests with neither header come from non-browser clients, which cannot carry a victim's cookie.
 */
export function sameOriginWrites(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin');
    const self = `${req.protocol}://${req.get('host')}`;
    if (origin)
      return allowed.has(origin) || origin === self ? next() : next(forbidden('This request came from another site and was refused.'));
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return next(forbidden('This request came from another site and was refused.'));
    next();
  };
}

/**
 * A fixed-window limit per client address, for the routes anyone can call without signing in (sign-in,
 * set-up, password reset). Per instance: with several instances behind a balancer each allows `max`,
 * which still bounds guessing; the per-account throttle in the database is the hard limit.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
    const key = req.ip ?? 'unknown';
    const h = hits.get(key);
    if (!h || h.until <= now) hits.set(key, { count: 1, until: now + opts.windowMs });
    else if (++h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.until - now) / 1000)));
      return next(new AppError('RATE_LIMITED', 'Too many requests. Wait a minute and try again.'));
    }
    next();
  };
}
