// Load test with 50 funds (Phase 7). Starts the api in this process against an empty, migrated database,
// fills it through the HTTP api as the screens would (team, client, 50 funds, sample documents, review points
// with threads, an analysis of each fund), then times the reads the screens make most, with 20 people at once.
//   LOAD_DATABASE_URL=postgresql://.../fsreview_load npm run load-test
// Use a database made for this: it is filled with test data.
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadEnv } from '../src/config/env.js';
import { buildContainer } from '../src/container.js';
import { createApp } from '../src/interface/http/app.js';

const FUNDS = Number(process.env.LOAD_FUNDS || 50);
const POINTS_PER_FUND = 12;
const CLIENTS = 20;
const ROUNDS = 10;
const PW = 'load-test-password';

const url = process.env.LOAD_DATABASE_URL;
if (!url) throw new Error('Set LOAD_DATABASE_URL to an empty, migrated database made for the load test.');

// Files and the OCR cache go to a temporary folder, so the load test leaves the api's data folder alone.
const scratch = mkdtempSync(path.join(tmpdir(), 'fs-review-load-'));
const env = loadEnv({
  NODE_ENV: 'development',
  DATABASE_URL: url,
  APP_URL: 'http://localhost:5173',
  LOG_LEVEL: 'warn',
  ANALYSIS_WORKERS: '4',
  FILES_DIR: path.join(scratch, 'files'),
  OCR_CACHE_DIR: path.join(scratch, 'ocr')
});
const c = buildContainer(env);
const app = createApp({
  logger: c.logger,
  httpLogger: (_req, _res, next) => next(),
  corsOrigins: env.CORS_ORIGINS,
  version: c.version,
  secureCookies: false,
  health: { startedAt: Date.now(), pingDatabase: c.pingDatabase },
  uc: c.uc,
  permissions: c.permissions,
  events: c.events,
  authRateLimit: 1000
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

const cookies: Record<string, string> = {};
async function call<T = Record<string, unknown>>(who: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base + path, {
    method,
    headers: { cookie: cookies[who] ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const set = r.headers.get('set-cookie');
  if (set) cookies[who] = set.split(';')[0]!;
  const j = (await r.json().catch(() => ({}))) as T;
  if (!r.ok) throw new Error(`${who} ${method} ${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const inBatches = async <T>(items: T[], size: number, fn: (x: T, i: number) => Promise<void>) => {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map((x, j) => fn(x, i + j)));
};

async function seed() {
  const t0 = Date.now();
  await call('admin', 'POST', '/auth/setup', { name: 'Load Admin', username: 'load.admin', password: PW });
  const ids: Record<string, string> = {};
  for (const [name, username, role] of [
    ['Load Preparer', 'load.preparer', 'Preparer'],
    ['Load Reviewer', 'load.reviewer', 'Reviewer'],
    ['Load Manager', 'load.manager', 'Manager']
  ] as const) {
    const u = await call<{ user: { id: string } }>('admin', 'POST', '/users', { name, username, password: PW, role });
    ids[role] = u.user.id;
    await call(role, 'POST', '/auth/login', { username, password: PW });
  }
  const ent = await call<{ entity: { id: string } }>('Manager', 'POST', '/entities', {
    name: 'Load Test Funds ICAV',
    client: 'Load Test Asset Management',
    framework: 'FRS 102',
    aiPermitted: false,
    aiBasis: 'Load test',
    aiDecidedBy: { id: ids.Manager, name: 'Load Manager' },
    aiDecidedAt: '2026-10-29T00:00:00.000Z'
  });
  const funds: string[] = [];
  for (let i = 1; i <= FUNDS; i++) {
    const e = await call<{ engagement: { id: string } }>('Manager', 'POST', '/engagements', {
      entityId: ent.entity.id,
      fund: {
        name: `Load Fund ${String(i).padStart(2, '0')}`,
        yearEnd: '2025-12-31',
        currency: 'GBP',
        preparerId: ids.Preparer,
        reviewerId: ids.Reviewer
      }
    });
    funds.push(e.engagement.id);
  }
  const jobs: string[] = [];
  await inBatches(funds, 10, async (id) => {
    for (const [slot, name] of [
      ['cy', 'Draft'],
      ['py', 'Signed'],
      ['tb', 'TB'],
      ['is', 'Schedule']
    ])
      await call('Preparer', 'POST', `/engagements/${id}/documents/sample`, { slot, name });
    await call('Preparer', 'PUT', `/engagements/${id}/workflow`, { state: 'ready' });
    jobs.push((await call<{ job: { id: string } }>('Reviewer', 'POST', `/engagements/${id}/analysis-jobs`, { mode: 'full' })).job.id);
  });
  // the analyses run in the background, ANALYSIS_WORKERS at a time; wait until every job has finished
  const analysedFrom = Date.now();
  for (const id of jobs) {
    for (;;) {
      const { job } = await call<{ job: { status: string; error?: string } }>('Reviewer', 'GET', `/analysis-jobs/${id}`);
      if (job.status === 'failed') throw new Error(`Analysis job ${id} failed: ${job.error}`);
      if (job.status === 'done') break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const analysisSeconds = (Date.now() - analysedFrom) / 1000;
  await inBatches(funds, 10, async (id) => {
    for (let p = 1; p <= POINTS_PER_FUND; p++) {
      const { point } = await call<{ point: { id: string } }>('Reviewer', 'POST', `/engagements/${id}/points`, {
        content: { title: `Load point ${p}`, area: 'Load', basis: 'Raised by the load test' },
        assignee: { id: ids.Preparer, name: 'Load Preparer', role: 'Preparer' }
      });
      await call('Reviewer', 'POST', `/points/${point.id}/comments`, { text: 'Please look at this.' });
      if (p % 3 === 0) await call('Preparer', 'POST', `/points/${point.id}/act`, { kind: 'response', text: 'Done.' });
    }
  });
  return { funds, seconds: (Date.now() - t0) / 1000, analysisSeconds };
}

async function measure(label: string, who: string, path: string, clients: number) {
  const times: number[] = [];
  let bytes = 0;
  await Promise.all(
    Array.from({ length: clients }, async () => {
      for (let i = 0; i < ROUNDS; i++) {
        const t = performance.now();
        const r = await fetch(base + path, { headers: { cookie: cookies[who] ?? '' } });
        const text = await r.text();
        if (!r.ok) throw new Error(`${label}: ${r.status} ${text.slice(0, 200)}`);
        times.push(performance.now() - t);
        bytes = text.length;
      }
    })
  );
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  return { label, clients, requests: times.length, p50: q(0.5), p95: q(0.95), max: times.at(-1)!, kb: bytes / 1024 };
}

const main = async () => {
  const { funds, seconds, analysisSeconds } = await seed();
  console.log(
    `Seeded ${funds.length} funds (${POINTS_PER_FUND} points each, with comments and responses, each analysed) in ${seconds.toFixed(1)} s; ` +
      `the ${funds.length} analyses took ${analysisSeconds.toFixed(1)} s with ${env.ANALYSIS_WORKERS} workers.`
  );
  const reads: [string, string, string][] = [
    ['Portfolio (GET /api/portfolio)', 'Manager', '/portfolio'],
    ['Bell (GET /api/notifications)', 'Preparer', '/notifications'],
    ['One fund (GET /api/engagements/:id/review)', 'Reviewer', `/engagements/${funds[0]}/review`],
    ['Fund list (GET /api/engagements)', 'Reviewer', '/engagements'],
    ['All funds listing (GET /api/reviews), not used by the screens', 'Reviewer', '/reviews']
  ];
  const results = [];
  // one person at a time, then CLIENTS people at once (a burst, as when every open tab refetches after a change)
  for (const clients of [1, CLIENTS]) for (const [label, who, path] of reads) results.push(await measure(label, who, path, clients));
  console.log(`\n${ROUNDS} requests per person:\n`);
  console.log('| Read | People at once | Requests | p50 ms | p95 ms | max ms | Response KB |');
  console.log('| --- | --: | --: | --: | --: | --: | --: |');
  for (const r of results)
    console.log(
      `| ${r.label} | ${r.clients} | ${r.requests} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.max.toFixed(0)} | ${r.kb.toFixed(0)} |`
    );
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    server.close();
    await c.shutdown();
  });
