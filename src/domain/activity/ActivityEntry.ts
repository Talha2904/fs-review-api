/** One line of the append-only activity log. Nothing edits or deletes an entry. */
export interface ActivityActor {
  id: string;
  name: string;
  username: string;
  role: string;
}

export interface AiUsageRecord {
  step: string;
  model: string;
  input: number;
  output: number;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: ActivityActor | null;
  category: string;
  summary: string;
  details: string;
  ip: string;
  engagementId: string | null;
  fundName: string | null;
  usage?: AiUsageRecord;
}

export interface NewActivity {
  actor: ActivityActor | null;
  category: string;
  summary: string;
  details?: string;
  ip?: string;
  engagementId?: string | null;
  fundName?: string | null;
  usage?: AiUsageRecord;
}

const clip = (v: unknown, n: number): string => String(v ?? '').slice(0, n);

/** Applies the same length limits the old server used, so the log stays bounded. */
export function newActivityEntry(id: string, at: string, a: NewActivity): ActivityEntry {
  return {
    id,
    at,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name, username: a.actor.username, role: a.actor.role } : null,
    category: clip(a.category, 40),
    summary: clip(a.summary, 300),
    details: clip(a.details, 1000),
    ip: clip(a.ip, 64),
    engagementId: a.engagementId ? clip(a.engagementId, 80) : null,
    fundName: a.fundName ? clip(a.fundName, 200) : null,
    ...(a.usage
      ? {
          usage: {
            step: clip(a.usage.step, 20),
            model: clip(a.usage.model, 80),
            input: Math.max(0, Math.round(Number(a.usage.input) || 0)),
            output: Math.max(0, Math.round(Number(a.usage.output) || 0))
          }
        }
      : {})
  };
}
