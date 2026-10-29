// Runs a scenario through the api's analysis engine with the real document reader and canned AI.
// Used by test/unit/analysisParity.test.ts and by scripts/analysis-parity.ts.
import { currencyOf, settingsSignature, setupFor, type AnalysisResult, type DocSlot, type Reading } from '@fs-review/shared/analysis';

import type { AiStepInput } from '../../src/application/ai/RunAiStep.js';
import { AiAnalysisSteps } from '../../src/application/analysis/AiAnalysisSteps.js';
import { liveAnalysis, sampleAnalysis, type AnalysisFile } from '../../src/application/analysis/AnalysisPipeline.js';
import { PdfJsDocumentReader } from '../../src/infrastructure/documents/PdfJsDocumentReader.js';
import { cannedAi, fileBytes, sha256Of, type Scenario } from '../fixtures/analysis/scenarios.js';

export interface EngineRun {
  result: AnalysisResult;
  settingsSig: string;
  ticks: number[];
  aiCalls: string[];
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function runServerScenario(
  sc: Scenario,
  previous: AnalysisResult | null,
  existing: { ref: string; title: string }[] = []
): Promise<EngineRun> {
  const { setup, library } = setupFor(sc.engagement, sc.entity, sc.config);
  const ticks: number[] = [],
    aiCalls: string[] = [];
  const tick = (n: number) => ticks.push(n);
  if (sc.kind === 'sample')
    return { result: sampleAnalysis(previous ? 3 : 2, setup, tick), settingsSig: settingsSignature(setup), ticks, aiCalls };

  const reader = new PdfJsDocumentReader();
  const files: Partial<Record<DocSlot, AnalysisFile>> = {};
  const kept = new Map<string, Reading>();
  for (const [slot, f] of Object.entries(sc.files) as [DocSlot, NonNullable<Scenario['files'][DocSlot]>][]) {
    const bytes = fileBytes(f);
    const sha256 = sha256Of(bytes);
    files[slot] = { name: f.name, sample: !!f.sample, sha256, readWith: f.readWith ?? null, bytes: async () => bytes as Uint8Array };
    if (sc.seedReadings?.includes(slot))
      kept.set(`${slot}:${sha256}`, json(cannedAi('extract', { slot, file: { fileName: f.name } })) as Reading);
  }
  const ai = new AiAnalysisSteps(async (input: AiStepInput) => {
    aiCalls.push(input.step);
    return json(cannedAi(input.step, json(input) as unknown as Record<string, unknown>));
  }, reader);
  const result = await liveAnalysis(
    { files, setup, library, previous, ai: sc.ai, umbrella: sc.umbrella, currency: currencyOf(setup.fund?.currency), existing },
    {
      reader,
      ai,
      readings: {
        get: async (slot, sha) => kept.get(`${slot}:${sha}`) ?? null,
        put: async (slot, sha, r) => void kept.set(`${slot}:${sha}`, r)
      },
      ocr: null,
      tick
    }
  );
  return { result, settingsSig: settingsSignature(setup), ticks, aiCalls };
}
