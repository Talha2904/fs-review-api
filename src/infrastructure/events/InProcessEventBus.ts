import type { DomainEvent, EventBus, EventHandler } from '../../application/ports/EventBus.js';

/** Event bus for a single api instance. Handlers run in order; one failing handler does not stop the others. */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Set<EventHandler>();

  async publish(event: DomainEvent): Promise<void> {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        // a subscriber's failure is its own problem; publishing must not fail the use case
      }
    }
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get size(): number {
    return this.handlers.size;
  }
}
