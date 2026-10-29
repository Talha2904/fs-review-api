import { describe, expect, it } from 'vitest';

import { DEFAULT_AI, normalizeAi, stepLabel } from '../src/aiOptions.js';

describe('AI settings', () => {
  it('AI stays off without an acknowledgement, even if enabled is sent', () => {
    expect(normalizeAi({ enabled: true }).enabled).toBe(false);
    const ack = { by: { id: 'a1', name: 'Hamza' }, at: '2026-10-28T00:00:00Z' };
    expect(normalizeAi({ enabled: true, acknowledgement: ack })).toMatchObject({ enabled: true, acknowledgement: ack });
  });

  it('unknown models fall back to the default and missing steps default on', () => {
    const s = normalizeAi({ model: 'gpt-9', steps: { narrative: false } });
    expect(s.model).toBe(DEFAULT_AI.model);
    expect(s.steps).toEqual({ extract: true, narrative: false, explain: true, version: true });
  });

  it('labels steps', () => {
    expect(stepLabel('extract')).toBe('Reading real documents');
    expect(stepLabel('other')).toBe('other');
  });
});
