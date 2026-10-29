import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** The reducer validates the action in detail; HTTP checks only that it is an object with a type. */
export const BillingActionSchema = z
  .object({ type: z.string().max(40) })
  .passthrough()
  .openapi('BillingAction');
export const BillingBody = z.object({ action: BillingActionSchema }).openapi('BillingBody');
export const BillingStateResponse = z
  .object({ state: z.record(z.string(), z.unknown()), usage: z.array(z.unknown()).optional() })
  .openapi('BillingStateResponse');
export const IntegrationsResponse = z
  .object({
    email: z.object({ configured: z.boolean(), from: z.string() }),
    fx: z.object({ auto: z.boolean() }),
    xero: z.object({ configured: z.boolean(), connected: z.boolean(), tenantName: z.string() })
  })
  .openapi('IntegrationsResponse');
export const EmailInvoiceBody = z
  .object({
    invoiceId: z.string().max(64),
    to: z.string().max(1000),
    cc: z.string().max(1000).optional(),
    subject: z.string().max(200).optional(),
    message: z.string().max(5000).optional(),
    pdf: z.string().max(15_000_000),
    fileName: z.string().max(260).optional()
  })
  .openapi('EmailInvoiceBody');
export const XeroInvoiceBody = z.object({ invoiceId: z.string().max(64) }).openapi('XeroInvoiceBody');
export const XeroConnectResponse = z.object({ url: z.string() }).openapi('XeroConnectResponse');
export const XeroCallbackQuery = z.object({ state: z.string().max(200).optional(), code: z.string().max(2000).optional() });
