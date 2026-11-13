import type { PermissionMatrix } from '@fs-review/shared';

import { conflict, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { ENTITY_DEFAULTS, entityNameKey, entityProblem, type EntityDocument } from '../../domain/review/Entity.js';
import { requirePermission } from '../identity/authorize.js';
import type { Clock } from '../ports/Clock.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

const ID_RE = /^[A-Za-z0-9._-]{3,64}$/;

/** Entities whose funds have all been deleted: hidden until one of their funds is restored. */
export async function hiddenEntityIds(engagements: EngagementRepository): Promise<Set<string>> {
  const [live, deleted] = await Promise.all([engagements.list(), engagements.listDeleted()]);
  const withLive = new Set(live.map((r) => r.doc.entityId).filter(Boolean));
  return new Set(deleted.map((r) => r.doc.entityId).filter((id): id is string => !!id && !withLive.has(id)));
}

/** Every staff member sees the client list; Finance sees it too for invoices. An entity left with only deleted funds is hidden. */
export class ListEntities {
  constructor(
    private readonly entities: EntityRepository,
    private readonly engagements: EngagementRepository
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<EntityDocument[]> {
    requirePermission(actor, 'activity.write', matrix);
    const [all, hidden] = await Promise.all([this.entities.list(), hiddenEntityIds(this.engagements)]);
    return all.map((r) => r.doc).filter((d) => !hidden.has(d.id));
  }
}

/**
 * Creates or updates an entity. The web app may supply the id (it did so before the api existed);
 * a missing id is made here. Names are unique ignoring case and spacing. Entities are never deleted.
 */
export class SaveEntity {
  constructor(
    private readonly entities: EntityRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly engagements: EngagementRepository
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    input: Partial<EntityDocument>,
    idFromPath?: string
  ): Promise<EntityDocument> {
    const by = requirePermission(actor, 'engagements.edit', matrix);
    const id = idFromPath || (typeof input.id === 'string' ? input.id : '') || this.ids.next();
    if (!ID_RE.test(id)) throw validationFailed('The entity id is not valid.');
    const existing = await this.entities.findById(id);
    const doc = {
      ...ENTITY_DEFAULTS,
      ...(existing?.doc ?? {}),
      ...input,
      id,
      name: String(input.name ?? existing?.doc.name ?? '').trim()
    } as EntityDocument;
    const problem = entityProblem(doc);
    if (problem) throw validationFailed(problem);
    const clash = await this.entities.findByNameKey(entityNameKey(doc.name));
    if (clash && clash.doc.id !== id) {
      if ((await hiddenEntityIds(this.engagements)).has(clash.doc.id))
        throw conflict(
          `An entity called “${clash.doc.name}” already exists, with only deleted funds. Restore one of its funds from Deleted funds to use it again.`
        );
      throw conflict(`An entity called “${clash.doc.name}” already exists.`);
    }
    const now = this.clock.nowIso();
    if (existing) {
      const updated = {
        doc: { ...doc, createdAt: existing.doc.createdAt ?? existing.createdAt, savedAt: now },
        createdBy: existing.createdBy,
        createdAt: existing.createdAt,
        updatedBy: by.id,
        updatedAt: now
      };
      await this.entities.update(updated);
      return updated.doc;
    }
    const created = {
      doc: { ...doc, createdAt: doc.createdAt ?? now, savedAt: now },
      createdBy: by.id,
      createdAt: now,
      updatedBy: by.id,
      updatedAt: now
    };
    await this.entities.create(created);
    return created.doc;
  }
}
