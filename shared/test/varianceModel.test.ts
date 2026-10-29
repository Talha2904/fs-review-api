import { describe, expect, it } from 'vitest';

import { varianceModel, type Doc, type VarNote } from '../src/analysis/index.js';

// One income line that moved +100% against a flat net-asset expectation: the model bands it Investigate.
const draft: Doc = {
  title: 'Draft',
  meta: '',
  blocks: [
    { k: 'head', title: 'Statement of Comprehensive Income' },
    { k: 'table', cols: ['2026', '2025'], rows: [{ l: 'Interest income', v: [200000, 100000] }] }
  ]
} as unknown as Doc;
const note = (band: string, aiDrafted = true): Record<string, VarNote> => ({
  'Interest income': { band, pri: 'Low', expect: 'Tracking bond holdings', note: 'Claude’s note.', action: 'Agree to holdings.', aiDrafted }
});
const bandOf = (notes: Record<string, VarNote> | null) => varianceModel(draft, notes, 10000, 0).rows[0]?.band;

describe('variance model: Claude may escalate a band but never lower it', () => {
  it('bands the line Investigate on its own', () => {
    expect(bandOf(null)).toBe('Investigate');
  });

  it('keeps Investigate when Claude answers Explain', () => {
    expect(bandOf(note('Explain'))).toBe('Investigate');
  });

  it('keeps Claude’s escalation from Explain to Investigate', () => {
    const r = varianceModel(draft, note('Investigate'), 10000, 0, { investigatePct: 500, explainPct: 15 }).rows[0];
    expect(r?.band).toBe('Investigate');
  });

  it('uses Claude’s commentary with the kept band', () => {
    const r = varianceModel(draft, note('Explain'), 10000, 0).rows[0];
    expect(r?.note).toBe('Claude’s note.');
  });

  it('leaves hand-written sample notes as written', () => {
    expect(bandOf(note('Explain', false))).toBe('Explain');
  });
});
