// The four places the app uses AI, and the models an Administrator can choose. Shared by the api
// (which enforces the settings) and the web app (which explains them).

export const AI_STEPS = [
  {
    id: 'extract',
    label: 'Reading real documents',
    desc: 'Turns an uploaded PDF or spreadsheet into structured statements and figures.',
    off: 'Real documents can be attached and checked, but not analysed. The built-in samples still work.'
  },
  {
    id: 'narrative',
    label: 'Narrative review',
    desc: 'Finds stale wording, wrong directors, missing subsequent events, currency labels, and the firm’s own narrative rules.',
    off: 'The analysis runs without narrative points; recalculation checks still run.'
  },
  {
    id: 'explain',
    label: 'Variance explanations',
    desc: 'Writes the explanation for each flagged movement.',
    off: 'Movements are still flagged by the app’s own arithmetic, without written explanations.'
  },
  {
    id: 'version',
    label: 'Version pass',
    desc: 'Decides which points a new draft resolved, which are still outstanding, and what is new.',
    off: 'A new draft is analysed as a fresh analysis; existing points keep their status and the reviewer decides.'
  }
] as const;
export type AiStep = (typeof AI_STEPS)[number]['id'];

export const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Recommended: strong accuracy at moderate cost and speed.' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Most thorough; slower and more expensive.' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Fastest and lowest cost; best for simpler documents.' }
] as const;
export type ModelId = (typeof MODELS)[number]['id'];

export interface AiAcknowledgement {
  by: { id: string; name: string };
  at: string;
  text?: string;
}

export interface AiSettings {
  enabled: boolean;
  acknowledgement: AiAcknowledgement | null;
  steps: Record<AiStep, boolean>;
  model: ModelId;
}

export const DEFAULT_AI: AiSettings = {
  enabled: false,
  acknowledgement: null,
  steps: { extract: true, narrative: true, explain: true, version: true },
  model: 'claude-sonnet-5-5'
};

const isModel = (m: unknown): m is ModelId => MODELS.some((x) => x.id === m);

/** Accepts anything saved or sent and returns a complete, valid settings object. AI is on only with an acknowledgement. */
export function normalizeAi(s: unknown): AiSettings {
  const src = (s && typeof s === 'object' ? s : {}) as Partial<Record<string, unknown>>;
  const stepsIn = (src.steps && typeof src.steps === 'object' ? src.steps : {}) as Record<string, unknown>;
  const steps = Object.fromEntries(AI_STEPS.map((x) => [x.id, stepsIn[x.id] !== false])) as Record<AiStep, boolean>;
  const ack = src.acknowledgement && typeof src.acknowledgement === 'object' ? (src.acknowledgement as AiAcknowledgement) : null;
  return { enabled: !!src.enabled && !!ack, acknowledgement: ack, steps, model: isModel(src.model) ? src.model : DEFAULT_AI.model };
}

export const stepLabel = (id: string): string => AI_STEPS.find((s) => s.id === id)?.label || id;
export const isAiStep = (id: unknown): id is AiStep => AI_STEPS.some((s) => s.id === id);
