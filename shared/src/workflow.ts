// Review workflow and sign-off states, shared by the web app and the api so both sides agree on the
// state machine. The api enforces the transitions; the web app shows what is possible.

export const WORKFLOW_STATES = ['preparing', 'ready', 'returned'] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

// 'manager-signed' is the Manager's sign-off where a Partner must still sign; 'signed' is final.
export const SIGNOFF_STATES = ['none', 'returned', 'resubmitted', 'manager-signed', 'signed', 'unlocked'] as const;
export type SignoffState = (typeof SIGNOFF_STATES)[number];

export const POINT_STATUSES = ['open', 'responded', 'reopened', 'cleared'] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

/** Sign-off states in which documents, points, analysis and settings are read-only. */
export const LOCKED_SIGNOFF_STATES: readonly SignoffState[] = ['manager-signed', 'signed'];

export const isLockedSignoff = (state: SignoffState): boolean => LOCKED_SIGNOFF_STATES.includes(state);

/** Allowed document workflow transitions. */
const WORKFLOW_TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  preparing: ['ready'],
  ready: ['returned'],
  returned: ['ready']
};

export const canTransitionWorkflow = (from: WorkflowState, to: WorkflowState): boolean => WORKFLOW_TRANSITIONS[from].includes(to);

/** Allowed review point transitions by action. */
export const POINT_ACTIONS = {
  response: { from: ['open', 'reopened'] as readonly PointStatus[], to: 'responded' as PointStatus },
  reopen: { from: ['responded', 'cleared'] as readonly PointStatus[], to: 'reopened' as PointStatus },
  clear: { from: ['open', 'responded', 'reopened'] as readonly PointStatus[], to: 'cleared' as PointStatus }
} as const;
export type PointAction = keyof typeof POINT_ACTIONS;

export const nextPointStatus = (current: PointStatus, action: PointAction): PointStatus | null => {
  const rule = POINT_ACTIONS[action];
  return rule.from.includes(current) ? rule.to : null;
};
