import { Router } from 'express';
import multer from 'multer';

import { MAX_BYTES } from '@fs-review/shared';

import type { UseCases } from '../../../application/UseCases.js';
import { validationFailed } from '../../../domain/errors.js';
import type { Validation } from '../../../domain/review/Document.js';
import { requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  ConfirmBody,
  EngagementIdParams,
  ReadWithBody,
  SampleBody,
  SlotParams,
  ValidationBody,
  VersionIdParams,
  WorkflowBody
} from '../schemas/documents.js';

/** Documents, workflow and the review snapshot. Uploads are multipart (field "file", field "slot"). */
export function documentRoutes(uc: UseCases): Router {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

  r.get('/reviews', requirePerm('reviews.read'), async (req, res, next) => {
    try {
      res.json({ reviews: await uc.listReviewSnapshots.execute(req.actor, req.matrix) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/engagements/:id/review', requirePerm('reviews.read'), validate({ params: EngagementIdParams }), async (req, res, next) => {
    try {
      res.json(await uc.getReviewSnapshot.execute(req.actor, req.matrix, String(req.params.id)));
    } catch (e) {
      next(e);
    }
  });

  r.post(
    '/engagements/:id/documents',
    requirePerm('reviews.read'), // documents.attach, or points.respond for a revised document: checked by the use case
    validate({ params: EngagementIdParams }),
    (req, res, next) =>
      upload.single('file')(req, res, (err: unknown) => {
        if (err)
          return next(
            validationFailed(
              err instanceof Error && err.message === 'File too large'
                ? `The file is larger than ${MAX_BYTES / 1048576} MB.`
                : 'The upload could not be read.'
            )
          );
        next();
      }),
    async (req, res, next) => {
      try {
        const f = req.file;
        if (!f) throw validationFailed('No file was received.');
        const body = req.body as { slot?: string; responseTo?: string };
        const slot = String(body.slot ?? '');
        const responseTo = body.responseTo ? String(body.responseTo).slice(0, 64) : undefined;
        res.json(
          await uc.attachDocument.execute(
            req.actor,
            req.matrix,
            String(req.params.id),
            slot,
            f.originalname,
            new Uint8Array(f.buffer),
            responseTo ? { responseTo } : {}
          )
        );
      } catch (e) {
        next(e);
      }
    }
  );

  r.post(
    '/engagements/:id/documents/sample',
    requirePerm('documents.attach'),
    validate({ params: EngagementIdParams, body: SampleBody }),
    async (req, res, next) => {
      try {
        res.json(await uc.attachSampleDocument.execute(req.actor, req.matrix, String(req.params.id), req.body.slot, req.body.name));
      } catch (e) {
        next(e);
      }
    }
  );

  r.delete(
    '/engagements/:id/documents/:slot',
    requirePerm('documents.attach'),
    validate({ params: SlotParams }),
    async (req, res, next) => {
      try {
        await uc.removeDocument.execute(req.actor, req.matrix, String(req.params.id), String(req.params.slot));
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    }
  );

  r.put(
    '/documents/:versionId/validation',
    requirePerm('reviews.read'),
    validate({ params: VersionIdParams, body: ValidationBody }),
    async (req, res, next) => {
      try {
        res.json({
          version: await uc.setDocumentValidation.execute(
            req.actor,
            req.matrix,
            String(req.params.versionId),
            req.body.validation as Validation
          )
        });
      } catch (e) {
        next(e);
      }
    }
  );

  r.put(
    '/documents/:versionId/read-with',
    requirePerm('reviews.read'),
    validate({ params: VersionIdParams, body: ReadWithBody }),
    async (req, res, next) => {
      try {
        res.json({ version: await uc.setDocumentReadWith.execute(req.actor, req.matrix, String(req.params.versionId), req.body.mode) });
      } catch (e) {
        next(e);
      }
    }
  );

  r.post(
    '/documents/:versionId/confirm',
    requirePerm('reviews.read'),
    validate({ params: VersionIdParams, body: ConfirmBody }),
    async (req, res, next) => {
      try {
        res.json({ version: await uc.confirmDocument.execute(req.actor, req.matrix, String(req.params.versionId), req.body.reason ?? '') });
      } catch (e) {
        next(e);
      }
    }
  );

  r.get('/documents/:versionId/file', requirePerm('reviews.read'), validate({ params: VersionIdParams }), async (req, res, next) => {
    try {
      const f = await uc.downloadDocument.execute(req.actor, req.matrix, String(req.params.versionId));
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.fileName)}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(f.bytes));
    } catch (e) {
      next(e);
    }
  });

  r.put(
    '/engagements/:id/workflow',
    requirePerm('reviews.read'),
    validate({ params: EngagementIdParams, body: WorkflowBody }),
    async (req, res, next) => {
      try {
        res.json({
          workflow: await uc.setWorkflowState.execute(req.actor, req.matrix, String(req.params.id), req.body.state, req.body.reason ?? '')
        });
      } catch (e) {
        next(e);
      }
    }
  );

  return r;
}
