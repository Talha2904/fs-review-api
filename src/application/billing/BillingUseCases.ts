import { type BillingAction, type BillingActionType, type PermissionMatrix } from '@fs-review/shared';

import { AppError, forbidden, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { BillingRepository } from '../ports/BillingRepository.js';
import type { FxRateSource } from '../ports/FxRateSource.js';
import type { Mailer } from '../ports/Mailer.js';
import type { XeroClient } from '../ports/XeroClient.js';
import type { XeroConnectionRepository } from '../ports/XeroConnectionRepository.js';

import type { BillingActions } from './BillingActions.js';

/** Finance reads the whole billing state plus the AI usage it can bill. */
export class GetBilling {
  constructor(private readonly actions: BillingActions) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix) {
    requirePermission(actor, 'billing.manage', matrix);
    return this.actions.state();
  }
}

/** Sign-off and unlock events are written only by a sign-off on the server (SetSignoff), never posted by a person. */
const EVENT_TYPES: readonly BillingActionType[] = ['signoff', 'unlock'];

/** Finance applies a billing action: anything but the sign-off events. */
export class ApplyBillingAction {
  constructor(private readonly actions: BillingActions) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, action: BillingAction, ip?: string) {
    const by = requirePermission(actor, 'billing.manage', matrix);
    if (EVENT_TYPES.includes(action?.type)) throw forbidden('Sign-off events come only from signing off the review.');
    const r = await this.actions.apply(by, action, ip);
    return { state: r.state, usage: r.usage };
  }
}

export class GetIntegrations {
  constructor(
    private readonly mailer: Mailer,
    private readonly xero: XeroClient,
    private readonly xeroConnection: XeroConnectionRepository,
    private readonly fxAuto: boolean
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix) {
    requirePermission(actor, 'billing.manage', matrix);
    const x = await this.xeroConnection.get();
    return {
      email: { configured: this.mailer.configured, from: this.mailer.from },
      fx: { auto: this.fxAuto },
      xero: { configured: this.xero.configured, connected: !!x, tenantName: x?.tenantName || '' }
    };
  }
}

export interface EmailInvoiceInput {
  invoiceId: string;
  to: string;
  cc?: string;
  subject?: string;
  message?: string;
  /** base64 PDF made in the browser */
  pdf: string;
  fileName?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class EmailInvoice {
  constructor(
    private readonly actions: BillingActions,
    private readonly billing: BillingRepository,
    private readonly mailer: Mailer
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, input: EmailInvoiceInput, ip?: string) {
    const by = requirePermission(actor, 'billing.manage', matrix);
    if (!this.mailer.configured)
      throw new AppError(
        'AI_UNAVAILABLE',
        'Email isn’t set up on the server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM.'
      );
    const inv = (await this.billing.get()).invoices.find((i) => i.id === input.invoiceId);
    if (!inv || inv.status === 'draft') throw validationFailed('Only an issued invoice can be emailed.');
    const emails = String(input.to || '')
      .split(/[;,]\s*/)
      .filter(Boolean);
    if (!emails.length || emails.some((e) => !EMAIL_RE.test(e))) throw validationFailed('Enter a valid email address.');
    if (!input.pdf || input.pdf.length > 15e6) throw validationFailed('The invoice PDF is missing or too large.');
    try {
      await this.mailer.send({
        to: emails.join(', '),
        ...(input.cc ? { cc: input.cc } : {}),
        subject: String(input.subject || '').slice(0, 200),
        text: String(input.message || '').slice(0, 5000),
        attachments: [
          { filename: input.fileName || `${inv.number}.pdf`, content: Buffer.from(input.pdf, 'base64'), contentType: 'application/pdf' }
        ]
      });
    } catch (e) {
      throw new AppError('AI_UNAVAILABLE', `The email could not be sent: ${e instanceof Error ? e.message : String(e)}`);
    }
    const r = await this.actions.apply(by, { type: 'emailed', id: inv.id, to: emails.join(', ') }, ip);
    return { state: r.state };
  }
}

export class RefreshFxRate {
  constructor(
    private readonly actions: BillingActions,
    private readonly rates: FxRateSource
  ) {}
  /** Finance clicks Update Rate Now; the scheduler calls `run` with the system actor. */
  async execute(actor: Actor | null, matrix: PermissionMatrix, ip?: string) {
    const by = requirePermission(actor, 'billing.manage', matrix);
    return this.run(by, ip);
  }
  async run(by: Actor, ip?: string) {
    let fx;
    try {
      fx = await this.rates.latestUsdToGbp();
    } catch (e) {
      throw new AppError('AI_UNAVAILABLE', `The rate could not be updated: ${e instanceof Error ? e.message : String(e)}`);
    }
    const r = await this.actions.apply(by, { type: 'fxUpdate', rate: fx.rate, date: fx.date, source: fx.source }, ip);
    return { state: r.state };
  }
}
