import type { PermissionMatrix } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { ChecklistItem, ChecklistTemplate, ChecklistTemplateRepository } from '../ports/ChecklistTemplateRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export const FRAMEWORKS = ['FRS 102', 'IFRS', 'Other'] as const;

/** Cleans imported or edited items the same way the Administration screen does. */
export function cleanChecklistItems(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) throw validationFailed('A checklist needs at least one item.');
  const items = raw
    .map((x, i) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const kw = Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? '').split(',');
      return {
        id: String(r.id || `item-${i + 1}`).slice(0, 80),
        ref: String(r.ref ?? '')
          .trim()
          .slice(0, 40),
        section: (String(r.section ?? '').trim() || 'General').slice(0, 120),
        text: String(r.text ?? '')
          .trim()
          .slice(0, 1000),
        keywords: kw
          .map((k) => String(k).trim())
          .filter(Boolean)
          .slice(0, 20)
      };
    })
    .filter((x) => x.text);
  if (!items.length) throw validationFailed('A checklist needs at least one item.');
  if (items.length > 500) throw validationFailed('A checklist can hold up to 500 items.');
  return items;
}

/** v1, v2, … after the current version; a starter or unknown version starts at v1. */
export const nextChecklistVersion = (current: string | undefined): string => {
  const n = /^v(\d+)$/.exec(current || '')?.[1];
  return `v${n ? +n + 1 : 1}`;
};

/** Anyone signed in reads the checklists (reviewers answer them); Administrators save them. */
export class GetChecklists {
  constructor(private readonly repo: ChecklistTemplateRepository) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<Record<string, ChecklistTemplate>> {
    requirePermission(actor, 'activity.write', matrix);
    return Object.fromEntries((await this.repo.list()).map((t) => [t.framework, t]));
  }
}

export class SaveChecklist {
  constructor(
    private readonly repo: ChecklistTemplateRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, framework: string, items: unknown): Promise<ChecklistTemplate> {
    const by = requirePermission(actor, 'users.manage', matrix);
    if (!(FRAMEWORKS as readonly string[]).includes(framework)) throw validationFailed('Choose a framework from the list.');
    const current = await this.repo.get(framework);
    const template: ChecklistTemplate = {
      framework,
      version: nextChecklistVersion(current?.version),
      items: cleanChecklistItems(items),
      savedBy: by.id,
      savedAt: this.clock.nowIso()
    };
    await this.repo.save(template, this.ids.next());
    return template;
  }
}
