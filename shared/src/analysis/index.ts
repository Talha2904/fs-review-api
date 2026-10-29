// @fs-review/shared/analysis: the deterministic review engine (readers, checks, variance model, sample
// fund), ported from the web app so the api runs exactly the same analysis. No I/O and no AI here:
// reading files, OCR and Claude calls are the caller's (the api's analysis job).
export * from './types.js';
export * from './format.js';
export * from './checkLibrary.js';
export * from './tbMapping.js';
export * from './docChecks.js';
export * from './checks.js';
export * from './readers/lines.js';
export * from './readers/tbReader.js';
export * from './readers/isReader.js';
export * from './readers/fsReader.js';
export * as SampleFund from './sampleFund.js';

import type { Figures, Setup } from './types.js';

/** Figures the engagement can override or add before the checks run: fee period and fee rate. */
export const withSetup = (K: Figures, setup: Setup): Figures => ({
  ...K,
  feeMonths: setup.feeMonths,
  mgmtRate: setup.feeRatePct != null && setup.feeRatePct !== '' ? Number(setup.feeRatePct) / 100 : K.mgmtRate
});

/** The variance model's options from the engagement settings. */
export const varianceOpts = (setup: Setup) => ({
  mode: setup.varianceMode,
  investigatePct: setup.investigatePct,
  explainPct: setup.explainPct
});
