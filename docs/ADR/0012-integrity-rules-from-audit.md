# 0012. Integrity and security rules from the Phase 0 to 6 audit

Date: 2026-10-29 · Status: Accepted

## Context

An independent audit of Phases 0 to 6 (`docs/AUDIT-2026-10-28.md`) found two critical and several high
findings. Their common causes were: rules checked once when work starts but not when it is saved; whole
records written back from a stale read; review content readable by every signed-in role; and untrusted
documents parsed inside the api process. The fixes follow a handful of rules, recorded here so new code keeps
to them.

## Decision

1. **Review content is for the review staff.** Reading a fund's review needs `reviews.read`, a fixed
   permission every role holds except Finance. Finance sees sign-off events and AI usage, nothing else.
2. **Some facts come only from the server.** Sign-off events, analysis results, AI context (the client's
   permission, the fund) and server-owned audit categories are never accepted from a client.
3. **No whole-record writes from a stale read.** A change either names the fields it changes (documents), is
   conditional on the version read (points: `updatedAt`), or runs read-change-write in one serializable
   transaction with retries (billing, checklist answers, the first Administrator, the analysis job claim).
   Serializable isolation is portable to MySQL.
4. **A lock is checked where the change is saved.** Sign-off fixes the Partner step and makes the engagement
   read-only; sign-off and send-back are refused while an analysis runs; an analysis checks again before it
   saves; sign-off requires an analysis of the current documents.
5. **One rule for which version is current**, in the domain (`currentVersions`).
6. **Untrusted documents are parsed out of process**, in a short-lived child process with a heap limit and a
   timeout (`IsolatedDocumentReader`). A child process rather than a worker thread, because node-canvas cannot
   load in worker threads.
7. **Browser writes must come from the app's own origins** (CSRF), and the client address is trusted only from
   the proxies `TRUST_PROXY` names.

## Consequences

- A conflicting change now gets a 409 with a plain message instead of silently overwriting; the screens reload.
- Parsing a document costs a process start (about 0.3 s built, 2 s from source in development).
- The audit's regression tests (`test/http/audit.test.ts` and others listed in the report) keep these rules.
