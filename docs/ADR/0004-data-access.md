# 0004. Prisma behind repository ports; portable SQL only

Date: 2026-10-28 · Status: Accepted

## Context

A future change of database engine must not touch application code. Drizzle and Prisma were compared.
Drizzle's schema is written per engine (`pg-core`, `mysql-core`); Prisma's schema names the provider in one
line and generates a client for Postgres, MySQL, SQL Server and SQLite from the same models.

## Decision

Use Prisma. Every query lives in a repository class under `infrastructure/db` that implements a port in
`application/ports`. Repositories return domain objects, never Prisma rows. Follow the portability rules in
`BACKEND_PLAN.md` section 11.2: no native types, no raw engine-specific SQL, application-made UUIDs,
table-based sequences, stored lower-case keys instead of functional indexes.

## Consequences

- Changing engine: edit `provider`, regenerate migrations, copy data, run the integration suite.
- From Phase 3 the repository suite runs on Postgres and MySQL in CI, which is the proof.
- Some queries that Postgres could do in one statement are done in two, or in code. That cost is accepted.
