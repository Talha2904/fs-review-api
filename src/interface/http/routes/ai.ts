import { Router } from 'express';

import type { UseCases } from '../../../application/UseCases.js';
import { ipOf, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AiSettingsBody, OcrBody } from '../schemas/ai.js';

export function aiRoutes(uc: UseCases): Router {
  const r = Router();

  // ---- settings (Administrators) and status (everyone signed in) ----
  r.get('/ai/status', requirePerm('activity.write'), async (req, res, next) => {
    try {
      res.json(await uc.getAiStatus.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });
  r.get('/ai/settings', requirePerm('users.manage'), async (req, res, next) => {
    try {
      res.json(await uc.getAiSettings.execute(req.actor, req.matrix));
    } catch (e) {
      next(e);
    }
  });
  r.put('/ai/settings', requirePerm('users.manage'), validate({ body: AiSettingsBody }), async (req, res, next) => {
    try {
      res.json(await uc.saveAiSettings.execute(req.actor, req.matrix, req.body.settings, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });
  r.post('/ai/test', requirePerm('users.manage'), async (req, res, next) => {
    try {
      res.json(await uc.testAiConnection.execute(req.actor, req.matrix, ipOf(req)));
    } catch (e) {
      next(e);
    }
  });

  // ---- OCR: scanned pages read on this server, no AI ----
  r.post('/ocr', requirePerm('activity.write'), validate({ body: OcrBody }), async (req, res, next) => {
    try {
      const b = req.body;
      res.json(
        await uc.readScannedPages.execute(
          req.actor,
          req.matrix,
          { pages: b.pages, fileName: b.fileName, engagementId: b._ctx?.engagementId ?? null, fundName: b._ctx?.fundName ?? null },
          ipOf(req)
        )
      );
    } catch (e) {
      next(e);
    }
  });

  return r;
}
