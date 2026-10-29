import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { actorOf } from '../../src/domain/identity/User.js';
import { buildTestWorld, cookieOf, type TestWorld } from '../helpers/fakes.js';

const PW = 'longenough1';

async function world() {
  const w = buildTestWorld();
  const admin = cookieOf(
    await request(w.app).post('/api/auth/setup').send({ name: 'Hamza Mehmood', username: 'hamza.mehmood', password: PW })
  );
  for (const [name, username, role] of [
    ['Ali Awan', 'ali.awan', 'Manager'],
    ['Ibrahim Moola', 'ibrahim.moola', 'Finance'],
    ['Rahat Kalim', 'rahat.kalim', 'Reviewer']
  ])
    await request(w.app).post('/api/users').set('Cookie', admin).send({ name, username, password: PW, role });
  const as = async (u: string) => cookieOf(await request(w.app).post('/api/auth/login').send({ username: u, password: PW }));
  return { w, admin, manager: await as('ali.awan'), finance: await as('ibrahim.moola'), reviewer: await as('rahat.kalim') };
}
const event = {
  engagementId: 'eng-1',
  fundName: 'ABC Fund',
  clientName: 'ABC Funds ICAV',
  yearEnd: '2026-12-31',
  signedBy: 'Ali Awan',
  billingEmail: 'accounts@abc.test'
};

/** The event the Manager's final sign-off writes (SetSignoff applies it on the server; there is no client route). */
const signedOff = async (w: TestWorld) =>
  w.billingActions.apply(actorOf((await w.users.findByUsername('ali.awan'))!), { type: 'signoff', event });

describe('billing (UAT K)', () => {
  it('only Finance reads billing; sign-off events come only from a sign-off on the server', async () => {
    const { w, manager, finance, reviewer } = await world();
    expect((await request(w.app).get('/api/billing').set('Cookie', manager)).status).toBe(403);
    expect((await request(w.app).get('/api/billing').set('Cookie', finance)).body.state.invoices).toEqual([]);
    // no client can post a sign-off event (it would make a fund "ready to invoice" without a sign-off)
    for (const cookie of [manager, reviewer, finance])
      expect(
        (
          await request(w.app)
            .post('/api/billing/event')
            .set('Cookie', cookie)
            .send({ action: { type: 'signoff', event } })
        ).status
      ).toBe(404);
    // nor can Finance post one through its own billing actions
    expect(
      (
        await request(w.app)
          .post('/api/billing')
          .set('Cookie', finance)
          .send({ action: { type: 'signoff', event } })
      ).status
    ).toBe(403);
    await signedOff(w);
    expect((await request(w.app).get('/api/billing').set('Cookie', finance)).body.state.events['eng-1'].state).toBe('signed');
  });

  it('from sign-off to an issued invoice with AI usage priced, then a payment and the period lock', async () => {
    const { w, finance } = await world();
    // one AI call recorded against the fund, as the api logs them
    await w.uc.activity.record({
      actor: null,
      category: 'AI',
      summary: 'AI: Reading real documents',
      engagementId: 'eng-1',
      fundName: 'ABC Fund',
      usage: { step: 'extract', model: 'claude-sonnet-5-5', input: 1_000_000, output: 1_000_000 }
    });
    await signedOff(w);

    const act = (action: unknown) => request(w.app).post('/api/billing').set('Cookie', finance).send({ action });
    await act({
      type: 'settings',
      settings: {
        firmName: 'Project Accountants',
        defaultFee: 250000,
        usdToGbp: 0.8,
        aiMarkupPct: 25,
        rates: { 'claude-sonnet-5-5': { in: 3, out: 15 } }
      }
    });
    const draft = await act({ type: 'createDraft', engagementId: 'eng-1' });
    expect(draft.status).toBe(200);
    const inv = draft.body.state.invoices[0];
    expect(inv.lines.map((l: { kind: string; amount: number }) => [l.kind, l.amount])).toEqual([
      ['fee', 250000],
      ['ai', 1800]
    ]);
    expect(draft.body.usage).toHaveLength(1);

    const issued = await act({ type: 'issue', id: inv.id });
    expect(issued.body.state.invoices[0]).toMatchObject({ status: 'issued', number: 'INV-2026-0001' });
    expect(w.log.entries.at(-1)).toMatchObject({
      category: 'Billing',
      summary: 'Issued invoice INV-2026-0001 for ABC Fund',
      details: '£3,021.60',
      engagementId: 'eng-1'
    });

    const tooMuch = await act({ type: 'payment', id: inv.id, amount: 999_999_99 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/more than the £3,021.60 outstanding/);
    expect((await act({ type: 'payment', id: inv.id, amount: 100000, reference: 'BACS 1' })).status).toBe(200);

    await act({ type: 'setLock', lockDate: '2026-10-28', reason: 'October closed' });
    const locked = await act({ type: 'payment', id: inv.id, amount: 100, date: '2026-10-28' });
    expect(locked.body.error.message).toMatch(/locked/);
  });

  it('a second draft for the same fund after issue is supplementary and never re-bills usage', async () => {
    const { w, finance } = await world();
    await signedOff(w);
    const act = (action: unknown) => request(w.app).post('/api/billing').set('Cookie', finance).send({ action });
    await act({ type: 'settings', settings: { defaultFee: 100000 } });
    const d1 = await act({ type: 'createDraft', engagementId: 'eng-1' });
    await act({ type: 'issue', id: d1.body.state.invoices[0].id });
    const d2 = await act({ type: 'createDraft', engagementId: 'eng-1' });
    expect(d2.status).toBe(200);
    const supp = d2.body.state.invoices[1];
    expect(supp).toMatchObject({ kind: 'supplementary', lines: [] }); // no fee again and no new usage to bill
    const issue = await act({ type: 'issue', id: supp.id });
    expect(issue.body.error.message).toBe('An invoice must be for more than £0.00.');
  });

  it('emails an issued invoice to a valid address and records it', async () => {
    const { w, finance } = await world();
    await signedOff(w);
    const act = (action: unknown) => request(w.app).post('/api/billing').set('Cookie', finance).send({ action });
    await act({ type: 'settings', settings: { defaultFee: 100000 } });
    const d = await act({ type: 'createDraft', engagementId: 'eng-1' });
    const id = d.body.state.invoices[0].id;
    const draftMail = await request(w.app)
      .post('/api/billing/email')
      .set('Cookie', finance)
      .send({ invoiceId: id, to: 'a@b.test', pdf: 'JVBERi0=' });
    expect(draftMail.body.error.message).toBe('Only an issued invoice can be emailed.');
    await act({ type: 'issue', id });
    const bad = await request(w.app)
      .post('/api/billing/email')
      .set('Cookie', finance)
      .send({ invoiceId: id, to: 'not-an-email', pdf: 'JVBERi0=' });
    expect(bad.body.error.message).toBe('Enter a valid email address.');
    const ok = await request(w.app)
      .post('/api/billing/email')
      .set('Cookie', finance)
      .send({ invoiceId: id, to: 'accounts@abc.test', subject: 'Invoice', message: 'Attached', pdf: 'JVBERi0=' });
    expect(ok.status).toBe(200);
    expect(w.mailer.sent[0]).toMatchObject({
      to: 'accounts@abc.test',
      attachments: [{ filename: 'INV-2026-0001.pdf', contentType: 'application/pdf' }]
    });
    expect(ok.body.state.invoices[0].emails).toHaveLength(1);
  });

  it('updates the exchange rate and reports integrations', async () => {
    const { w, finance } = await world();
    const fx = await request(w.app).post('/api/billing/fx-refresh').set('Cookie', finance);
    expect(fx.body.state.settings).toMatchObject({ usdToGbp: 0.8, fxDate: '2026-10-28', fxSource: 'test' });
    const integ = await request(w.app).get('/api/billing/integrations').set('Cookie', finance);
    expect(integ.body).toEqual({
      email: { configured: true, from: 'test@example.com' },
      fx: { auto: false },
      xero: { configured: true, connected: false, tenantName: '' }
    });
  });

  it('connects Xero through the callback and posts an issued invoice', async () => {
    const { w, finance } = await world();
    const start = await request(w.app).get('/api/xero/connect').set('Cookie', finance);
    const state = new URL(start.body.url).searchParams.get('state')!;
    expect((await request(w.app).get('/api/xero/callback?state=wrong&code=c')).status).toBe(502);
    const cb = await request(w.app).get(`/api/xero/callback?state=${state}&code=c`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/?xero=connected');
    expect((await request(w.app).get('/api/billing/integrations').set('Cookie', finance)).body.xero).toMatchObject({
      connected: true,
      tenantName: 'Demo Company'
    });

    await signedOff(w);
    const act = (action: unknown) => request(w.app).post('/api/billing').set('Cookie', finance).send({ action });
    await act({ type: 'settings', settings: { defaultFee: 100000 } });
    const d = await act({ type: 'createDraft', engagementId: 'eng-1' });
    const id = d.body.state.invoices[0].id;
    await act({ type: 'issue', id });
    const sent = await request(w.app).post('/api/xero/invoice').set('Cookie', finance).send({ invoiceId: id });
    expect(sent.status).toBe(200);
    expect(sent.body.xero).toMatchObject({ invoiceId: 'xero-1', ours: 1200 });
    expect(w.xero.created[0]).toMatchObject({ Type: 'ACCREC', InvoiceNumber: 'INV-2026-0001', Contact: { Name: 'ABC Funds ICAV' } });
    expect((await request(w.app).post('/api/xero/invoice').set('Cookie', finance).send({ invoiceId: id })).body.error.message).toBe(
      'This invoice is already in Xero.'
    );
    await request(w.app).post('/api/xero/disconnect').set('Cookie', finance);
    expect((await request(w.app).get('/api/billing/integrations').set('Cookie', finance)).body.xero.connected).toBe(false);
  });
});
