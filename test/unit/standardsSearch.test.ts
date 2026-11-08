// The standards the AI review is given (Phase 6): only what is in force for the fund's period, worked out from its
// year end at every review; only paragraph references that were sent survive in a point; a broken index never
// breaks a review.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkCitations, extractsBlock, inForce, periodStart, selectPassages } from '../../src/application/ai/standardsSearch.js';
import type { StandardPassage } from '../../src/application/ports/StandardsLibrary.js';
import { FileStandardsLibrary } from '../../src/infrastructure/standards/FileStandardsLibrary.js';

const p = (ref: string, std: string, topic: string, text: string): StandardPassage => ({ ref, std, topic, text });

describe('standards in force for the period', () => {
  it('works out the period from the year end, and uses today when the year end is not known', () => {
    expect(periodStart('2025-12-31')).toBe('2025-01-01');
    expect(periodStart('2026-03-31')).toBe('2025-04-01');
    expect(periodStart('2024-02-29')).toBe('2023-03-01');
    expect(periodStart('', new Date('2026-11-08T10:00:00Z'))).toBe('2026-11-08');
  });

  it('leaves out what is not yet in force, by the standards’ own effective dates', () => {
    const frs = [
      p('FRS 102 2A.1', 'FRS 102 Section 2A', 'Fair Value Measurement', 'x'),
      p('FRS 102 20.1', 'FRS 102 Section 20', 'Leases', 'x'),
      p('FRS 102 33.9', 'FRS 102 Section 33', 'Related Party Disclosures', 'x')
    ];
    expect(inForce('FRS 102', frs, '2025-01-01').map((x) => x.ref)).toEqual(['FRS 102 33.9']);
    expect(inForce('FRS 102', frs, '2026-01-01')).toHaveLength(3);
    const ifrs = [p('IFRS 18 75', 'IFRS 18', 't', 'x'), p('IFRS 19 56', 'IFRS 19', 't', 'x'), p('IAS 24 18', 'IAS 24', 't', 'x')];
    expect(inForce('IFRS', ifrs, '2026-01-01').map((x) => x.ref)).toEqual(['IAS 24 18']);
    expect(inForce('IFRS', ifrs, '2027-01-01')).toHaveLength(3);
  });

  it('tells the AI the edition, the period and what was left out', () => {
    const block = extractsBlock('FRS 102', [p('FRS 102 33.9', 'FRS 102 Section 33', 'Related Party Disclosures', 'Text.')], '2025-01-01');
    expect(block).toContain('FRS 102 (September 2024 edition)');
    expect(block).toContain('The period reviewed begins 2025-01-01');
    expect(block).toContain('Not yet in force for this period, so left out: Sections 2A, 20 and 23');
    expect(extractsBlock('FRS 102', [], '2026-04-01')).not.toContain('Not yet in force');
  });
});

describe('citations', () => {
  it('keeps references that were sent and cuts any other paragraph back to the standard’s name', () => {
    const sent = new Set(['FRS 102 33.9', 'IAS 24 18', 'IAS 12 51 (continued)']);
    expect(checkCitations('Note 5 · FRS 102 33.9 · IAS 24 18', sent)).toBe('Note 5 · FRS 102 33.9 · IAS 24 18');
    expect(checkCitations('IAS 24 99 · FRS 102 33.77', sent)).toBe('IAS 24 (paragraph not verified) · FRS 102 (paragraph not verified)');
    expect(checkCitations('IAS 12 51 (continued)', sent)).toBe('IAS 12 51 (continued)');
    expect(checkCitations('IAS 24 (related party disclosures)', sent)).toBe('IAS 24 (related party disclosures)');
  });
});

describe('the standards index', () => {
  it('a broken or partly broken file is read as no standards, or without its broken rows, never an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'standards-')) + '/';
    writeFileSync(dir + 'frs102.json', '{ not json');
    writeFileSync(
      dir + 'ifrs.json',
      JSON.stringify([
        { ref: 'IAS 24 18', std: 'IAS 24', topic: 'x', text: 'y' },
        { ref: 'IAS 1 1', text: 'no std' }
      ])
    );
    const lib = new FileStandardsLibrary(undefined, dir);
    expect(await lib.passages('FRS 102')).toEqual([]);
    expect((await lib.passages('IFRS')).map((x) => x.ref)).toEqual(['IAS 24 18']);
  });

  it('the real index picks the matching paragraphs for a fund’s notes', async () => {
    const lib = new FileStandardsLibrary();
    const frs = inForce('FRS 102', await lib.passages('FRS 102'), '2025-01-01');
    const chosen = selectPassages(frs, [{ heading: 'Related Party Transactions', text: 'management fee payable to the manager' }]);
    expect(chosen.some((x) => x.std === 'FRS 102 Section 33')).toBe(true);
    expect(chosen.some((x) => /Section (2A|20|23)$/.test(x.std))).toBe(false);
  });
});
