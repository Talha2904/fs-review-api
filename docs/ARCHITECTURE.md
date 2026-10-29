# FS Review api: architecture

This repository is the FS Review backend. The web front end (`react-app`) is a separate repository; on a
developer machine both sit under one parent folder, `fs-review/`, as siblings. This repo holds the api
itself and `shared/`, a workspace package of rules the front end will consume too (ADR 0010).

The api follows clean architecture: four layers, dependencies pointing inward, vendor packages confined to
adapters. The full plan is in `BACKEND_PLAN.md`.

## Layers

```
src/
  domain/          Entities, value objects and rules. No imports from any other layer or vendor.
  application/     Use cases (one per action) and ports (interfaces the use cases need).
                   Imports domain only. Never Express, never Prisma.
  infrastructure/  Adapters that implement the ports: Prisma repositories, S3 storage, Anthropic,
                   Tesseract, nodemailer, Redis, pino. The only layer allowed to import vendor packages,
                   each in its own folder.
  interface/http/  Express: middleware, routes (thin controllers), zod schemas, OpenAPI.
                   Calls use cases. Receives adapters from the container; never imports infrastructure.
  config/          Typed environment loading.
  container.ts     Composition root: builds adapters and hands them to use cases and routes.
```

A request flows: `interface` parses and validates → calls a `use case` → the use case checks permission
and lock state, applies `domain` rules, talks to `ports` → `infrastructure` adapters do the IO →
the use case publishes an event → `interface` maps the result to JSON.

## Analysis (Phase 6)

The analysis engine (readers, checks, variance model, sample fund) is pure TypeScript in
`shared/src/analysis`, ported from the web app. `application/analysis` holds the pipeline (`AnalysisPipeline`,
the steps and their order), the Claude steps (`AiAnalysisSteps`, through `RunAiStep`) and the job use cases
(`StartAnalysis`, `RunAnalysisJob`, `GetAnalysisJob`, `RecoverAnalysisJobs`). Documents are read through the
`DocumentReader` port (`infrastructure/documents`: pdf.js and SheetJS at the browser's versions, node-canvas for
drawing scans) and jobs run through the `JobQueue` port (`infrastructure/jobs`). See ADR 0011.

```
POST /analysis-jobs → StartAnalysis: checks, saves a queued job, 202 → JobQueue
  RunAnalysisJob: load fund, settings and documents → pipeline (read, check, AI steps) → tick 1..8
  → SyncAnalysisPoints → SaveAnalysisRun → activity log → job done   (each step published on /api/events)
```

Parity with the browser is tested. `npm run fixtures:analysis` builds the test documents in
`test/fixtures/analysis`; `npm run parity:analysis` runs every scenario through the web app's original
pipeline (a frozen copy in `test/parity/web-engine`, or another checkout with `--web <path>`) and the api, and
`--write` records the browser's results as `golden/*.json`. `test/unit/analysisParity.test.ts` compares the api with those on every `npm test`.

## Security and integrity

The rules from the Phase 0 to 6 audit (ADR 0012, `docs/AUDIT-2026-10-28.md`):

- **Who reads what.** Review content needs `reviews.read` (every role but Finance); billing needs
  `billing.manage` (Finance). Permissions are checked in the use case; route guards are a first filter only.
- **Server-only facts.** Sign-off events, analysis results, AI context and server-owned audit categories never
  come from a client.
- **Concurrency.** Targeted or conditional updates (documents, points), or read-change-write in one
  serializable transaction with retries (billing, checklist answers, first Administrator, analysis job claim).
- **Locks where saved.** Sign-off fixes the Partner step and freezes the engagement; nothing changes while an
  analysis runs; sign-off needs an analysis of the current documents.
- **HTTP.** Writes only from the app's own origins (CSRF); 1 MB JSON bodies except OCR and invoice PDFs;
  sign-in, set-up and reset limited per address and per username; client address trusted only from the proxies
  `TRUST_PROXY` names; HttpOnly, SameSite=Lax, Secure in production session cookie.
- **Untrusted files.** Parsed in a short-lived child process with a heap limit and a timeout
  (`IsolatedDocumentReader`); pages drawn for OCR are capped in size.

## Rules that are enforced by tooling

| Rule                                               | Enforced by                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only `infrastructure/<vendor>` imports that vendor | `eslint.config.js`, `no-restricted-imports`; CI job `import-boundary` proves it fires                                                                                         |
| Inner layers never import outer ones               | same config, path patterns                                                                                                                                                    |
| `@supabase/*` is never imported                    | same config; the package is not installed                                                                                                                                     |
| Every request is validated                         | `validate()` middleware with zod schemas; schemas also generate OpenAPI                                                                                                       |
| One error shape                                    | `errorHandler`: `{ error: { code, message, details? } }`                                                                                                                      |
| Configuration is complete and typed                | `config/env.ts` refuses to start on a bad value                                                                                                                               |
| Portable SQL                                       | Prisma with no native types but `@db.Text`; the CI `portability` job deploys the schema to MySQL 8.4 (`npm run check:portability`). The repository tests run on Postgres only |
| Coverage on domain and application                 | vitest thresholds in `vitest.config.ts`                                                                                                                                       |

## Conventions

- TypeScript strict, ES modules, `.js` extensions on relative imports (NodeNext).
- Ids are UUID v4 made by `IdGenerator`; the database never generates ids.
- Times are ISO 8601 UTC strings over the wire, `timestamptz` in the database, read through `Clock`.
- Money is integer pence.
- A use case is a class with one `execute(input, actor)` method, constructed with its ports.
- A repository exposes domain objects, never Prisma rows; mapping lives in `infrastructure/db/mappers`.
- Routes do: validate → call use case → `res.json`. Nothing else.
- Tests: unit tests for domain and use cases with in-memory fakes of the ports; HTTP tests with supertest and
  fake adapters (`test/helpers/fakes.ts` builds the whole app in memory); integration tests for repositories
  under `test/integration`, which run against the migrated database named by `DATABASE_URL_TEST` and are
  skipped when it is not set. CI sets it to its own fresh Postgres; locally create `fsreview_test` as described
  in `.env.example`.

## Running

All commands run from this repository's root (the `api` folder).

```
docker compose up -d                 # postgres and minio
cp .env.example .env
npm install                          # installs the api and the shared workspace
npm run build -w shared
npm run db:generate
npm run db:migrate                   # applies prisma/migrations
npm run seed                         # the five starting accounts (change their passwords)
npm run import:legacy -- <path to the old server's data folder>   # optional, one-time: users, permissions, log, billing
npm run dev                          # http://localhost:8787/api/health, /api/docs
npm test
npm run lint
npm run build
```

The front end runs from its own repository (`npm run dev` in `react-app`) and reaches the api on port 8787
through the Vite proxy. In production, serve `react-app/dist` from a static host and point its `/api`
proxy or `API_URL` at this api.

Schema changes: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>` against the
local Postgres, and commit the generated folder under `prisma/migrations`. Never change the database by hand.

## Decision records

See `docs/ADR/`. Each decision in `BACKEND_PLAN.md` section 10 has a record.
