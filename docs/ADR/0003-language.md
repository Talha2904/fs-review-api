# 0003. TypeScript for api and shared; the web app stays JavaScript

Date: 2026-10-28 · Status: Accepted

## Context

Clean architecture depends on ports (interfaces) between layers. The existing code is JavaScript with
comments as the only contract.

## Decision

Write `api/` and `shared/` in TypeScript with strict mode, ES modules and NodeNext resolution. Leave the
front end in JavaScript; it imports `@fs-review/shared` from its built output.

## Consequences

- Ports are real interfaces; a repository that does not implement its port fails to compile.
- `shared` must be built before the api or the web app type-checks (`npm run build -w shared`).
- Contributors need TypeScript familiarity for backend work only.
