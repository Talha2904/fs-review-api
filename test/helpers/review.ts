// A firm with the six UAT people, ABC Funds ICAV and its ABC Fund engagement, for the review tests.
import request from 'supertest';

import { buildTestWorld, cookieOf, type TestWorld } from './fakes.js';

export const PW = 'longenough1';

export interface World {
  w: TestWorld;
  admin: string;
  manager: string;
  reviewer: string;
  preparer: string;
  partner: string;
  finance: string;
  eng: { id: string };
  ent: { id: string };
}

export async function world(opts: { partnerSignoff?: boolean; aiPermitted?: boolean } = {}): Promise<World> {
  const w = buildTestWorld();
  const admin = cookieOf(
    await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW })
  );
  const people: Record<string, string> = {};
  for (const [name, username, role] of [
    ['Ali Awan', 'ali.awan', 'Manager'],
    ['Rahat Kalim', 'rahat.kalim', 'Reviewer'],
    ['Muhammad Salman', 'muhammad.salman', 'Preparer'],
    ['Owais Ahmed', 'owais.ahmed', 'Partner'],
    ['Ibrahim Moola', 'ibrahim.moola', 'Finance']
  ]) {
    const r = await request(w.app).post('/api/users').set('Cookie', admin).send({ name, username, password: PW, role });
    people[username!] = r.body.user.id;
  }
  const as = async (u: string) => cookieOf(await request(w.app).post('/api/auth/login').send({ username: u, password: PW }));
  const manager = await as('ali.awan');
  const ent = (
    await request(w.app)
      .post('/api/entities')
      .set('Cookie', manager)
      .send({
        name: 'ABC Funds ICAV',
        client: 'ABC Asset Management',
        framework: 'FRS 102',
        billingEmail: 'accounts@abc.test',
        partnerSignoff: !!opts.partnerSignoff,
        aiPermitted: opts.aiPermitted ?? true,
        aiBasis: 'Letter',
        aiDecidedBy: { id: 'm', name: 'Ali' },
        aiDecidedAt: '2026-10-28T10:00:00.000Z'
      })
  ).body.entity;
  const eng = (
    await request(w.app)
      .post('/api/engagements')
      .set('Cookie', manager)
      .send({
        entityId: ent.id,
        fund: {
          name: 'ABC Fund',
          yearEnd: '2026-12-31',
          currency: 'GBP',
          preparerId: people['muhammad.salman'],
          reviewerId: people['rahat.kalim']
        }
      })
  ).body.engagement;
  return {
    w,
    admin,
    manager,
    reviewer: await as('rahat.kalim'),
    preparer: await as('muhammad.salman'),
    partner: await as('owais.ahmed'),
    finance: await as('ibrahim.moola'),
    eng,
    ent
  };
}

/** Samples attached and marked ready, as the UAT does before analysing. */
export async function ready(x: World) {
  for (const [slot, name] of [
    ['cy', 'Draft'],
    ['py', 'Signed'],
    ['tb', 'TB'],
    ['is', 'Schedule']
  ])
    await request(x.w.app).post(`/api/engagements/${x.eng.id}/documents/sample`).set('Cookie', x.preparer).send({ slot, name });
  await request(x.w.app).put(`/api/engagements/${x.eng.id}/workflow`).set('Cookie', x.preparer).send({ state: 'ready' });
}
