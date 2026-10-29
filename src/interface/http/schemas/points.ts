import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const PersonSchema = z.object({ id: z.string(), name: z.string(), role: z.string().optional() }).nullable();

export const PointSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    ref: z.string(),
    source: z.enum(['analysis', 'manual']),
    content: z.record(z.string(), z.unknown()),
    status: z.enum(['open', 'responded', 'reopened', 'cleared']),
    type: z.enum(['change', 'explain', 'info']),
    dueDate: z.string().nullable(),
    assignedTo: PersonSchema,
    raisedBy: PersonSchema,
    raisedAt: z.string(),
    clearedBy: PersonSchema,
    clearedAt: z.string().nullable(),
    updatedAt: z.string()
  })
  .openapi('ReviewPoint');
export const PointResponse = z.object({ point: PointSchema }).openapi('PointResponse');

export const AttachmentSchema = z.union([
  z.object({ type: z.literal('version'), slot: z.string(), versionId: z.string(), version: z.number().int(), fileName: z.string() }),
  z.object({ type: z.literal('evidence'), id: z.string(), fileName: z.string(), size: z.number().int() })
]);

export const RaisePointBody = z
  .object({ content: z.object({ title: z.string().max(500) }).passthrough(), assignee: PersonSchema.optional() })
  .openapi('RaisePointBody');
export const PointMetaBody = z
  .object({ type: z.string().max(20).optional(), dueDate: z.string().max(10).nullable().optional() })
  .openapi('PointMetaBody');
export const AssignBody = z.object({ assignee: PersonSchema }).openapi('AssignBody');
export const CommentBody = z.object({ text: z.string().max(5000) }).openapi('CommentBody');
export const ActBody = z
  .object({
    kind: z.enum(['response', 'reopen', 'clear']),
    text: z.string().max(5000).optional(),
    attachments: z.array(AttachmentSchema).max(20).optional()
  })
  .openapi('ActBody');
export const EvidenceSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    pointId: z.string(),
    fileName: z.string(),
    size: z.number().int(),
    sha256: z.string(),
    by: PersonSchema,
    at: z.string()
  })
  .openapi('Evidence');
export const EvidenceResponse = z.object({ evidence: EvidenceSchema }).openapi('EvidenceResponse');
export const PointIdParams = z.object({ pointId: z.string().min(3).max(64) });
export const EvidenceIdParams = z.object({ id: z.string().min(3).max(64) });

export const RunSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    version: z.number().int(),
    result: z.record(z.string(), z.unknown()),
    analysedAt: z.string(),
    settingsSig: z.string(),
    documentVersions: z.record(z.string(), z.string()),
    by: PersonSchema,
    at: z.string()
  })
  .openapi('AnalysisRun');
export const RunResponse = z.object({ run: RunSchema }).openapi('RunResponse');

export const ChecklistAnswerBody = z
  .object({
    framework: z.string().max(40),
    version: z.string().max(40).optional(),
    items: z
      .array(z.object({ id: z.string(), ref: z.string(), section: z.string(), text: z.string(), keywords: z.array(z.string()) }))
      .max(500)
      .optional(),
    answer: z.enum(['yes', 'no', 'na']),
    ref: z.string().max(200).optional()
  })
  .openapi('ChecklistAnswerBody');
export const ChecklistStateSchema = z
  .object({
    engagementId: z.string(),
    framework: z.string(),
    version: z.string(),
    items: z.array(z.unknown()),
    answers: z.record(z.string(), z.unknown())
  })
  .openapi('DisclosureChecklist');
export const ChecklistStateResponse = z.object({ checklist: ChecklistStateSchema }).openapi('ChecklistStateResponse');
export const ItemIdParams = z.object({ id: z.string().min(3).max(64), itemId: z.string().min(1).max(80) });

export const SignoffBody = z
  .object({
    state: z.enum(['manager-signed', 'signed', 'returned', 'resubmitted', 'unlocked']),
    text: z.string().max(5000).optional(),
    summary: z.unknown().optional()
  })
  .openapi('SignoffBody');
export const SignoffResponse = z.object({ signoff: z.record(z.string(), z.unknown()) }).openapi('SignoffResponse');
export const ReportSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    version: z.number().int(),
    sha256: z.string(),
    size: z.number().int(),
    by: PersonSchema,
    at: z.string(),
    signedBy: PersonSchema,
    signedAt: z.string().nullable()
  })
  .openapi('ReviewReport');
export const ReportResponse = z.object({ report: ReportSchema }).openapi('ReportResponse');
export const ReportIdParams = z.object({ id: z.string().min(3).max(64) });

export const StartAnalysisBody = z
  .object({
    mode: z
      .enum(['full', 'nextDraft'])
      .optional()
      .openapi({ description: 'full (default) analyses the current documents; nextDraft re-tests the last analysis points on a new draft' })
  })
  .openapi('StartAnalysisBody');
export const JobIdParams = z.object({ id: z.string().min(1).max(100) });
export const AnalysisJobSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    mode: z.enum(['full', 'nextDraft']),
    status: z.enum(['queued', 'running', 'done', 'failed']),
    step: z.number().int(),
    total: z.number().int(),
    error: z.string().nullable(),
    runId: z.string().nullable(),
    requestedBy: PersonSchema,
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable()
  })
  .openapi('AnalysisJob');
