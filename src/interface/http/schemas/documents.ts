import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const PersonSchema = z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable();

export const DocumentVersionSchema = z
  .object({
    id: z.string(),
    engagementId: z.string(),
    slot: z.string(),
    version: z.number().int(),
    fileName: z.string(),
    size: z.number().int(),
    sha256: z.string(),
    sample: z.boolean(),
    uploadedBy: PersonSchema,
    uploadedAt: z.string(),
    removedAt: z.string().nullable(),
    removedBy: PersonSchema,
    validation: z.record(z.string(), z.unknown()).nullable(),
    confirmation: z.object({ by: PersonSchema, at: z.string(), reason: z.string() }).nullable(),
    readWith: z.string().nullable(),
    readWithBy: PersonSchema,
    readWithAt: z.string().nullable(),
    sameAs: z.number().int().nullable()
  })
  .openapi('DocumentVersion');

export const WorkflowSchema = z
  .object({
    engagementId: z.string(),
    state: z.enum(['preparing', 'ready', 'returned']),
    by: PersonSchema,
    at: z.string().nullable(),
    reason: z.string(),
    history: z.array(z.object({ state: z.string(), by: PersonSchema, at: z.string(), reason: z.string() }))
  })
  .openapi('Workflow');

export const SignoffSchema = z
  .object({
    engagementId: z.string(),
    state: z.string(),
    by: PersonSchema,
    at: z.string().nullable(),
    text: z.string(),
    summary: z.unknown(),
    history: z.array(z.unknown())
  })
  .openapi('Signoff');

export const ReviewSnapshotSchema = z
  .object({
    engagementId: z.string(),
    versions: z.array(DocumentVersionSchema),
    current: z.record(z.string(), DocumentVersionSchema),
    workflow: WorkflowSchema,
    signoff: SignoffSchema,
    analysisJob: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'The latest analysis requested on the api, in the AnalysisJob shape: follow its status and step' })
  })
  .openapi('ReviewSnapshot');
export const ReviewSnapshotsResponse = z.object({ reviews: z.record(z.string(), ReviewSnapshotSchema) }).openapi('ReviewSnapshotsResponse');

export const AttachResponse = z.object({ version: DocumentVersionSchema, unchanged: z.boolean() }).openapi('AttachResponse');
export const VersionResponse = z.object({ version: DocumentVersionSchema }).openapi('VersionResponse');
export const WorkflowResponse = z.object({ workflow: WorkflowSchema }).openapi('WorkflowResponse');

export const EngagementIdParams = z.object({ id: z.string().min(3).max(64) });
export const VersionIdParams = z.object({ versionId: z.string().min(3).max(64) });
export const SlotParams = z.object({ id: z.string().min(3).max(64), slot: z.string().min(2).max(5) });
export const SampleBody = z.object({ slot: z.string().max(5), name: z.string().max(200) }).openapi('AttachSampleBody');
export const ValidationBody = z
  .object({
    // the statuses a check can give; 'sample' is reserved for built-in samples and never accepted from a client
    validation: z
      .object({
        status: z.enum(['checking', 'recognised', 'check', 'mismatch']),
        summary: z.string().max(2000),
        checks: z.array(z.unknown()).max(50)
      })
      .passthrough()
  })
  .openapi('ValidationBody');
export const ReadWithBody = z.object({ mode: z.enum(['ai', 'ocr', 'local']) }).openapi('ReadWithBody');
export const ConfirmBody = z.object({ reason: z.string().max(1000).optional() }).openapi('ConfirmBody');
export const WorkflowBody = z
  .object({ state: z.enum(['preparing', 'ready', 'returned']), reason: z.string().max(1000).optional() })
  .openapi('WorkflowBody');
