// The OpenAPI document is generated from the zod schemas, so it cannot drift from the code.
// Served at /api/docs (UI) and /api/docs/openapi.json.
import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { ActivityBody, ActivityEntryResponse, ActivityQuery, ActivityResponse } from './schemas/activity.js';
import { AiSettingsBody, AiSettingsResponse, AiStatusResponse, AiTestResponse, OcrBody, OcrResponse } from './schemas/ai.js';
import {
  BillingBody,
  BillingStateResponse,
  EmailInvoiceBody,
  IntegrationsResponse,
  XeroCallbackQuery,
  XeroConnectResponse,
  XeroInvoiceBody
} from './schemas/billing.js';
import {
  AttachResponse,
  ConfirmBody,
  EngagementIdParams,
  ReadWithBody,
  ReviewSnapshotSchema,
  ReviewSnapshotsResponse,
  SampleBody,
  SlotParams,
  ValidationBody,
  VersionIdParams,
  VersionResponse,
  WorkflowBody,
  WorkflowResponse
} from './schemas/documents.js';
import { HealthResponse } from './schemas/health.js';
import {
  AuthStatusResponse,
  CreateUserBody,
  ForgotBody,
  LoginBody,
  MeResponse,
  OkResponse,
  PeopleResponse,
  PermissionsBody,
  PermissionsResponse,
  ResetBody,
  SetupBody,
  UpdateUserBody,
  UserResponse,
  UsersResponse
} from './schemas/identity.js';
import {
  ActBody,
  AssignBody,
  ChecklistAnswerBody,
  ChecklistStateResponse,
  CommentBody,
  EvidenceIdParams,
  EvidenceResponse,
  ItemIdParams,
  PointIdParams,
  PointMetaBody,
  PointResponse,
  RaisePointBody,
  ReportIdParams,
  ReportResponse,
  JobIdParams,
  AnalysisJobSchema,
  StartAnalysisBody,
  SignoffBody,
  SignoffResponse
} from './schemas/points.js';
import { NotificationsResponse, PortfolioResponse } from './schemas/portfolio.js';
import {
  CheckRuleConfigBody,
  CheckRuleConfigResponse,
  ChecklistBody,
  ChecklistResponse,
  ChecklistsResponse,
  EngagementBody,
  EngagementResponse,
  EngagementsResponse,
  EntitiesResponse,
  EntityBody,
  EntityResponse,
  FrameworkParams,
  IdParams
} from './schemas/review.js';

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) })
  .openapi('ErrorResponse');

export function buildOpenApi(version: string) {
  const reg = new OpenAPIRegistry();
  reg.registerComponent('securitySchemes', 'session', { type: 'apiKey', in: 'cookie', name: 'fsr_session' });

  const json = (schema: z.ZodTypeAny, description: string) => ({ description, content: { 'application/json': { schema } } });
  const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [c, json(ErrorBody, `Error ${c}`)]));

  const add = (
    cfg: Omit<RouteConfig, 'responses'> & {
      ok: z.ZodTypeAny;
      /** the success status when it is not 200 (202 for work accepted to run in the background) */
      okStatus?: number;
      errs?: number[];
      body?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
      params?: z.ZodTypeAny;
      auth?: boolean;
    }
  ) => {
    const { ok, okStatus = 200, errs = [], body, query, params, auth = true, ...rest } = cfg;
    reg.registerPath({
      ...rest,
      ...(auth ? { security: [{ session: [] }] } : {}),
      request: {
        ...(body ? { body: { content: { 'application/json': { schema: body } } } } : {}),
        ...(query ? { query: query as z.AnyZodObject } : {}),
        ...(params ? { params: params as z.AnyZodObject } : {})
      },
      responses: { [okStatus]: json(ok, okStatus === 202 ? 'Accepted' : 'OK'), ...errors(...errs) }
    });
  };

  add({
    method: 'get',
    path: '/api/health',
    tags: ['System'],
    summary: 'Liveness and readiness',
    ok: HealthResponse,
    errs: [503],
    auth: false
  });

  // Sign-in
  add({
    method: 'get',
    path: '/api/auth/status',
    tags: ['Sign-in'],
    summary: 'Whether setup is needed and reset by email is available',
    ok: AuthStatusResponse,
    auth: false
  });
  add({
    method: 'post',
    path: '/api/auth/setup',
    tags: ['Sign-in'],
    summary: 'First run: create the first Administrator',
    body: SetupBody,
    ok: UserResponse,
    errs: [400, 409],
    auth: false
  });
  add({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Sign-in'],
    summary: 'Sign in; sets the session cookie',
    body: LoginBody,
    ok: UserResponse,
    errs: [401, 429],
    auth: false
  });
  add({ method: 'post', path: '/api/auth/logout', tags: ['Sign-in'], summary: 'Sign out', ok: OkResponse });
  add({ method: 'get', path: '/api/auth/me', tags: ['Sign-in'], summary: 'Who is signed in', ok: MeResponse });
  add({
    method: 'post',
    path: '/api/auth/forgot',
    tags: ['Sign-in'],
    summary: 'Email a one-time reset link (same answer whether or not an account matches)',
    body: ForgotBody,
    ok: OkResponse,
    errs: [503],
    auth: false
  });
  add({
    method: 'post',
    path: '/api/auth/reset',
    tags: ['Sign-in'],
    summary: 'Choose a new password with an emailed link',
    body: ResetBody,
    ok: OkResponse,
    errs: [400],
    auth: false
  });

  // Users and permissions
  add({
    method: 'get',
    path: '/api/users',
    tags: ['Users'],
    summary: 'Staff directory (Administrators)',
    ok: UsersResponse,
    errs: [401, 403]
  });
  add({
    method: 'post',
    path: '/api/users',
    tags: ['Users'],
    summary: 'Add a user (Administrators)',
    body: CreateUserBody,
    ok: UserResponse,
    errs: [400, 401, 403]
  });
  add({
    method: 'patch',
    path: '/api/users/{id}',
    tags: ['Users'],
    summary: 'Rename, change role, deactivate, set email or reset password',
    params: z.object({ id: z.string() }),
    body: UpdateUserBody,
    ok: UserResponse,
    errs: [400, 401, 403, 404]
  });
  add({
    method: 'get',
    path: '/api/people',
    tags: ['Users'],
    summary: 'Names and roles for team pickers',
    ok: PeopleResponse,
    errs: [401]
  });
  add({ method: 'get', path: '/api/permissions', tags: ['Users'], summary: 'The permission matrix', ok: PermissionsResponse, auth: false });
  add({
    method: 'put',
    path: '/api/permissions',
    tags: ['Users'],
    summary: 'Save the permission matrix (Administrators)',
    body: PermissionsBody,
    ok: PermissionsResponse,
    errs: [401, 403]
  });

  // Activity
  add({
    method: 'post',
    path: '/api/activity',
    tags: ['Activity'],
    summary: 'Record an action; the actor comes from the session',
    body: ActivityBody,
    ok: ActivityEntryResponse,
    errs: [400, 401]
  });
  add({
    method: 'get',
    path: '/api/activity',
    tags: ['Activity'],
    summary: 'Read the log: all of it for Administrators, one fund for others',
    query: ActivityQuery,
    ok: ActivityResponse,
    errs: [401, 403]
  });

  // AI
  add({
    method: 'get',
    path: '/api/ai/status',
    tags: ['AI'],
    summary: 'Whether a key exists and what is switched on',
    ok: AiStatusResponse,
    errs: [401]
  });
  add({
    method: 'get',
    path: '/api/ai/settings',
    tags: ['AI'],
    summary: 'AI settings (Administrators)',
    ok: AiSettingsResponse,
    errs: [401, 403]
  });
  add({
    method: 'put',
    path: '/api/ai/settings',
    tags: ['AI'],
    summary: 'Save AI settings (Administrators)',
    body: AiSettingsBody,
    ok: AiSettingsResponse,
    errs: [400, 401, 403]
  });
  add({
    method: 'post',
    path: '/api/ai/test',
    tags: ['AI'],
    summary: 'One tiny Claude call to check the key',
    ok: AiTestResponse,
    errs: [400, 401, 403, 503]
  });
  add({
    method: 'post',
    path: '/api/ocr',
    tags: ['AI'],
    summary: 'Read scanned pages with Tesseract on this server (no AI)',
    body: OcrBody,
    ok: OcrResponse,
    errs: [400, 401, 403]
  });

  // Billing
  add({
    method: 'get',
    path: '/api/billing',
    tags: ['Billing'],
    summary: 'Billing state and billable AI usage (Finance)',
    ok: BillingStateResponse,
    errs: [401, 403]
  });
  add({
    method: 'post',
    path: '/api/billing',
    tags: ['Billing'],
    summary: 'Apply a billing action (Finance)',
    body: BillingBody,
    ok: BillingStateResponse,
    errs: [400, 401, 403]
  });
  add({
    method: 'get',
    path: '/api/billing/integrations',
    tags: ['Billing'],
    summary: 'Which of email, exchange rates and Xero are configured',
    ok: IntegrationsResponse,
    errs: [401, 403]
  });
  add({
    method: 'post',
    path: '/api/billing/email',
    tags: ['Billing'],
    summary: 'Email an issued invoice PDF',
    body: EmailInvoiceBody,
    ok: BillingStateResponse,
    errs: [400, 401, 403, 503]
  });
  add({
    method: 'post',
    path: '/api/billing/fx-refresh',
    tags: ['Billing'],
    summary: 'Fetch the ECB USD to GBP rate',
    ok: BillingStateResponse,
    errs: [401, 403, 503]
  });
  add({
    method: 'get',
    path: '/api/xero/connect',
    tags: ['Billing'],
    summary: 'Start the Xero OAuth connection',
    ok: XeroConnectResponse,
    errs: [401, 403, 503]
  });
  add({
    method: 'get',
    path: '/api/xero/callback',
    tags: ['Billing'],
    summary: 'Where Xero sends the browser back after sign-in; answers with a redirect to the Billing Settings screen',
    query: XeroCallbackQuery,
    auth: false,
    ok: z.string().openapi({ description: 'A redirect (302) to the app' })
  });
  add({
    method: 'post',
    path: '/api/xero/disconnect',
    tags: ['Billing'],
    summary: 'Forget the Xero connection',
    ok: OkResponse,
    errs: [401, 403]
  });
  add({
    method: 'post',
    path: '/api/xero/invoice',
    tags: ['Billing'],
    summary: 'Post an issued invoice to Xero',
    body: XeroInvoiceBody,
    ok: BillingStateResponse,
    errs: [400, 401, 403, 503]
  });

  // Clients, funds and firm configuration (Phase 2)
  add({ method: 'get', path: '/api/entities', tags: ['Engagements'], summary: 'Every client entity', ok: EntitiesResponse, errs: [401] });
  add({
    method: 'post',
    path: '/api/entities',
    tags: ['Engagements'],
    summary: 'Add a client entity',
    body: EntityBody,
    ok: EntityResponse,
    errs: [400, 401, 403, 409]
  });
  add({
    method: 'put',
    path: '/api/entities/{id}',
    tags: ['Engagements'],
    summary: 'Create or update a client entity by id',
    params: IdParams,
    body: EntityBody,
    ok: EntityResponse,
    errs: [400, 401, 403, 409]
  });
  add({
    method: 'get',
    path: '/api/engagements',
    tags: ['Engagements'],
    summary: 'Every fund engagement',
    ok: EngagementsResponse,
    errs: [401]
  });
  add({
    method: 'post',
    path: '/api/engagements',
    tags: ['Engagements'],
    summary: 'Add a fund engagement',
    body: EngagementBody,
    ok: EngagementResponse,
    errs: [400, 401, 403, 409]
  });
  add({
    method: 'put',
    path: '/api/engagements/{id}',
    tags: ['Engagements'],
    summary: 'Create or update a fund engagement by id (also saves the trial balance mapping)',
    params: IdParams,
    body: EngagementBody,
    ok: EngagementResponse,
    errs: [400, 401, 403, 409]
  });
  add({
    method: 'get',
    path: '/api/config/check-rules',
    tags: ['Configuration'],
    summary: "The firm's check-rule template",
    ok: CheckRuleConfigResponse,
    errs: [401]
  });
  add({
    method: 'put',
    path: '/api/config/check-rules',
    tags: ['Configuration'],
    summary: 'Save the check-rule template (Administrators)',
    body: CheckRuleConfigBody,
    ok: CheckRuleConfigResponse,
    errs: [400, 401, 403]
  });
  add({
    method: 'get',
    path: '/api/config/checklists',
    tags: ['Configuration'],
    summary: 'The current disclosure checklist per framework',
    ok: ChecklistsResponse,
    errs: [401]
  });
  add({
    method: 'put',
    path: '/api/config/checklists/{framework}',
    tags: ['Configuration'],
    summary: 'Save a checklist as the next version (Administrators)',
    params: FrameworkParams,
    body: ChecklistBody,
    ok: ChecklistResponse,
    errs: [400, 401, 403]
  });

  // Documents, workflow, review snapshot and live events (Phase 3)
  add({
    method: 'get',
    path: '/api/reviews',
    tags: ['Documents'],
    summary: "Every fund's document state at once",
    ok: ReviewSnapshotsResponse,
    errs: [401]
  });
  add({
    method: 'get',
    path: '/api/engagements/{id}/review',
    tags: ['Documents'],
    summary: 'Documents, workflow and sign-off state of one fund',
    params: EngagementIdParams,
    ok: ReviewSnapshotSchema,
    errs: [401, 404]
  });
  reg.registerPath({
    method: 'post',
    path: '/api/engagements/{id}/documents',
    tags: ['Documents'],
    summary: 'Upload a document as the next version of its slot (multipart: slot, file)',
    security: [{ session: [] }],
    request: {
      params: EngagementIdParams,
      body: {
        content: { 'multipart/form-data': { schema: z.object({ slot: z.string(), file: z.string().openapi({ format: 'binary' }) }) } }
      }
    },
    responses: { 200: json(AttachResponse, 'OK'), ...errors(400, 401, 403, 404, 423) }
  });
  add({
    method: 'post',
    path: '/api/engagements/{id}/documents/sample',
    tags: ['Documents'],
    summary: 'Attach a built-in sample document',
    params: EngagementIdParams,
    body: SampleBody,
    ok: AttachResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'delete',
    path: '/api/engagements/{id}/documents/{slot}',
    tags: ['Documents'],
    summary: 'Remove the current version of a slot',
    params: SlotParams,
    ok: z.object({ ok: z.literal(true) }),
    errs: [401, 403, 404, 423]
  });
  add({
    method: 'put',
    path: '/api/documents/{versionId}/validation',
    tags: ['Documents'],
    summary: 'Store the recognition result for a version',
    params: VersionIdParams,
    body: ValidationBody,
    ok: VersionResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'put',
    path: '/api/documents/{versionId}/read-with',
    tags: ['Documents'],
    summary: 'Record how a document is read (ai, ocr, local)',
    params: VersionIdParams,
    body: ReadWithBody,
    ok: VersionResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'post',
    path: '/api/documents/{versionId}/confirm',
    tags: ['Documents'],
    summary: 'Confirm Anyway: accept a version that needs a check or mismatched',
    params: VersionIdParams,
    body: ConfirmBody,
    ok: VersionResponse,
    errs: [400, 401, 403, 404, 423]
  });
  reg.registerPath({
    method: 'get',
    path: '/api/documents/{versionId}/file',
    tags: ['Documents'],
    summary: "A version's file",
    security: [{ session: [] }],
    request: { params: VersionIdParams },
    responses: {
      200: { description: 'The file bytes', content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
      ...errors(401, 404)
    }
  });
  add({
    method: 'put',
    path: '/api/engagements/{id}/workflow',
    tags: ['Documents'],
    summary: 'Mark Ready for Review, or Send Back to Preparer',
    params: EngagementIdParams,
    body: WorkflowBody,
    ok: WorkflowResponse,
    errs: [400, 401, 403, 404, 423]
  });
  reg.registerPath({
    method: 'get',
    path: '/api/events',
    tags: ['System'],
    summary: 'Server-Sent Events: { topic, engagementId, at } after every committed write',
    security: [{ session: [] }],
    responses: { 200: { description: 'text/event-stream', content: { 'text/event-stream': { schema: z.string() } } }, ...errors(401) }
  });

  // Analysis (Phase 6), review points, checklist answers, sign-off and reports (Phase 4)
  add({
    method: 'post',
    path: '/api/engagements/{id}/analysis-jobs',
    tags: ['Analysis'],
    summary:
      'Start an analysis on the server. Answers 202 with the queued job; progress and completion arrive on /api/events (topic analysis_jobs).',
    params: EngagementIdParams,
    body: StartAnalysisBody,
    ok: z.object({ job: AnalysisJobSchema }),
    okStatus: 202,
    errs: [400, 401, 403, 404, 409, 423]
  });
  add({
    method: 'get',
    path: '/api/analysis-jobs/{id}',
    tags: ['Analysis'],
    summary: 'One analysis job: queued, running (step of total), done (with the run it produced) or failed (with the reason)',
    params: JobIdParams,
    ok: z.object({ job: AnalysisJobSchema }),
    errs: [401, 404]
  });
  add({
    method: 'get',
    path: '/api/portfolio',
    tags: ['Portfolio'],
    summary: 'Every fund: its stage, who it waits for, open, responded and overdue points (aggregate queries)',
    ok: PortfolioResponse,
    errs: [401, 403]
  });
  add({
    method: 'get',
    path: '/api/notifications',
    tags: ['Portfolio'],
    summary: 'The bell for the signed-in person: actions waiting for them and updates from others',
    ok: NotificationsResponse,
    errs: [401]
  });
  add({
    method: 'post',
    path: '/api/engagements/{id}/points',
    tags: ['Review points'],
    summary: 'Raise a point',
    params: EngagementIdParams,
    body: RaisePointBody,
    ok: PointResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'put',
    path: '/api/points/{pointId}/meta',
    tags: ['Review points'],
    summary: 'Set a point’s type and due date',
    params: PointIdParams,
    body: PointMetaBody,
    ok: PointResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'put',
    path: '/api/points/{pointId}/assignee',
    tags: ['Review points'],
    summary: 'Assign or unassign a point',
    params: PointIdParams,
    body: AssignBody,
    ok: PointResponse,
    errs: [401, 403, 404, 423]
  });
  add({
    method: 'post',
    path: '/api/points/{pointId}/comments',
    tags: ['Review points'],
    summary: 'Comment on a point',
    params: PointIdParams,
    body: CommentBody,
    ok: z.object({ ok: z.literal(true) }),
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'post',
    path: '/api/points/{pointId}/act',
    tags: ['Review points'],
    summary: 'Respond to, reopen or clear a point',
    params: PointIdParams,
    body: ActBody,
    ok: PointResponse,
    errs: [400, 401, 403, 404, 423]
  });
  reg.registerPath({
    method: 'post',
    path: '/api/points/{pointId}/evidence',
    tags: ['Review points'],
    summary: 'Attach an evidence file to a point (multipart: file)',
    security: [{ session: [] }],
    request: {
      params: PointIdParams,
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }) }) } } }
    },
    responses: { 200: json(EvidenceResponse, 'OK'), ...errors(400, 401, 403, 404, 423) }
  });
  reg.registerPath({
    method: 'get',
    path: '/api/evidence/{id}/file',
    tags: ['Review points'],
    summary: 'An evidence file',
    security: [{ session: [] }],
    request: { params: EvidenceIdParams },
    responses: {
      200: { description: 'The file bytes', content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
      ...errors(401, 404)
    }
  });
  add({
    method: 'put',
    path: '/api/engagements/{id}/checklist/answers/{itemId}',
    tags: ['Review points'],
    summary: 'Answer a disclosure checklist item',
    params: ItemIdParams,
    body: ChecklistAnswerBody,
    ok: ChecklistStateResponse,
    errs: [400, 401, 403, 404, 423]
  });
  add({
    method: 'post',
    path: '/api/engagements/{id}/signoff',
    tags: ['Sign-off'],
    summary: 'Sign off, partner sign-off, return, resubmit or unlock; the api checks readiness and tells Finance',
    params: EngagementIdParams,
    body: SignoffBody,
    ok: SignoffResponse,
    errs: [400, 401, 403, 404]
  });
  reg.registerPath({
    method: 'post',
    path: '/api/engagements/{id}/reports',
    tags: ['Sign-off'],
    summary: 'File the review report PDF made at a final sign-off (multipart: file)',
    security: [{ session: [] }],
    request: {
      params: EngagementIdParams,
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }) }) } } }
    },
    responses: { 200: json(ReportResponse, 'OK'), ...errors(400, 401, 403, 404) }
  });
  reg.registerPath({
    method: 'get',
    path: '/api/reports/{id}/file',
    tags: ['Sign-off'],
    summary: 'A review report PDF',
    security: [{ session: [] }],
    request: { params: ReportIdParams },
    responses: {
      200: { description: 'The PDF', content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } } },
      ...errors(401, 404)
    }
  });

  return new OpenApiGeneratorV31(reg.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'FS Review API',
      version,
      description:
        'Review workflow, identity, AI proxy, OCR and billing for FS Review. Errors always have the shape { error: { code, message, details? } }.'
    },
    servers: [{ url: '/' }]
  });
}
