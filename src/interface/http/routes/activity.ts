import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { ipOf, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ActivityBody, ActivityQuery } from '../schemas/activity.js';

export function activityRoutes(uc: UseCases): Router {
  const r = Router();

  // Any signed-in user records app actions. The actor comes from the session, never from the body.
  r.post('/activity', requirePerm('activity.write'), validate({ body: ActivityBody }), async (req, res, next) => {
    try {
      const b = req.body;
      const entry = await uc.activity.record({
        actor: req.actor,
        category: b.category,
        summary: b.summary,
        details: b.details ?? '',
        ip: ipOf(req),
        engagementId: b.engagementId ?? null,
        fundName: b.fundName ?? null
      });
      res.json({ entry });
    } catch (e) {
      next(e);
    }
  });

  // Administrators read everything; other signed-in users read one fund's entries at a time.
  r.get('/activity', requirePerm('activity.write'), validate({ query: ActivityQuery }), async (req, res, next) => {
    try {
      const q = req.query as unknown as { engagementId?: string; limit?: number };
      res.json({ entries: await uc.listActivity.execute(req.actor, req.matrix, q.engagementId || null, q.limit ?? 5000) });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
