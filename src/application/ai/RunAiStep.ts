import {
  describeExt,
  extOf,
  isAiStep,
  isSlot,
  MAX_MB,
  SLOT_RULES,
  stepLabel,
  type AiStep,
  type PermissionMatrix,
  type Slot
} from '@fs-review/shared';

import { AppError, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import { requirePermission } from '../identity/authorize.js';
import type { AiGateway, ContentBlock } from '../ports/AiGateway.js';

import type { LoadAiSettings } from './AiSettingsUseCases.js';
import { plainAiError } from './aiErrors.js';
import { PROMPTS, SYSTEM, TOOLS } from './prompts.js';

export interface UploadedFile {
  fileName: string;
  mediaType: string;
  /** base64 for PDFs and images */
  data?: string;
  /** CSV text for spreadsheets */
  text?: string;
}

export interface AiRequestContext {
  engagementId?: string | null;
  fundName?: string | null;
  aiAllowed: boolean;
  currency: string;
  umbrella?: string | null;
}

export type AiStepInput =
  | { step: 'extract'; slot: unknown; file: unknown }
  | { step: 'narrative'; docs: Record<string, unknown>; threshold: number; highMultiple?: number; customChecks?: unknown }
  | { step: 'explain'; lines: unknown; docs: Record<string, unknown>; threshold: number; growth: number }
  | { step: 'version'; priorPoints: unknown; candidatePoints: unknown; previousDraft: unknown; newDraft: unknown; supporting?: unknown };

const fileBlock = (p: UploadedFile): ContentBlock => {
  if (p.mediaType === 'application/pdf')
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data ?? '' } };
  if (p.mediaType?.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data ?? '' } };
  return { type: 'text', text: `<document name="${p.fileName}">\n${p.text ?? ''}\n</document>` };
};
const json = (name: string, obj: unknown): ContentBlock => ({
  type: 'text',
  text: `<${name}>\n${JSON.stringify(obj ?? null)}\n</${name}>`
});

/** Re-checks an upload against its slot's rule before anything is sent to Claude. */
export function checkUpload(slot: unknown, file: unknown): { slot: Slot; file: UploadedFile } {
  if (!isSlot(slot)) throw validationFailed('Unknown document slot.');
  const rule = SLOT_RULES[slot];
  if (!file || typeof file !== 'object') throw validationFailed('No file was received.');
  const f = file as UploadedFile;
  const ext = extOf(f.fileName);
  if (ext !== rule.type) throw validationFailed(`This document must be ${rule.label}; “${f.fileName}” is ${describeExt(ext)}.`);
  if (rule.type === 'pdf') {
    if (f.mediaType !== 'application/pdf' || typeof f.data !== 'string' || !f.data.startsWith('JVBERi0'))
      throw validationFailed(`“${f.fileName}” is not a PDF.`);
    if (f.data.length * 0.75 > MAX_MB * 1048576) throw validationFailed(`“${f.fileName}” is larger than ${MAX_MB} MB.`);
  } else {
    if (f.mediaType !== 'text/csv' || typeof f.text !== 'string' || !f.text.trim())
      throw validationFailed(`“${f.fileName}” could not be read as an Excel workbook.`);
    if (f.text.length > 5_000_000) throw validationFailed(`“${f.fileName}” has too much data to review in one pass.`);
  }
  return { slot, file: f };
}

/**
 * One Claude call. Needs a signed-in user who may run the analysis, a key on the server, AI turned on by
 * an Administrator, that step turned on, and the client not opted out. Every call is logged with tokens.
 */
export class RunAiStep {
  constructor(
    private readonly load: LoadAiSettings,
    private readonly gateway: AiGateway,
    private readonly activity: ActivityRecorder
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, input: AiStepInput, ctx: AiRequestContext, ip?: string): Promise<unknown> {
    const by = requirePermission(actor, 'analysis.run', matrix);
    if (!isAiStep(input.step)) throw validationFailed('Unknown AI step.');
    const ai = await this.load.execute();
    const stop = !this.gateway.keyStatus().configured
      ? 'No Claude API key is configured on the server.'
      : !ai.enabled
        ? 'AI is turned off. An Administrator can turn it on under AI Settings.'
        : !ai.steps[input.step]
          ? `${stepLabel(input.step)} is turned off under AI Settings.`
          : ctx.aiAllowed === false
            ? 'AI is not permitted for this client.'
            : '';
    if (stop) throw new AppError('AI_UNAVAILABLE', stop, { aiOff: true });

    const currency = /^[A-Z]{3}$/.test(ctx.currency || '') ? ctx.currency : 'GBP';
    const { content, tool, maxTokens } = this.build(input, ctx.umbrella ?? null, currency);
    try {
      const r = await this.gateway.structured({
        model: ai.model,
        system: SYSTEM.replaceAll('{CURRENCY}', currency),
        content: content.map((b) => (b.type === 'text' ? { ...b, text: b.text.replaceAll('{CURRENCY}', currency) } : b)),
        tool,
        maxTokens
      });
      await this.activity.record({
        actor: by,
        category: 'AI',
        summary: `AI: ${stepLabel(input.step)}`,
        details: `${r.model} · ${r.inputTokens} tokens in, ${r.outputTokens} out`,
        ip: ip ?? '',
        engagementId: ctx.engagementId ?? null,
        fundName: ctx.fundName ?? null,
        usage: { step: input.step, model: r.model, input: r.inputTokens, output: r.outputTokens }
      });
      return r.output;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('AI_UNAVAILABLE', plainAiError(e));
    }
  }

  private build(input: AiStepInput, umbrella: string | null, currency: string) {
    switch (input.step) {
      case 'extract': {
        const { slot, file } = checkUpload(input.slot, input.file);
        const umb =
          umbrella && slot !== 'sup'
            ? `\n\nThis is an umbrella document covering several sub-funds. Read only the sub-fund “${String(umbrella).slice(0, 120)}”: its own column (drop the other sub-funds and any Total column) or its own section. Keep notes that apply to all sub-funds. Figures must be this sub-fund’s.`
            : '';
        return {
          content: [fileBlock(file), { type: 'text' as const, text: PROMPTS.extract(slot).replaceAll('{CURRENCY}', currency) + umb }],
          tool: TOOLS.extract,
          maxTokens: 16000
        };
      }
      case 'narrative':
        return {
          content: [
            json('current_year_draft', input.docs.cy),
            json('prior_year_signed', input.docs.py),
            json('investment_schedule', input.docs.is),
            json('supporting_information', input.docs.sup ?? null),
            { type: 'text' as const, text: PROMPTS.narrative(input.threshold, input.highMultiple, input.customChecks) }
          ],
          tool: TOOLS.points,
          maxTokens: 8000
        };
      case 'explain':
        return {
          content: [
            json('flagged_lines', input.lines),
            json('prior_year_signed', input.docs.py),
            json('supporting_information', input.docs.sup ?? null),
            { type: 'text' as const, text: PROMPTS.variance(input.threshold, input.growth) }
          ],
          tool: TOOLS.variance,
          maxTokens: 8000
        };
      case 'version':
        return {
          content: [
            json('prior_points', input.priorPoints),
            json('candidate_points_on_new_draft', input.candidatePoints),
            json('previous_draft', input.previousDraft),
            json('new_draft', input.newDraft),
            json('supporting_information', input.supporting ?? null),
            { type: 'text' as const, text: PROMPTS.versionPass() }
          ],
          tool: TOOLS.versionPass,
          maxTokens: 8000
        };
    }
  }
}

export type { AiStep };
