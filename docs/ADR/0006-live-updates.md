# 0006. Own Server-Sent Events fed by an EventBus port

Date: 2026-10-28 · Status: Accepted

## Context

Screens refresh through `reviewStore.subscribe`. With a shared database a Reviewer must see a Preparer's
change without reloading. Supabase Realtime and Postgres `NOTIFY` were the alternatives; both tie the
feature to one vendor or one engine.

## Decision

Use cases publish `{ topic, engagementId, at }` on an `EventBus` port after their transaction commits. The
api exposes `GET /api/events` as a Server-Sent Events stream that forwards those events to signed-in
clients, filtered by the access rule. The in-process adapter serves one instance; a Redis pub/sub adapter
serves several (`EVENT_BUS=redis`).

## Consequences

- Works on any database and host.
- Clients that cannot hold an SSE connection poll the review snapshot with an ETag every 15 seconds.
- Events carry ids only, never document contents.
