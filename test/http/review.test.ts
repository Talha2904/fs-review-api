import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestWorld, cookieOf } from '../helpers/fakes.js';

const PW = 'longenough1';

async function world() {
  const w = buildTestWorld();
  const admin = cookieOf(
    await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW })
  );
  for (const [name, username, role] of [
    ['Ali Awan', 'ali.awan', 'Manager'],
    ['Rahat Kalim', 'rahat.kalim', 'Reviewer'],
    ['Muhammad Salman', 'muhammad.salman', 'Preparer']
  ])
    await request(w.app).post('/api/users').set('Cookie', admin).send({ name, username, password: PW, role });
  const as = async (u: string) => cookieOf(await request(w.app).post('/api/auth/login').send({ username: u, password: PW }));
  return { w, admin, manager: await as('ali.awan'), reviewer: await as('rahat.kalim'), preparer: await as('muhammad.salman') };
}

const abc = {
  name: 'ABC Funds ICAV',
  client: 'ABC Asset Management',
  legalForm: 'ICAV',
  jurisdiction: 'Ireland',
  yearEnd: '2026-12-31',
  framework: 'FRS 102',
  billingEmail: 'accounts@abc.test',
  aiPermitted: true,
  aiBasis: 'Engagement letter, clause 7',
  aiDecidedBy: { id: 'm1', name: 'Ali Awan' },
  aiDecidedAt: '2026-10-28T10:00:00.000Z'
};

describe('entities (UAT B1)', () => {
  it('a Manager adds a client; saving without the AI decision or basis is refused', async () => {
    const { w, manager, reviewer } = await world();
    const noDecision = await request(w.app)
      .post('/api/entities')
      .set('Cookie', manager)
      .send({ ...abc, aiPermitted: null, aiBasis: '' });
    expect(noDecision.status).toBe(400);
    expect(noDecision.body.error.message).toBe('Record whether the client permits AI.');
    const noBasis = await request(w.app)
      .post('/api/entities')
      .set('Cookie', manager)
      .send({ ...abc, aiBasis: '' });
    expect(noBasis.body.error.message).toMatch(/basis for the AI decision/);
    const ok = await request(w.app).post('/api/entities').set('Cookie', manager).send(abc);
    expect(ok.status).toBe(200);
    expect(ok.body.entity).toMatchObject({
      name: 'ABC Funds ICAV',
      framework: 'FRS 102',
      partnerSignoff: false,
      umbrella: false,
      ruleOverrides: {}
    });
    expect(ok.body.entity.id).toMatch(/^id-/);
    expect((await request(w.app).get('/api/entities').set('Cookie', reviewer)).body.entities).toHaveLength(1);
    expect((await request(w.app).post('/api/entities').set('Cookie', reviewer).send(abc)).status).toBe(403);
  });

  it('names are unique ignoring case and spacing; an id chosen by the web app is kept; edits keep createdAt', async () => {
    const { w, manager } = await world();
    const first = await request(w.app).put('/api/entities/ent-abc123').set('Cookie', manager).send(abc);
    expect(first.body.entity.id).toBe('ent-abc123');
    const dup = await request(w.app)
      .post('/api/entities')
      .set('Cookie', manager)
      .send({ ...abc, name: 'abc funds  icav' });
    expect(dup.status).toBe(409);
    w.clock.advance(60_000);
    const edit = await request(w.app)
      .put('/api/entities/ent-abc123')
      .set('Cookie', manager)
      .send({ ...abc, auditor: 'KPMG', partnerSignoff: true });
    expect(edit.body.entity).toMatchObject({
      auditor: 'KPMG',
      partnerSignoff: true,
      createdAt: '2026-10-28T10:00:00.000Z',
      savedAt: '2026-10-28T10:01:00.000Z'
    });
  });
});

describe('engagements (UAT B2, B3, B4)', () => {
  const fund = (entityId: string, name = 'ABC Fund', yearEnd = '2026-12-31') => ({
    entityId,
    fund: {
      name,
      yearEnd,
      currency: 'GBP',
      preparer: { id: 'p1', name: 'Muhammad Salman' },
      reviewer: { id: 'r1', name: 'Rahat Kalim' },
      manager: { id: 'm1', name: 'Ali Awan' }
    },
    threshold: 250000,
    highMultiple: 4,
    ruleOverrides: {}
  });

  it('a Manager adds a fund under the client with its team; duplicates and unknown entities are refused', async () => {
    const { w, manager } = await world();
    const ent = (await request(w.app).post('/api/entities').set('Cookie', manager).send(abc)).body.entity;
    const ok = await request(w.app).post('/api/engagements').set('Cookie', manager).send(fund(ent.id));
    expect(ok.status).toBe(200);
    expect(ok.body.engagement).toMatchObject({ entityId: ent.id, fund: { name: 'ABC Fund', yearEnd: '2026-12-31' }, threshold: 250000 });
    const dup = await request(w.app).post('/api/engagements').set('Cookie', manager).send(fund(ent.id, ' abc  fund '));
    expect(dup.status).toBe(409);
    const second = await request(w.app)
      .post('/api/engagements')
      .set('Cookie', manager)
      .send(fund(ent.id, 'XYZ Fund', '2026-06-30'));
    expect(second.status).toBe(200);
    const orphan = await request(w.app).post('/api/engagements').set('Cookie', manager).send(fund('ent-missing'));
    expect(orphan.body.error.message).toBe('That entity no longer exists.');
    const bad = await request(w.app)
      .post('/api/engagements')
      .set('Cookie', manager)
      .send({ ...fund(ent.id, 'Third'), fund: { name: 'Third', yearEnd: 'next year' } });
    expect(bad.body.error.message).toBe('Enter the year end as a date.');
    expect((await request(w.app).get('/api/engagements').set('Cookie', manager)).body.engagements).toHaveLength(2);
  });

  it('rule overrides are stored and can be reset; AI off needs a reason', async () => {
    const { w, manager } = await world();
    const ent = (await request(w.app).post('/api/entities').set('Cookie', manager).send(abc)).body.entity;
    const e = (await request(w.app).post('/api/engagements').set('Cookie', manager).send(fund(ent.id))).body.engagement;
    const over = await request(w.app)
      .put(`/api/engagements/${e.id}`)
      .set('Cookie', manager)
      .send({ ...e, ruleOverrides: { 'CHK-10': { on: true, tol: 500, tolKind: 'abs' } } });
    expect(over.body.engagement.ruleOverrides['CHK-10'].tol).toBe(500);
    const reset = await request(w.app)
      .put(`/api/engagements/${e.id}`)
      .set('Cookie', manager)
      .send({ ...over.body.engagement, ruleOverrides: {} });
    expect(reset.body.engagement.ruleOverrides).toEqual({});
    const aiOff = await request(w.app)
      .put(`/api/engagements/${e.id}`)
      .set('Cookie', manager)
      .send({ ...e, aiOff: true });
    expect(aiOff.body.error.message).toMatch(/reason for turning AI off/);
  });

  it('a Reviewer may save only the trial balance mapping, never the engagement settings', async () => {
    const { w, manager, reviewer, preparer } = await world();
    const ent = (await request(w.app).post('/api/entities').set('Cookie', manager).send(abc)).body.entity;
    const e = (await request(w.app).post('/api/engagements').set('Cookie', manager).send(fund(ent.id))).body.engagement;
    const map = await request(w.app)
      .put(`/api/engagements/${e.id}`)
      .set('Cookie', reviewer)
      .send({ ...e, tbMap: { '1000': 'investments' }, tbMapBy: { id: 'r1', name: 'Rahat Kalim' }, tbMapAt: '2026-10-28T11:00:00.000Z' });
    expect(map.status).toBe(200);
    expect(map.body.engagement.tbMap).toEqual({ '1000': 'investments' });
    const settings = await request(w.app)
      .put(`/api/engagements/${e.id}`)
      .set('Cookie', reviewer)
      .send({ ...map.body.engagement, threshold: 1 });
    expect(settings.status).toBe(403);
    expect((await request(w.app).post('/api/engagements').set('Cookie', preparer).send(fund(ent.id, 'New Fund'))).status).toBe(403);
  });
});

describe('firm configuration (UAT A3, A4)', () => {
  it('the Administrator saves the check-rule template; everyone reads it; a custom rule needs a CHK id', async () => {
    const { w, admin, manager } = await world();
    expect((await request(w.app).get('/api/config/check-rules').set('Cookie', manager)).body.config).toBeNull();
    const saved = await request(w.app)
      .put('/api/config/check-rules')
      .set('Cookie', admin)
      .send({
        config: {
          rules: { 'CHK-05': { on: false, tol: 1, tolKind: 'abs' } },
          overrides: {},
          custom: [{ id: 'CHK-15', name: 'Fee check', engine: 'custom-tieout' }]
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.config.rules['CHK-05'].on).toBe(false);
    expect((await request(w.app).get('/api/config/check-rules').set('Cookie', manager)).body.config.custom).toHaveLength(1);
    expect((await request(w.app).put('/api/config/check-rules').set('Cookie', manager).send({ config: {} })).status).toBe(403);
    const badId = await request(w.app)
      .put('/api/config/check-rules')
      .set('Cookie', admin)
      .send({ config: { rules: {}, overrides: {}, custom: [{ id: 'fee' }] } });
    expect(badId.body.error.message).toMatch(/CHK-15/);
  });

  it('an imported checklist is saved as v1, then v2, with history kept and items cleaned', async () => {
    const { w, admin, manager } = await world();
    const items = [
      { ref: '3.3', section: 'Basis', text: 'Statement of compliance', keywords: 'FRS 102, compliance' },
      { ref: '', section: '', text: '   ', keywords: [] },
      { ref: '32.10', section: 'Events', text: 'Events after the reporting date', keywords: ['subsequent event'] }
    ];
    const v1 = await request(w.app).put('/api/config/checklists/FRS%20102').set('Cookie', admin).send({ items });
    expect(v1.status).toBe(200);
    expect(v1.body.checklist).toMatchObject({ framework: 'FRS 102', version: 'v1' });
    expect(v1.body.checklist.items).toHaveLength(2);
    expect(v1.body.checklist.items[0]).toMatchObject({ section: 'Basis', keywords: ['FRS 102', 'compliance'] });
    const v2 = await request(w.app)
      .put('/api/config/checklists/FRS%20102')
      .set('Cookie', admin)
      .send({ items: items.slice(0, 1) });
    expect(v2.body.checklist.version).toBe('v2');
    expect(w.checklists.history.map((h) => h.version)).toEqual(['v1', 'v2']);
    const all = await request(w.app).get('/api/config/checklists').set('Cookie', manager);
    expect(Object.keys(all.body.checklists)).toEqual(['FRS 102']);
    expect(all.body.checklists['FRS 102'].version).toBe('v2');
    expect((await request(w.app).put('/api/config/checklists/GAAP').set('Cookie', admin).send({ items })).status).toBe(400);
    expect((await request(w.app).put('/api/config/checklists/IFRS').set('Cookie', admin).send({ items: [] })).body.error.message).toBe(
      'A checklist needs at least one item.'
    );
  });
});
