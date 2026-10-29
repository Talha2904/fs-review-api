# 0002. The app's own session cookie, sessions in the database

Date: 2026-10-28 · Status: Accepted

## Context

The current server already has sign-in with scrypt passwords, an HttpOnly cookie, lockout after five
failures and password reset by email. Sessions are in memory, so a restart signs everyone out and two
instances cannot share them. Supabase Auth was the alternative.

## Decision

Keep the app's own sign-in. Store sessions in a `sessions` table keyed by a SHA-256 hash of the token, with
expiry, IP and a revoked-at column. Keep the HttpOnly, SameSite=Lax cookie; add an Origin check on writes and
rate limiting on sign-in. Two-factor or SSO is a later decision (plan Phase 7).

## Consequences

- No screen changes; the login page and user management keep working.
- Sign-in does not depend on any vendor, so it survives a host change.
- Session revocation on role change, deactivation and password reset becomes a database update.
