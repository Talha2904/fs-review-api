# 0013. Two-factor sign-in in the app; single sign-on later as an extra way in

Date: 2026-10-29 · Status: Proposed (needs the owner's approval)

## Context

ADR 0002 kept the app's own sign-in and left two-factor sign-in or single sign-on (SSO) to Phase 7. The app
will be hosted on the internet and holds client financial statements, review findings and invoices. A
password alone, at 8 characters minimum, is the weakest control left (`SECURITY.md`).

The options:

1. **Two-factor sign-in with an authenticator app (TOTP, RFC 6238), built into the app's own sign-in.** It
   works with any authenticator (Microsoft Authenticator, Google Authenticator, 1Password). It needs no
   vendor, no directory and no per-user fee. The firm's Administrator manages it like the rest of the accounts.
2. **SSO through the firm's directory (OpenID Connect, for example Microsoft Entra ID).** People sign in with
   their work account, and the directory's two-factor and leaving process apply. It ties sign-in to one
   directory tenant, needs an app registration the firm controls, and does not cover anyone outside it, such
   as a contract preparer.
3. **Passkeys (WebAuthn).** Strongest against phishing, but recovery and support on shared or older machines
   is harder for a small firm, and few people use them yet.

## Decision

Build option 1 before the first hosted release, and keep option 2 open as an additional way to sign in.

- Two-factor sign-in is required for every account once the app runs with `NODE_ENV=production`. A person
  sets it up at their first sign-in after it is switched on.
- The secret is stored encrypted with a key from the environment, never returned after set-up. Ten one-time
  recovery codes are shown once and stored as hashes.
- A code is checked within one 30-second step either side, and a used code cannot be used again. Wrong codes
  count towards the existing sign-in throttle.
- An Administrator can reset another person's two-factor set-up. The reset is logged and signs that person
  out everywhere.
- The minimum length for new and changed passwords rises from 8 to 12 characters at the same time.
- SSO is added later only if the firm confirms its directory. It would sit behind an identity-provider port,
  next to the password sign-in, so no use case changes.

## Consequences

- Sign-in stays vendor independent (ADR 0002), and two-factor sign-in survives a change of host.
- People need an authenticator app on their phone. Recovery codes and the Administrator reset cover a lost
  phone.
- New work: a `user_mfa` table, set-up and verify screens on the login page, an Administrator reset, and tests.
  About two days, planned as its own item before go-live.
- Until it is built, the controls in `SECURITY.md` apply: the sign-in throttle, 12-hour sessions, and
  sessions revoked on any access change.
