// Deleting a fund (a soft delete): Administrators only, the fund's name typed to confirm, refused while anything of
// it runs; afterwards the fund is found nowhere in the app (every read by id answers 404) until it is restored, while
// its data, its activity entries and its billing stay as they were.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { world, type World } from '../helpers/review.js';

const GROUP = 'abc asset management';
const YE = '2026-12-31';

/** A second fund of an entity with the same Client name and year end: one Consolidated Review group with ABC Fund. */
async function related(x: World) {
  const ent2 = (
    await request(x.w.app)
      .post('/api/entities')
      .set('Cookie', x.manager)
      .send({
        name: 'ABC Lending LP',
        client: 'ABC Asset Management',
        framework: 'FRS 102',
        aiPermitted: true,
        aiBasis: 'Letter',
        aiDecidedBy: { id: 'm', name: 'Ali' },
        aiDecidedAt: '2026-10-28T10:00:00.000Z'
      })
  ).body.entity as { id: string };
  const fund = async (name: string) =>
    (
      await request(x.w.app)
        .post('/api/engagements')
        .set('Cookie', x.manager)
        .send({ entityId: ent2.id, fund: { name, yearEnd: YE, currency: 'GBP' } })
    ).body.engagement as { id: string };
  return { ent2, eng2: await fund('ABC Lending'), eng3: await fund('ABC Lending II') };
}

const del = (x: World, id: string, cookie: string, body: Record<string, unknown> = { confirmName: 'ABC Fund' }) =>
  request(x.w.app).delete(`/api/engagements/${id}`).set('Cookie', cookie).send(body);
const restore = (x: World, id: string, cookie: string) => request(x.w.app).post(`/api/engagements/${id}/restore`).set('Cookie', cookie);
const raise = async (x: World, engagementId: string, title: string) =>
  (await request(x.w.app).post(`/api/engagements/${engagementId}/points`).set('Cookie', x.reviewer).send({ content: { title } })).body
    .point as { id: string; ref: string };
const ids = (rows: { id?: string; engagementId?: string }[]) => rows.map((r) => r.id ?? r.engagementId);

describe('deleting and restoring a fund', { timeout: 30_000 }, () => {
  it('only Administrators (or a role given engagements.delete) may delete, with the fund’s name typed to confirm', async () => {
    const x = await world();
    for (const c of [x.manager, x.reviewer, x.preparer, x.partner, x.finance]) expect((await del(x, x.eng.id, c)).status).toBe(403);
    expect((await request(x.w.app).get('/api/engagements/deleted').set('Cookie', x.manager)).status).toBe(403);

    const wrong = await del(x, x.eng.id, x.admin, { confirmName: 'ABC' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe('Type the fund’s name, ABC Fund, to confirm.');
    expect((await del(x, x.eng.id, x.admin, { confirmName: 'ABC Fund', reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await del(x, 'no-such-fund', x.admin)).status).toBe(404);

    // an Administrator can grant it to Managers in the permission matrix; it is never given to Preparers
    const before = (await request(x.w.app).get('/api/permissions')).body.matrix;
    expect(before['engagements.delete']).toEqual([]);
    const saved = await request(x.w.app)
      .put('/api/permissions')
      .set('Cookie', x.admin)
      .send({ matrix: { ...before, 'engagements.delete': ['Manager', 'Preparer'] } });
    expect(saved.body.matrix['engagements.delete']).toEqual(['Manager']);
    // case and spacing of the typed name do not matter
    expect((await del(x, x.eng.id, x.manager, { confirmName: '  abc   fund ' })).status).toBe(200);
  });

  it('hides the fund everywhere, keeps who, when and why, logs it, and restores it with everything it had', async () => {
    const x = await world();
    const point = await raise(x, x.eng.id, 'Cash not agreed to the bank letter');
    const sample = await request(x.w.app)
      .post(`/api/engagements/${x.eng.id}/documents/sample`)
      .set('Cookie', x.preparer)
      .send({ slot: 'cy', name: 'Draft' });
    const versionId = sample.body.version.id as string;
    const ev = await request(x.w.app)
      .post(`/api/points/${point.id}/evidence`)
      .set('Cookie', x.preparer)
      .attach('file', Buffer.from('hello'), 'bank letter.txt');
    expect(ev.status).toBe(200);
    // the preparer has an action in the bell for the point
    expect((await request(x.w.app).get('/api/notifications').set('Cookie', x.preparer)).body.actionCount).toBe(1);

    const gone = await del(x, x.eng.id, x.admin, { confirmName: 'ABC Fund', reason: 'Set up twice by mistake' });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ id: x.eng.id, deletedAt: expect.any(String) });

    // lists
    expect(ids((await request(x.w.app).get('/api/engagements').set('Cookie', x.reviewer)).body.engagements)).toEqual([]);
    expect(Object.keys((await request(x.w.app).get('/api/reviews').set('Cookie', x.reviewer)).body.reviews)).toEqual([]);
    expect((await request(x.w.app).get('/api/portfolio').set('Cookie', x.reviewer)).body.rows).toEqual([]);
    expect((await request(x.w.app).get('/api/notifications').set('Cookie', x.preparer)).body).toMatchObject({
      actions: [],
      actionCount: 0
    });
    // the entity stays when its last fund is deleted
    expect(ids((await request(x.w.app).get('/api/entities').set('Cookie', x.reviewer)).body.entities)).toEqual([x.ent.id]);

    // every read and write by id answers 404
    const id = x.eng.id;
    const app = x.w.app;
    const notFound = [
      request(app).get(`/api/engagements/${id}/review`).set('Cookie', x.reviewer),
      request(app)
        .put(`/api/engagements/${id}`)
        .set('Cookie', x.manager)
        .send({ fund: { name: 'ABC Fund', yearEnd: YE } }),
      request(app)
        .post('/api/engagements')
        .set('Cookie', x.manager)
        .send({ id, fund: { name: 'ABC Fund', yearEnd: YE } }),
      request(app)
        .post(`/api/engagements/${id}/points`)
        .set('Cookie', x.reviewer)
        .send({ content: { title: 'More' } }),
      request(app).post(`/api/engagements/${id}/documents/sample`).set('Cookie', x.preparer).send({ slot: 'py', name: 'Signed' }),
      request(app).delete(`/api/engagements/${id}/documents/cy`).set('Cookie', x.preparer),
      request(app).put(`/api/engagements/${id}/workflow`).set('Cookie', x.preparer).send({ state: 'ready' }),
      request(app).post(`/api/engagements/${id}/analysis-jobs`).set('Cookie', x.reviewer).send({}),
      request(app)
        .put(`/api/engagements/${id}/checklist/answers/item-1`)
        .set('Cookie', x.reviewer)
        .send({ framework: 'FRS 102', answer: 'yes' }),
      request(app).post(`/api/engagements/${id}/signoff`).set('Cookie', x.manager).send({ state: 'signed' }),
      request(app).get(`/api/documents/${versionId}/file`).set('Cookie', x.reviewer),
      request(app).put(`/api/documents/${versionId}/confirm`).set('Cookie', x.preparer).send({}),
      request(app).post(`/api/points/${point.id}/comments`).set('Cookie', x.reviewer).send({ text: 'Any news?' }),
      request(app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Done' }),
      request(app).get(`/api/evidence/${ev.body.evidence.id}/file`).set('Cookie', x.reviewer),
      request(app).get('/api/activity').query({ engagementId: id }).set('Cookie', x.reviewer),
      del(x, id, x.admin)
    ];
    for (const [i, r] of (await Promise.all(notFound)).entries()) expect([i, r.status]).toEqual([i, 404]);

    // the deleted funds list, for whoever may restore
    const list = (await request(x.w.app).get('/api/engagements/deleted').set('Cookie', x.admin)).body.funds;
    expect(list).toEqual([
      {
        id,
        fundName: 'ABC Fund',
        yearEnd: YE,
        entityId: x.ent.id,
        entityName: 'ABC Funds ICAV',
        clientName: 'ABC Asset Management',
        deletedAt: gone.body.deletedAt,
        deletedBy: { id: expect.any(String), name: 'Hamza Mehmood', role: 'Administrator' },
        reason: 'Set up twice by mistake'
      }
    ]);

    // the whole log keeps the fund's entries (marked, so the screens do not link into it) and records the delete
    const log = (await request(x.w.app).get('/api/activity').set('Cookie', x.admin)).body.entries as {
      summary: string;
      details: string;
      engagementId: string | null;
      fundDeleted?: true;
    }[];
    const entry = log.find((e) => e.summary === 'Deleted fund ABC Fund')!;
    expect(entry).toMatchObject({ engagementId: id, fundDeleted: true });
    expect(entry.details).toContain('Reason: Set up twice by mistake');
    expect(log.filter((e) => e.engagementId === id).every((e) => e.fundDeleted)).toBe(true);

    // restore: everything comes back as it was
    expect((await restore(x, id, x.manager)).status).toBe(403);
    expect((await restore(x, id, x.admin)).status).toBe(200);
    expect((await restore(x, id, x.admin)).status).toBe(404);
    expect((await request(x.w.app).get('/api/engagements/deleted').set('Cookie', x.admin)).body.funds).toEqual([]);
    const back = (await request(x.w.app).get(`/api/engagements/${id}/review`).set('Cookie', x.reviewer)).body;
    expect(back.points.map((p: { id: string }) => p.id)).toEqual([point.id]);
    expect(back.current.cy.id).toBe(versionId);
    expect((await request(x.w.app).get('/api/notifications').set('Cookie', x.preparer)).body.actionCount).toBe(1);
    expect((await request(x.w.app).get('/api/portfolio').set('Cookie', x.reviewer)).body.rows).toHaveLength(1);
    const after = (await request(x.w.app).get('/api/activity').set('Cookie', x.admin)).body.entries as {
      summary: string;
      fundDeleted?: true;
    }[];
    expect(after.some((e) => e.summary === 'Restored fund ABC Fund')).toBe(true);
    expect(after.some((e) => e.fundDeleted)).toBe(false);
  });

  it('refuses a restore when a live fund now has the same entity, name and year end', async () => {
    const x = await world();
    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);
    // the name is free again while the fund is deleted
    const again = await request(x.w.app)
      .post('/api/engagements')
      .set('Cookie', x.manager)
      .send({ entityId: x.ent.id, fund: { name: 'ABC Fund', yearEnd: YE } });
    expect(again.status).toBe(200);
    const r = await restore(x, x.eng.id, x.admin);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('already exists under that entity');
  });

  it('is refused while the fund’s analysis or its group’s Consolidated Review is queued or running', async () => {
    const x = await world();
    await related(x);
    const job = {
      id: 'job-1',
      engagementId: x.eng.id,
      mode: 'full' as const,
      status: 'running' as const,
      step: 1,
      total: 8,
      error: null,
      runId: null,
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: null
    };
    x.w.jobs.rows.push(job);
    const busy = await del(x, x.eng.id, x.admin);
    expect(busy.status).toBe(409);
    expect(busy.body.error.message).toContain('An analysis of this fund is running');
    x.w.jobs.rows = [{ ...job, status: 'done', finishedAt: '2026-11-01T10:05:00.000Z' }];

    x.w.consolidated.rows.push({
      id: 'cr-1',
      groupKey: GROUP,
      groupName: 'ABC Asset Management',
      yearEnd: YE,
      status: 'queued',
      step: 0,
      total: 4,
      error: null,
      runIds: {},
      result: null,
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: null,
      finishedAt: null
    });
    const grp = await del(x, x.eng.id, x.admin);
    expect(grp.status).toBe(409);
    expect(grp.body.error.message).toContain('A Consolidated Review of ABC Asset Management is running');
    x.w.consolidated.rows[0]!.status = 'failed';
    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);
  });

  it('a restart never picks up a deleted fund’s job', async () => {
    const x = await world();
    x.w.jobs.rows.push({
      id: 'job-q',
      engagementId: x.eng.id,
      mode: 'full',
      status: 'queued',
      step: 0,
      total: 8,
      error: null,
      runId: null,
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: null,
      finishedAt: null
    });
    // deleted at the same moment the job was queued (the delete itself refuses while a job is active)
    await x.w.engagements.markDeleted(x.eng.id, { at: '2026-11-01T10:00:01.000Z', by: null, reason: null });
    expect(await x.w.recoverJobs.execute()).toEqual({ failed: 0, requeued: 0 });
    expect(x.w.jobs.rows[0]!.status).toBe('queued');
  });

  it('leaves its Consolidated Review group (shown as removed) and its shared points, and comes back on restore', async () => {
    const x = await world();
    const { eng2, eng3 } = await related(x);
    const p = await raise(x, x.eng.id, 'Management fee rate not agreed to the prospectus');
    const shared = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    expect(shared.status).toBe(200);
    const copy = shared.body.points.find((q: { engagementId: string }) => q.engagementId === eng2.id);
    // a finished Consolidated Review that read all three funds and listed the shared point
    x.w.consolidated.rows.push({
      id: 'cr-done',
      groupKey: GROUP,
      groupName: 'ABC Asset Management',
      yearEnd: YE,
      status: 'done',
      step: 4,
      total: 4,
      error: null,
      runIds: { [x.eng.id]: null, [eng2.id]: null, [eng3.id]: null },
      result: {
        groups: [
          {
            title: 'Management fee',
            points: [
              { engagementId: x.eng.id, ref: p.ref, status: 'open' },
              { engagementId: eng2.id, ref: copy.ref, status: 'open' }
            ]
          }
        ]
      },
      requestedBy: { id: 'u', name: 'U', role: 'Reviewer' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: '2026-11-01T10:00:00.000Z',
      finishedAt: '2026-11-01T10:01:00.000Z'
    });

    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);

    const groups = (await request(x.w.app).get('/api/consolidated').set('Cookie', x.reviewer)).body.groups;
    expect(groups[0].funds.map((f: { engagementId: string }) => f.engagementId).sort()).toEqual([eng2.id, eng3.id].sort());
    const cr = (await request(x.w.app).get('/api/consolidated/review').query({ groupKey: GROUP, yearEnd: YE }).set('Cookie', x.reviewer))
      .body;
    expect(cr.group.funds.map((f: { engagementId: string }) => f.engagementId)).not.toContain(x.eng.id);
    // the deleted fund is never named, and the saved result (its names, figures and summary) is withheld until run again
    expect(cr.stale.removed).toEqual(['a deleted fund']);
    expect(cr.review).toMatchObject({ id: 'cr-done', result: null, withheld: 'deletedFund' });
    expect(JSON.stringify(cr)).not.toContain('ABC Fund"');

    // the other fund's shared point no longer shows the deleted fund's copy or thread
    const s2 = (await request(x.w.app).get(`/api/engagements/${eng2.id}/review`).set('Cookie', x.reviewer)).body;
    expect(s2.shared).toEqual({ points: [], messages: [] });
    // and the deleted fund cannot be shared into
    const into = await request(x.w.app)
      .post(`/api/points/${copy.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [x.eng.id] });
    expect(into.status).toBe(400);

    // restored: back in the group, the shared point linked again
    expect((await restore(x, x.eng.id, x.admin)).status).toBe(200);
    const s2b = (await request(x.w.app).get(`/api/engagements/${eng2.id}/review`).set('Cookie', x.reviewer)).body;
    expect(s2b.shared.points.map((q: { id: string }) => q.id)).toEqual([p.id]);
    const cr2 = (await request(x.w.app).get('/api/consolidated/review').query({ groupKey: GROUP, yearEnd: YE }).set('Cookie', x.reviewer))
      .body;
    expect(cr2.stale).toBeNull();
    expect(cr2.review.withheld).toBeUndefined();
    const listed = cr2.review.result.groups[0].points;
    expect(listed.find((q: { engagementId: string }) => q.engagementId === x.eng.id)).toMatchObject({ status: 'open', pointId: p.id });
  });

  it('a point left shared with nobody while its fund was deleted is an ordinary point again on restore', async () => {
    const x = await world();
    const { eng2 } = await related(x);
    const p = await raise(x, x.eng.id, 'Custody fees not accrued');
    const shared = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    const copy = shared.body.points.find((q: { engagementId: string }) => q.engagementId === eng2.id);
    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);
    // the other fund stops sharing while ABC Fund is deleted
    expect((await request(x.w.app).delete(`/api/points/${copy.id}/share`).set('Cookie', x.reviewer)).status).toBe(200);
    expect((await restore(x, x.eng.id, x.admin)).status).toBe(200);
    const back = (await request(x.w.app).get(`/api/engagements/${x.eng.id}/review`).set('Cookie', x.reviewer)).body;
    expect(back.points.find((q: { id: string }) => q.id === p.id).sharedGroupId).toBeNull();
    expect(back.messages.some((m: { text: string }) => m.text.startsWith('No longer shared: the other funds stopped sharing'))).toBe(true);
  });

  it('refuses activity entries and late saves against a deleted fund', async () => {
    const x = await world();
    const rec = (await x.w.engagements.findById(x.eng.id))!;
    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);
    const entry = await request(x.w.app)
      .post('/api/activity')
      .set('Cookie', x.reviewer)
      .send({ category: 'Documents', summary: 'Opened a document', engagementId: x.eng.id, fundName: 'ABC Fund' });
    expect(entry.status).toBe(404);
    // a save that read the fund just before it was deleted
    await expect(x.w.engagements.update(rec)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('billing is unchanged: the fund’s AI usage stays billable and Finance is told the fund is deleted', async () => {
    const x = await world();
    await x.w.uc.activity.record({
      actor: null,
      category: 'AI',
      summary: 'AI: Reading real documents',
      engagementId: x.eng.id,
      fundName: 'ABC Fund',
      usage: { step: 'extract', model: 'claude-sonnet-5-5', input: 1000, output: 1000 }
    });
    const before = (await request(x.w.app).get('/api/billing').set('Cookie', x.finance)).body;
    expect(before.deletedFunds).toEqual([]);
    expect((await del(x, x.eng.id, x.admin)).status).toBe(200);
    const after = (await request(x.w.app).get('/api/billing').set('Cookie', x.finance)).body;
    expect(after.deletedFunds).toEqual([x.eng.id]);
    expect(after.usage).toEqual(before.usage);
    expect(after.usage).toHaveLength(1);
    expect(after.state).toEqual(before.state);
  });
});
