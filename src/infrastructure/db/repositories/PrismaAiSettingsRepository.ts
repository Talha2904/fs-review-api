import { normalizeAi, type AiSettings } from '@fs-review/shared';

import type { AiSettingsRepository } from '../../../application/ports/AiSettingsRepository.js';
import type { Db } from '../prisma.js';

const ROW_ID = 1;

export class PrismaAiSettingsRepository implements AiSettingsRepository {
  constructor(private readonly db: Db) {}

  async get(): Promise<AiSettings | null> {
    const r = await this.db.aiSettings.findUnique({ where: { id: ROW_ID } });
    return r ? normalizeAi(r.settings) : null;
  }

  async save(settings: AiSettings, updatedBy: string, at: string): Promise<void> {
    const clean = JSON.parse(JSON.stringify(normalizeAi(settings)));
    await this.db.aiSettings.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, settings: clean, updatedBy, updatedAt: new Date(at) },
      update: { settings: clean, updatedBy, updatedAt: new Date(at) }
    });
  }
}
