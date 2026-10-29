import type {
  ChecklistItem,
  ChecklistTemplate,
  ChecklistTemplateRepository
} from '../../../application/ports/ChecklistTemplateRepository.js';
import type { Db } from '../prisma.js';

type Row = NonNullable<Awaited<ReturnType<Db['checklistTemplate']['findUnique']>>>;

const toDomain = (r: Row): ChecklistTemplate => ({
  framework: r.framework,
  version: r.version,
  items: r.items as unknown as ChecklistItem[],
  savedBy: r.savedBy,
  savedAt: r.savedAt.toISOString()
});

export class PrismaChecklistTemplateRepository implements ChecklistTemplateRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<ChecklistTemplate[]> {
    return (await this.db.checklistTemplate.findMany({ orderBy: { framework: 'asc' } })).map(toDomain);
  }

  async get(framework: string): Promise<ChecklistTemplate | null> {
    const r = await this.db.checklistTemplate.findUnique({ where: { framework } });
    return r ? toDomain(r) : null;
  }

  async save(t: ChecklistTemplate, versionId: string): Promise<void> {
    const items = JSON.parse(JSON.stringify(t.items));
    const savedAt = new Date(t.savedAt);
    await this.db.$transaction([
      this.db.checklistTemplate.upsert({
        where: { framework: t.framework },
        create: { framework: t.framework, version: t.version, items, savedBy: t.savedBy, savedAt },
        update: { version: t.version, items, savedBy: t.savedBy, savedAt }
      }),
      this.db.checklistTemplateVersion.create({
        data: { id: versionId, framework: t.framework, version: t.version, items, savedBy: t.savedBy, savedAt }
      })
    ]);
  }
}
