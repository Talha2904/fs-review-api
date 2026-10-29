import { Router } from 'express';
import multer from 'multer';

import type { UseCases } from '../../../application/UseCases.js';
import type { ChecklistItem } from '../../../application/ports/ChecklistTemplateRepository.js';
import { validationFailed } from '../../../domain/errors.js';
import type { Person } from '../../../domain/review/Document.js';
import { EVIDENCE_MAX_BYTES, type Attachment, type PointContent } from '../../../domain/review/Point.js';
import { ipOf, requirePerm } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { EngagementIdParams } from '../schemas/documents.js';
import {
  ActBody,
  AssignBody,
  ChecklistAnswerBody,
  CommentBody,
  EvidenceIdParams,
  ItemIdParams,
  JobIdParams,
  PointIdParams,
  PointMetaBody,
  RaisePointBody,
  ReportIdParams,
  SignoffBody,
  StartAnalysisBody
} from '../schemas/points.js';

const person = (p: unknown): Person | null => {
  const x = p as { id?: string; name?: string; role?: string } | null | undefined;
  return x && x.id && x.name ? { id: String(x.id), name: String(x.name), role: String(x.role ?? '') } : null;
};

/** Analysis jobs, review points and their threads, evidence, checklist answers, sign-off and reports. */
export function pointRoutes(uc: UseCases): Router {
  const r = Router();
  const staff = requirePerm('reviews.read');
  const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1048576, files: 1 } });
  const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: EVIDENCE_MAX_BYTES, files: 1 } });
  const uploaded =
    (u: multer.Multer) =>
    (
      req: Parameters<ReturnType<multer.Multer['single']>>[0],
      res: Parameters<ReturnType<multer.Multer['single']>>[1],
      next: (e?: unknown) => void
    ) =>
      u.single('file')(req, res, (err: unknown) =>
        err
          ? next(
              validationFailed(
                err instanceof Error && err.message === 'File too large' ? 'The file is too large.' : 'The upload could not be read.'
              )
            )
          : next()
      );

  // ---- analysis: runs on the api as a background job (Phase 6); progress arrives on /api/events ----
  r.post(
    '/engagements/:id/analysis-jobs',
    staff,
    validate({ params: EngagementIdParams, body: StartAnalysisBody }),
    async (req, res, next) => {
      try {
        res
          .status(202)
          .json({ job: await uc.startAnalysis.execute(req.actor, req.matrix, String(req.params.id), req.body.mode ?? 'full') });
      } catch (e) {
        next(e);
      }
    }
  );
  r.get('/analysis-jobs/:id', staff, validate({ params: JobIdParams }), async (req, res, next) => {
    try {
      res.json({ job: await uc.getAnalysisJob.execute(req.actor, req.matrix, String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  });

  // ---- review points ----
  r.post('/engagements/:id/points', staff, validate({ params: EngagementIdParams, body: RaisePointBody }), async (req, res, next) => {
    try {
      res.json({
        point: await uc.raisePoint.execute(
          req.actor,
          req.matrix,
          String(req.params.id),
          req.body.content as PointContent,
          person(req.body.assignee)
        )
      });
    } catch (e) {
      next(e);
    }
  });
  r.put('/points/:pointId/meta', staff, validate({ params: PointIdParams, body: PointMetaBody }), async (req, res, next) => {
    try {
      res.json({ point: await uc.setPointMeta.execute(req.actor, req.matrix, String(req.params.pointId), req.body) });
    } catch (e) {
      next(e);
    }
  });
  r.put('/points/:pointId/assignee', staff, validate({ params: PointIdParams, body: AssignBody }), async (req, res, next) => {
    try {
      res.json({ point: await uc.assignPoint.execute(req.actor, req.matrix, String(req.params.pointId), person(req.body.assignee)) });
    } catch (e) {
      next(e);
    }
  });
  r.post('/points/:pointId/comments', staff, validate({ params: PointIdParams, body: CommentBody }), async (req, res, next) => {
    try {
      await uc.commentOnPoint.execute(req.actor, req.matrix, String(req.params.pointId), req.body.text);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  r.post('/points/:pointId/act', staff, validate({ params: PointIdParams, body: ActBody }), async (req, res, next) => {
    try {
      const b = req.body;
      res.json({
        point: await uc.actOnPoint.execute(
          req.actor,
          req.matrix,
          String(req.params.pointId),
          b.kind,
          b.text ?? '',
          (b.attachments ?? []) as Attachment[]
        )
      });
    } catch (e) {
      next(e);
    }
  });
  r.post('/points/:pointId/evidence', staff, validate({ params: PointIdParams }), uploaded(evidenceUpload), async (req, res, next) => {
    try {
      if (!req.file) throw validationFailed('No file was received.');
      res.json({
        evidence: await uc.addEvidence.execute(
          req.actor,
          req.matrix,
          String(req.params.pointId),
          req.file.originalname,
          new Uint8Array(req.file.buffer)
        )
      });
    } catch (e) {
      next(e);
    }
  });
  r.get('/evidence/:id/file', staff, validate({ params: EvidenceIdParams }), async (req, res, next) => {
    try {
      const f = await uc.downloadEvidence.execute(req.actor, req.matrix, String(req.params.id));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.fileName)}"`);
      res.send(Buffer.from(f.bytes));
    } catch (e) {
      next(e);
    }
  });

  // ---- disclosure checklist ----
  r.put(
    '/engagements/:id/checklist/answers/:itemId',
    staff,
    validate({ params: ItemIdParams, body: ChecklistAnswerBody }),
    async (req, res, next) => {
      try {
        const b = req.body;
        res.json({
          checklist: await uc.answerChecklistItem.execute(req.actor, req.matrix, String(req.params.id), {
            framework: b.framework,
            version: b.version ?? '',
            items: (b.items ?? []) as ChecklistItem[],
            itemId: String(req.params.itemId),
            answer: b.answer,
            ...(b.ref !== undefined ? { ref: b.ref } : {})
          })
        });
      } catch (e) {
        next(e);
      }
    }
  );

  // ---- sign-off and reports ----
  r.post('/engagements/:id/signoff', staff, validate({ params: EngagementIdParams, body: SignoffBody }), async (req, res, next) => {
    try {
      const b = req.body;
      res.json({
        signoff: await uc.setSignoff.execute(
          req.actor,
          req.matrix,
          String(req.params.id),
          b.state,
          b.text ?? '',
          b.summary ?? null,
          ipOf(req)
        )
      });
    } catch (e) {
      next(e);
    }
  });
  r.post('/engagements/:id/reports', staff, validate({ params: EngagementIdParams }), uploaded(pdfUpload), async (req, res, next) => {
    try {
      if (!req.file) throw validationFailed('No file was received.');
      res.json({ report: await uc.addReport.execute(req.actor, req.matrix, String(req.params.id), new Uint8Array(req.file.buffer)) });
    } catch (e) {
      next(e);
    }
  });
  r.get('/reports/:id/file', staff, validate({ params: ReportIdParams }), async (req, res, next) => {
    try {
      const f = await uc.downloadReport.execute(req.actor, req.matrix, String(req.params.id));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="review-report-v${f.version}.pdf"`);
      res.send(Buffer.from(f.bytes));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
