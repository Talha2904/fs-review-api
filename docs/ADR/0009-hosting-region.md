# 0009. A European region for data and files

Date: 2026-10-28 · Status: Accepted

## Context

The product stores client financial statements and sends them to Anthropic when AI is permitted. The
developer guide lists hosting region among the pre-production items.

## Decision

Create the Supabase project and the storage bucket in a European region. Record the region in the
deployment notes. Any later host must offer an equivalent region.

## Consequences

- Satisfies the data residency expectation for UK and Irish fund clients.
- Developers outside Europe accept slightly higher latency; for an administrative application it is not noticeable.
