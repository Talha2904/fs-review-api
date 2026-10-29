import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { CheckRuleConfigBody, ChecklistBody, FrameworkParams } from '../schemas/review.js';

/** The firm's check-rule template and disclosure checklists. Read by everyone signed in; saved by Administrators. */
export function configRoutes(uc: UseCases): Router {
  const r = Router();

  r.get('/config/check-rules', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json({ config: await uc.getCheckRuleConfig.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });
  r.put('/config/check-rules', requirePerm('users.manage'), validate({ body: CheckRuleConfigBody }), async (req, res, next) => {
    try {
      res.json({ config: await uc.saveCheckRuleConfig.execute(req.actor, req.matrix, req.body.config) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/config/checklists', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json({ checklists: await uc.getChecklists.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });
  r.put(
    '/config/checklists/:framework',
    requirePerm('users.manage'),
    validate({ params: FrameworkParams, body: ChecklistBody }),
    async (req, res, next) => {
      try {
        res.json({ checklist: await uc.saveChecklist.execute(req.actor, req.matrix, String(req.params.framework), req.body.items) });
      } catch (e) {
        next(e);
      }
    }
  );

  return r;
}
