# Operations

How to run the api in production: settings, HTTPS, the web app's security headers, backups and restore,
upgrades and health. Phase 7 (plan section 9). The security controls these settings switch on are listed in
`SECURITY.md`.

## 1. Production settings

The api refuses to start on a missing or invalid setting (`src/config/env.ts`). `.env.example` lists every
setting with a comment. The ones that matter for safety:

| Setting             | Production value                                                             | Why                                                                                             |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `production`                                                                 | Secure cookie, API docs hidden, https checks on. Required: there is no default.                 |
| `APP_URL`           | the web app's https address                                                  | Links in emails; must be https in production.                                                   |
| `CORS_ORIGINS`      | the web app's https origin, and nothing else                                 | Only these origins may call the api with the session cookie or write to it.                     |
| `TRUST_PROXY`       | the number of proxies in front of the api (usually `1`), or their addresses  | The client address used by the sign-in limits comes only from these proxies.                    |
| `DATABASE_URL`      | the Postgres connection string, with `sslmode=require` for a hosted database | The only way the api reaches the database (ADR 0001).                                           |
| `S3_*`              | the bucket, endpoint and keys                                                | Without `S3_ENDPOINT` files go to `FILES_DIR` on local disk, which a host may wipe on redeploy. |
| `ANTHROPIC_API_KEY` | set only if the firm uses AI                                                 | Stays on the server; clients never see it.                                                      |
| `DOCS_PUBLIC`       | leave unset                                                                  | `/api/docs` is then not served in production.                                                   |
| `LOG_LEVEL`         | `info`                                                                       | Request logs carry method, path and status; cookies, passwords and tokens are redacted.         |

Run one api instance. Live updates and the sign-in limits per address are held in the process. A second
instance needs the Redis event bus first (plan section 7.6).

## 2. Backups and restore

**Database.** Use the host's daily backups, and check the plan's retention and whether point-in-time recovery
is included. Also take a nightly copy to storage the firm controls (ADR 0001), so a host account problem cannot
take both:

```bash
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="fsreview-$(date +%F).dump"
```

Use the direct connection (port 5432), not the transaction pooler. Keep 30 daily and 12 monthly copies,
encrypted, in a second account in the same European region (ADR 0009).

**Files.** Documents, evidence and review reports live in the bucket, not the database, and database
backups do not include them. Copy the bucket nightly to a second bucket in another account, keeping deleted
and overwritten objects for 30 days. A file key always holds the same content, so a copy never replaces a file with a different one.

**Restore test.** Do it before go-live and every quarter. A backup that has not been restored is not a backup.

1. Create an empty database and restore into it:
   `pg_restore --no-owner --dbname="$RESTORE_URL" fsreview-YYYY-MM-DD.dump`
2. Run `npm run db:migrate` against it; it should report nothing to apply.
3. Start a staging api with `DATABASE_URL=$RESTORE_URL` and the copied bucket.
4. Sign in, open a signed-off fund, download a document and its review report, and open Finance's invoices.
5. Record the date, the backup used, the time it took and any problem.

## 3. HTTPS

- The host or a proxy ends TLS and redirects HTTP to HTTPS. The api itself listens on plain HTTP behind it.
- Serve the web app and the api from one origin, with the proxy sending `/api` to the api. Cookies and the
  same-origin write check then need no extra settings. If they must be on different hosts, put the web app's
  origin in `CORS_ORIGINS`.
- The api's responses carry HSTS (one year, subdomains) through helmet. The web app's host must send the same
  header on its pages:
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `/api/events` is a long-lived Server-Sent Events stream. The proxy must not buffer it, and its idle timeout
  must exceed 60 seconds.

## 4. Security headers for the web app

The api serves only JSON and sends no Content-Security-Policy. The web app's host sends these on every page:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- `'unsafe-inline'` for styles is needed because the screens use inline styles. Scripts stay `'self'` only.
- The Google Fonts entries go once the Inter font is served from the app's own host (`SECURITY.md`).
- `blob:` covers PDF previews and the PDF and Excel files the screens make for download.
- Ship it first as `Content-Security-Policy-Report-Only`. Open every screen as each role with the browser
  console open, fix what it reports, then switch to the enforcing header.

## 5. Upgrades

1. Take a database backup (section 2).
2. Deploy the new version with `npm run db:migrate` (`prisma migrate deploy`) before the api starts.
3. To roll back, deploy the previous version and restore the backup from step 1 if a migration ran. Code
   older than Phase 7 cannot create review points once `phase7_point_title` has run, because it does not
   write the new required `title` column. Write future migrations so the previous version keeps working:
   add a column as optional, fill it, and make it required in a later release.
4. The api stops cleanly on SIGTERM: it stops taking requests and closes the database within 10 seconds.
   An analysis interrupted by a restart is marked failed when the api starts again, and queued ones run.

## 6. Health and monitoring

- `GET /api/health` returns the version, uptime and whether the database answers, with status 503 when it does not. Use it for the host's health
  check, every 30 seconds.
- Logs are JSON lines (pino) with a request id, which is also returned in the `X-Request-Id` header. A person
  reporting an error can quote it.
- Alert on: the health check failing twice, 5xx responses above 1 percent over 5 minutes, and an analysis job
  marked failed.
- The log records each sign-in block once per window, so a burst of blocks means someone is guessing passwords.

## 7. Capacity

`LOAD-TEST-2026-10-29.md` has the figures for 50 funds. To repeat it against a new version, create an empty
database, migrate it, and run:

```bash
LOAD_DATABASE_URL=postgresql://user:pass@host:5432/fsreview_load npm run load-test
```

Never point it at a database with real data: it fills the database with test funds and accounts.

## 8. Containers

The api and the web app each have a Dockerfile, and `docker-compose.prod.yml` runs them together on any host
with Docker: a VPS, AWS or Azure. The database stays outside the containers (Supabase or any Postgres, ADR 0001).

- `api/Dockerfile`: Node 22 on Debian slim (node-canvas and Prisma need glibc and OpenSSL), runs as the `node`
  user, checks `/api/health` every 30 seconds, and starts `node` directly so SIGTERM stops it cleanly (section 5).
- `react-app/Dockerfile`: the Vite build served by nginx as a non-root user on port 8080. Its `nginx.conf` passes
  `/api` to the api container, so the app and the api share one origin (section 3); it never buffers
  `/api/events`, accepts bodies up to 55 MB, and sends the headers of section 4.
- `docker-compose.prod.yml`: `migrate` runs `prisma migrate deploy` and exits; the api starts only if it
  succeeded; the web app starts once the api is healthy. It expects the react-app repository beside this one.

Run it:

```bash
cp .env.example .env.production
docker compose -f docker-compose.prod.yml up -d --build
```

Settings that differ in containers:

| Setting        | Value                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | never `localhost`, which is the container itself; on Docker Desktop a database on the host is `host.docker.internal` |
| `TRUST_PROXY`  | `1` for the web container's nginx, `2` with a TLS proxy in front of it                                               |
| `S3_*`         | without them, files go to the `api-data` volume; back it up like the bucket (section 2)                              |
| `WEB_BIND`     | the web app is published on `127.0.0.1:8080` for a TLS proxy on the same machine; `0.0.0.0` opens it                 |

- **HTTPS.** The containers speak plain HTTP. Put Caddy or nginx with a certificate in front on a VPS, or let the
  cloud load balancer end TLS (section 3).
- **Content-Security-Policy.** `nginx.conf` sends it as `Content-Security-Policy-Report-Only`. Rename the header to
  enforce it once every screen has been checked (section 4).
- **First accounts.** With no users, the sign-in page asks for the first Administrator. To load the starting
  accounts instead: `docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/seed-users.ts`.
- **Upgrades.** Take a backup, then run the same `up -d --build`. Migrations run before the new api starts.
- **Logs.** `docker compose -f docker-compose.prod.yml logs -f api` shows the JSON log lines (section 6).
