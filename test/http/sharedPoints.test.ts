// Review points shared across related funds (meeting point 4): one matter, a copy in each fund that is cleared in
// that fund, and one thread read across the copies.
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { world, type World } from '../helpers/review.js';

/** A second fund of an entity with the same Client name and year end, and one more fund outside the group. */
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
  ).body.entity;
  const fund = async (name: string, yearEnd: string) =>
    (
      await request(x.w.app)
        .post('/api/engagements')
        .set('Cookie', x.manager)
        .send({ entityId: ent2.id, fund: { name, yearEnd, currency: 'GBP' } })
    ).body.engagement as { id: string };
  return { eng2: await fund('ABC Lending', '2026-12-31'), other: await fund('ABC Lending 2025', '2025-12-31') };
}
const raise = async (x: World, engagementId: string, title: string) =>
  (await request(x.w.app).post(`/api/engagements/${engagementId}/points`).set('Cookie', x.reviewer).send({ content: { title } })).body
    .point as { id: string; ref: string };
const snapshot = async (x: World, engagementId: string) =>
  (await request(x.w.app).get(`/api/engagements/${engagementId}/review`).set('Cookie', x.reviewer)).body;

describe('Shared review points', () => {
  it('shares a point with a related fund: an SP copy there, one thread, each fund clears its own copy', async () => {
    const x = await world();
    const { eng2 } = await related(x);
    const p = await raise(x, x.eng.id, 'Management fee rate not agreed to the prospectus');
    const r = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    expect(r.status).toBe(200);
    const copy = r.body.points.find((q: { engagementId: string }) => q.engagementId === eng2.id);
    expect(copy).toMatchObject({ ref: 'SP-1', status: 'open', sharedGroupId: r.body.sharedGroupId, assignedTo: null });
    expect(copy.content).toMatchObject({
      title: 'Management fee rate not agreed to the prospectus',
      sharedFrom: { engagementId: x.eng.id, ref: p.ref }
    });

    // a comment in one fund is read in the other
    await request(x.w.app).post(`/api/points/${copy.id}/comments`).set('Cookie', x.manager).send({ text: 'Same in Lending.' });
    const s1 = await snapshot(x, x.eng.id);
    expect(s1.shared.points.map((q: { id: string }) => q.id)).toEqual([copy.id]);
    expect(s1.shared.messages.some((m: { text: string }) => m.text === 'Same in Lending.')).toBe(true);

    // clearing in one fund leaves the other open
    await request(x.w.app).post(`/api/points/${copy.id}/act`).set('Cookie', x.preparer).send({ kind: 'response', text: 'Fixed' });
    expect((await request(x.w.app).post(`/api/points/${copy.id}/act`).set('Cookie', x.reviewer).send({ kind: 'clear' })).status).toBe(200);
    const s2 = await snapshot(x, x.eng.id);
    expect(s2.points.find((q: { id: string }) => q.id === p.id).status).toBe('open');
    expect(s2.shared.points[0].status).toBe('cleared');
  });

  it('links points already raised in several funds, and refuses funds outside the group or signed off', async () => {
    const x = await world();
    const { eng2, other } = await related(x);
    const a = await raise(x, x.eng.id, 'Related party note omits the manager');
    const b = await raise(x, eng2.id, 'Related-party note does not name the manager');
    const c = await raise(x, other.id, 'Different year end');
    expect(
      (
        await request(x.w.app)
          .post('/api/points/shared')
          .set('Cookie', x.reviewer)
          .send({ pointIds: [a.id, c.id] })
      ).status
    ).toBe(400);
    const linked = await request(x.w.app)
      .post('/api/points/shared')
      .set('Cookie', x.reviewer)
      .send({ pointIds: [a.id, b.id] });
    expect(linked.status).toBe(200);
    expect(new Set(linked.body.points.map((q: { sharedGroupId: string }) => q.sharedGroupId)).size).toBe(1);
    // refs are unchanged: linking only joins the threads
    expect(linked.body.points.map((q: { ref: string }) => q.ref).sort()).toEqual([a.ref, b.ref].sort());

    // a second point of a fund that already has a copy is refused
    const a2 = await raise(x, x.eng.id, 'Another');
    expect(
      (
        await request(x.w.app)
          .post('/api/points/shared')
          .set('Cookie', x.reviewer)
          .send({ pointIds: [a2.id, b.id] })
      ).status
    ).toBe(400);

    // a signed-off fund cannot receive a copy, and nothing is created anywhere
    const d = await raise(x, x.eng.id, 'New matter');
    x.w.signoffs.rows.set(eng2.id, {
      engagementId: eng2.id,
      state: 'signed',
      by: null,
      at: null,
      text: '',
      summary: null,
      history: []
    } as never);
    const refused = await request(x.w.app)
      .post(`/api/points/${d.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/ABC Lending is signed off/);
    expect((await x.w.points.listByEngagement(eng2.id)).filter((q) => q.ref.startsWith('SP-'))).toHaveLength(0);
  });

  it('only those who may raise points can share; stopping sharing unlinks the copy', async () => {
    const x = await world();
    const { eng2 } = await related(x);
    const p = await raise(x, x.eng.id, 'Matter');
    expect(
      (
        await request(x.w.app)
          .post(`/api/points/${p.id}/share`)
          .set('Cookie', x.preparer)
          .send({ engagementIds: [eng2.id] })
      ).status
    ).toBe(403);
    const r = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    const copy = r.body.points.find((q: { engagementId: string }) => q.engagementId === eng2.id);
    const off = await request(x.w.app).delete(`/api/points/${p.id}/share`).set('Cookie', x.reviewer);
    expect(off.body.point.sharedGroupId).toBeNull();
    expect((await x.w.points.findById(copy.id))!.sharedGroupId).toBeNull();
    expect((await snapshot(x, x.eng.id)).shared.points).toEqual([]);
  });

  it('a new analysis updates a linked point without unlinking it, and never touches the SP copies', async () => {
    const x = await world();
    const { eng2 } = await related(x);
    const p = await raise(x, x.eng.id, 'Matter'); // RP-01, as the analysis would number it
    const r = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    const actor = actorOf((await x.w.users.findByUsername('rahat.kalim'))!);
    await x.w.uc.syncAnalysisPoints.execute(actor, x.w.permissions.matrix, x.eng.id, [{ ref: p.ref, title: 'Matter, re-tested' }], null, 2);
    await x.w.uc.syncAnalysisPoints.execute(actor, x.w.permissions.matrix, eng2.id, [{ ref: 'RP-01', title: 'From analysis' }], null, 2);
    const again = (await x.w.points.findById(p.id))!;
    expect(again.content.title).toBe('Matter, re-tested');
    expect(again.sharedGroupId).toBe(r.body.sharedGroupId);
    expect((await x.w.points.listByEngagement(eng2.id)).map((q) => [q.ref, q.sharedGroupId ?? null]).sort()).toEqual(
      [
        ['RP-01', null],
        ['SP-1', r.body.sharedGroupId]
      ].sort()
    );
  });

  it('stopping sharing in a two-fund share makes the other copy ordinary again; groups say which funds are signed off', async () => {
    const x = await world();
    const { eng2 } = await related(x);
    const p = await raise(x, x.eng.id, 'Matter');
    const r = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    const copy = r.body.points.find((q: { engagementId: string }) => q.engagementId === eng2.id);
    await request(x.w.app).delete(`/api/points/${p.id}/share`).set('Cookie', x.reviewer);
    expect((await x.w.points.findById(copy.id))!.sharedGroupId).toBeNull();
    // sharing again afterwards cannot make a second copy for the same fund unnoticed: it is a new SP copy, linked
    const again = await request(x.w.app)
      .post(`/api/points/${p.id}/share`)
      .set('Cookie', x.reviewer)
      .send({ engagementIds: [eng2.id] });
    expect(again.status).toBe(200);

    x.w.signoffs.rows.set(eng2.id, {
      engagementId: eng2.id,
      state: 'signed',
      by: null,
      at: null,
      text: '',
      summary: null,
      history: []
    } as never);
    const groups = (await request(x.w.app).get('/api/consolidated').set('Cookie', x.reviewer)).body.groups;
    const funds = groups.find((g: { yearEnd: string }) => g.yearEnd === '2026-12-31').funds;
    expect(funds.find((f: { engagementId: string }) => f.engagementId === eng2.id).locked).toBe(true);
    expect(funds.find((f: { engagementId: string }) => f.engagementId === x.eng.id).locked).toBe(false);
  });

  it('raises a common review point in several funds at once: an SP copy in each, linked, each cleared on its own', async () => {
    const x = await world();
    const { eng2, other } = await related(x);
    const body = {
      engagementIds: [x.eng.id, eng2.id],
      content: { title: 'Board minutes not on file', basis: 'Needed for both funds', pri: 'High' }
    };
    expect((await request(x.w.app).post('/api/points/common').set('Cookie', x.preparer).send(body)).status).toBe(403);
    expect(
      (
        await request(x.w.app)
          .post('/api/points/common')
          .set('Cookie', x.reviewer)
          .send({ ...body, engagementIds: [x.eng.id, other.id] })
      ).status
    ).toBe(400); // a different year end is another group
    const r = await request(x.w.app).post('/api/points/common').set('Cookie', x.reviewer).send(body);
    expect(r.status).toBe(200);
    expect(r.body.points).toHaveLength(2);
    for (const p of r.body.points)
      expect(p).toMatchObject({
        ref: 'SP-1',
        status: 'open',
        sharedGroupId: r.body.sharedGroupId,
        content: { title: 'Board minutes not on file', pri: 'High' }
      });
    const s1 = await snapshot(x, x.eng.id);
    expect(s1.messages.find((m: { kind: string }) => m.kind === 'raise').text).toMatch(/common review point, also in ABC Lending SP-1/);
    expect(s1.shared.points).toHaveLength(1);
    // a signed-off fund is refused and nothing is raised anywhere
    x.w.signoffs.rows.set(eng2.id, {
      engagementId: eng2.id,
      state: 'signed',
      by: null,
      at: null,
      text: '',
      summary: null,
      history: []
    } as never);
    expect((await request(x.w.app).post('/api/points/common').set('Cookie', x.reviewer).send(body)).status).toBe(400);
    expect((await x.w.points.listByEngagement(x.eng.id)).filter((q) => q.ref.startsWith('SP-'))).toHaveLength(1);
  });
});
