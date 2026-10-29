import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { requirePerm } from '../middleware/auth.js';

/** The portfolio and the bell, computed on the api (plan section 7.5). */
export function portfolioRoutes(uc: UseCases): Router {
  const r = Router();
  r.get('/portfolio', requirePerm('reviews.read'), async (req, res, next) => {
    try {
      res.json(await uc.getPortfolio.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });
  r.get('/notifications', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json(await uc.getNotifications.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });
  return r;
}
