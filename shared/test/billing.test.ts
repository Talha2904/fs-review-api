import { describe, expect, it } from 'vitest';

import { applyBilling, BillingRuleError, EMPTY_BILLING, invoiceStatus, totals, type AiUsage, type BillingState } from '../src/billing.js';

let n = 0;
const ctx = (usage: AiUsage[] = [], now = '2026-10-28T10:00:00.000Z') => ({
  user: { id: 'f1', name: 'Ibrahim Moola' },
  usage,
  now,
  uid: () => 'id-' + ++n
});
const signedOff = (state: BillingState = EMPTY_BILLING) =>
  applyBilling(
    state,
    {
      type: 'signoff',
      event: { engagementId: 'e1', fundName: 'ABC Fund', clientName: 'ABC Funds ICAV', yearEnd: '2026-12-31', signedBy: 'Ali Awan' }
    },
    ctx()
  ).state;

describe('billing rules', () => {
  it('a signed-off fund can be drafted once, with a fee line and an AI line', () => {
    const s0 = applyBilling(signedOff(), { type: 'settings', settings: { defaultFee: 250000 } }, ctx()).state;
    const usage: AiUsage[] = [
      { id: 'u1', at: '2026-10-01T00:00:00Z', engagementId: 'e1', model: 'claude-sonnet-5-5', input: 1_000_000, output: 100_000 }
    ];
    const r = applyBilling(s0, { type: 'createDraft', engagementId: 'e1' }, ctx(usage));
    expect(r.invoice?.lines.map((l) => l.kind)).toEqual(['fee', 'ai']);
    expect(r.invoice?.lines[0]?.amount).toBe(250000);
    expect(r.invoice?.lines[1]?.unpriced).toBe(true); // no rates set yet
    expect(() => applyBilling(r.state, { type: 'createDraft', engagementId: 'e1' }, ctx(usage))).toThrow(BillingRuleError);
  });

  it('prices AI usage from the model rates and the exchange rate', () => {
    let s = signedOff();
    s = applyBilling(
      s,
      {
        type: 'settings',
        settings: { defaultFee: 100000, usdToGbp: 0.8, aiMarkupPct: 25, rates: { 'claude-sonnet-5-5': { in: 3, out: 15 } } }
      },
      ctx()
    ).state;
    const usage: AiUsage[] = [
      { id: 'u1', at: '2026-10-01T00:00:00Z', engagementId: 'e1', model: 'claude-sonnet-5-5', input: 1_000_000, output: 1_000_000 }
    ];
    const r = applyBilling(s, { type: 'createDraft', engagementId: 'e1' }, ctx(usage));
    const ai = r.invoice!.lines.find((l) => l.kind === 'ai')!;
    expect(ai.costAtCost).toBe(1440); // (3 + 15) USD × 0.8 = £14.40
    expect(ai.amount).toBe(1800); // plus 25 percent
  });

  it('issuing assigns a sequential number and a due date, and locks usage against double billing', () => {
    let s = applyBilling(signedOff(), { type: 'settings', settings: { defaultFee: 100000 } }, ctx()).state;
    const draft = applyBilling(s, { type: 'createDraft', engagementId: 'e1' }, ctx());
    const issued = applyBilling(draft.state, { type: 'issue', id: draft.invoice!.id }, ctx());
    expect(issued.invoice?.number).toBe('INV-2026-0001');
    expect(issued.invoice?.dueDate).toBe('2026-11-27T10:00:00.000Z');
    expect(totals(issued.invoice!).gross).toBe(120000);
    expect(invoiceStatus(issued.invoice!, '2026-11-01T00:00:00Z')).toBe('Issued');
    expect(invoiceStatus(issued.invoice!, '2026-12-01T00:00:00Z')).toBe('Overdue');
    s = issued.state;
    expect(() => applyBilling(s, { type: 'issue', id: draft.invoice!.id }, ctx())).toThrow(/already been issued/);
  });

  it('payments cannot exceed the outstanding balance and a period lock refuses dated actions', () => {
    let s = applyBilling(signedOff(), { type: 'settings', settings: { defaultFee: 100000 } }, ctx()).state;
    const d = applyBilling(s, { type: 'createDraft', engagementId: 'e1' }, ctx());
    s = applyBilling(d.state, { type: 'issue', id: d.invoice!.id }, ctx()).state;
    expect(() => applyBilling(s, { type: 'payment', id: d.invoice!.id, amount: 999999 }, ctx())).toThrow(/more than the/);
    s = applyBilling(s, { type: 'payment', id: d.invoice!.id, amount: 20000, reference: 'BACS' }, ctx()).state;
    expect(totals(s.invoices[0]!).outstanding).toBe(100000);
    s = applyBilling(s, { type: 'setLock', lockDate: '2026-10-28', reason: 'Month end closed' }, ctx()).state;
    expect(() => applyBilling(s, { type: 'payment', id: d.invoice!.id, amount: 100, date: '2026-10-28' }, ctx())).toThrow(/locked/);
  });

  it('a credit note splits out VAT and an unlock blocks new drafts', () => {
    let s = applyBilling(signedOff(), { type: 'settings', settings: { defaultFee: 100000 } }, ctx()).state;
    const d = applyBilling(s, { type: 'createDraft', engagementId: 'e1' }, ctx());
    s = applyBilling(d.state, { type: 'issue', id: d.invoice!.id }, ctx()).state;
    const cn = applyBilling(s, { type: 'creditNote', id: d.invoice!.id, amount: 120000, reason: 'Fee waived' }, ctx());
    expect(cn.invoice?.creditNotes?.[0]).toMatchObject({ number: 'CN-2026-0001', amount: 120000, vat: 20000, net: 100000 });
    expect(invoiceStatus(cn.invoice!)).toBe('Credited');
    s = applyBilling(cn.state, { type: 'unlock', event: { engagementId: 'e1', fundName: 'ABC Fund' } }, ctx()).state;
    expect(() => applyBilling(s, { type: 'createDraft', engagementId: 'e1' }, ctx())).toThrow(/unlocked/);
  });

  it('the period lock cannot be moved through settings, and payment dates must be real dates', () => {
    let st = applyBilling(EMPTY_BILLING, { type: 'setLock', lockDate: '2026-06-30', reason: 'June closed' }, ctx()).state;
    st = applyBilling(st, { type: 'settings', settings: { lockDate: null, fxDate: '2030-01-01', firmName: 'PA' } as never }, ctx()).state;
    expect(st.settings).toMatchObject({ lockDate: '2026-06-30', fxDate: null, firmName: 'PA' });
    st = applyBilling(st, { type: 'settings', settings: { defaultFee: 1000 } }, ctx()).state;
    st = applyBilling(st, { type: 'signoff', event: { engagementId: 'e1', fundName: 'F' } }, ctx()).state;
    const d = applyBilling(st, { type: 'createDraft', engagementId: 'e1' }, ctx());
    const issued = applyBilling(d.state, { type: 'issue', id: d.invoice!.id }, ctx()).state;
    expect(() => applyBilling(issued, { type: 'payment', id: d.invoice!.id, amount: 100, date: '2026-6-1' }, ctx())).toThrow(
      'Enter the payment date as a date.'
    );
    expect(() => applyBilling(issued, { type: 'payment', id: d.invoice!.id, amount: 100, date: '2026-06-01' }, ctx())).toThrow(/locked/);
    expect(() => applyBilling(d.state, { type: 'updateDraft', id: d.invoice!.id, vatRate: -5 }, ctx())).toThrow(
      'The VAT rate must be between 0 and 100 percent.'
    );
  });
});
