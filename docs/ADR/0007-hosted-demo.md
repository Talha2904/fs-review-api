# 0007. Retire the no-server demo mode

Date: 2026-10-28 · Status: Accepted

## Context

`src/lib/auth.js`, `activity.js` and `engagements.js` each carry a second code path for a hosted page with
no server: accounts, permissions, billing and the log kept in the browser. Keeping it correct alongside a
real backend doubles the surface for every change.

## Decision

Delete the demo branches when each module moves to the api (Phases 1 and 2). Keep the built-in sample
documents, which are a product feature that works against the real backend.

## Consequences

- The app always needs the api running. `npm run dev` starts both.
- Less code and one storage path to test.
- If a no-server demo is ever needed again, it is a separate build, not a branch inside production modules.

## Outcome

Done in Phase 7 (29 Oct 2026). The web app has no browser-only path left for sign-in, the activity log,
reviews, billing or AI: `auth.js`, `activity.js` and `reviewStore.js` call only the api. Without the api the app
shows that the server cannot be reached, with a Try Again button. The built-in sample documents remain.
