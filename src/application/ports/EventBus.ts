// Live updates. A use case publishes after its transaction commits; the SSE endpoint subscribes.
// Adapters: InProcessEventBus (one api instance), RedisEventBus (several). Never Postgres NOTIFY or a
// vendor realtime service, so this works on any database and host.

export interface DomainEvent {
  /** Table or aggregate that changed, e.g. "review_points". */
  readonly topic: string;
  /** Engagement the change belongs to, when there is one. */
  readonly engagementId?: string;
  /** ISO timestamp of the change. */
  readonly at: string;
  /** Small, non-sensitive payload. Never document contents. */
  readonly data?: Record<string, unknown>;
}

export type EventHandler = (event: DomainEvent) => void;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  /** Returns a function that removes the subscription. */
  subscribe(handler: EventHandler): () => void;
}
