import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { GroupQuery, StartConsolidatedBody } from '../schemas/consolidated.js';

/** The Consolidated Review: groups of related funds, a group's latest review, and starting one (meeting point 2). */
export function consolidatedRoutes(uc: UseCases): Router {
  const r = Router();
  r.get('/consolidated', requirePerm('reviews.read'), async (req, res, next) => {
    try {
      res.json({ groups: await uc.listConsolidatedGroups.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });
  r.get('/consolidated/review', requirePerm('reviews.read'), validate({ query: GroupQuery }), async (req, res, next) => {
    try {
      const q = req.query as unknown as { groupKey: string; yearEnd: string };
      res.json(await uc.getConsolidatedReview.execute(req.actor, req.matrix, q.groupKey, q.yearEnd));
    } catch (e) {
      next(e);
    }
  });
  // starts it in the background: 202 at once; progress arrives on /api/events (topic consolidated_reviews)
  r.post('/consolidated/runs', requirePerm('analysis.run'), validate({ body: StartConsolidatedBody }), async (req, res, next) => {
    try {
      const b = req.body as { groupKey: string; yearEnd: string };
      const rec = await uc.startConsolidatedReview.execute(req.actor, req.matrix, b.groupKey, b.yearEnd);
      res.status(202).json({
        review: {
          id: rec.id,
          groupKey: rec.groupKey,
          yearEnd: rec.yearEnd,
          status: rec.status,
          step: rec.step,
          total: rec.total,
          error: rec.error,
          requestedBy: rec.requestedBy,
          createdAt: rec.createdAt,
          finishedAt: rec.finishedAt
        }
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
