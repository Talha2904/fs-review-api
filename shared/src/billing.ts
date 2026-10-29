// Billing: one set of rules used by the api and the web app's screens.
// State: { settings, events: { [engagementId]: signOffEvent }, invoices: [invoice], seq, creditSeq }
// Every change goes through applyBilling(state, action, ctx), which validates it and returns the new
// state plus a short description for the activity log. Amounts are in pence (integers); screens divide by 100.

export interface BillingSettings {
  firmName: string;
  firmAddress: string;
  vatNumber: string;
  currency: string;
  invoicePrefix: string;
  paymentTermsDays: number;
  vatRate: number;
  /** pence; the professional fee suggested on a new invoice */
  defaultFee: number;
  /** AI prices are in US dollars; Finance sets the conversion rate */
  usdToGbp: number | null;
  /** recharge AI cost at cost plus this percentage */
  aiMarkupPct: number;
  /** { modelId: { in: USD per million input tokens, out: USD per million output tokens } } */
  rates: Record<string, { in: number; out: number }>;
  fxDate: string | null;
  fxSource: string;
  /** ISO date: nothing can be issued, paid, credited or written off on or before it */
  lockDate: string | null;
  emailSubject: string;
  emailMessage: string;
  /** taxType for invoices with VAT; zeroTaxType (default ZERORATEDOUTPUT) for invoices at 0% VAT */
  xero: { accountCode: string; taxType: string; zeroTaxType?: string };
}

/** The settings the Billing Settings screen edits through the settings action. */
const EDITABLE_SETTINGS = [
  'firmName',
  'firmAddress',
  'vatNumber',
  'currency',
  'invoicePrefix',
  'paymentTermsDays',
  'vatRate',
  'defaultFee',
  'usdToGbp',
  'aiMarkupPct',
  'rates',
  'emailSubject',
  'emailMessage',
  'xero'
] as const;
const isIsoDay = (v: unknown): boolean =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

export const DEFAULT_BILLING: BillingSettings = {
  firmName: '',
  firmAddress: '',
  vatNumber: '',
  currency: 'GBP',
  invoicePrefix: 'INV-',
  paymentTermsDays: 30,
  vatRate: 20,
  defaultFee: 0,
  usdToGbp: null,
  aiMarkupPct: 0,
  rates: {},
  fxDate: null,
  fxSource: '',
  lockDate: null,
  emailSubject: 'Invoice {number} from {firm}',
  emailMessage: 'Please find attached invoice {number} for {fund}, due on {due}.',
  xero: { accountCode: '200', taxType: 'OUTPUT2' }
};

export interface Person {
  id: string;
  name: string;
}
export interface AiUsage {
  id: string;
  at: string;
  engagementId: string;
  fundName?: string;
  model: string;
  input: number;
  output: number;
  step?: string;
}
export interface SignoffEvent {
  engagementId: string;
  fundName: string;
  entityName?: string;
  clientName?: string;
  billingEmail?: string;
  yearEnd?: string;
  yearEndLabel?: string;
  signedBy?: string;
  signedAt?: string;
  state?: 'signed' | 'unlocked';
  at?: string;
  history?: { state: string; by: Person | null; at: string }[];
}
export interface InvoiceLine {
  id: string;
  kind: 'fee' | 'ai' | 'other';
  description: string;
  amount: number;
  adjustReason?: string;
  costAtCost?: number;
  markupPct?: number;
  unpriced?: boolean;
  usageCount?: number;
  calcAmount?: number;
}
export interface HistoryItem {
  what: string;
  by: Person | null;
  at: string;
}
export interface Invoice {
  id: string;
  status: 'draft' | 'issued' | 'cancelled';
  kind: 'standard' | 'supplementary';
  engagementId: string;
  fundName: string;
  entityName?: string;
  clientName: string;
  email: string;
  yearEnd?: string;
  signedBy?: string;
  signedAt?: string;
  lines: InvoiceLine[];
  usageIds: string[];
  vatRate: number;
  termsDays: number;
  notes: string;
  createdBy: Person | null;
  createdAt: string;
  payments: { id: string; amount: number; date: string; reference: string; by: Person | null; at: string }[];
  writeOffs: { id: string; amount: number; reason: string; by: Person | null; at: string }[];
  creditNotes?: { id: string; number: string; amount: number; net: number; vat: number; reason: string; by: Person | null; at: string }[];
  history: HistoryItem[];
  number?: string;
  issuedAt?: string;
  issuedBy?: Person | null;
  dueDate?: string;
  settingsAtIssue?: { firmName: string; firmAddress: string; vatNumber: string };
  creditNote?: string;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: Person | null;
  emails?: { to: string; at: string; by: Person | null }[];
  xero?: { invoiceId: string; status: string; at: string };
}
export interface BillingState {
  settings: BillingSettings;
  events: Record<string, SignoffEvent>;
  invoices: Invoice[];
  seq: number;
  creditSeq: number;
}
export const EMPTY_BILLING: BillingState = { settings: DEFAULT_BILLING, events: {}, invoices: [], seq: 0, creditSeq: 0 };

export type BillingAction =
  | { type: 'settings'; settings: Omit<Partial<BillingSettings>, 'usdToGbp'> & { usdToGbp?: number | string | null } }
  | { type: 'signoff' | 'unlock'; event: SignoffEvent }
  | { type: 'createDraft'; engagementId: string }
  | { type: 'updateDraft'; id: string; lines?: InvoiceLine[]; vatRate?: number; termsDays?: number; notes?: string }
  | { type: 'refreshAi'; id: string }
  | { type: 'issue'; id: string }
  | { type: 'payment'; id: string; amount: number; date?: string; reference?: string }
  | { type: 'writeOff'; id: string; amount: number; reason: string }
  | { type: 'cancel'; id: string; reason: string }
  | { type: 'creditNote'; id: string; amount: number; reason: string }
  | { type: 'setLock'; lockDate: string | null; reason: string }
  | { type: 'fxUpdate'; rate: number; date?: string; source?: string }
  | { type: 'emailed'; id: string; to: string }
  | { type: 'xeroSynced'; id: string; xeroInvoiceId: string; status?: string };
export type BillingActionType = BillingAction['type'];

export interface BillingContext {
  user: Person | null;
  usage: AiUsage[];
  now: string;
  /** id maker; defaults to crypto.randomUUID */
  uid?: () => string;
}
export interface BillingResult {
  state: BillingState;
  log: string;
  details?: string;
  engagement?: SignoffEvent;
  invoice?: Invoice;
}

export class BillingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingRuleError';
  }
}

const defaultUid = (): string =>
  globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
const day = (iso: string): string => iso.slice(0, 10);
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString();
};
const bad = (msg: string): never => {
  throw new BillingRuleError(msg);
};
export const money = (p: number): string =>
  '£' + ((p || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- AI usage and its cost ----------------------------------------------------------------
export function rateFor(settings: BillingSettings, model: string): { in: number; out: number } | null {
  const key = Object.keys(settings.rates || {}).find((k) => model === k || String(model || '').startsWith(k));
  const r = key ? settings.rates[key] : null;
  return r && (Number(r.in) > 0 || Number(r.out) > 0) ? r : null;
}
/** Cost of one call in pence, or null when its model has no rate or no exchange rate is set. */
export function usageCost(settings: BillingSettings, u: AiUsage): number | null {
  const r = rateFor(settings, u.model);
  if (!r || !(Number(settings.usdToGbp) > 0)) return null;
  const usd = (u.input / 1e6) * Number(r.in) + (u.output / 1e6) * Number(r.out);
  return Math.round(usd * Number(settings.usdToGbp) * 100);
}
/** Usage for a fund that is not on an issued invoice, nor already on another draft. */
export function unbilledUsage(
  state: BillingState,
  usage: AiUsage[],
  engagementId: string,
  exceptInvoiceId: string | null = null
): AiUsage[] {
  const taken = new Set(
    state.invoices.filter((i) => i.id !== exceptInvoiceId && ['draft', 'issued'].includes(i.status)).flatMap((i) => i.usageIds || [])
  );
  return usage.filter((u) => u.engagementId === engagementId && !taken.has(u.id));
}
export function aiSummary(settings: BillingSettings, list: AiUsage[]) {
  const priced = list.map((u) => usageCost(settings, u));
  const missing = priced.some((c) => c === null);
  const cost = priced.reduce<number>((a, c) => a + (c || 0), 0);
  const charge = Math.round(cost * (1 + Number(settings.aiMarkupPct || 0) / 100));
  return {
    calls: list.length,
    input: list.reduce((a, u) => a + u.input, 0),
    output: list.reduce((a, u) => a + u.output, 0),
    cost,
    charge,
    missing,
    models: [...new Set(list.map((u) => u.model))]
  };
}
const aiLine = (settings: BillingSettings, list: AiUsage[], uid: () => string): InvoiceLine => {
  const s = aiSummary(settings, list);
  return {
    id: uid(),
    kind: 'ai',
    description: `AI-assisted review: ${s.calls} AI call${s.calls === 1 ? '' : 's'} (${s.input.toLocaleString('en-GB')} input and ${s.output.toLocaleString('en-GB')} output tokens)`,
    amount: s.missing ? 0 : s.charge,
    costAtCost: s.cost,
    markupPct: Number(settings.aiMarkupPct || 0),
    unpriced: s.missing,
    usageCount: s.calls,
    adjustReason: ''
  };
};

// ---- totals and status -------------------------------------------------------------------
export function totals(inv: Invoice) {
  const net = inv.lines.reduce((a, l) => a + Math.round(Number(l.amount) || 0), 0);
  const vat = Math.round((net * Number(inv.vatRate || 0)) / 100);
  const gross = net + vat;
  const paid = (inv.payments || []).reduce((a, p) => a + p.amount, 0);
  const writtenOff = (inv.writeOffs || []).reduce((a, w) => a + w.amount, 0);
  const credited = (inv.creditNotes || []).reduce((a, c) => a + c.amount, 0);
  return {
    net,
    vat,
    gross,
    paid,
    writtenOff,
    credited,
    outstanding: inv.status === 'issued' ? Math.max(0, gross - paid - writtenOff - credited) : 0
  };
}
export function invoiceStatus(inv: Invoice, today: string = new Date().toISOString()): string {
  if (inv.status === 'draft') return 'Draft';
  if (inv.status === 'cancelled') return 'Cancelled';
  const t = totals(inv);
  if (t.outstanding === 0)
    return t.credited >= t.gross
      ? 'Credited'
      : t.writtenOff > 0 && t.paid < t.gross
        ? t.paid
          ? 'Paid (part written off)'
          : 'Written off'
        : t.paid
          ? 'Paid'
          : t.credited
            ? 'Credited'
            : 'Paid';
  if (day(inv.dueDate || today) < day(today)) return t.paid || t.credited ? 'Overdue (part settled)' : 'Overdue';
  return t.credited ? 'Part credited' : t.paid ? 'Part paid' : 'Issued';
}
export const daysOverdue = (inv: Invoice, today: string = new Date().toISOString()): number =>
  inv.status === 'issued' && totals(inv).outstanding > 0
    ? Math.max(0, Math.floor((new Date(day(today)).getTime() - new Date(day(inv.dueDate || today)).getTime()) / 864e5))
    : 0;

// ---- the actions ---------------------------------------------------------------------------
export function applyBilling(state: BillingState | null | undefined, action: BillingAction, ctx: BillingContext): BillingResult {
  const s: BillingState = { ...EMPTY_BILLING, ...(state || {}), settings: { ...DEFAULT_BILLING, ...(state?.settings || {}) } };
  const uid = ctx.uid || defaultUid;
  const now = ctx.now || new Date().toISOString();
  const by: Person | null = ctx.user ? { id: ctx.user.id, name: ctx.user.name } : null;
  const find = (id: string): Invoice => s.invoices.find((i) => i.id === id) || bad('That invoice no longer exists.');
  const replace = (inv: Invoice): Invoice[] => s.invoices.map((i) => (i.id === inv.id ? inv : i));
  const a = action;
  const lockedOn = (iso: string): boolean => !!s.settings.lockDate && day(iso) <= s.settings.lockDate;
  const guard = (iso: string, what: string): void => {
    if (lockedOn(iso)) bad(`The period up to ${s.settings.lockDate} is locked, so ${what} can’t be dated ${day(iso)}.`);
  };
  switch (a.type) {
    case 'settings': {
      // Only the settings a person edits on the Billing Settings screen. The period lock changes only through
      // setLock (with its reason and checks) and the rate's date and source only through fxUpdate.
      const x = Object.fromEntries(
        Object.entries(a.settings || {}).filter(([k]) => EDITABLE_SETTINGS.includes(k as (typeof EDITABLE_SETTINGS)[number]))
      ) as typeof a.settings;
      const usd = x.usdToGbp === '' || x.usdToGbp == null ? (x.usdToGbp === undefined ? s.settings.usdToGbp : null) : Number(x.usdToGbp);
      const settings: BillingSettings = {
        ...s.settings,
        ...(x as Partial<BillingSettings>),
        paymentTermsDays: Math.max(0, Math.round(Number(x.paymentTermsDays ?? s.settings.paymentTermsDays))),
        vatRate: Math.max(0, Number(x.vatRate ?? s.settings.vatRate)),
        aiMarkupPct: Number(x.aiMarkupPct ?? s.settings.aiMarkupPct),
        defaultFee: Math.max(0, Math.round(Number(x.defaultFee ?? s.settings.defaultFee))),
        usdToGbp: usd
      };
      if (settings.usdToGbp !== null && !(settings.usdToGbp > 0)) bad('The USD to GBP rate must be more than zero.');
      return { state: { ...s, settings }, log: 'Changed the billing settings' };
    }
    case 'signoff':
    case 'unlock': {
      const e = a.event || bad('No sign-off details were received.');
      const prev = s.events[e.engagementId] || { history: [] };
      const ev: SignoffEvent = {
        ...prev,
        ...e,
        state: a.type === 'signoff' ? 'signed' : 'unlocked',
        at: now,
        history: [...(prev.history || []), { state: a.type, by, at: now }]
      };
      return {
        state: { ...s, events: { ...s.events, [e.engagementId]: ev } },
        log: a.type === 'signoff' ? `Signed off ${e.fundName}: ready to invoice` : `${e.fundName} was unlocked after sign-off`,
        engagement: e
      };
    }
    case 'createDraft': {
      const ev = s.events[a.engagementId] || bad('That fund has not been signed off.');
      if (ev.state !== 'signed') bad('That fund was unlocked after sign-off. It can be invoiced once it is signed off again.');
      if (s.invoices.some((i) => i.engagementId === a.engagementId && i.status === 'draft'))
        bad('There is already a draft invoice for this fund.');
      const usage = unbilledUsage(s, ctx.usage || [], a.engagementId);
      const supplementary = s.invoices.some((i) => i.engagementId === a.engagementId && i.status === 'issued');
      const lines: InvoiceLine[] = [];
      if (!supplementary)
        lines.push({
          id: uid(),
          kind: 'fee',
          description: `Financial statement review: ${ev.fundName}, year ended ${ev.yearEndLabel || ev.yearEnd || ''}`.trim(),
          amount: s.settings.defaultFee,
          adjustReason: ''
        });
      if (usage.length || !supplementary) lines.push(aiLine(s.settings, usage, uid));
      const inv: Invoice = {
        id: uid(),
        status: 'draft',
        kind: supplementary ? 'supplementary' : 'standard',
        engagementId: ev.engagementId,
        fundName: ev.fundName,
        ...(ev.entityName !== undefined ? { entityName: ev.entityName } : {}),
        clientName: ev.clientName || ev.entityName || '',
        email: ev.billingEmail || '',
        ...(ev.yearEnd !== undefined ? { yearEnd: ev.yearEnd } : {}),
        ...(ev.signedBy !== undefined ? { signedBy: ev.signedBy } : {}),
        ...(ev.signedAt !== undefined ? { signedAt: ev.signedAt } : {}),
        lines,
        usageIds: usage.map((u) => u.id),
        vatRate: s.settings.vatRate,
        termsDays: s.settings.paymentTermsDays,
        notes: '',
        createdBy: by,
        createdAt: now,
        payments: [],
        writeOffs: [],
        history: [{ what: 'Draft created', by, at: now }]
      };
      return {
        state: { ...s, invoices: [...s.invoices, inv] },
        log: `Created a ${supplementary ? 'supplementary ' : ''}draft invoice for ${ev.fundName}`,
        engagement: ev,
        invoice: inv
      };
    }
    case 'updateDraft': {
      const inv = find(a.id);
      if (inv.status !== 'draft') bad('Only a draft invoice can be changed.');
      const lines = (a.lines || inv.lines).map((l) => ({
        ...l,
        amount: Math.round(Number(l.amount) || 0),
        description: String(l.description || '').trim()
      }));
      if (lines.some((l) => !l.description)) bad('Every line needs a description.');
      if (lines.some((l) => l.amount < 0)) bad('Line amounts can’t be negative. Reduce a line instead and give the reason.');
      const ai = lines.find((l) => l.kind === 'ai'),
        wasAi = inv.lines.find((l) => l.kind === 'ai');
      if (
        ai &&
        wasAi &&
        ai.amount !== wasAi.amount &&
        ai.amount < (wasAi.calcAmount ?? wasAi.amount) &&
        !String(ai.adjustReason || '').trim()
      )
        bad('Give a reason for reducing the AI usage charge.');
      const vatRate = Number(a.vatRate ?? inv.vatRate);
      if (!(vatRate >= 0 && vatRate <= 100)) bad('The VAT rate must be between 0 and 100 percent.');
      const upd: Invoice = {
        ...inv,
        lines,
        // a removed AI line leaves its usage unbilled, so it can go on a later invoice
        usageIds: ai ? inv.usageIds : [],
        vatRate,
        termsDays: Math.round(Number(a.termsDays ?? inv.termsDays)),
        notes: a.notes ?? inv.notes,
        history: [...inv.history, { what: 'Draft updated', by, at: now }]
      };
      return { state: { ...s, invoices: replace(upd) }, log: `Updated the draft invoice for ${inv.fundName}`, invoice: upd };
    }
    case 'refreshAi': {
      const inv = find(a.id);
      if (inv.status !== 'draft') bad('Only a draft invoice can be refreshed.');
      const usage = unbilledUsage(s, ctx.usage || [], inv.engagementId, inv.id),
        line = aiLine(s.settings, usage, uid);
      const others = inv.lines.filter((l) => l.kind !== 'ai');
      const upd: Invoice = {
        ...inv,
        lines: [...others, { ...line, calcAmount: line.amount }],
        usageIds: usage.map((u) => u.id),
        history: [...inv.history, { what: 'AI usage recalculated', by, at: now }]
      };
      return {
        state: { ...s, invoices: replace(upd) },
        log: `Recalculated AI usage on the draft invoice for ${inv.fundName}`,
        invoice: upd
      };
    }
    case 'issue': {
      const inv = find(a.id);
      if (inv.status !== 'draft') bad('This invoice has already been issued.');
      const ai = inv.lines.find((l) => l.kind === 'ai');
      if (ai?.unpriced && ai.usageCount)
        bad('Set the AI prices and the USD to GBP rate under Billing Settings, then recalculate the AI usage.');
      if (totals(inv).gross <= 0) bad('An invoice must be for more than £0.00.');
      guard(now, 'an invoice');
      const seq = s.seq + 1,
        number = `${s.settings.invoicePrefix}${new Date(now).getUTCFullYear()}-${String(seq).padStart(4, '0')}`;
      const upd: Invoice = {
        ...inv,
        status: 'issued',
        number,
        issuedAt: now,
        issuedBy: by,
        dueDate: addDays(now, inv.termsDays),
        settingsAtIssue: { firmName: s.settings.firmName, firmAddress: s.settings.firmAddress, vatNumber: s.settings.vatNumber },
        history: [...inv.history, { what: `Issued as ${number}`, by, at: now }]
      };
      return {
        state: { ...s, seq, invoices: replace(upd) },
        log: `Issued invoice ${number} for ${inv.fundName}`,
        details: money(totals(upd).gross),
        invoice: upd
      };
    }
    case 'payment': {
      const inv = find(a.id);
      if (inv.status !== 'issued') bad('Payments can only be recorded against an issued invoice.');
      const amount = Math.round(Number(a.amount) || 0),
        t = totals(inv);
      if (amount <= 0) bad('Enter the amount received.');
      if (amount > t.outstanding) bad(`That is more than the ${money(t.outstanding)} outstanding.`);
      if (a.date !== undefined && a.date !== '' && !isIsoDay(a.date)) bad('Enter the payment date as a date.');
      guard(a.date || now, 'a payment');
      const upd: Invoice = {
        ...inv,
        payments: [
          ...inv.payments,
          { id: uid(), amount, date: a.date || day(now), reference: String(a.reference || '').trim(), by, at: now }
        ],
        history: [...inv.history, { what: `Payment of ${money(amount)} recorded`, by, at: now }]
      };
      return {
        state: { ...s, invoices: replace(upd) },
        log: `Recorded a payment of ${money(amount)} on ${inv.number}`,
        details: a.reference || '',
        invoice: upd
      };
    }
    case 'writeOff': {
      const inv = find(a.id);
      if (inv.status !== 'issued') bad('Only an issued invoice can be written off.');
      const amount = Math.round(Number(a.amount) || 0),
        t = totals(inv);
      if (amount <= 0 || amount > t.outstanding) bad(`Write off between £0.01 and ${money(t.outstanding)}.`);
      if (String(a.reason || '').trim().length < 5) bad('Give the reason for the write-off.');
      guard(now, 'a write-off');
      const upd: Invoice = {
        ...inv,
        writeOffs: [...inv.writeOffs, { id: uid(), amount, reason: a.reason.trim(), by, at: now }],
        history: [...inv.history, { what: `${money(amount)} written off`, by, at: now }]
      };
      return {
        state: { ...s, invoices: replace(upd) },
        log: `Wrote off ${money(amount)} on ${inv.number}`,
        details: a.reason,
        invoice: upd
      };
    }
    case 'cancel': {
      const inv = find(a.id);
      if (String(a.reason || '').trim().length < 5) bad('Give the reason for cancelling.');
      if (inv.status === 'draft')
        return {
          state: { ...s, invoices: s.invoices.filter((i) => i.id !== inv.id) },
          log: `Discarded the draft invoice for ${inv.fundName}`,
          details: a.reason
        };
      if (inv.status !== 'issued') bad('This invoice is already cancelled.');
      if ((inv.payments || []).length) bad('A paid or part-paid invoice can’t be cancelled. Write off the balance instead.');
      if (lockedOn(inv.issuedAt || now))
        bad(`This invoice was issued in a locked period (up to ${s.settings.lockDate}). Issue a credit note instead.`);
      guard(now, 'a cancellation');
      const creditSeq = s.creditSeq + 1,
        credit = `CN-${new Date(now).getUTCFullYear()}-${String(creditSeq).padStart(4, '0')}`;
      const upd: Invoice = {
        ...inv,
        status: 'cancelled',
        creditNote: credit,
        cancelReason: a.reason.trim(),
        cancelledAt: now,
        cancelledBy: by,
        history: [...inv.history, { what: `Cancelled by credit note ${credit}`, by, at: now }]
      };
      return {
        state: { ...s, creditSeq, invoices: replace(upd) },
        log: `Cancelled ${inv.number} with credit note ${credit}`,
        details: `${a.reason} · its AI usage can be billed again`,
        invoice: upd
      };
    }
    case 'creditNote': {
      const inv = find(a.id);
      if (inv.status !== 'issued') bad('A credit note can only be raised against an issued invoice.');
      const amount = Math.round(Number(a.amount) || 0),
        t = totals(inv);
      if (amount <= 0 || amount > t.outstanding) bad(`Credit between £0.01 and ${money(t.outstanding)}.`);
      if (String(a.reason || '').trim().length < 5) bad('Give the reason for the credit note.');
      guard(now, 'a credit note');
      const creditSeq = s.creditSeq + 1,
        number = `CN-${new Date(now).getUTCFullYear()}-${String(creditSeq).padStart(4, '0')}`;
      const vat = Math.round((amount * Number(inv.vatRate || 0)) / (100 + Number(inv.vatRate || 0)));
      const cn = { id: uid(), number, amount, net: amount - vat, vat, reason: a.reason.trim(), by, at: now };
      const upd: Invoice = {
        ...inv,
        creditNotes: [...(inv.creditNotes || []), cn],
        history: [...inv.history, { what: `Credit note ${number} for ${money(amount)}`, by, at: now }]
      };
      return {
        state: { ...s, creditSeq, invoices: replace(upd) },
        log: `Raised credit note ${number} for ${money(amount)} against ${inv.number}`,
        details: a.reason,
        invoice: upd
      };
    }
    case 'setLock': {
      const d = a.lockDate || null;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad('Enter the lock date as a date.');
      if (d && d > day(now)) bad('The lock date can’t be in the future.');
      if (String(a.reason || '').trim().length < 5) bad('Give the reason for changing the lock date.');
      return {
        state: { ...s, settings: { ...s.settings, lockDate: d } },
        log: d ? `Locked billing up to ${d}` : 'Removed the billing lock date',
        details: a.reason
      };
    }
    case 'fxUpdate': {
      if (!(Number(a.rate) > 0)) bad('The exchange rate must be more than zero.');
      return {
        state: { ...s, settings: { ...s.settings, usdToGbp: Number(a.rate), fxDate: a.date || day(now), fxSource: a.source || 'manual' } },
        log: `Updated the USD to GBP rate to ${a.rate}`,
        details: `${a.source || 'manual'} · ${a.date || day(now)}`
      };
    }
    case 'emailed': {
      const inv = find(a.id);
      const upd: Invoice = {
        ...inv,
        emails: [...(inv.emails || []), { to: a.to, at: now, by }],
        history: [...inv.history, { what: `Emailed to ${a.to}`, by, at: now }]
      };
      return { state: { ...s, invoices: replace(upd) }, log: `Emailed ${inv.number} to ${a.to}`, invoice: upd };
    }
    case 'xeroSynced': {
      const inv = find(a.id);
      const upd: Invoice = {
        ...inv,
        xero: { invoiceId: a.xeroInvoiceId, status: a.status || 'AUTHORISED', at: now },
        history: [...inv.history, { what: `Sent to Xero (${a.status || 'AUTHORISED'})`, by, at: now }]
      };
      return { state: { ...s, invoices: replace(upd) }, log: `Sent ${inv.number} to Xero`, invoice: upd };
    }
    default:
      return bad('Unknown billing action.');
  }
}

// ---- recovery ------------------------------------------------------------------------------
export function recovery(state: BillingState, usage: AiUsage[], today: string = new Date().toISOString()) {
  const issued = state.invoices.filter((i) => i.status === 'issued');
  const t = issued.map((i) => ({ inv: i, ...totals(i), overdue: daysOverdue(i, today) }));
  type Row = (typeof t)[number];
  const sum = (arr: Row[], k: 'gross' | 'paid' | 'writtenOff' | 'credited' | 'outstanding') => arr.reduce((a, x) => a + x[k], 0);
  const aiLines = issued.flatMap((i) => i.lines.filter((l) => l.kind === 'ai'));
  const billedUsageIds = new Set(issued.flatMap((i) => i.usageIds || []));
  const unbilled = usage.filter((u) => u.engagementId && !billedUsageIds.has(u.id));
  const unbilledCost = unbilled.reduce((a, u) => a + (usageCost(state.settings, u) || 0), 0);
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  t.forEach((x) => {
    if (!x.outstanding) return;
    const d = x.overdue;
    aging[d === 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90p'] += x.outstanding;
  });
  type ClientRow = {
    client: string;
    invoices: number;
    billed: number;
    collected: number;
    writtenOff: number;
    credited: number;
    outstanding: number;
    overdue: number;
    aiCost: number;
    aiBilled: number;
  };
  const clients: Record<string, ClientRow> = {};
  t.forEach((x) => {
    const c = (clients[x.inv.clientName] ||= {
      client: x.inv.clientName,
      invoices: 0,
      billed: 0,
      collected: 0,
      writtenOff: 0,
      credited: 0,
      outstanding: 0,
      overdue: 0,
      aiCost: 0,
      aiBilled: 0
    });
    c.invoices++;
    c.billed += x.gross;
    c.collected += x.paid;
    c.writtenOff += x.writtenOff;
    c.credited += x.credited;
    c.outstanding += x.outstanding;
    if (x.overdue) c.overdue += x.outstanding;
    x.inv.lines
      .filter((l) => l.kind === 'ai')
      .forEach((l) => {
        c.aiCost += l.costAtCost || 0;
        c.aiBilled += l.amount || 0;
      });
  });
  const aiCost = aiLines.reduce((a, l) => a + (l.costAtCost || 0), 0),
    aiBilled = aiLines.reduce((a, l) => a + (l.amount || 0), 0);
  return {
    billed: sum(t, 'gross'),
    collected: sum(t, 'paid'),
    writtenOff: sum(t, 'writtenOff'),
    credited: sum(t, 'credited'),
    outstanding: sum(t, 'outstanding'),
    overdue: t.filter((x) => x.overdue && x.outstanding).reduce((a, x) => a + x.outstanding, 0),
    cashRecovery: sum(t, 'gross') - sum(t, 'credited') ? sum(t, 'paid') / (sum(t, 'gross') - sum(t, 'credited')) : null,
    aiCost,
    aiBilled,
    aiRecovery: aiCost ? aiBilled / aiCost : null,
    unbilledCalls: unbilled.length,
    unbilledCost,
    aging,
    clients: Object.values(clients).sort((a, b) => b.outstanding - a.outstanding)
  };
}
