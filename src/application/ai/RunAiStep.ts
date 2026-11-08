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
import type { StandardsLibrary } from '../ports/StandardsLibrary.js';

import type { LoadAiSettings } from './AiSettingsUseCases.js';
import { plainAiError } from './aiErrors.js';
import { describeEntity, describeFramework, PROMPTS, STANDARDS_RULE, SYSTEM, TOOLS } from './prompts.js';
import { checkCitations, draftQuery, extractsBlock, inForce, periodStart, selectPassages, standardsFramework } from './standardsSearch.js';

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
  /** the entity's type and accounting framework, which the review applies */
  entityType?: string | null;
  framework?: string | null;
  /** the fund's year end: which standards are in force for its period */
  periodEnd?: string | null;
  /**
   * A call made for several funds at once (the Consolidated Review): its usage is recorded against each of
   * them, split evenly, so every fund's AI usage is still billed and nothing is counted twice.
   */
  shareWith?: { engagementId: string; fundName: string | null }[];
}

export type AiStepInput =
  | { step: 'extract'; slot: unknown; file: unknown }
  | { step: 'narrative'; docs: Record<string, unknown>; threshold: number; highMultiple?: number; customChecks?: unknown }
  | { step: 'explain'; lines: unknown; docs: Record<string, unknown>; threshold: number; growth: number }
  | { step: 'version'; priorPoints: unknown; candidatePoints: unknown; previousDraft: unknown; newDraft: unknown; supporting?: unknown }
  | { step: 'consolidated'; input: unknown };

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
/**
 * The most Claude may write in one answer, thinking included. Calls are streamed (AnthropicGateway), so this
 * can be well above the 21,000 a request that is not streamed allows. It is a ceiling, not a charge: only the
 * tokens Claude writes are billed. Current models allow up to 128,000. The review writes the most (18,307 seen in
 * production); the other steps under 14,000. Kept below the maximum so a whole analysis stays well inside the
 * 60 minutes after which a job is treated as stuck.
 */
const REVIEW_TOKENS = 64000;
const STEP_TOKENS = 32000;
/** A workbook as CSV text, when there is one; capped so one large file cannot crowd out the rest. */
const WORKBOOK_CHARS = 150_000;
const workbook = (name: string, text: unknown): ContentBlock[] =>
  typeof text === 'string' && text.trim() ? [{ type: 'text', text: `<${name}>\n${text.slice(0, WORKBOOK_CHARS)}\n</${name}>` }] : [];

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
    private readonly activity: ActivityRecorder,
    /** the FRS 102 and IFRS passages the narrative review cites (Phase 6); without it the review runs as before */
    private readonly standards?: StandardsLibrary
  ) {}

  /** The passages of the fund's framework most relevant to its draft, as one text block; null when none apply. */
  private async extracts(
    input: AiStepInput,
    ctx: AiRequestContext,
    useStandards: boolean
  ): Promise<{ block: string; count: number; refs: Set<string> } | null> {
    if (input.step !== 'narrative' || !this.standards || !useStandards) return null;
    const fw = standardsFramework(ctx.framework);
    if (!fw) return null;
    // only what is in force for this fund's period (worked out from its year end at every review)
    const start = periodStart(ctx.periodEnd);
    const chosen = selectPassages(inForce(fw, await this.standards.passages(fw), start), draftQuery(input.docs.cy, ctx.entityType));
    return chosen.length
      ? { block: extractsBlock(fw, chosen, start), count: chosen.length, refs: new Set(chosen.map((p) => p.ref)) }
      : null;
  }

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
    // the standards add context only: if they cannot be read or searched, the review runs without them
    const standards = await this.extracts(input, ctx, ai.standards !== false).catch(() => null);
    const { content, tool, maxTokens } = this.build(input, ctx.umbrella ?? null, currency, standards?.block ?? null);
    try {
      const r = await this.gateway.structured({
        model: ai.model,
        system: SYSTEM.replaceAll('{CURRENCY}', currency)
          .replaceAll('{ENTITY}', describeEntity(ctx.entityType))
          .replaceAll('{FRAMEWORK}', describeFramework(ctx.framework)),
        content: content.map((b) => (b.type === 'text' ? { ...b, text: b.text.replaceAll('{CURRENCY}', currency) } : b)),
        tool,
        maxTokens
      });
      const funds = ctx.shareWith?.length ? ctx.shareWith : [{ engagementId: ctx.engagementId ?? null, fundName: ctx.fundName ?? null }];
      const share = (total: number, i: number) => Math.floor(total / funds.length) + (i < total % funds.length ? 1 : 0);
      for (const [i, f] of funds.entries()) {
        const inT = share(r.inputTokens, i),
          outT = share(r.outputTokens, i);
        await this.activity.record({
          actor: by,
          category: 'AI',
          summary: `AI: ${stepLabel(input.step)}`,
          details: `${r.model} · ${inT} tokens in, ${outT} out${funds.length > 1 ? ` (share of one call for ${funds.length} funds)` : ''}${standards ? ` · ${standards.count} standards paragraphs` : ''}`,
          ip: ip ?? '',
          engagementId: f.engagementId,
          fundName: f.fundName,
          usage: { step: input.step, model: r.model, input: inT, output: outT }
        });
      }
      return standards ? withCheckedCitations(r.output, standards.refs) : r.output;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('AI_UNAVAILABLE', plainAiError(e));
    }
  }

  private build(input: AiStepInput, umbrella: string | null, currency: string, standards: string | null = null) {
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
          maxTokens: STEP_TOKENS
        };
      }
      case 'narrative':
        return {
          content: [
            json('current_year_draft', input.docs.cy),
            json('prior_year_signed', input.docs.py),
            json('investment_schedule', input.docs.is),
            json('supporting_information', input.docs.sup ?? null),
            json('agreements_and_correspondence', input.docs.ag ?? null),
            // whole workbooks, every sheet: the readings above keep only the accounts and the holdings
            ...workbook('trial_balance_workbook', input.docs.tbText),
            ...workbook('supporting_schedules_workbook', input.docs.isText),
            ...(standards ? [{ type: 'text' as const, text: standards }] : []),
            {
              type: 'text' as const,
              text: PROMPTS.narrative(input.threshold, input.highMultiple, input.customChecks) + (standards ? STANDARDS_RULE : '')
            }
          ],
          tool: TOOLS.points,
          maxTokens: REVIEW_TOKENS
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
          maxTokens: STEP_TOKENS
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
          maxTokens: STEP_TOKENS
        };
      case 'consolidated':
        // compact lines and point titles only (built by the shared consolidation engine), never documents
        return {
          content: [json('group', input.input), { type: 'text' as const, text: PROMPTS.consolidated() }],
          tool: TOOLS.consolidated,
          maxTokens: STEP_TOKENS
        };
    }
  }
}

export type { AiStep };

/** Every point's references, with any paragraph of the standards that was not sent cut back to the standard's name. */
function withCheckedCitations(output: unknown, sent: Set<string>): unknown {
  const o = output as { points?: { refs?: unknown }[] } | null;
  if (!o || !Array.isArray(o.points)) return output;
  return { ...o, points: o.points.map((p) => (p && typeof p.refs === 'string' ? { ...p, refs: checkCitations(p.refs, sent) } : p)) };
}
