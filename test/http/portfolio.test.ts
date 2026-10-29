// The portfolio and the bell, computed on the api (UAT J1, J2): a fund moves through its stages and each person
// sees what waits for them.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { ready, world, type World } from '../helpers/review.js';

const portfolio = async (x: World, cookie: string) => (await request(x.w.app).get('/api/portfolio').set('Cookie', cookie)).body;
const bell = async (x: World, cookie: string) => (await request(x.w.app).get('/api/notifications').set('Cookie', cookie)).body;
const titles = (b: { actions: { title: string }[] }) => b.actions.map((a) => a.title);

describe('portfolio and notifications on the server (UAT J1, J2)', () => {
  it('follows a fund from not started to ready for sign-off, telling each person what waits for them', async () => {
    const x = await world();
    const row = async () => (await portfolio(x, x.manager)).rows.find((r: { engagementId: string }) => r.engagementId === x.eng.id);

    expect(await row()).toMatchObject({
      stage: 'Not started',
      owner: 'preparer',
      ownerName: 'Muhammad Salman',
      client: 'ABC Funds ICAV',
      fund: 'ABC Fund',
      tab: 'docs'
    });

    await ready(x);
    expect(await row()).toMatchObject({ stage: 'Ready to analyse', ownerName: 'Rahat Kalim' });
    expect(titles(await bell(x, x.reviewer))).toContain('Documents are ready to analyse');
    expect(titles(await bell(x, x.preparer))).not.toContain('Documents are ready to analyse');

    // the analysis raises a point assigned to the preparer, overdue since yesterday
    const reviewer = actorOf((await x.w.users.findByUsername('rahat.kalim'))!);
    const preparer = (await x.w.users.findByUsername('muhammad.salman'))!;
    const matrix = await x.w.permissions.get();
    await x.w.uc.syncAnalysisPoints.execute(
      reviewer,
      matrix,
      x.eng.id,
      [{ ref: 'RP-01', title: 'Note 4 differs' }],
      { id: preparer.id, name: preparer.name, role: 'Preparer' },
      1
    );
    await x.w.uc.saveAnalysisRun.execute(reviewer, matrix, x.eng.id, { result: { version: 1 }, analysedAt: '', settingsSig: '' });
    const point = [...x.w.points.rows.values()][0]!;
    await request(x.w.app).put(`/api/points/${point.id}/meta`).set('Cookie', x.reviewer).send({ dueDate: '2026-10-27' });
    expect(await row()).toMatchObject({ stage: 'In review', ownerName: 'Muhammad Salman', open: 1, overdue: 1 });
    expect(titles(await bell(x, x.preparer))).toEqual(
      expect.arrayContaining(['RP-01 is waiting for your response', 'RP-01 is overdue (due 2026-10-27)'])
    );
    expect((await bell(x, x.preparer)).updates.map((u: { title: string }) => u.title)).toContain(
      'Rahat Kalim ran the analysis of draft v1'
    );

    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Corrected' });
    expect(await row()).toMatchObject({ stage: 'In review', owner: 'reviewer', ownerName: 'Rahat Kalim', responded: 1 });
    expect(titles(await bell(x, x.reviewer))).toContain('RP-01 has a response for you to review');

    await request(x.w.app).post(`/api/points/${point.id}/act`).set('Cookie', x.reviewer).send({ kind: 'clear', text: 'Agreed' });
    expect(await row()).toMatchObject({ stage: 'Ready for sign-off', owner: 'manager', open: 0, overdue: 0 });
    expect(titles(await bell(x, x.manager))).toContain('Ready for your sign-off');
  });

  it('lists the newest 50 actions and counts them all (load test: a preparer with hundreds of points)', async () => {
    const x = await world();
    await ready(x);
    const preparer = (await x.w.users.findByUsername('muhammad.salman'))!;
    for (let i = 1; i <= 55; i++)
      await request(x.w.app)
        .post(`/api/engagements/${x.eng.id}/points`)
        .set('Cookie', x.reviewer)
        .send({ content: { title: `Point ${i}` }, assignee: { id: preparer.id, name: preparer.name, role: 'Preparer' } })
        .expect(200);
    const b = await bell(x, x.preparer);
    expect(b.actions).toHaveLength(50);
    expect(b.actionCount).toBe(55);
    expect(b.updates.map((u: { title: string }) => u.title)).toContain('Rahat Kalim raised RP-01 for you');
    // the reviewer raised the points: their own messages are not updates for them
    expect((await bell(x, x.reviewer)).updates.map((u: { title: string }) => u.title)).toEqual([
      'Muhammad Salman marked the documents ready for review'
    ]);
  });

  it('Finance sees no portfolio and no review notifications', async () => {
    const x = await world();
    await ready(x);
    expect((await request(x.w.app).get('/api/portfolio').set('Cookie', x.finance)).status).toBe(403);
    expect(await bell(x, x.finance)).toEqual({ actions: [], actionCount: 0, updates: [] });
  });
});
