import { Prisma } from '@prisma/client';

import { DEFAULT_BILLING, EMPTY_BILLING, totals, type BillingState, type Invoice, type SignoffEvent } from '@fs-review/shared';

import type { BillingRepository } from '../../../application/ports/BillingRepository.js';
import type { Db } from '../prisma.js';

const SETTINGS_ROW = 1;
const MAX_ATTEMPTS = 6;
// JSON columns are written whole; the reducer types have no index signature, so they go through JSON once.
const plain = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));
const plainOrNull = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => (v == null ? Prisma.DbNull : plain(v));
const date = (iso: string | undefined | null): Date | null => (iso ? new Date(iso) : null);

type Tx = Prisma.TransactionClient;

/**
 * Billing on tables. The shared reducer works on one state object { settings, events, invoices, seq,
 * creditSeq }; this adapter composes it from the settings, events, invoices and sequences tables and
 * writes it back. Every change runs as read, reduce and write inside one serializable transaction, retried
 * when two changes collide, so concurrent Finance users cannot overwrite each other or reuse a number.
 * Money movements are also recorded as insert-only transaction rows for reporting. An installation that
 * still has the Phase 1 single-row document reads it until the first change, which moves it to the tables.
 */
export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<BillingState> {
    return compose(this.db);
  }

  async update<T>(change: (state: BillingState) => { state: BillingState; result: T }, updatedBy: string, at: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const { state, result } = change(await compose(tx));
            await write(tx, state, updatedBy, new Date(at));
            return result;
          },
          { isolationLevel: 'Serializable', timeout: 20_000 }
        );
      } catch (e) {
        const code = (e as { code?: string }).code;
        // P2034: the database detected a conflicting transaction; P2002: a unique number taken meanwhile
        if ((code === 'P2034' || code === 'P2002') && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }
}

async function compose(tx: Tx | Db): Promise<BillingState> {
  const settingsRow = await tx.billingSettings.findUnique({ where: { id: SETTINGS_ROW } });
  if (!settingsRow) {
    const legacy = await tx.billingState.findUnique({ where: { id: 1 } });
    if (legacy) {
      const s = legacy.state as unknown as Partial<BillingState>;
      return { ...EMPTY_BILLING, ...s, settings: { ...DEFAULT_BILLING, ...(s.settings || {}) } };
    }
  }
  const events = await tx.billingEvent.findMany();
  const invoices = await tx.invoice.findMany({ orderBy: { createdAt: 'asc' } });
  const sequences = await tx.billingSequence.findMany();
  const seq = Object.fromEntries(sequences.map((s) => [s.name, s.value]));
  return {
    settings: { ...DEFAULT_BILLING, ...((settingsRow?.settings as Partial<BillingState['settings']>) || {}) },
    events: Object.fromEntries(events.map((e) => [e.engagementId, e.payload as unknown as SignoffEvent])),
    invoices: invoices.map((i) => i.data as unknown as Invoice),
    seq: seq['invoice'] ?? 0,
    creditSeq: seq['credit'] ?? 0
  };
}

async function write(tx: Tx, state: BillingState, updatedBy: string, now: Date): Promise<void> {
  const existing = await tx.invoice.findMany({ select: { id: true } });
  const keep = new Set(state.invoices.map((i) => i.id));
  const gone = existing.filter((i) => !keep.has(i.id)).map((i) => i.id); // discarded drafts
  const knownTx = new Set((await tx.invoiceTransaction.findMany({ select: { id: true } })).map((t) => t.id));

  await tx.billingSettings.upsert({
    where: { id: SETTINGS_ROW },
    create: { id: SETTINGS_ROW, settings: plain(state.settings), updatedBy, updatedAt: now },
    update: { settings: plain(state.settings), updatedBy, updatedAt: now }
  });
  for (const [engagementId, ev] of Object.entries(state.events)) {
    const data = {
      state: ev.state ?? 'signed',
      fundName: ev.fundName ?? '',
      clientName: ev.clientName ?? ev.entityName ?? '',
      payload: plain(ev),
      at: date(ev.at) ?? now,
      updatedAt: now
    };
    await tx.billingEvent.upsert({ where: { engagementId }, create: { engagementId, ...data }, update: data });
  }
  if (gone.length) {
    await tx.invoiceTransaction.deleteMany({ where: { invoiceId: { in: gone } } });
    await tx.invoice.deleteMany({ where: { id: { in: gone } } });
  }
  for (const inv of state.invoices) {
    const data = {
      number: inv.number ?? null,
      engagementId: inv.engagementId,
      status: inv.status,
      kind: inv.kind,
      clientName: inv.clientName,
      fundName: inv.fundName,
      issuedAt: date(inv.issuedAt),
      dueDate: date(inv.dueDate),
      grossPence: totals(inv).gross,
      data: plain(inv),
      updatedAt: now
    };
    await tx.invoice.upsert({
      where: { id: inv.id },
      create: { id: inv.id, createdAt: date(inv.createdAt) ?? now, ...data },
      update: data
    });
  }
  for (const t of state.invoices.flatMap((inv) => transactionsOf(inv).filter((x) => !knownTx.has(x.id))))
    await tx.invoiceTransaction.create({ data: t });
  for (const [name, value] of [
    ['invoice', state.seq],
    ['credit', state.creditSeq]
  ] as const)
    await tx.billingSequence.upsert({ where: { name }, create: { name, value }, update: { value } });
}

/** The money movements an invoice document records, as transaction rows. Ids come from the reducer, so they are stable. */
function transactionsOf(inv: Invoice) {
  const rows = [
    ...(inv.payments || []).map((p) => ({
      id: p.id,
      invoiceId: inv.id,
      kind: 'payment',
      amount: p.amount,
      number: null as string | null,
      reason: '',
      reference: p.reference || '',
      by: plainOrNull(p.by),
      at: new Date(p.at)
    })),
    ...(inv.writeOffs || []).map((w) => ({
      id: w.id,
      invoiceId: inv.id,
      kind: 'writeoff',
      amount: w.amount,
      number: null as string | null,
      reason: w.reason || '',
      reference: '',
      by: plainOrNull(w.by),
      at: new Date(w.at)
    })),
    ...(inv.creditNotes || []).map((c) => ({
      id: c.id,
      invoiceId: inv.id,
      kind: 'credit',
      amount: c.amount,
      number: c.number,
      reason: c.reason || '',
      reference: '',
      by: plainOrNull(c.by),
      at: new Date(c.at)
    }))
  ];
  if (inv.status === 'cancelled' && inv.creditNote && inv.cancelledAt)
    rows.push({
      id: `${inv.id}:cancel`,
      invoiceId: inv.id,
      kind: 'cancel',
      amount: totals(inv).gross,
      number: inv.creditNote,
      reason: inv.cancelReason || '',
      reference: '',
      by: plainOrNull(inv.cancelledBy),
      at: new Date(inv.cancelledAt)
    });
  return rows;
}
