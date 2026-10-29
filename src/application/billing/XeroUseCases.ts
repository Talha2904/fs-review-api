import { totals, type Invoice, type BillingSettings, type PermissionMatrix } from '@fs-review/shared';

import { AppError, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { BillingRepository } from '../ports/BillingRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { Tokens } from '../ports/Tokens.js';
import type { XeroClient, XeroInvoicePayload } from '../ports/XeroClient.js';
import type { XeroConnection, XeroConnectionRepository, XeroTokens } from '../ports/XeroConnectionRepository.js';

import type { BillingActions } from './BillingActions.js';

const NOT_SET_UP =
  'Xero isn’t set up on the server. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI from your Xero developer app.';

/** Our invoice as a Xero sales invoice (ACCREC), amounts in pounds, VAT added by Xero's tax rate. */
export function toXeroInvoice(inv: Invoice, settings: BillingSettings): XeroInvoicePayload {
  const d = (iso: string | undefined) => (iso ?? '').slice(0, 10);
  return {
    Type: 'ACCREC',
    Contact: { Name: inv.clientName },
    Date: d(inv.issuedAt),
    DueDate: d(inv.dueDate),
    InvoiceNumber: inv.number ?? '',
    Reference: `${inv.fundName}`.slice(0, 255),
    LineAmountTypes: 'Exclusive',
    CurrencyCode: 'GBP',
    Status: 'AUTHORISED',
    LineItems: inv.lines.map((l) => ({
      Description: l.description,
      Quantity: 1,
      UnitAmount: (l.amount / 100).toFixed(2),
      AccountCode: settings.xero?.accountCode || '200',
      // an invoice at 0% VAT must not be posted with a standard-rated tax type
      TaxType: Number(inv.vatRate) > 0 ? settings.xero?.taxType || 'OUTPUT2' : settings.xero?.zeroTaxType || 'ZERORATEDOUTPUT'
    }))
  };
}

/** Starts the OAuth dance; the state is kept in memory for the one callback that follows. */
export class ConnectXero {
  private pendingState: string | null = null;

  constructor(
    private readonly xero: XeroClient,
    private readonly connections: XeroConnectionRepository,
    private readonly tokens: Tokens,
    private readonly clock: Clock
  ) {}

  start(actor: Actor | null, matrix: PermissionMatrix): { url: string } {
    requirePermission(actor, 'billing.manage', matrix);
    if (!this.xero.configured) throw new AppError('AI_UNAVAILABLE', NOT_SET_UP);
    this.pendingState = this.tokens.secret().slice(0, 32);
    return { url: this.xero.authorizeUrl(this.pendingState) };
  }

  /** The browser arrives here from Xero; there is no session requirement because Xero redirects the user. */
  async complete(state: string | undefined, code: string | undefined): Promise<void> {
    if (!this.pendingState || state !== this.pendingState)
      throw validationFailed('This Xero sign-in link has expired. Start again from Billing Settings.');
    this.pendingState = null;
    const t = await this.xero.exchangeCode(String(code || ''));
    const c = await this.xero.connections(t.access);
    const first = c[0];
    if (!first) throw new AppError('AI_UNAVAILABLE', 'No Xero organisation was authorised.');
    const conn: XeroConnection = { tokens: t, tenantId: first.tenantId, tenantName: first.tenantName, connectedAt: this.clock.nowIso() };
    await this.connections.save(conn, this.clock.nowIso());
  }
}

export class DisconnectXero {
  constructor(private readonly connections: XeroConnectionRepository) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<void> {
    requirePermission(actor, 'billing.manage', matrix);
    await this.connections.clear();
  }
}

export class SendInvoiceToXero {
  // one send per invoice at a time in this process, and token refreshes one at a time (Xero's refresh token is single-use)
  private readonly sending = new Set<string>();
  private refreshing: Promise<XeroConnection> | null = null;

  constructor(
    private readonly actions: BillingActions,
    private readonly billing: BillingRepository,
    private readonly xero: XeroClient,
    private readonly connections: XeroConnectionRepository,
    private readonly clock: Clock
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, invoiceId: string, ip?: string) {
    const by = requirePermission(actor, 'billing.manage', matrix);
    const st = await this.billing.get();
    const inv = st.invoices.find((i) => i.id === invoiceId);
    if (!inv || inv.status !== 'issued') throw validationFailed('Only an issued invoice can be sent to Xero.');
    if (inv.xero?.invoiceId) throw validationFailed('This invoice is already in Xero.');
    if (this.sending.has(inv.id)) throw validationFailed('This invoice is being sent to Xero already.');
    this.sending.add(inv.id);
    try {
      const conn = await this.freshConnection();
      // the invoice id as the idempotency key: a retry after a failure here never makes a second Xero invoice
      const xi = await this.xero.createInvoice(conn.tokens, conn.tenantId, toXeroInvoice(inv, st.settings), `fs-review-${inv.id}`);
      const out = await this.actions.apply(by, { type: 'xeroSynced', id: inv.id, xeroInvoiceId: xi.invoiceId, status: xi.status }, ip);
      return { state: out.state, xero: { invoiceId: xi.invoiceId, total: xi.total, ours: totals(inv).gross / 100 } };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('AI_UNAVAILABLE', `The invoice could not be sent to Xero: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.sending.delete(inv.id);
    }
  }

  /** Tokens last 30 minutes; refresh when fewer than 60 seconds remain. */
  private freshConnection(): Promise<XeroConnection> {
    return (this.refreshing ??= this.connectionNow().finally(() => {
      this.refreshing = null;
    }));
  }

  private async connectionNow(): Promise<XeroConnection> {
    const x = await this.connections.get();
    if (!x) throw new AppError('AI_UNAVAILABLE', 'Xero is not connected. Connect it under Billing Settings.');
    if (x.tokens.expiresAt - this.clock.now().getTime() > 60000) return x;
    const t: XeroTokens = await this.xero.refresh(x.tokens.refresh);
    const next = { ...x, tokens: t };
    await this.connections.save(next, this.clock.nowIso());
    return next;
  }
}
