import { Router } from 'express';

import type { DomainEvent, EventBus } from '../../../application/ports/EventBus.js';
import { requirePerm } from '../middleware/auth.js';

/**
 * Server-Sent Events: every committed write publishes { topic, engagementId, at } and the web app
 * refetches that engagement's snapshot. Events carry ids only, never document contents. A heartbeat
 * every 25 seconds keeps proxies from closing idle connections.
 */
export function eventRoutes(events: EventBus, stillSignedIn: (token: string | undefined) => Promise<boolean>): Router {
  const r = Router();
  r.get('/events', requirePerm('reviews.read'), (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    const send = (e: DomainEvent) => res.write(`event: change\ndata: ${JSON.stringify(e)}\n\n`);
    const off = events.subscribe(send);
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    // a stream outlives its request: after sign-out, deactivation or expiry it is closed within a minute
    const token = req.sessionToken;
    const recheck = setInterval(() => {
      stillSignedIn(token).then((ok) => (ok ? undefined : close()), close);
    }, 60_000);
    const close = () => {
      clearInterval(beat);
      clearInterval(recheck);
      off();
      res.end();
    };
    req.on('close', close);
    req.on('error', close);
  });
  return r;
}
