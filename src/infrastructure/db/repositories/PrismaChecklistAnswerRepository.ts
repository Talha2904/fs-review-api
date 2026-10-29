import type {
  ChecklistAnswer,
  ChecklistAnswerRepository,
  DisclosureChecklist
} from '../../../application/ports/ChecklistAnswerRepository.js';
import type { ChecklistItem } from '../../../application/ports/ChecklistTemplateRepository.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['disclosureChecklist']['findUnique']>>>;

const toDomain = (r: Row): DisclosureChecklist => ({
  engagementId: r.engagementId,
  framework: r.framework,
  version: r.version,
  items: r.items as unknown as ChecklistItem[],
  answers: (r.answers as unknown as Record<string, ChecklistAnswer>) ?? {}
});

const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

export class PrismaChecklistAnswerRepository implements ChecklistAnswerRepository {
  constructor(private readonly db: Db) {}

  async get(engagementId: string): Promise<DisclosureChecklist | null> {
    const r = await this.db.disclosureChecklist.findUnique({ where: { engagementId } });
    return r ? toDomain(r) : null;
  }
  async listAll(): Promise<DisclosureChecklist[]> {
    return (await this.db.disclosureChecklist.findMany()).map(toDomain);
  }
  /** Serializable read, change and write, retried when two answers collide (portable to MySQL). */
  async update(
    engagementId: string,
    change: (current: DisclosureChecklist | null) => DisclosureChecklist,
    at: string
  ): Promise<DisclosureChecklist> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const r = await tx.disclosureChecklist.findUnique({ where: { engagementId } });
            const c = change(r ? toDomain(r) : null);
            const data = {
              framework: c.framework,
              version: c.version,
              items: plain(c.items),
              answers: plain(c.answers),
              updatedAt: new Date(at)
            };
            await tx.disclosureChecklist.upsert({ where: { engagementId }, create: { engagementId, ...data }, update: data });
            return c;
          },
          { isolationLevel: 'Serializable' }
        );
      } catch (e) {
        const code = (e as { code?: string }).code;
        if ((code === 'P2034' || code === 'P2002') && attempt < 4) continue;
        throw e;
      }
    }
  }
}
