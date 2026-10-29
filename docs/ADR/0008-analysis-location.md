# 0008. Analysis in the browser first, on the server in Phase 6

Date: 2026-10-28 · Status: Accepted · Implemented 2026-10-28 (Phase 6, see ADR 0011)

## Context

The analysis pipeline (`src/lib/pipeline.js`) reads documents, runs the checks and calls the four Claude
routes from the browser, then saves the result. Moving it to the server is the right end state, but doing it
before review data is shared delays the main benefit.

## Decision

Phases 1 to 5 keep the pipeline in the browser and persist its result through `POST /analysis-runs`. Phase 6
moves the pipeline into `application/analysis` behind an `AnalysisRunner` port, run as a job with progress
over SSE. The readers and checks have no browser dependencies except pdf.js, which has a Node build.

## Consequences

- Shared, durable review data ships after Phase 4.
- Until Phase 6 a closed tab during a run loses that run; the stored documents are unaffected.
- The `AnalysisRunner` port means the browser implementation and the server implementation are swappable.

## Outcome

Phase 6 is done. The pipeline runs on the api as a background job (ADR 0011); the browser starts it and
shows its progress. The port behind it is `DocumentReader` plus the `AnalysisAi` steps rather than one
`AnalysisRunner`, and a parity test proves the api gives the browser's results on the same documents.
