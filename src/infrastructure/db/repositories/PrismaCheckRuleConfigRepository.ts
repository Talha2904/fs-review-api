import type { CheckRuleConfig, CheckRuleConfigRepository } from '../../../application/ports/CheckRuleConfigRepository.js';
import type { Db } from '../prisma.js';

const ROW_ID = 1;

export class PrismaCheckRuleConfigRepository implements CheckRuleConfigRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<CheckRuleConfig | null> {
    const r = await this.db.checkRuleConfig.findUnique({ where: { id: ROW_ID } });
    return r ? (r.config as unknown as CheckRuleConfig) : null;
  }

  async save(config: CheckRuleConfig, updatedBy: string, at: string): Promise<void> {
    const json = JSON.parse(JSON.stringify(config));
    await this.db.checkRuleConfig.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, config: json, updatedBy, updatedAt: new Date(at) },
      update: { config: json, updatedBy, updatedAt: new Date(at) }
    });
  }
}
