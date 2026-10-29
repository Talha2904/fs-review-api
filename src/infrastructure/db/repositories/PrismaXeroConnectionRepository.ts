import type { XeroConnection, XeroConnectionRepository, XeroTokens } from '../../../application/ports/XeroConnectionRepository.js';
import type { Db } from '../prisma.js';

const ROW_ID = 1;

export class PrismaXeroConnectionRepository implements XeroConnectionRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<XeroConnection | null> {
    const r = await this.db.xeroConnection.findUnique({ where: { id: ROW_ID } });
    return r
      ? {
          tokens: r.tokens as unknown as XeroTokens,
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          connectedAt: r.connectedAt.toISOString()
        }
      : null;
  }

  async save(c: XeroConnection, at: string): Promise<void> {
    const tokens = { ...c.tokens };
    await this.db.xeroConnection.upsert({
      where: { id: ROW_ID },
      create: {
        id: ROW_ID,
        tokens,
        tenantId: c.tenantId,
        tenantName: c.tenantName,
        connectedAt: new Date(c.connectedAt),
        updatedAt: new Date(at)
      },
      update: { tokens, tenantId: c.tenantId, tenantName: c.tenantName, connectedAt: new Date(c.connectedAt), updatedAt: new Date(at) }
    });
  }

  async clear(): Promise<void> {
    await this.db.xeroConnection.deleteMany({ where: { id: ROW_ID } });
  }
}
