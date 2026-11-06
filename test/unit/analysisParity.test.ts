// Phase 6 acceptance: the api's analysis gives exactly the result the browser's analysis gave on the same
// documents and settings. golden/*.json were recorded from the web app's own pipeline by
// scripts/analysis-parity.ts --write; this test runs the api's port and compares.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AnalysisResult } from '@fs-review/shared/analysis';

import { FIXTURES, normalise, SCENARIOS } from '../fixtures/analysis/scenarios.js';
import { runServerScenario } from '../helpers/analysisParity.js';

interface Golden {
  settingsSig: string;
  ticks: number[];
  aiCalls: string[];
  result: AnalysisResult;
}
const golden = (name: string): Golden => JSON.parse(readFileSync(path.join(FIXTURES, 'golden', `${name}.json`), 'utf8')) as Golden;

describe('analysis on the server matches the browser analysis (Phase 6)', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: ${sc.about}`, async () => {
      const want = golden(sc.name);
      const previous = sc.previous ? golden(sc.previous).result : null;
      const got = await runServerScenario(sc, previous);
      expect(normalise(got.result)).toEqual(want.result);
      expect(got.settingsSig).toBe(want.settingsSig);
      expect(got.ticks).toEqual(want.ticks);
      expect([...got.aiCalls].sort()).toEqual(want.aiCalls);
    }, 30_000);
  }
});

describe('a fresh analysis of a fund that already has points (audit finding)', () => {
  it('keeps the reference of a finding raised before and never gives an old reference to a new finding', async () => {
    const sc = SCENARIOS.find((x) => x.name === 'meridian-no-ai')!;
    const first = golden(sc.name).result.points;
    const fee = first.find((p) => /Management fee/.test(p.title))!;
    // the fund has RP-01 for something else, and the fee point under RP-07 from an earlier run
    const existing = [
      { ref: 'RP-01', title: 'Bank confirmation outstanding' },
      { ref: 'RP-07', title: fee.title }
    ];
    const { result } = await runServerScenario(sc, null, existing);
    expect(result.points.find((p) => p.title === fee.title)!.ref).toBe('RP-07');
    const others = result.points.filter((p) => p.title !== fee.title).map((p) => p.ref);
    expect(others).toEqual(['RP-08', 'RP-09', 'RP-10']);
    expect(result.points.some((p) => p.ref === 'RP-01')).toBe(false);
  }, 30_000);
});

describe('the review and the variance commentary run at the same time', () => {
  const sc = SCENARIOS.find((x) => x.name === 'meridian-ai')!;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('the commentary starts before the review has answered, and the result is exactly as before', async () => {
    const events: string[] = [];
    const got = await runServerScenario(sc, null, [], async (step) => {
      events.push(`${step}:start`);
      if (step === 'narrative') await pause(50);
      events.push(`${step}:end`);
    });
    expect(events.indexOf('explain:start')).toBeGreaterThan(-1);
    expect(events.indexOf('explain:start')).toBeLessThan(events.indexOf('narrative:end'));
    expect(normalise(got.result)).toEqual(golden(sc.name).result);
  }, 30_000);

  it('a failed review stops the analysis, but only once the commentary has finished', async () => {
    let explained = false;
    await expect(
      runServerScenario(sc, null, [], async (step) => {
        if (step === 'narrative') throw new Error('the review failed');
        if (step === 'explain') {
          await pause(50);
          explained = true;
        }
      })
    ).rejects.toThrow('the review failed');
    expect(explained).toBe(true);
  }, 30_000);

  it('a failed commentary still gives the review and says the explanations are missing', async () => {
    const got = await runServerScenario(sc, null, [], async (step) => {
      if (step === 'explain') throw new Error('incomplete');
    });
    expect(got.result.aiSkipped).toEqual(['Variance explanations (the AI answer was incomplete)']);
    expect(got.result.points.some((p) => p.aiDrafted)).toBe(true);
    expect(got.result.varNotes).toEqual({});
  }, 30_000);
});
