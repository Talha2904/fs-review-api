// Review points and their threads. A point's status cycle is Open → Responded → Cleared, or
// Reopened → Responded → Cleared (shared/workflow.ts). Messages are never edited or deleted.
import type { PointStatus } from '@fs-review/shared';

import type { Person } from './Document.js';

export type PointSource = 'analysis' | 'manual';
export type PointType = 'change' | 'explain' | 'info';
export const POINT_TYPES: readonly PointType[] = ['change', 'explain', 'info'];
export const TYPE_LABEL: Record<PointType, string> = { change: 'Needs a change', explain: 'Needs an explanation', info: 'For information' };

/** What the analysis or a person said: title, basis, priority, area, amount, references, follow-up, anchor. */
export interface PointContent {
  ref?: string;
  title: string;
  pri?: string;
  area?: string;
  basis?: string;
  amount?: number | null;
  refs?: string;
  follow?: string;
  doc?: string;
  anchor?: string;
  agent?: string;
  agentNote?: string;
  rule?: string;
  aiDrafted?: boolean;
  source?: string;
  [extra: string]: unknown;
}

export interface ReviewPoint {
  id: string;
  engagementId: string;
  ref: string;
  source: PointSource;
  content: PointContent;
  status: PointStatus;
  type: PointType;
  dueDate: string | null;
  assignedTo: Person | null;
  raisedBy: Person | null;
  raisedAt: string;
  clearedBy: Person | null;
  clearedAt: string | null;
  updatedAt: string;
}

export type MessageKind = 'raise' | 'assign' | 'comment' | 'response' | 'reopen' | 'clear' | 'note';

export type Attachment =
  | { type: 'version'; slot: string; versionId: string; version: number; fileName: string }
  | { type: 'evidence'; id: string; fileName: string; size: number };

export interface PointMessage {
  id: string;
  pointId: string;
  engagementId: string;
  kind: MessageKind;
  author: Person | null;
  at: string;
  text: string;
  attachments: Attachment[];
}

export interface PointEvidence {
  id: string;
  engagementId: string;
  pointId: string;
  fileName: string;
  size: number;
  sha256: string;
  storageKey: string;
  by: Person | null;
  at: string;
}

export const EVIDENCE_EXT = /\.(pdf|xlsx|xls|csv|docx|doc|png|jpe?g|msg|eml|txt)$/i;
export const EVIDENCE_MAX_BYTES = 25 * 1048576;

/** Variance points ask for an explanation; everything else asks for a change. */
export const typeFor = (content: PointContent): PointType => (/variance/i.test(content.area || '') ? 'explain' : 'change');

/** The next free reference with this prefix, e.g. RP-07 after RP-06, RP-D2 after RP-D1. */
export function nextRef(prefix: string, existing: readonly string[]): string {
  const pad = prefix === 'RP-' ? 2 : 1;
  const n =
    Math.max(
      0,
      ...existing.filter((r) => r.startsWith(prefix) && /^\d+$/.test(r.slice(prefix.length))).map((r) => +r.slice(prefix.length))
    ) + 1;
  return prefix + String(n).padStart(pad, '0');
}
