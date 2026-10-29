# FS Review api

The backend for the Financial Statement Review app: sign-in, users and permissions, the activity log, the
review itself (documents, analysis jobs, review points, sign-off), AI settings and the Claude calls, OCR, and
billing. TypeScript on Node.js (Express, Prisma on PostgreSQL), with the rules shared with the web app in the
`shared/` workspace. The web app is a separate repository, `react-app`, which runs beside this one.

## Run

Needs Node.js 22 (20 or later works) and a PostgreSQL database: Supabase, or the local one from
`docker compose up -d`.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and the other settings
npm run build -w shared
npm run db:migrate
npm run seed                  # the five starting accounts; change their passwords
npm run dev                   # http://localhost:8787/api/health, API reference at /api/docs
```

Then start the web app (`npm run dev` in `react-app`) and open http://localhost:5173.

Checks: `npm test`, `npm run lint`, `npm run typecheck`. Containers: `docker-compose.prod.yml`
(`docs/OPERATIONS.md`, section 8).

## Documents

- `BACKEND_PLAN.md`: the plan, its phases and their status
- `docs/ARCHITECTURE.md`: layers, ports and how a request flows
- `docs/OPERATIONS.md`: production settings, HTTPS, backups, upgrades, containers
- `docs/SECURITY.md`: the security checklist
- `docs/ADR/`: decision records
