// Runs against a real Postgres when DATABASE_URL_TEST is set (CI, or a local `fsreview_test` database with
// the migrations applied). Everything it writes is removed again. Skipped otherwise.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyBilling, EMPTY_BILLING, type AiUsage } from '@fs-review/shared';

import { createDb, type Db } from '../../src/infrastructure/db/prisma.js';
import { PrismaBillingRepository } from '../../src/infrastructure/db/repositories/PrismaBillingRepository.js';

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('PrismaBillingRepository (Postgres)', () => {
  let db: Db;
  let repo: PrismaBillingRepository;
  const user = { id: 'f1', name: 'Ibrahim Moola' };
  let n = 0;
  const ctx = (usage: AiUsage[] = [], now = '2026-10-28T10:00:00.000Z') => ({
    user,
    usage,
    now,
    uid: () => `t-${Date.now().toString(36)}-${++n}`
  });
  const wipe = async () => {
    await db.invoiceTransaction.deleteMany();
    await db.invoice.deleteMany();
    await db.billingEvent.deleteMany();
    await db.billingSequence.deleteMany();
    await db.billingSettings.deleteMany();
    await db.billingState.deleteMany();
  };

  beforeAll(() => {
    db = createDb(url!);
    repo = new PrismaBillingRepository(db);
  });
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('starts empty, then round-trips settings, events, invoices and sequences through the tables', async () => {
    expect(await repo.get()).toEqual(EMPTY_BILLING);
    let state = applyBilling(
      EMPTY_BILLING,
      { type: 'settings', settings: { firmName: 'Project Accountants', defaultFee: 250000 } },
      ctx()
    ).state;
    state = applyBilling(
      state,
      {
        type: 'signoff',
        event: { engagementId: 'eng-1', fundName: 'ABC Fund', clientName: 'ABC Funds ICAV', yearEnd: '2026-12-31', signedBy: 'Ali Awan' }
      },
      ctx()
    ).state;
    const draft = applyBilling(state, { type: 'createDraft', engagementId: 'eng-1' }, ctx());
    state = applyBilling(draft.state, { type: 'issue', id: draft.invoice!.id }, ctx()).state;
    state = applyBilling(state, { type: 'payment', id: draft.invoice!.id, amount: 100000, reference: 'BACS 1' }, ctx()).state;
    await repo.update(() => ({ state: state, result: undefined }), 'f1', '2026-10-28T10:05:00.000Z');

    const back = await repo.get();
    expect(back.settings.firmName).toBe('Project Accountants');
    expect(back.events['eng-1']).toMatchObject({ state: 'signed', fundName: 'ABC Fund' });
    expect(back.invoices).toHaveLength(1);
    expect(back.invoices[0]).toMatchObject({
      number: 'INV-2026-0001',
      status: 'issued',
      payments: [{ amount: 100000, reference: 'BACS 1' }]
    });
    expect(back.seq).toBe(1);
    expect(back.creditSeq).toBe(0);

    const rows = await db.invoice.findMany();
    expect(rows[0]).toMatchObject({ number: 'INV-2026-0001', status: 'issued', clientName: 'ABC Funds ICAV', grossPence: 300000 });
    expect(await db.invoiceTransaction.findMany()).toHaveLength(1);
    expect(await db.billingSequence.findMany()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'invoice', value: 1 })]));
  });

  it('a discarded draft disappears, a credit note adds a transaction row once, and saves are idempotent', async () => {
    let state = applyBilling(EMPTY_BILLING, { type: 'settings', settings: { defaultFee: 100000 } }, ctx()).state;
    state = applyBilling(state, { type: 'signoff', event: { engagementId: 'eng-1', fundName: 'ABC Fund' } }, ctx()).state;
    const d1 = applyBilling(state, { type: 'createDraft', engagementId: 'eng-1' }, ctx());
    await repo.update(() => ({ state: d1.state, result: undefined }), 'f1', '2026-10-28T10:00:00.000Z');
    expect(await db.invoice.count()).toBe(1);
    state = applyBilling(d1.state, { type: 'cancel', id: d1.invoice!.id, reason: 'Started again' }, ctx()).state; // discards the draft
    await repo.update(() => ({ state: state, result: undefined }), 'f1', '2026-10-28T10:01:00.000Z');
    expect(await db.invoice.count()).toBe(0);

    const d2 = applyBilling(state, { type: 'createDraft', engagementId: 'eng-1' }, ctx());
    state = applyBilling(d2.state, { type: 'issue', id: d2.invoice!.id }, ctx()).state;
    state = applyBilling(state, { type: 'creditNote', id: d2.invoice!.id, amount: 60000, reason: 'Goodwill credit' }, ctx()).state;
    await repo.update(() => ({ state: state, result: undefined }), 'f1', '2026-10-28T10:02:00.000Z');
    await repo.update(() => ({ state: state, result: undefined }), 'f1', '2026-10-28T10:03:00.000Z');
    const tx = await db.invoiceTransaction.findMany();
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ kind: 'credit', amount: 60000, number: 'CN-2026-0001', reason: 'Goodwill credit' });
    expect((await repo.get()).creditSeq).toBe(1);
  });

  it('reads a Phase 1 single-row document until the first change, which moves it to the tables', async () => {
    const legacyState = applyBilling(
      EMPTY_BILLING,
      { type: 'signoff', event: { engagementId: 'eng-9', fundName: 'Old Fund' } },
      ctx()
    ).state;
    await db.billingState.create({
      data: { id: 1, state: JSON.parse(JSON.stringify(legacyState)), updatedBy: 'old', updatedAt: new Date('2026-01-01T00:00:00Z') }
    });
    expect((await repo.get()).events['eng-9']).toMatchObject({ fundName: 'Old Fund' });
    expect(await db.billingSettings.count()).toBe(0); // a read never writes
    await repo.update(
      (st) => ({ state: applyBilling(st, { type: 'settings', settings: { defaultFee: 1 } }, ctx()).state, result: undefined }),
      'f1',
      '2026-10-28T10:00:00.000Z'
    );
    expect(await db.billingSettings.count()).toBe(1);
    expect(await db.billingEvent.count()).toBe(1);
  });

  it('two changes at the same moment both land, and invoice numbers are never reused', async () => {
    let state = applyBilling(EMPTY_BILLING, { type: 'settings', settings: { defaultFee: 100000 } }, ctx()).state;
    for (const id of ['eng-1', 'eng-2'])
      state = applyBilling(state, { type: 'signoff', event: { engagementId: id, fundName: id } }, ctx()).state;
    for (const id of ['eng-1', 'eng-2']) state = applyBilling(state, { type: 'createDraft', engagementId: id }, ctx()).state;
    await repo.update(() => ({ state, result: undefined }), 'f1', '2026-10-28T10:00:00.000Z');
    const [d1, d2] = state.invoices;
    const issue = (id: string) =>
      repo.update(
        (st) => ({ state: applyBilling(st, { type: 'issue', id }, ctx()).state, result: undefined }),
        'f1',
        '2026-10-28T10:01:00.000Z'
      );
    await Promise.all([issue(d1!.id), issue(d2!.id)]);
    const numbers = (await repo.get()).invoices.map((i) => i.number).sort();
    expect(numbers).toEqual(['INV-2026-0001', 'INV-2026-0002']);
    expect((await repo.get()).seq).toBe(2);
  });
});
