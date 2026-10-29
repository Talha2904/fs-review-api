# Architecture decision records

One file per decision. Status is Accepted unless marked otherwise. Supersede, never edit history.

| #                                          | Decision                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| [0001](0001-database-host.md)              | Supabase Postgres through a plain connection string; no Supabase SDK or services |
| [0002](0002-authentication.md)             | The app's own session cookie with sessions in the database                       |
| [0003](0003-language.md)                   | TypeScript for api and shared; the web app stays JavaScript                      |
| [0004](0004-data-access.md)                | Prisma behind repository ports; portable SQL only                                |
| [0005](0005-file-storage.md)               | S3 protocol behind a FileStorage port                                            |
| [0006](0006-live-updates.md)               | Own Server-Sent Events fed by an EventBus port                                   |
| [0007](0007-hosted-demo.md)                | Retire the no-server demo mode                                                   |
| [0008](0008-analysis-location.md)          | Analysis in the browser first, on the server in Phase 6                          |
| [0009](0009-hosting-region.md)             | A European region for data and files                                             |
| [0010](0010-separate-repositories.md)      | Front end and backend are separate repositories; shared lives in the api repo    |
| [0011](0011-analysis-jobs.md)              | The analysis runs as a background job on the api, with a parity test             |
| [0012](0012-integrity-rules-from-audit.md) | Integrity and security rules from the Phase 0 to 6 audit                         |
| [0013](0013-two-factor-sign-in.md)         | Proposed: two-factor sign-in in the app; single sign-on later as an extra way in |
