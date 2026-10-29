import { describe, expect, it } from 'vitest';

import { InProcessEventBus } from '../../src/infrastructure/events/InProcessEventBus.js';

describe('InProcessEventBus', () => {
  it('delivers events to every subscriber and stops after unsubscribe', async () => {
    const bus = new InProcessEventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push('a:' + e.topic));
    bus.subscribe((e) => seen.push('b:' + e.topic));
    await bus.publish({ topic: 'review_points', engagementId: 'e1', at: '2026-10-28T00:00:00.000Z' });
    off();
    await bus.publish({ topic: 'signoffs', engagementId: 'e1', at: '2026-10-28T00:00:01.000Z' });
    expect(seen).toEqual(['a:review_points', 'b:review_points', 'b:signoffs']);
    expect(bus.size).toBe(1);
  });

  it('keeps publishing when one subscriber throws', async () => {
    const bus = new InProcessEventBus();
    let ok = false;
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(() => {
      ok = true;
    });
    await expect(bus.publish({ topic: 'x', at: '2026-10-28T00:00:00.000Z' })).resolves.toBeUndefined();
    expect(ok).toBe(true);
  });
});
