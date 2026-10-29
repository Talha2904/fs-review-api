import { newActivityEntry, type ActivityActor, type AiUsageRecord } from '../../domain/activity/ActivityEntry.js';
import type { ActivityLog } from '../ports/ActivityLog.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface RecordInput {
  actor: ActivityActor | null;
  category: string;
  summary: string;
  details?: string;
  ip?: string;
  engagementId?: string | null;
  fundName?: string | null;
  usage?: AiUsageRecord;
}

/** The one way anything writes to the activity log. The actor is whoever the session says, never the request body. */
export class ActivityRecorder {
  constructor(
    private readonly log: ActivityLog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async record(input: RecordInput) {
    const entry = newActivityEntry(this.ids.next(), this.clock.nowIso(), input);
    await this.log.append(entry);
    return entry;
  }
}
