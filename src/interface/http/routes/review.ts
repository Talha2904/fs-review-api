import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import type { EngagementDocument } from '../../../domain/review/Engagement.js';
import type { EntityDocument } from '../../../domain/review/Entity.js';
import { requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { EngagementBody, EntityBody, IdParams } from '../schemas/review.js';

/** Entities (clients) and engagements (funds). Reads for every signed-in user; writes need engagements.edit. */
export function reviewRoutes(uc: UseCases): Router {
  const r = Router();

  r.get('/entities', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json({ entities: await uc.listEntities.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });
  r.post('/entities', requirePerm('engagements.edit'), validate({ body: EntityBody }), async (req, res, next) => {
    try {
      res.json({ entity: await uc.saveEntity.execute(req.actor, req.matrix, req.body as Partial<EntityDocument>) });
    } catch (e) {
      next(e);
    }
  });
  r.put('/entities/:id', requirePerm('engagements.edit'), validate({ params: IdParams, body: EntityBody }), async (req, res, next) => {
    try {
      res.json({ entity: await uc.saveEntity.execute(req.actor, req.matrix, req.body as Partial<EntityDocument>, String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/engagements', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json({ engagements: await uc.listEngagements.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });
  r.post('/engagements', requirePerm('engagements.edit'), validate({ body: EngagementBody }), async (req, res, next) => {
    try {
      res.json({ engagement: await uc.saveEngagement.execute(req.actor, req.matrix, req.body as Partial<EngagementDocument>) });
    } catch (e) {
      next(e);
    }
  });
  // PUT also carries trial balance mapping saves, which the use case allows for document and analysis roles.
  r.put('/engagements/:id', requirePerm('activity.write'), validate({ params: IdParams, body: EngagementBody }), async (req, res, next) => {
    try {
      res.json({
        engagement: await uc.saveEngagement.execute(req.actor, req.matrix, req.body as Partial<EngagementDocument>, String(req.params.id))
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
