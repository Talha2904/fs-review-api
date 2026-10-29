import type { PermissionMatrix } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { Person } from '../../domain/review/Document.js';
import type { ChecklistAnswerRepository, DisclosureChecklist } from '../ports/ChecklistAnswerRepository.js';
import type { ChecklistItem } from '../ports/ChecklistTemplateRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { EventBus } from '../ports/EventBus.js';

import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
const ANSWERS = ['yes', 'no', 'na'] as const;

/**
 * Answers one checklist item. The first answer copies the firm's checklist into the review, so later
 * edits to the template don't alter a review in progress. A "No" is raised as a point by the web app
 * through the usual RaisePoint route.
 */
export class AnswerChecklistItem {
  constructor(
    private readonly access: ReviewAccess,
    private readonly checklists: ChecklistAnswerRepository,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    input: { framework: string; version: string; items: ChecklistItem[]; itemId: string; answer: string; ref?: string }
  ): Promise<DisclosureChecklist> {
    const by = await this.access.writer(actor, matrix, engagementId, ['points.raise']);
    if (!ANSWERS.includes(input.answer as (typeof ANSWERS)[number])) throw validationFailed('Answer Yes, No or N/A.');
    const now = this.clock.nowIso();
    const next = await this.checklists.update(
      engagementId,
      (current) => {
        let c = current;
        if (!c || c.framework !== input.framework) {
          if (!Array.isArray(input.items) || !input.items.length) throw validationFailed('The checklist items are missing.');
          c = { engagementId, framework: input.framework, version: String(input.version || ''), items: input.items, answers: {} };
        }
        if (!c.items.some((i) => i.id === input.itemId)) throw validationFailed('That item is not on this review’s checklist.');
        const answered: DisclosureChecklist = {
          ...c,
          answers: {
            ...c.answers,
            [input.itemId]: {
              answer: input.answer as (typeof ANSWERS)[number],
              ref: String(input.ref || '').slice(0, 200),
              by: who(by),
              at: now
            }
          }
        };
        return answered;
      },
      now
    );
    await this.events.publish({ topic: 'disclosure_checklists', engagementId, at: now });
    return next;
  }
}
