# Security checklist

Phase 7 (plan section 9). Each control says where it lives and what proves it. Status is **Done**, **Open**
(work or a decision remains) or **Hosting** (set when the app is deployed; see `OPERATIONS.md`). The audit of
Phases 0 to 6 (`AUDIT-2026-10-28.md`, ADR 0012) is the security review this list builds on.

Checked on 29 Oct 2026 against the code at the end of Phase 7. To sign the list, the reviewer re-runs the
evidence column on the release candidate and records their name and date at the end.

## Identity and sessions

| Control                                                                                                                                | Where                                           | Evidence                                                        | Status |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- | ------ |
| Passwords hashed with scrypt, 16-byte salt, 64-byte key; compared in constant time                                                     | `infrastructure/crypto/ScryptPasswordHasher.ts` | `test/http/identity.test.ts`                                    | Done   |
| Minimum password length 8                                                                                                              | `shared/src/roles.ts` (`MIN_PASSWORD`)          | `test/http/identity.test.ts`                                    | Open   |
| Session token random, stored as a SHA-256 hash, 12-hour expiry, revocable                                                              | `application/identity`, `sessions` table        | `test/http/identity.test.ts`                                    | Done   |
| Cookie `fsr_session`: HttpOnly, SameSite=Lax, Path=/, Secure when `NODE_ENV=production`                                                | `interface/http/cookies.ts`                     | audit I10, I11; `test/unit/env.test.ts`                         | Done   |
| Sessions revoked on deactivation, role change and password change; other sessions revoked on reset                                     | `UpdateUser`, `ResetPassword`                   | audit I7; `test/http/audit.test.ts`                             | Done   |
| Sign-in throttle: 5 failures per username and address, 20 per username from anywhere, in 15 minutes; atomic in the database            | `SignIn`, `PrismaLoginThrottle`                 | audit I3; `test/http/audit.test.ts`                             | Done   |
| Unknown usernames cost the same time as wrong passwords                                                                                | `SignIn` (dummy hash)                           | audit I13                                                       | Done   |
| Password reset: one-time token, 30 minutes, same answer whether or not the account exists, older unused links deleted on a new request | `RequestPasswordReset`, `ResetPassword`         | audit I7, I14                                                   | Done   |
| First Administrator created once, in a serializable transaction                                                                        | `UserRepository.createFirst`                    | audit I9                                                        | Done   |
| Two-factor sign-in or single sign-on                                                                                                   | ADR 0013                                        | proposed; needs the owner's approval, then about two days' work | Open   |

The minimum length of 8 matches the old server, so existing accounts keep working. ADR 0013 raises it to 12
for new and changed passwords when two-factor sign-in is built.

## Authorisation

| Control                                                                                                | Where                                                 | Evidence                                | Status |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------- | ------ |
| Every permission is checked in the use case; route guards are a first filter only                      | `application/**`, `requirePermission`, `ReviewAccess` | 111 api tests; audit W1 to W10          | Done   |
| Review content needs `reviews.read` (every role but Finance); billing needs `billing.manage`           | `shared/src/roles.ts`                                 | audit I1, W2; `test/http/audit.test.ts` | Done   |
| Sign-off events, analysis results, AI context and server-owned log categories never come from a client | ADR 0012                                              | audit I2, I4, I12                       | Done   |
| Partner sign-off fixed once the Manager signs; the Partner must be a different person                  | `SetSignoff`                                          | audit W1 (critical)                     | Done   |
| No route serves a file without the reader check for its fund                                           | document, evidence and report routes                  | HTTP tests                              | Done   |
| Every route is in the OpenAPI document, so none is unreviewed                                          | `test/unit/openapiCoverage.test.ts`                   | CI                                      | Done   |
| Funds visible per team rather than to every reviewer                                                   | not built                                             | decision for the firm                   | Open   |

## HTTP

| Control                                                                                                                    | Where                                         | Evidence                           | Status  |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ------- |
| Writes accepted only from the app's own origins (`Origin`, else `Sec-Fetch-Site`): the CSRF defence alongside SameSite=Lax | `middleware/security.ts` (`sameOriginWrites`) | audit I5                           | Done    |
| CORS allows only `CORS_ORIGINS`, with credentials; production refuses non-https origins at start-up                        | `app.ts`, `config/env.ts`                     | audit I10; `test/unit/env.test.ts` | Done    |
| helmet headers: HSTS, nosniff, frame denial, referrer policy, no `X-Powered-By`                                            | `app.ts`                                      | `curl -I /api/health`              | Done    |
| Sign-in, set-up and reset limited to 30 requests a minute per address                                                      | `app.ts` (`rateLimit`)                        | audit I3                           | Done    |
| Client address trusted only from the proxies `TRUST_PROXY` names (default: loopback)                                       | `app.ts`, `config/env.ts`                     | audit I3                           | Done    |
| JSON bodies limited to 1 MB; OCR pages (40 MB) and invoice PDFs (25 MB) only from a signed-in user                         | `app.ts` (`LARGE_BODIES`)                     | audit I6                           | Done    |
| Uploads: one file, 25 MB for documents and evidence, 50 MB for review reports                                              | `routes/documents.ts`, `routes/points.ts`     | HTTP tests                         | Done    |
| Every request body, query and parameter validated with zod                                                                 | `validate()`                                  | lint rule and tests                | Done    |
| Errors return one shape and never a stack trace                                                                            | `errorHandler`                                | HTTP tests                         | Done    |
| API docs (`/api/docs`) served in production only when `DOCS_PUBLIC=true`                                                   | `app.ts`                                      | audit I10                          | Done    |
| The live-update stream re-checks the session every 60 seconds and closes when it ends                                      | `routes/events.ts`                            | audit I8                           | Done    |
| Content-Security-Policy for the web app                                                                                    | the web app's host                            | `OPERATIONS.md`, section 4         | Hosting |
| TLS, HTTP to HTTPS redirect and HSTS at the edge                                                                           | the host or proxy                             | `OPERATIONS.md`, section 3         | Hosting |

The api sends no CSP because it serves JSON, plus Swagger UI outside production, which needs inline scripts.
The web app's pages need the policy, so its host sends it (`OPERATIONS.md`).

## Data and files

| Control                                                                                                                                       | Where                                    | Evidence                                                           | Status  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | ------- |
| Untrusted PDFs and spreadsheets parsed in a short-lived child process: 768 MB heap, 120-second limit                                          | `IsolatedDocumentReader`                 | audit B3, B4; `test/integration/isolatedDocumentReader.test.ts`    | Done    |
| Pages drawn for OCR capped at 20 million pixels; Tesseract page limit of 90 seconds                                                           | `PdfJsDocumentReader`, `TesseractEngine` | scanned-document test                                              | Done    |
| Files stored under random keys through the `FileStorage` port, outside the web root                                                           | `infrastructure/storage`                 | HTTP tests                                                         | Done    |
| Writes that race are safe: conditional updates or serializable transactions with retries                                                      | repositories                             | audit B1 (critical), W5, B7; load test (`LOAD-TEST-2026-10-29.md`) | Done    |
| AI calls only for clients whose AI decision allows it, with the key on the server only                                                        | `AiAnalysisSteps`, `/api/ai/*`           | audit I4; `test/http/ai.test.ts`                                   | Done    |
| Secrets only in environment variables; `.env` is not committed; `.env.example` holds no values                                                | `config/env.ts`                          | review of `.env.example`                                           | Done    |
| Activity log: entries stamped with the signed-in person by the api; server-owned categories (Users, Sign-in, Billing) written only by the api | `ActivityLog`                            | audit I12                                                          | Done    |
| Data and files in a European region                                                                                                           | ADR 0009                                 | hosting set-up                                                     | Hosting |
| Backups of the database and the file bucket, with a tested restore                                                                            | `OPERATIONS.md`, section 2               | first restore test                                                 | Hosting |

## Dependencies

| Item                                                                                                                                                                                                                                                                              | Status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `xlsx` 0.18.5 on the api has two published advisories (prototype pollution, ReDoS). Spreadsheets are parsed only inside the isolated child process, which limits the harm. The fix is SheetJS 0.20.3 from the vendor's own registry, which needs the owner's approval to install. | Open   |
| The web app also bundles `xlsx` 0.18.5. It reads a spreadsheet the user picks to check it before upload, and writes the Excel exports. The same upgrade applies.                                                                                                                  | Open   |
| The web app loads the Inter font from Google Fonts, which sends each visitor's address to Google. Serving the font from the app's own host removes that request and simplifies the CSP.                                                                                           | Open   |
| CI runs `npm ci` from the lock file; versions are pinned exactly.                                                                                                                                                                                                                 | Done   |

## Sign-off

| Release | Reviewer | Date | Notes |
| ------- | -------- | ---- | ----- |
|         |          |      |       |
