import type { WorkflowState } from '@fs-review/shared';

import type { Person } from '../../domain/review/Document.js';

export interface WorkflowEntry {
  state: WorkflowState;
  by: Person | null;
  at: string;
  reason: string;
}

export interface Workflow {
  engagementId: string;
  state: WorkflowState;
  by: Person | null;
  at: string | null;
  reason: string;
  history: WorkflowEntry[];
}

export const EMPTY_WORKFLOW = (engagementId: string): Workflow => ({
  engagementId,
  state: 'preparing',
  by: null,
  at: null,
  reason: '',
  history: []
});

export interface WorkflowRepository {
  get(engagementId: string): Promise<Workflow | null>;
  listAll(): Promise<Workflow[]>;
  save(workflow: Workflow): Promise<void>;
}
