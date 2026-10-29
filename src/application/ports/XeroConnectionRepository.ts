export interface XeroTokens {
  access: string;
  refresh: string;
  /** epoch milliseconds */
  expiresAt: number;
}

export interface XeroConnection {
  tokens: XeroTokens;
  tenantId: string;
  tenantName: string;
  connectedAt: string;
}

export interface XeroConnectionRepository {
  get(): Promise<XeroConnection | null>;
  save(connection: XeroConnection, at: string): Promise<void>;
  clear(): Promise<void>;
}
