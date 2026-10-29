import type { SignoffState } from '@fs-review/shared';

import type { Person } from '../../domain/review/Document.js';

export interface SignoffEntry {
  state: SignoffState;
  by: Person | null;
  at: string;
  text: string;
  summary: unknown;
}

export interface Signoff {
  engagementId: string;
  state: SignoffState;
  by: Person | null;
  at: string | null;
  text: string;
  summary: unknown;
  history: SignoffEntry[];
}

export const EMPTY_SIGNOFF = (engagementId: string): Signoff => ({
  engagementId,
  state: 'none',
  by: null,
  at: null,
  text: '',
  summary: null,
  history: []
});

export interface SignoffRepository {
  get(engagementId: string): Promise<Signoff | null>;
  listAll(): Promise<Signoff[]>;
  save(signoff: Signoff): Promise<void>;
}
