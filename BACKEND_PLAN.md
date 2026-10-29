# FS Review: backend and database plan

Version 1.0 · 28 October 2026

## 1. Purpose

Build a standalone backend that owns all review data, so that work is shared between people, survives a
refresh, and is protected by the permission matrix on the server. Keep the existing front end; change only
its two storage modules and its API client.

The developer guide fixes the platform: Node.js 20 or later, Express, ES modules, PostgreSQL (Supabase is the
suggested host). This plan follows that and adds the structure, tooling and conventions the current code lacks.

## 2. What the code review found

The front end is complete. The backend is partial and file based.

| Concern                                                         | Today                                                                          | Problem                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Users, sessions, permissions, log, AI settings, billing, Xero   | Seven JSON files under `server/data`, read and rewritten whole on every change | No concurrency safety, no history, no queries, sessions lost on restart   |
| Entities, engagements, firm rules, checklists                   | Browser localStorage (`src/lib/engagements.js`)                                | Each computer has its own client list                                     |
| Documents, points, runs, sign-offs, reports, readings, evidence | Browser memory (`src/lib/reviewStore.js`)                                      | Lost on refresh, invisible to colleagues, permissions only in the browser |
| Analysis pipeline                                               | Runs in the browser (`src/lib/pipeline.js`) calling four Claude routes         | Results are never stored on the server; a closed tab loses the run        |
| Server structure                                                | Each file registers its own routes and does its own file IO                    | No separation of HTTP, rules and storage; hard to test                    |
| Validation                                                      | Ad hoc `if` checks per route                                                   | No schemas, inconsistent error shapes                                     |
| Tests                                                           | None                                                                           | Checks, permissions and billing rules are untested                        |
| Shared code                                                     | Server imports `../src/lib/*.js` from the front end                            | The two sides cannot be deployed separately                               |

What is good and must be preserved: role enforcement through `requirePerm` and the saved matrix; the
append-only activity log with actor taken from the session; the API key never leaving the server; every
Claude call logged with tokens; the billing reducer in `src/lib/billing.js` being shared by both sides; the
review store already being shaped as tables.

## 3. Target architecture

Clean architecture with four layers. Dependencies point inward only. The domain knows nothing about Express
or Postgres.

```
api/
  src/
    domain/            entities, value objects, domain rules, domain errors
      review/          Engagement, DocumentVersion, Workflow, ReviewPoint, Signoff, transitions
      identity/        User, Session, Role, PermissionMatrix
      billing/         Invoice, Transaction (wraps shared billing rules)
      activity/        ActivityEntry
    application/       use cases, one class or function per action; ports (interfaces) for storage
      review/          AttachDocument, ConfirmDocument, MarkReady, SendBack, SaveAnalysisRun,
                       RaisePoint, RespondToPoint, ClearPoint, ReopenPoint, SignOff, Unlock, ...
      identity/        SignIn, SignOut, CreateUser, UpdateUser, SavePermissions
      ai/              ExtractDocument, NarrativeReview, ExplainVariances, VersionPass
      billing/         ApplyBillingAction, EmailInvoice, SendToXero
      ports/           ReviewRepository, EngagementRepository, UserRepository, FileStorage,
                       ActivityLog, Clock, IdGenerator, AiGateway, Mailer, OcrEngine
    infrastructure/    adapters that implement the ports; the only layer that imports vendor packages
      db/              Prisma client, repositories, mappers between rows and domain objects
      storage/         S3Storage (Supabase Storage S3 endpoint, MinIO locally, AWS S3 or R2 later)
      ai/              AnthropicGateway (moved from server/index.js), prompts
      ocr/             TesseractEngine
      mail/            NodemailerMailer
      xero/            XeroClient
      events/          InProcessEventBus (one instance), RedisEventBus (several instances)
    interface/         HTTP only
      http/
        app.js         express app factory (no listen)
        server.js      entry point: config, container, listen
        middleware/    requestId, logger, auth (session → user), requirePerm, validate(zod), errorHandler
        routes/        thin controllers: parse → call use case → map result to response
        schemas/       zod request and response schemas, source of the OpenAPI document
        openapi.js     generated from the schemas, served at /api/docs
    config/            env loading and validation (zod), one typed config object
    container.js       composition root: wires adapters into use cases
  test/
    unit/              domain and use cases with in-memory fakes of the ports
    integration/       repositories against a real Postgres (testcontainers or a docker service)
    http/              supertest against the express app with the fake AI gateway
  migrations/
  package.json
```

Rules the team follows:

- Controllers contain no business logic; use cases contain no HTTP or SQL.
- Every write goes through a use case that checks the permission and the lock state. A route never calls a
  repository directly.
- Domain rules that the front end also needs (roles, billing, file rules, check library, workflow states) live
  in a shared workspace package `@fs-review/shared` imported by both `api` and `web`. One copy, one truth.
- All ids are UUID v4 generated by the server. The client never invents ids.
- All times are ISO 8601 UTC strings over the wire and `timestamptz` in the database.
- Money is integer pence, as the billing module already does.

## 4. Repository layout

The front end and the backend are two separate git repositories (ADR 0010). On a developer machine they sit
side by side under one plain parent folder, `fs-review`, which holds nothing of its own: no package.json, no
git, no tooling.

```
fs-review/                      plain parent folder on disk, not a repository
  react-app/                    repository 1: the web front end, unchanged (src/, public/, vite.config.js)
    server/                     the current file-based backend; deleted at the end of Phase 1
  api/                          repository 2: the backend, this document lives here
    package.json                the api; workspaces: ["shared"]
    src/, test/, prisma/        section 3
    shared/                     @fs-review/shared: roles, billing, fileRules, checkLibrary, aiOptions,
                                activityText, workflow states, plus their unit tests
    docker-compose.yml          postgres, mysql (portability gate), minio for local development
    .github/workflows/ci.yml    lint, typecheck, test, build, import-boundary proof
    docs/                       ARCHITECTURE.md, ADR/
    BACKEND_PLAN.md
```

Each repository installs, tests and deploys on its own. The front end reaches the api over HTTP on port 8787
(the Vite proxy in development, the api's public address in production). During Phases 0 and 1 the front
end still talks to the old `react-app/server`, because every existing route keeps its path and payload.

`shared` lives in the api repository because the api is its first consumer and the rules it holds are
enforced there. The front end consumes it as a versioned package: published to GitHub Packages under the
firm's organisation from the api repo's release workflow (Phase 2, when `roles` and `fileRules` move in).
Until then the front end keeps its existing copies under `src/lib` and `src/data`.

## 5. Standards and tooling

| Area            | Standard                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript, strict mode, ES modules, for `api` and `shared`. The front end stays JavaScript.                                                                                                                          |
| Lint and format | ESLint (recommended + import order) and Prettier, enforced in CI and in a pre-commit hook (lint-staged)                                                                                                               |
| Validation      | zod schemas for every request body, query and params; the same schemas generate OpenAPI 3.1                                                                                                                           |
| API style       | REST, nouns in paths, JSON bodies, `GET /api/engagements/:id/review` style; verbs only for state transitions (`/signoff`, `/workflow`)                                                                                |
| Errors          | One shape everywhere: `{ error: { code, message, details? } }`; codes such as `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `LOCKED`, `AI_UNAVAILABLE`. HTTP status matches the code. |
| Auth            | Keep the HttpOnly session cookie. Sessions in Postgres with a hashed token. Add CSRF protection (SameSite=Lax plus an Origin check on writes) and rate limiting on login and Claude routes.                           |
| Logging         | pino, JSON lines, one request id per request echoed in the `X-Request-Id` header; never log file contents or passwords                                                                                                |
| Config          | All settings from environment variables, validated at start by a zod schema; the process refuses to start with a missing or malformed value; `.env.example` stays the documentation                                   |
| Database        | Prisma with migrations committed to the repo; `npm run db:migrate` in CI and at deploy; no schema changes outside migrations; portable SQL only (section 11)                                                          |
| Files           | Object storage behind the `FileStorage` port; database stores key, size and SHA-256 only; downloads via short-lived signed URLs                                                                                       |
| Tests           | Vitest. Unit tests for domain and use cases; integration tests for repositories; HTTP tests with supertest. CI fails under 80 percent coverage on `domain`, `application` and `shared`.                               |
| Docs            | OpenAPI served at `/api/docs`; `ARCHITECTURE.md`; one ADR per decision in section 10                                                                                                                                  |
| Versioning      | Conventional commits, semantic version tags, CHANGELOG generated                                                                                                                                                      |
| Security        | helmet, CORS allow list, 25 MB upload limit, MIME sniffing on uploads, scrypt stays for passwords, secrets only in env                                                                                                |

## 6. Database schema

PostgreSQL 15 or later. Names in snake_case. Every table: `id uuid primary key`, `created_at timestamptz not
null default now()`, and `updated_at` where rows change. Foreign keys everywhere; `on delete restrict` because
nothing in this product is deleted, only deactivated or superseded.

### 6.1 Identity and administration

```
users                 id, name, username unique, email unique null, role, active bool,
                      password_hash, password_salt, last_sign_in_at
sessions              id, token_hash unique, user_id → users, ip, expires_at, revoked_at
login_attempts        key pk (ip|username), count, first_at
permission_matrix     id = 1, matrix jsonb, updated_by → users, updated_at
password_resets       id, token_hash unique, user_id, expires_at, used_at
ai_settings           id = 1, enabled, model, steps jsonb, policy_confirmed_by, policy_confirmed_at
xero_connection       id = 1, tokens jsonb (encrypted at rest), tenant_id, connected_by, connected_at
activity              id bigserial, at, actor_id null, actor_name, actor_role, category, summary, details,
                      ip, engagement_id null, fund_name, usage jsonb null
                      index (engagement_id, at desc); index (at desc); no update or delete grants
```

### 6.2 Firm configuration

```
check_rule_config     id = 1, rules jsonb, overrides jsonb, custom jsonb, updated_by, updated_at
checklist_templates   framework pk (FRS102 | IFRS | Other), version int, items jsonb, updated_by, updated_at
checklist_template_versions   framework, version, items jsonb, saved_by, saved_at   (history)
```

### 6.3 Clients and funds

```
entities              id, name, name_key unique (lower, no spaces), client_name, legal_form, jurisdiction,
                      year_end, administrator, auditor, framework, billing_email,
                      ai_permitted bool null, ai_basis, ai_decided_by, ai_decided_at,
                      rule_overrides jsonb, partner_signoff bool, umbrella bool, checklist_mode,
                      created_by, updated_by, updated_at
engagements           id, entity_id → entities, fund_name, year_end date, currency char(3),
                      umbrella_name, preparer_id, reviewer_id, manager_id, partner_id (→ users, null),
                      threshold bigint, high_multiple int, fee_rate_pct numeric null, fee_months int,
                      variance_mode, investigate_pct, explain_pct, narrative bool,
                      options jsonb (partnerSignoff, umbrella, aiOptOut, aiOptOutReason, checklist),
                      rule_overrides jsonb, tb_map jsonb, tb_map_by, tb_map_at,
                      created_by, updated_by, updated_at
                      unique (entity_id, fund_name, year_end)
engagement_members    view: preparer, reviewer, manager, partner of each engagement (for access checks)
```

### 6.4 Review work (one row type per table in `reviewStore.js`)

```
document_versions     id, engagement_id, slot (cy|py|tb|is|sup), version int, file_name, size, sha256,
                      sample bool, storage_key null, uploaded_by, uploaded_at, removed_at, removed_by,
                      validation jsonb, confirmation jsonb, read_with, same_as_version int
                      unique (engagement_id, slot, version); index (engagement_id, sha256)
workflows             engagement_id pk, state (preparing|ready|returned), by, at, reason
workflow_history      id, engagement_id, state, by, at, reason
review_points         id, engagement_id, ref (RP-01, RP-D1), source (analysis|manual|disclosure),
                      content jsonb, status (open|responded|reopened|cleared), type, due_date,
                      assigned_to, raised_by, raised_at, cleared_by, cleared_at, updated_at
                      unique (engagement_id, ref)
point_messages        id, point_id, engagement_id, kind (raise|assign|comment|response|reopen|clear|note),
                      author jsonb, at, text, attachments jsonb      insert only
point_evidence        id, engagement_id, point_id, file_name, size, sha256, storage_key, by, at
analysis_runs         id, engagement_id, draft_version, result jsonb, analysed_at, settings_sig,
                      document_versions jsonb, by, at, ai_skipped jsonb, ai_reads jsonb
document_readings     key pk (slot:sha256:model), slot, sha256, model, reading jsonb, read_by, read_at
signoffs              engagement_id pk, state (none|returned|resubmitted|signed_manager|awaiting_partner|
                      signed|unlocked), by, at, text, summary jsonb
signoff_history       id, engagement_id, state, by, at, text, summary jsonb
disclosure_checklists engagement_id pk, framework, version, items jsonb, answers jsonb
review_reports        id, engagement_id, version int, sha256, storage_key, by, at, signed_by, signed_at
```

### 6.5 Billing

```
billing_settings      id = 1, settings jsonb, updated_by, updated_at
billing_events        id, engagement_id, kind (signoff|unlock), payload jsonb, at
invoices              id, number unique, engagement_id, status, lines jsonb, ai_usage jsonb, totals jsonb,
                      fx_rate numeric, issued_at, due_date, emails jsonb, created_by, updated_at
invoice_transactions  id, invoice_id, kind (payment|credit|writeoff|cancel), amount bigint, number,
                      reason, at, by
billing_sequences     name pk (invoice|credit), value int
```

Billing keeps the reducer in `shared/billing.js`. Phase 1 stores its whole state as one jsonb row to move
quickly; Phase 5 splits it into the tables above without changing the reducer's interface.

### 6.6 Access rule

Review rows are visible to: Administrators; Finance, limited to sign-off events and AI usage; and any staff
member who is on the engagement team or whose role holds a matching permission in the matrix (the rule
`notifications.js` already uses). Implemented once in `application/review/access.js` and used by every
review use case. Supabase row level security can mirror it later; the application check is the one that
counts.

## 7. API

All existing 35 routes keep their path, method and payload. New routes below. Every write passes through
`auth → requirePerm → validate → use case`. Writes on a locked engagement return `423 LOCKED`.

### 7.1 Entities, engagements, configuration

| Method and path                                  | Use case                    | Permission                       |
| ------------------------------------------------ | --------------------------- | -------------------------------- |
| GET /api/entities                                | ListEntities                | signed in                        |
| POST /api/entities · PUT /api/entities/:id       | SaveEntity                  | engagements.edit                 |
| GET /api/engagements                             | ListEngagements             | signed in                        |
| POST /api/engagements · PUT /api/engagements/:id | SaveEngagement              | engagements.edit                 |
| PUT /api/engagements/:id/tb-map                  | SaveTrialBalanceMapping     | documents.attach or analysis.run |
| GET, PUT /api/config/check-rules                 | GetRules, SaveRules         | PUT: users.manage                |
| GET, PUT /api/config/checklists/:framework       | GetChecklist, SaveChecklist | PUT: users.manage                |

### 7.2 Documents and workflow

| Method and path                                             | Use case                                                                                                  | Permission                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| GET /api/engagements/:id/review                             | GetReviewSnapshot (versions, current, workflow, points, messages, signoff, checklist, reports, latestRun) | access rule                                     |
| POST /api/engagements/:id/documents (multipart: slot, file) | AttachDocument: hash, dedupe by sha256, create version                                                    | documents.attach                                |
| POST /api/engagements/:id/documents/sample                  | AttachSampleDocuments                                                                                     | documents.attach                                |
| PUT /api/documents/:versionId/validation                    | SetValidation                                                                                             | documents.attach                                |
| PUT /api/documents/:versionId/read-with                     | SetReadWith                                                                                               | documents.attach                                |
| POST /api/documents/:versionId/confirm                      | ConfirmDocument                                                                                           | documents.attach or analysis.run                |
| DELETE /api/engagements/:id/documents/:slot                 | RemoveDocument                                                                                            | documents.attach                                |
| GET /api/documents/:versionId/file                          | DownloadDocument (signed URL)                                                                             | access rule                                     |
| PUT /api/engagements/:id/workflow                           | MarkReady / SendBack / Reopen (state machine)                                                             | ready: documents.attach; returned: analysis.run |

### 7.3 Analysis

| Method and path                                                      | Use case                                                                                                                                                                                                                                                                                  | Permission   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| POST /api/engagements/:id/analysis-jobs                              | StartAnalysis: the same checks as the Documents tab, a queued job, 202. RunAnalysisJob then reads the documents, runs the checks and AI steps, saves the points (SyncAnalysisPoints) and the run (SaveAnalysisRun) and logs it; each step is published on /api/events (Phase 6, ADR 0011) | analysis.run |
| GET /api/analysis-jobs/:id                                           | GetAnalysisJob: queued, running (step of total), done (with the run) or failed (with the reason); the latest job is also in the review snapshot                                                                                                                                           | any staff    |
| POST /api/extract, narrative-review, explain-variances, version-pass | RunAiStep, unchanged; the analysis job calls the same use case. AI readings are kept by content on the server                                                                                                                                                                             | analysis.run |

### 7.4 Review points

| Method and path                                          | Use case                                         | Permission         |
| -------------------------------------------------------- | ------------------------------------------------ | ------------------ |
| POST /api/engagements/:id/points                         | RaisePoint                                       | points.raise       |
| PUT /api/points/:id/meta                                 | SetPointMeta (type, due date)                    | points.raise       |
| PUT /api/points/:id/assignee                             | AssignPoint                                      | points.raise       |
| POST /api/points/:id/comments                            | CommentOnPoint                                   | team member        |
| POST /api/points/:id/responses (multipart)               | RespondToPoint: text, revised document, evidence | points.respond     |
| POST /api/points/:id/reopen · POST /api/points/:id/clear | ReopenPoint, ClearPoint                          | canClearPoint rule |
| GET /api/evidence/:id/file                               | DownloadEvidence                                 | access rule        |

### 7.5 Checklist, sign-off, reports, portfolio

| Method and path                                                | Use case                                                                                                                      | Permission                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| PUT /api/engagements/:id/checklist/answers/:itemId             | AnswerChecklistItem (a No raises an RP-D point)                                                                               | analysis.run                                    |
| POST /api/engagements/:id/signoff                              | SignOff: server re-checks all points cleared, checklist complete, documents ready; writes report request and billing event    | review.signoff                                  |
| POST /api/engagements/:id/signoff/partner                      | PartnerSignOff                                                                                                                | review.partnerSignoff                           |
| POST /api/engagements/:id/signoff/return · /resubmit · /unlock | ReturnToReviewer, Resubmit, Unlock                                                                                            | signoff: review.signoff; resubmit: analysis.run |
| POST /api/engagements/:id/reports (multipart pdf)              | StoreReviewReport                                                                                                             | review.signoff or partnerSignoff                |
| GET /api/reports/:id/file                                      | DownloadReport                                                                                                                | access rule                                     |
| GET /api/portfolio                                             | GetPortfolio: stage and waiting-for per fund, from aggregate queries (counts and latest times per fund)                       | reviews.read                                    |
| GET /api/notifications                                         | GetNotifications: the rules in `shared/reviewStatus.ts` over a lean read; newest 50 actions with the total, newest 60 updates | activity.write (Finance gets none)              |

### 7.6 Live updates

`GET /api/events` is a Server-Sent Events stream. Every use case that commits a write publishes
`{ engagementId, table }` on the `EventBus` port after the transaction commits. The in-process adapter serves
a single API instance; the Redis adapter serves several. The front end's `reviewStore.subscribe` listens and
refetches that engagement's snapshot. Fallback for proxies that block SSE: poll the snapshot every 15 seconds
with an `If-None-Match` ETag.

## 8. Front-end changes

Deliberately small. No screen changes.

1. `src/lib/reviewStore.js`: same exported methods. Body becomes an API client with an in-memory cache
   per engagement, refreshed by SSE. `fileOf`, `evidenceFile` and `reportFile` return download URLs instead
   of File objects; the three places that read them (analysis, umbrella copy, report download) fetch the
   bytes when needed.
2. `src/lib/engagements.js`: `localStore` and `sharedStore` replaced by one `apiStore`.
3. `src/lib/auth.js` and `src/lib/activity.js`: the demo backend branches are deleted (decision 7).
4. `src/lib/api.js`: one `http` helper with the standard error shape, credentials included, request id
   passthrough.
5. Imports of `roles`, `billing`, `fileRules`, `checkLibrary` and `aiOptions` move from `src/lib` and
   `src/data` to `@fs-review/shared`, so the front end and the api use the same copy.
6. The analysis runs on the api (Phase 6). The Documents tab starts it with `POST /analysis-jobs` and follows
   the job on the event stream; `pipeline.js` keeps only what the screens need to re-run checks instantly.
7. Vite proxy points at `API_URL`. Production: `dist/` served by a CDN or by the api behind `/`.

## 9. Delivery phases

Each phase ends with green CI, a migration that runs forward on the previous phase's data, and the UAT
scenarios for that area passing. Estimates are for one developer.

| Phase                                             | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Exit test                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Days |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0 Foundation (done 28 Oct 2026)                   | Workspaces inside `react-app`, `shared` package, `api` skeleton in TypeScript with the four layers, config, logger, error handler, zod, OpenAPI, Prisma, ESLint import-boundary rules, docker-compose with Postgres, MySQL and MinIO, CI, Prettier, Vitest, ADRs for the nine decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `npm test` and `npm run lint` pass on an empty app; `/api/health` answers; the import-boundary rule fails a deliberate bad import                                                                                                                                                                                                                                                                                                                                                      | 2    |
| 1 Identity and admin (done 28 Oct 2026)           | users, sessions, login attempts, permissions, password resets, AI settings, activity, billing state and Xero moved to Postgres. All 35 routes re-homed as use cases behind ports, with the four Claude routes, OCR and billing extras. `npm run seed` and `npm run import:legacy`. The old `react-app/server` removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | UAT A1, A2, A5, K, L covered by HTTP tests with in-memory adapters (37 tests); live sign-in, user list, activity log and AI settings verified against Postgres; sessions live in the `sessions` table                                                                                                                                                                                                                                                                                  | 3    |
| 2 Firm configuration and funds (done 28 Oct 2026) | check-rule config, checklist templates with a version history, entities, engagements and the trial balance mapping on Postgres as documents with indexed columns; `engagements.js` rewritten as an api store that refreshes after saves, on focus and every 20 seconds, with a one-time import of a browser's old localStorage data. The front end still keeps its own copies of the shared rules until `@fs-review/shared` is published (section 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | UAT A3, A4, B1 to B4 covered by 7 HTTP tests (44 total); a client and a fund created live through the UI and found in Postgres; a second tab lists them from the server                                                                                                                                                                                                                                                                                                                | 3    |
| 3 Documents and workflow (done 28 Oct 2026)       | `FileStorage` port with local-disk and S3 adapters (S3 chosen when `S3_ENDPOINT` or `S3_ACCESS_KEY` is set); multipart uploads checked by slot, size and file signature; versions with SHA-256 dedupe and "same content as vN"; validation, read-with and Confirm Anyway stored per version; the preparing, ready, returned state machine with the required-documents and cleared checks; two locks enforced by the api (documents marked ready, and a sign-off); `GET /api/engagements/:id/review` and `/api/reviews` snapshots; `/api/events` Server-Sent Events; the document half of `reviewStore.js` rewritten as an api store that fetches files in the background and refreshes on events.                                                                                                                                                                                                                                                | UAT C1 to C5 covered by 10 HTTP tests (54 total); five sample documents attached and marked ready live through the UI, found in Postgres, and still there after a reload; a real PDF uploaded, downloaded and de-duplicated against the running api                                                                                                                                                                                                                                    | 5    |
| 4 Analysis, points, sign-off (done 28 Oct 2026)   | analysis runs kept with the document versions they read (the analysis itself still runs in the browser, ADR 0008); AI readings by content; review points with insert-only threads, evidence files and revised documents on responses; checklist answers with the copied items; the sign-off state machine with the readiness checks (documents ready, analysis recorded, every point cleared, checklist complete) and the Manager-then-Partner rule; review report PDFs filed in storage; the billing event written by the SetSignoff use case. `reviewStore.js` now reads and writes only the api. The portfolio and the bell are still computed in the browser from `/api/reviews`, which carries every fund's points, workflow, sign-off and latest run; the SQL portfolio and server-side notifications of sections 7.5 are deferred to Phase 7.                                                                                             | UAT D1, D2, E1 to E5, F1, G1 to G4 covered by 10 HTTP tests (63 total); live through the UI: analysis of the sample documents recorded 7 points, all responded to and cleared through the api, Manager sign-off with the report filed, and Finance seeing the fund under Ready to Invoice from the api-written event                                                                                                                                                                   | 6    |
| 5 Billing on tables (done 28 Oct 2026)            | billing on five tables: `billing_settings`, `billing_events` (one row per signed-off engagement), `invoices` (indexed columns for number, engagement, status, client, dates and gross pence, plus the whole invoice document), insert-only `invoice_transactions` (payments, write-offs, credit notes and cancellations, with the reducer's own ids) and `billing_sequences` (invoice and credit-note numbers). The shared reducer and the `BillingRepository` port are unchanged: the Prisma adapter composes the reducer's state from the tables and writes it back in one transaction; a discarded draft deletes its row. An installation that still has the Phase 1 `billing_state` row is imported on first read. AI usage already comes from the activity table by SQL (`ActivityLog.usage`). First integration test against Postgres, `test/integration/PrismaBillingRepository.test.ts`, switched on by `DATABASE_URL_TEST` (set in CI). | UAT K1 to K6 covered by the billing HTTP tests and the integration test                                                                                                                                                                                                                                                                                                                                                                                                                | 2    |
| 6 Analysis on the server (done 28 Oct 2026)       | the review engine (readers, checks, variance model, sample fund) ported to TypeScript in `@fs-review/shared/analysis`; the pipeline in `application/analysis` runs as a background job: `POST /analysis-jobs` answers 202, `analysis_jobs` events report the eight steps, the job saves the points and the run and logs it, and a restart marks an interrupted job failed and re-queues waiting ones (ADR 0011). pdf.js 3.11.174 and SheetJS 0.18.5 run in Node behind a `DocumentReader` port; scans are drawn with node-canvas (optional) and read with Tesseract on the server, the reading kept by content. The browser only starts the job and shows its progress; the routes that let it post its own results are removed.                                                                                                                                                                                                                 | Ten parity scenarios (no AI, AI, read by AI, reading reused, settings and custom rules, next draft with and without AI, umbrella, sample v2 and v3) give identical results in the browser engine and the api (`npm run parity:analysis`, golden files checked by `npm test`); a scanned draft is read by OCR on the server with the right figures (UAT I3); job tests cover D1, D2, I1, I2. The real UAT file pack should be run through `parity:analysis` once it is on this machine. | 5    |
| Audit of Phases 0 to 6 (done 29 Oct 2026)         | three independent reviews (identity and HTTP; review workflow; billing, analysis and the port); 38 findings, 2 critical (Partner sign-off bypass, lost billing updates) and 11 high, all fixed except the SheetJS upgrade, which is mitigated and pending approval. Rules that came out of it are in ADR 0012; the full list with each fix and test is `docs/AUDIT-2026-10-28.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 104 api tests and 20 shared tests, including `test/http/audit.test.ts`; live check of sign-in, review, analysis and a refused cross-site write                                                                                                                                                                                                                                                                                                                                         | 1    |
| 7 Hardening (done 29 Oct 2026, sign-off pending)  | rate limits, CSRF origin check, helmet, body limits and `TRUST_PROXY` (done in the audit, ADR 0012); portfolio (`GET /api/portfolio`, aggregate queries) and the bell (`GET /api/notifications`, rules in `shared/reviewStatus.ts`) computed on the api, so no screen loads every fund; the no-server demo mode retired (ADR 0007); load test with 50 funds (`npm run load-test`), which found and fixed three problems: concurrent analysis starts refused, a heavy bell, refetch bursts (`docs/LOAD-TEST-2026-10-29.md`); a `title` column on review points; MySQL portability gate in CI (`npm run check:portability`); coverage gate in CI; OpenAPI-matches-routes test; security checklist (`docs/SECURITY.md`), backups, restore, HTTPS and CSP notes (`docs/OPERATIONS.md`); two-factor decision proposed in ADR 0013                                                                                                                     | 111 api and 20 shared tests pass with coverage (93 percent of lines, threshold 80); lint, typecheck and both builds pass; the schema deploys to MySQL 8.4; portfolio 28 ms and bell 142 ms for one person at 50 funds; checked live in the browser. Open: the checklist is not yet signed by a reviewer; ADR 0013 needs approval and then about two days of work; the SheetJS upgrade needs approval; team visibility is undecided                                                     | 3    |

Total: about 29 working days, six weeks with the UAT re-run. Phases 5 and 6 can run after a first release
if the team wants shared review work sooner; Phases 0 to 4 are the minimum for production.

## 10. Decisions taken

Recorded here and copied into `docs/ADR/` in Phase 0. Each one is chosen so that the backend depends on
no single vendor.

| #   | Decision              | Choice                                                                                                                                                                                                                                     | Why                                                                                                                                |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Database host         | Supabase Postgres today, reached only through a standard Postgres connection string (`DATABASE_URL`). No Supabase SDK, Auth, Realtime, Storage SDK, Edge Functions or row level security in the codebase.                                  | Moving to RDS, Azure, Neon or a self-hosted server becomes a change to one environment variable.                                   |
| 2   | Authentication        | The app's own HttpOnly session cookie, sessions in a table, scrypt passwords as today. Not Supabase Auth.                                                                                                                                  | No screens change; sign-in does not break when the host changes.                                                                   |
| 3   | Language              | TypeScript for `api` and `shared`, strict mode. `web` stays JavaScript.                                                                                                                                                                    | Ports and use cases are interfaces; TypeScript makes the layer boundaries real and checkable.                                      |
| 4   | Data access           | Prisma, with every query inside a repository class under `infrastructure/db`. Prisma is chosen over Drizzle because its schema declares the provider in one line and supports Postgres, MySQL, SQL Server and SQLite from the same models. | A change of database engine regenerates migrations and touches nothing outside `infrastructure/db`.                                |
| 5   | File storage          | The S3 protocol through `@aws-sdk/client-s3`, behind the `FileStorage` port. Supabase Storage's S3-compatible endpoint today, MinIO locally.                                                                                               | AWS S3, Cloudflare R2, MinIO or Azure (through its S3 gateway) are a change of endpoint and keys.                                  |
| 6   | Live updates          | The API's own Server-Sent Events endpoint fed by an `EventBus` port. In-process adapter for a single instance; Redis pub/sub adapter when there is more than one instance. Not Supabase Realtime and not Postgres `NOTIFY`.                | Works on any database and any host.                                                                                                |
| 7   | Hosted no-server demo | Retired. The demo branches in `auth.js`, `activity.js` and `engagements.js` are deleted. The built-in sample documents stay, since they are a product feature, not a storage mode.                                                         | Removes a second code path that would otherwise have to be kept correct forever.                                                   |
| 8   | Analysis location     | Browser for the first release, server from Phase 6 (done): a background job on the api.                                                                                                                                                    | Shared review data shipped sooner; the move was isolated behind the `DocumentReader` port and checked by a parity test (ADR 0011). |
| 9   | Hosting region        | A European region of whichever host is chosen.                                                                                                                                                                                             | The developer guide notes a data residency requirement for client financial statements.                                            |

## 11. Database and vendor independence

The requirement: a future change of database host or engine must need no change to application code.
These rules make that true and are enforced, not just written down.

### 11.1 Layer rule

Only `infrastructure/` may import a vendor package. The domain, application and interface layers know
only the ports in `application/ports`. Enforced by an ESLint `no-restricted-imports` rule per folder:

| Package              | Allowed only in                       |
| -------------------- | ------------------------------------- |
| `@prisma/client`     | `infrastructure/db/**`                |
| `@aws-sdk/client-s3` | `infrastructure/storage/**`           |
| `@anthropic-ai/sdk`  | `infrastructure/ai/**`                |
| `tesseract.js`       | `infrastructure/ocr/**`               |
| `nodemailer`         | `infrastructure/mail/**`              |
| `ioredis`            | `infrastructure/events/**`            |
| `@supabase/*`        | nowhere; the package is not installed |

### 11.2 Portable SQL

- No raw SQL in repositories except inside a file named `*.pg.ts`, which must have a sibling for every
  supported engine or a documented fallback. Target: zero such files at the end of Phase 4.
- No Postgres-only column types or functions: no arrays, no `jsonb` operators in queries, no `NOTIFY`,
  no `ILIKE`, no `RETURNING` assumptions, no triggers or stored procedures. JSON columns are written and
  read whole; the application filters in code or through indexed scalar columns.
- Keys are UUID strings generated by the application, not by the database.
- Sequences for invoice and credit note numbers come from the `billing_sequences` table under a
  transaction, not from a database sequence.
- Timestamps are stored as UTC and compared as UTC; the application never relies on the database's
  time zone.
- Case-insensitive uniqueness (entity names, usernames) uses a stored lower-cased key column, not a
  functional index.

### 11.3 Portability gates in CI

- The repository integration suite runs against Postgres on every pull request.
- The `portability` CI job (`scripts/check-portability.mjs`, from Phase 7) makes a MySQL copy of
  `schema.prisma`, validates it, writes the MySQL DDL and deploys it to a MySQL 8.4 service. It fails on any
  native type other than `@db.Text`. This proves the schema is portable.
- Not done: running the repository suite itself on MySQL. The schema check catches engine-specific types and
  defaults; it does not catch a query that behaves differently on MySQL. Add it before a move to MySQL.

### 11.4 What a migration looks like

| Move                                | What changes                                                                                         | What does not                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Supabase to another Postgres host   | `DATABASE_URL`; run `prisma migrate deploy`; copy data with `pg_dump` and `pg_restore`               | Nothing in the repository                                  |
| Postgres to MySQL or SQL Server     | `provider` in `schema.prisma`; regenerate migrations; data copy script; re-run the integration suite | `domain/`, `application/`, `interface/`, `shared/`, `web/` |
| Supabase Storage to S3, R2 or MinIO | `S3_ENDPOINT`, `S3_BUCKET`, keys; copy objects                                                       | Nothing in the repository                                  |
| One instance to several             | `EVENT_BUS=redis`, `REDIS_URL`                                                                       | Nothing in the repository                                  |

### 11.5 Supabase connection details for today

- Use the direct connection or the pooler in session mode for the API process, because Prisma holds
  prepared statements. Transaction mode breaks them.
- Keep the Supabase project's own SQL editor and dashboard for inspection only; never create objects there.
  Every object comes from a committed migration, so the schema can be rebuilt anywhere.
- Row level security stays off. The API connects as the owner role and enforces access in
  `application/review/access.ts`. Supabase grants its public roles (`anon`, `authenticated`) every privilege on
  new tables in `public`, so with RLS off its Data API would expose them. Turn the Data API off (Project Settings,
  Data API) and, on every new project, remove the grants once in the SQL editor (done on the London project on
  29 Oct 2026):

  ```sql
  revoke all on all tables in schema public from anon, authenticated;
  revoke all on all sequences in schema public from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
  ```

- Back up with `pg_dump` on a schedule to storage you control, in addition to Supabase's own backups.

## 11. Definition of done for the whole project

- Every UAT scenario in the test plan passes against the new backend with two browsers and a server
  restart in the middle.
- No review permission is enforced only in the browser.
- `npm run test` covers domain, application and shared at 80 percent or more.
- OpenAPI document matches every route (CI checks it).
- A fresh clone starts with `docker compose up`, `npm run db:migrate`, `npm run seed`, `npm run dev`.
- ARCHITECTURE.md and the ADRs are up to date.
