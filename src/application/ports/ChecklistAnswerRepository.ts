import type { Person } from '../../domain/review/Document.js';

import type { ChecklistItem } from './ChecklistTemplateRepository.js';

export interface ChecklistAnswer {
  answer: 'yes' | 'no' | 'na';
  ref: string;
  by: Person | null;
  at: string;
}

/** The checklist a review copied when first answered, so later edits to the firm's list don't alter a review in progress. */
export interface DisclosureChecklist {
  engagementId: string;
  framework: string;
  version: string;
  items: ChecklistItem[];
  answers: Record<string, ChecklistAnswer>;
}

export interface ChecklistAnswerRepository {
  get(engagementId: string): Promise<DisclosureChecklist | null>;
  listAll(): Promise<DisclosureChecklist[]>;
  /**
   * Applies `change` to the current checklist and saves the result atomically, so two people answering at
   * once both keep their answer. `change` may throw to refuse.
   */
  update(
    engagementId: string,
    change: (current: DisclosureChecklist | null) => DisclosureChecklist,
    at: string
  ): Promise<DisclosureChecklist>;
}
