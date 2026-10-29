import type { XeroTokens } from './XeroConnectionRepository.js';

export interface XeroInvoicePayload {
  Type: 'ACCREC';
  Contact: { Name: string };
  Date: string;
  DueDate: string;
  InvoiceNumber: string;
  Reference: string;
  LineAmountTypes: 'Exclusive';
  CurrencyCode: string;
  Status: 'AUTHORISED';
  LineItems: { Description: string; Quantity: number; UnitAmount: string; AccountCode: string; TaxType: string }[];
}

export interface XeroCreatedInvoice {
  invoiceId: string;
  status: string;
  total: number;
}

/** Xero's OAuth and accounting API behind a port. `configured` is false until the three XERO_* settings exist. */
export interface XeroClient {
  readonly configured: boolean;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<XeroTokens>;
  refresh(refreshToken: string): Promise<XeroTokens>;
  connections(accessToken: string): Promise<{ tenantId: string; tenantName: string }[]>;
  /** `idempotencyKey`: the same key sent twice creates one invoice in Xero, so a retry after a failure is safe. */
  createInvoice(tokens: XeroTokens, tenantId: string, invoice: XeroInvoicePayload, idempotencyKey: string): Promise<XeroCreatedInvoice>;
}
