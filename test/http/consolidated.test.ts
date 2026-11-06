// The Consolidated Review (meeting point 2): funds of entities that share a Client name, reviewed together.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { world, type World } from '../helpers/review.js';

const GROUP = 'abc asset management';
const YE = '2026-12-31';

// A saved analysis whose draft balance sheet carries one balance with the other fund.
const result = (assets: [string, number][], liabilities: [string, number][]) => ({
  docs: {
    cy: {
      title: 'Draft',
      blocks: [
        { k: 'head', title: 'Statement of financial position' },
        { k: 'table', cols: ['2026', '2025'], rows: assets.map(([l, v]) => ({ l, v: [v, 0] })) },
        { k: 'table', cols: ['2026', '2025'], label: 'Liabilities', rows: liabilities.map(([l, v]) => ({ l, v: [v, 0] })) }
      ]
    }
  },
  K: {},
  points: [],
  varNotes: {},
  version: 1,
  priorResolved: [],
  demo: false
});

/** A second entity with the same Client name and one fund, then a saved analysis for both funds. */
async function group(x: World, opts: { secondAiPermitted?: boolean; analyse?: boolean } = {}) {
  const ent2 = (
    await request(x.w.app)
      .post('/api/entities')
      .set('Cookie', x.manager)
      .send({
        name: 'ABC Lending LP',
        client: 'ABC Asset Management',
        framework: 'FRS 102',
        aiPermitted: opts.secondAiPermitted ?? true,
        aiBasis: 'Letter',
        aiDecidedBy: { id: 'm', name: 'Ali' },
        aiDecidedAt: '2026-10-28T10:00:00.000Z'
      })
  ).body.entity;
  const eng2 = (
    await request(x.w.app)
      .post('/api/engagements')
      .set('Cookie', x.manager)
      .send({ entityId: ent2.id, fund: { name: 'ABC Lending', yearEnd: YE, currency: 'GBP' } })
  ).body.engagement;
  if (opts.analyse !== false) {
    await saveRun(x, x.eng.id, 'run-1', result([['Amount due from ABC Lending', 4200]], [['Trade payables', 30]]));
    await saveRun(x, eng2.id, 'run-2', result([['Cash', 10]], [['Amount due to ABC Fund', 5000]]));
  }
  return { eng2 };
}
const saveRun = (x: World, engagementId: string, id: string, r: unknown) =>
  x.w.runs.create({
    id,
    engagementId,
    version: 1,
    result: r as Record<string, unknown>,
    analysedAt: '2026-11-01T10:00:00.000Z',
    settingsSig: '',
    documentVersions: {},
    by: null,
    at: '2026-11-01T10:00:00.000Z'
  });

async function turnAiOn(x: World) {
  const on = await request(x.w.app)
    .put('/api/ai/settings')
    .set('Cookie', x.admin)
    .send({
      settings: {
        enabled: true,
        acknowledgement: { by: { id: 'a', name: 'Hamza' }, at: '2026-10-28T10:00:00Z' },
        model: 'claude-sonnet-5-5'
      }
    });
  expect(on.status).toBe(200);
}
const start = (x: World, cookie: string) =>
  request(x.w.app).post('/api/consolidated/runs').set('Cookie', cookie).send({ groupKey: GROUP, yearEnd: YE });
const review = (x: World, cookie: string) =>
  request(x.w.app).get('/api/consolidated/review').query({ groupKey: GROUP, yearEnd: YE }).set('Cookie', cookie);

describe('Consolidated Review', { timeout: 30_000 }, () => {
  it('lists funds of entities sharing a Client name as one group; review staff see it, Finance does not', async () => {
    const x = await world();
    await group(x, { analyse: false });
    const list = await request(x.w.app).get('/api/consolidated').set('Cookie', x.reviewer);
    expect(list.status).toBe(200);
    expect(list.body.groups).toHaveLength(1);
    expect(list.body.groups[0]).toMatchObject({
      groupKey: GROUP,
      groupName: 'ABC Asset Management',
      yearEnd: YE,
      analysedCount: 0,
      latest: null
    });
    expect(list.body.groups[0].funds.map((f: { fundName: string }) => f.fundName).sort()).toEqual(['ABC Fund', 'ABC Lending']);
    expect((await request(x.w.app).get('/api/consolidated').set('Cookie', x.finance)).status).toBe(403);
  });

  it('needs two analysed funds, and the right to run an analysis', async () => {
    const x = await world();
    await group(x, { analyse: false });
    expect((await start(x, x.manager)).status).toBe(400);
    await saveRun(x, x.eng.id, 'run-1', result([['Cash', 1]], []));
    expect((await start(x, x.manager)).status).toBe(400); // still only one analysed
    const y = await world();
    await group(y);
    expect((await start(y, y.preparer)).status).toBe(403);
  });

  it('without AI: pairs the balances that name each other, works out the difference, and says AI was not used', async () => {
    const x = await world();
    await group(x);
    const s = await start(x, x.reviewer);
    expect(s.status).toBe(202);
    expect(s.body.review).toMatchObject({ status: 'queued', groupKey: GROUP });
    await x.w.consolidatedQueue.idle();
    const r = await review(x, x.reviewer);
    expect(r.status).toBe(200);
    expect(r.body.latest.status).toBe('done');
    const res = r.body.review.result;
    expect(res.links).toHaveLength(1);
    expect(res.links[0]).toMatchObject({ status: 'differs', matchedBy: 'app' });
    expect(Math.abs(res.links[0].difference)).toBe(800);
    expect(res.aiNote).toMatch(/turned off/);
    expect(x.w.ai.calls).toHaveLength(0);
    expect(r.body.stale).toBeNull();
    expect(x.w.log.entries.some((e) => e.summary === 'Ran the Consolidated Review of ABC Asset Management (2026-12-31)')).toBe(true);
  });

  it('refuses a second start while one is running', async () => {
    const x = await world();
    await group(x);
    // one already in progress (put there directly: a real run finishes too fast to catch)
    x.w.consolidated.rows.push({
      id: 'busy',
      groupKey: GROUP,
      groupName: 'ABC Asset Management',
      yearEnd: YE,
      status: 'running',
      step: 1,
      total: 4,
      error: null,
      runIds: {},
      result: null,
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: null
    });
    expect((await start(x, x.reviewer)).status).toBe(409);
  });

  it('says which funds changed since the review', async () => {
    const x = await world();
    await group(x);
    await start(x, x.reviewer);
    await x.w.consolidatedQueue.idle();
    await saveRun(x, x.eng.id, 'run-3', result([['Amount due from ABC Lending', 5000]], []));
    expect((await review(x, x.reviewer)).body.stale).toEqual({ changed: ['ABC Fund'], added: [], removed: [] });
  });

  it('with AI: sends only lines and titles, applies checked pairs, and bills each fund its share of the call', async () => {
    const x = await world();
    await turnAiOn(x);
    const { eng2 } = await group(x);
    // two lines that name each other by role only, which the app cannot pair on its own
    await saveRun(x, x.eng.id, 'run-1b', result([['Fees receivable from managed funds', 300]], []));
    await saveRun(x, eng2.id, 'run-2b', result([['Cash', 10]], [['Management fee payable to the manager', 280]]));
    x.w.ai.answer = {
      pairs: [{ a: `${x.eng.id}#1`, b: `${eng2.id}#1`, relationship: 'Management fee', note: 'Same fee' }],
      groups: [],
      summary: 'One fee balance differs.'
    };
    await start(x, x.reviewer);
    await x.w.consolidatedQueue.idle();
    const res = (await review(x, x.reviewer)).body.review.result;
    expect(x.w.ai.calls).toHaveLength(1);
    const sent = JSON.stringify(x.w.ai.calls[0]!.content);
    expect(sent).toContain('Fees receivable from managed funds');
    expect(sent).not.toContain('"blocks"'); // never the documents
    expect(res.links).toEqual([
      expect.objectContaining({ matchedBy: 'ai', status: 'differs', difference: 20, relationship: 'Management fee' })
    ]);
    expect(res.summary).toBe('One fee balance differs.');
    const usage = x.w.log.entries.filter((e) => e.category === 'AI' && e.usage);
    expect(usage.map((e) => [e.engagementId, e.usage!.input, e.usage!.output]).sort()).toEqual(
      [
        [eng2.id, 500, 50],
        [x.eng.id, 500, 50]
      ].sort()
    );
  });

  it('with AI on but one client not permitting it: nothing is sent and the review says why', async () => {
    const x = await world();
    await turnAiOn(x);
    await group(x, { secondAiPermitted: false });
    await start(x, x.reviewer);
    await x.w.consolidatedQueue.idle();
    const res = (await review(x, x.reviewer)).body.review.result;
    expect(x.w.ai.calls).toHaveLength(0);
    expect(res.aiNote).toMatch(/Fewer than two of these funds have AI permitted/);
    expect(res.links).toHaveLength(1); // the app's own match still stands
  });

  it('after a restart, a review that was running is failed and a queued one runs again', async () => {
    const x = await world();
    await group(x);
    const base = {
      groupName: 'G',
      yearEnd: YE,
      step: 0,
      total: 4,
      error: null,
      runIds: {},
      result: null,
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: null
    };
    x.w.consolidated.rows.push(
      { ...base, id: 'r1', groupKey: 'g1', status: 'running' },
      { ...base, id: 'r2', groupKey: 'g2', status: 'queued' }
    );
    expect(await x.w.recoverConsolidated.execute()).toEqual({ failed: 1, requeued: 1 });
    expect((await x.w.consolidated.findById('r1'))!.status).toBe('failed');
  });
});
