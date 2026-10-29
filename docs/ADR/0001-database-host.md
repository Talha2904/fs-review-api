# 0001. Supabase Postgres through a plain connection string

Date: 2026-10-28 · Status: Accepted

## Context

The developer guide names Supabase/PostgreSQL as the intended database. The owner requires that a future
move to another host or engine needs no application code changes.

## Decision

Use Supabase's Postgres today, reached only through `DATABASE_URL`. Do not use the Supabase SDK, Supabase
Auth, Realtime, the Storage SDK, Edge Functions or row level security. Create every database object through
committed Prisma migrations; the Supabase dashboard is for inspection only. Connect through the direct
connection or the pooler in session mode, because Prisma uses prepared statements.

## Consequences

- Moving to RDS, Neon, Azure or a self-hosted server is a change to one environment variable plus a
  `pg_dump` and `pg_restore`.
- Access control is enforced in the application (`application/review/access.ts`), not by the database.
- Backups: schedule `pg_dump` to storage the firm controls, in addition to the host's backups.
