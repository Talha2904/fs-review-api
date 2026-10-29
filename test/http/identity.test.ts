import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildTestWorld, cookieOf, type TestWorld } from '../helpers/fakes.js';

const PW = 'longenough1';

async function setupAdmin(w: TestWorld) {
  const res = await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW });
  expect(res.status).toBe(200);
  return cookieOf(res);
}
async function login(w: TestWorld, username: string, password = PW) {
  const res = await request(w.app).post('/api/auth/login').send({ username, password });
  return { res, cookie: cookieOf(res) };
}

describe('first run and sign-in', () => {
  let w: TestWorld;
  beforeEach(() => {
    w = buildTestWorld();
  });

  it('reports setup required, creates the first Administrator, then refuses a second setup', async () => {
    expect((await request(w.app).get('/api/auth/status')).body).toEqual({ setupRequired: true, resetAvailable: true });
    const cookie = await setupAdmin(w);
    expect(cookie).toMatch(/^fsr_session=/);
    const me = await request(w.app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.user).toMatchObject({ username: 'hamza.mehmood', role: 'Administrator' });
    const again = await request(w.app).post('/api/auth/setup').send({ name: 'X', username: 'x.y', password: PW });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('signs in with the right password, refuses the wrong one, and logs both', async () => {
    await setupAdmin(w);
    const bad = await login(w, 'hamza.mehmood', 'wrong-password');
    expect(bad.res.status).toBe(401);
    expect(bad.res.body.error.message).toBe('The username or password is not correct.');
    const ok = await login(w, 'Hamza.Mehmood ');
    expect(ok.res.status).toBe(200);
    expect(ok.res.body.user.lastSignInAt).toBe('2026-10-28T10:00:00.000Z');
    expect(w.log.entries.map((e) => e.summary)).toEqual([
      'Created the first Administrator account',
      'Failed sign-in for “hamza.mehmood”',
      'Signed in'
    ]);
  });

  it('locks a username after five failures within fifteen minutes', async () => {
    await setupAdmin(w);
    for (let i = 0; i < 5; i++) await login(w, 'hamza.mehmood', 'nope-nope');
    const sixth = await login(w, 'hamza.mehmood');
    expect(sixth.res.status).toBe(429);
    w.clock.advance(16 * 60 * 1000);
    expect((await login(w, 'hamza.mehmood')).res.status).toBe(200);
  });

  it('a signed-out cookie no longer works', async () => {
    const cookie = await setupAdmin(w);
    await request(w.app).post('/api/auth/logout').set('Cookie', cookie);
    expect((await request(w.app).get('/api/auth/me').set('Cookie', cookie)).body.user).toBeNull();
    expect((await request(w.app).get('/api/users').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('users and permissions (UAT A1, A2)', () => {
  let w: TestWorld;
  let admin: string;
  beforeEach(async () => {
    w = buildTestWorld();
    admin = await setupAdmin(w);
  });

  it('an Administrator adds Owais as Partner and sets an email; the log records both', async () => {
    const add = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Owais Ahmed', username: 'owais.ahmed', password: PW, role: 'Partner' });
    expect(add.status).toBe(200);
    expect(add.body.user).toMatchObject({ username: 'owais.ahmed', role: 'Partner', active: true });
    const edit = await request(w.app).patch(`/api/users/${add.body.user.id}`).set('Cookie', admin).send({ email: 'Owais@Firm.com' });
    expect(edit.body.user.email).toBe('owais@firm.com');
    const list = await request(w.app).get('/api/users').set('Cookie', admin);
    expect(list.body.users).toHaveLength(2);
    expect(w.log.entries.slice(-2).map((e) => e.summary)).toEqual([
      'Added Owais Ahmed (owais.ahmed) as Partner',
      'Set Owais Ahmed’s email address to owais@firm.com'
    ]);
  });

  it('refuses duplicates, short passwords and unknown roles with the old wording', async () => {
    const dup = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'A', username: 'hamza.mehmood', password: PW, role: 'Manager' });
    expect(dup.body.error.message).toBe('That username is already taken.');
    const short = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'A', username: 'a.b', password: 'short', role: 'Manager' });
    expect(short.body.error.message).toBe('Use at least 8 characters.');
    const role = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'A', username: 'a.b', password: PW, role: 'Janitor' });
    expect(role.body.error.message).toBe('Choose a role.');
  });

  it('a non-Administrator cannot manage users, and the last Administrator cannot be deactivated', async () => {
    await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Ali Awan', username: 'ali.awan', password: PW, role: 'Manager' });
    const ali = await login(w, 'ali.awan');
    expect((await request(w.app).get('/api/users').set('Cookie', ali.cookie)).status).toBe(403);
    expect((await request(w.app).get('/api/people').set('Cookie', ali.cookie)).body.people).toHaveLength(2);
    const adminId = (await request(w.app).get('/api/auth/me').set('Cookie', admin)).body.user.id;
    const off = await request(w.app).patch(`/api/users/${adminId}`).set('Cookie', admin).send({ active: false });
    expect(off.body.error.message).toBe('Keep at least one active Administrator.');
  });

  it('a password reset or role change ends that person’s sessions', async () => {
    const add = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Ali Awan', username: 'ali.awan', password: PW, role: 'Manager' });
    const ali = await login(w, 'ali.awan');
    await request(w.app).patch(`/api/users/${add.body.user.id}`).set('Cookie', admin).send({ password: 'another-one-1' });
    expect((await request(w.app).get('/api/auth/me').set('Cookie', ali.cookie)).body.user).toBeNull();
    expect((await login(w, 'ali.awan', 'another-one-1')).res.status).toBe(200);
  });

  it('the matrix can be edited and restored, a Preparer can never be given clearing rights, and changes are logged', async () => {
    const before = (await request(w.app).get('/api/permissions')).body.matrix;
    expect(before['points.clear']).toEqual(['Manager', 'Reviewer']);
    const changed = await request(w.app)
      .put('/api/permissions')
      .set('Cookie', admin)
      .send({ matrix: { ...before, 'points.clear': ['Manager', 'Preparer'], 'analysis.run': ['Manager'] } });
    expect(changed.body.matrix['points.clear']).toEqual(['Manager']);
    expect(changed.body.matrix['analysis.run']).toEqual(['Manager']);
    expect(w.log.entries.at(-1)).toMatchObject({
      summary: 'Updated the permission matrix',
      details: 'Removed Reviewer: Run the analysis and version pass · Removed Reviewer: Clear or reopen points they raised'
    });
    await request(w.app).put('/api/permissions').set('Cookie', admin).send({ matrix: before });
    expect((await request(w.app).get('/api/permissions')).body.matrix).toEqual(before);
  });

  it('the saved matrix applies to the next request without a restart', async () => {
    await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Rahat Kalim', username: 'rahat.kalim', password: PW, role: 'Reviewer' });
    const rahat = await login(w, 'rahat.kalim');
    const ocrBody = { pages: [{ png: Buffer.from('png').toString('base64') }] };
    expect((await request(w.app).post('/api/ocr').set('Cookie', rahat.cookie).send(ocrBody)).status).toBe(200);
    const m = (await request(w.app).get('/api/permissions')).body.matrix;
    await request(w.app)
      .put('/api/permissions')
      .set('Cookie', admin)
      .send({ matrix: { ...m, 'documents.attach': ['Manager'], 'analysis.run': ['Manager'] } });
    expect((await request(w.app).post('/api/ocr').set('Cookie', rahat.cookie).send(ocrBody)).status).toBe(403);
  });
});

describe('activity log', () => {
  it('any staff member records entries under their own identity; only Administrators read the whole log', async () => {
    const w = buildTestWorld();
    const admin = await setupAdmin(w);
    await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Muhammad Salman', username: 'muhammad.salman', password: PW, role: 'Preparer' });
    const ms = await login(w, 'muhammad.salman');
    const rec = await request(w.app)
      .post('/api/activity')
      .set('Cookie', ms.cookie)
      .send({ category: 'Documents', summary: 'Attached Trial Balance v1', engagementId: 'eng-1', fundName: 'ABC Fund' });
    expect(rec.body.entry.actor.username).toBe('muhammad.salman');
    expect((await request(w.app).get('/api/activity').set('Cookie', ms.cookie)).status).toBe(403);
    const fund = await request(w.app).get('/api/activity?engagementId=eng-1').set('Cookie', ms.cookie);
    expect(fund.body.entries.map((e: { summary: string }) => e.summary)).toEqual(['Attached Trial Balance v1']);
    const all = await request(w.app).get('/api/activity').set('Cookie', admin);
    expect(all.body.entries.length).toBeGreaterThan(3);
  });
});

describe('password reset by email (UAT L)', () => {
  it('always answers the same, emails a one-time link, and the link works once', async () => {
    const w = buildTestWorld();
    const admin = await setupAdmin(w);
    const add = await request(w.app)
      .post('/api/users')
      .set('Cookie', admin)
      .send({ name: 'Ali Awan', username: 'ali.awan', password: PW, role: 'Manager', email: 'ali@firm.com' });
    expect(add.status).toBe(200);
    const unknown = await request(w.app).post('/api/auth/forgot').send({ login: 'nobody@firm.com' });
    const known = await request(w.app).post('/api/auth/forgot').send({ login: 'ALI@firm.com' });
    expect(unknown.body).toEqual(known.body);
    expect(w.mailer.sent).toHaveLength(1);
    const token = /reset=([a-z0-9-]+)/i.exec(w.mailer.sent[0]!.text)![1]!;
    const bad = await request(w.app).post('/api/auth/reset').send({ token: 'wrong', password: 'new-password-1' });
    expect(bad.status).toBe(400);
    const ok = await request(w.app).post('/api/auth/reset').send({ token, password: 'new-password-1' });
    expect(ok.status).toBe(200);
    expect((await request(w.app).post('/api/auth/reset').send({ token, password: 'new-password-2' })).status).toBe(400);
    expect((await login(w, 'ali.awan', 'new-password-1')).res.status).toBe(200);
  });

  it('says reset is not set up when there is no mail server', async () => {
    const w = buildTestWorld({ mailConfigured: false });
    expect((await request(w.app).get('/api/auth/status')).body.resetAvailable).toBe(false);
    const res = await request(w.app).post('/api/auth/forgot').send({ login: 'x' });
    expect(res.status).toBe(503);
  });
});
