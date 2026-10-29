# 0011. The analysis runs as a background job on the api

Date: 2026-10-28 · Status: Accepted

## Context

ADR 0008 moved the analysis to the server in Phase 6. An analysis reads up to five documents (PDF text,
workbooks, OCR of scans), runs the checks and makes up to four Claude calls, so it can take from under a
second to a minute or more. It must not hold an HTTP request open, a closed browser tab must not lose it,
and the result must be exactly what the browser produced, because reviewers have been using those results.

## Decision

- `POST /api/engagements/:id/analysis-jobs` checks the same conditions the Documents tab checked (documents
  ready, required documents attached and cleared, something changed since the last run, AI available for
  documents that need it), saves a queued `AnalysisJob` row and answers `202` at once.
- A `JobQueue` port runs the job. The adapter today is `InProcessJobQueue`: jobs run in the api process,
  `ANALYSIS_WORKERS` at a time. The job's state lives in the database, so a restart loses only the job that
  was running; `RecoverAnalysisJobs` marks it failed with a plain reason and runs the queued ones again.
- The job runs as the person who started it (their permissions are checked again), reports each of the eight
  steps on the event stream (`topic: analysis_jobs`), saves the points and the run through the existing
  `SyncAnalysisPoints` and `SaveAnalysisRun` use cases, and writes the activity log entry.
- The engine is the web app's own code ported to TypeScript in `@fs-review/shared/analysis`; pdf.js and SheetJS
  run in Node at the same versions as the browser, behind a `DocumentReader` port. Scanned PDFs are drawn with
  node-canvas and read with Tesseract on the server. node-canvas is an optional native dependency: without
  it, scans are read with AI where the client allows.
- Parity is a test, not a promise: `scripts/analysis-parity.ts` runs ten scenarios through the browser's
  original pipeline (kept frozen in `test/parity/web-engine`) and the api's port with the same documents and canned AI answers, and records the
  browser's results in `test/fixtures/analysis/golden`. `npm test` compares the api with them on every run.
- The routes that let a browser post its own results (`POST /analysis-runs`, `PUT /points/sync`,
  `PUT /readings`, `GET /readings`) are removed: results now come only from the server.

## Consequences

- Closing the tab no longer loses an analysis, and everyone with the fund open sees the progress.
- One instance runs a bounded number of analyses at once. Running several api instances needs a
  database-backed queue adapter that claims jobs with a conditional update; the use cases do not change.
- The web app keeps its own copy of the checks for instant re-checking when settings change, until it
  consumes `@fs-review/shared` (ADR 0010). The parity test keeps the two from drifting.
