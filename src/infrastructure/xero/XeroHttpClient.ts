import type { XeroClient, XeroCreatedInvoice, XeroInvoicePayload } from '../../application/ports/XeroClient.js';
import type { XeroTokens } from '../../application/ports/XeroConnectionRepository.js';

export interface XeroConfig {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
  authUrl?: string | undefined;
  tokenUrl?: string | undefined;
  apiBase?: string | undefined;
}

const SCOPE = 'openid profile email accounting.transactions accounting.contacts offline_access';

/** Xero OAuth 2 and the Invoices endpoint over plain fetch. */
export class XeroHttpClient implements XeroClient {
  readonly configured: boolean;
  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly apiBase: string;

  constructor(
    private readonly cfg: XeroConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    this.configured = !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
    this.authUrl = cfg.authUrl || 'https://login.xero.com/identity/connect/authorize';
    this.tokenUrl = cfg.tokenUrl || 'https://identity.xero.com/connect/token';
    this.apiBase = cfg.apiBase || 'https://api.xero.com';
  }

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg.clientId ?? '',
      redirect_uri: this.cfg.redirectUri ?? '',
      scope: SCOPE,
      state
    });
    return `${this.authUrl}?${q}`;
  }

  exchangeCode(code: string): Promise<XeroTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri ?? '' });
  }

  refresh(refreshToken: string): Promise<XeroTokens> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async connections(accessToken: string): Promise<{ tenantId: string; tenantName: string }[]> {
    const r = await this.fetchFn(`${this.apiBase}/connections`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const j = (await r.json().catch(() => [])) as unknown;
    if (!Array.isArray(j)) return [];
    return j.map((c) => ({
      tenantId: String((c as { tenantId?: string }).tenantId ?? ''),
      tenantName: String((c as { tenantName?: string }).tenantName ?? '')
    }));
  }

  async createInvoice(
    tokens: XeroTokens,
    tenantId: string,
    invoice: XeroInvoicePayload,
    idempotencyKey: string
  ): Promise<XeroCreatedInvoice> {
    const r = await this.fetchFn(`${this.apiBase}/api.xro/2.0/Invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access}`,
        'xero-tenant-id': tenantId,
        'Idempotency-Key': idempotencyKey.slice(0, 128),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Invoices: [invoice] })
    });
    const j = (await r.json().catch(() => ({}))) as {
      Invoices?: { InvoiceID?: string; Status?: string; Total?: number; ValidationErrors?: { Message: string }[] }[];
      Message?: string;
    };
    const xi = j?.Invoices?.[0];
    if (!r.ok || !xi?.InvoiceID)
      throw new Error(xi?.ValidationErrors?.map((v) => v.Message).join('; ') || j?.Message || `Xero answered ${r.status}.`);
    return { invoiceId: xi.InvoiceID, status: xi.Status || 'AUTHORISED', total: Number(xi.Total ?? 0) };
  }

  private async tokenRequest(params: Record<string, string>): Promise<XeroTokens> {
    const basic = 'Basic ' + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const r = await this.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    const j = (await r.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!r.ok) throw new Error(j.error_description || j.error || `Xero answered ${r.status}.`);
    return { access: j.access_token ?? '', refresh: j.refresh_token ?? '', expiresAt: Date.now() + (j.expires_in || 1800) * 1000 };
  }
}
