import type { ActivityEntry } from '../../domain/activity/ActivityEntry.js';

export interface ActivityQuery {
  engagementId?: string | null;
  limit: number;
}

/** AI usage as billing needs it: one record per Claude call, taken from the log. */
export interface UsageRow {
  id: string;
  at: string;
  engagementId: string;
  fundName: string;
  step: string;
  model: string;
  input: number;
  output: number;
}

export interface ActivityLog {
  append(entry: ActivityEntry): Promise<void>;
  /** Newest first. */
  list(q: ActivityQuery): Promise<ActivityEntry[]>;
  /** Every entry that carries AI usage and an engagement id, oldest first. */
  usage(): Promise<UsageRow[]>;
}
