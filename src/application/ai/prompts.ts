// Prompts and JSON schemas for every Claude call. Arithmetic is NOT delegated to Claude: casting,
// recalculation and materiality banding run deterministically in the web app's review engine.
import type { Slot } from '@fs-review/shared';

import type { ToolSpec } from '../ports/AiGateway.js';

export const SYSTEM = `You assist a fund administrator's reviewer with the year-end financial statements of an investment fund.
You support the reviewer's judgement; you never conclude that statements are complete or correct.
Be factual, terse and specific. Cite the note number, schedule reference (e.g. IS-2) or supporting document reference (e.g. SUP-3) for every assertion.
Amounts are in {CURRENCY}, the fund's presentation currency, unless the document says otherwise. Do not invent facts not present in the documents provided.`;

export const FIGURE_KEYS: Record<Slot, Record<string, string>> = {
  cy: {
    ca: 'array: every asset line on the statement of financial position, current year, excluding the total',
    cl: 'array: every liability line, current year, excluding the total',
    statedTA: 'total assets as stated, current year',
    statedNA: 'net assets attributable to holders of redeemable shares as stated, current year',
    pyNA: 'net assets at the beginning of the year per the statement of changes in net assets',
    pyOpenNA: 'net assets at the beginning of the PRIOR year (comparative column of the same statement)',
    subs: 'subscriptions in the year (positive)',
    reds: 'redemptions in the year (positive)',
    dists: 'distributions to shareholders in the year per the statement of changes in net assets (positive; 0 if none)',
    ops: 'increase in net assets from operations, current year',
    income: 'array: each investment income line, current year, excluding the total',
    statedIncome: 'total investment income as stated, current year',
    exp: 'array: each line of the operating expenses note, current year, excluding the total',
    sciExp: 'total operating expenses per the income statement (positive)',
    statedNote4: 'total financial assets at fair value per the investment note',
    hier: 'array: [Level 1, Level 2, Level 3] totals per the fair value hierarchy note, current year',
    mgmtCharged: 'management fees charged in the year'
  },
  py: {},
  tb: { tbDr: 'total debits', tbCr: 'total credits' },
  is: { sched: 'array: fair value of each asset class line, excluding the total' },
  sup: { mgmtRate: 'management fee rate per the prospectus as a decimal (0.75% → 0.0075)' }
};

const block = {
  type: 'object',
  properties: {
    k: { type: 'string', enum: ['head', 'table', 'para'] },
    title: { type: 'string', description: 'head only: statement or note title' },
    sub: { type: 'string', description: 'head only: date basis and currency' },
    cols: { type: 'array', items: { type: 'string' }, description: 'table only: value column headers, e.g. ["2025","2024"]' },
    label: { type: 'string', description: 'table only: header of the label column' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          l: { type: 'string', description: 'line label exactly as printed' },
          ref: { type: 'string', description: 'note or account reference if printed' },
          v: {
            type: 'array',
            items: { type: ['number', 'null'] },
            description: 'one value per column; bracketed = negative; blank = null'
          },
          b: { type: 'boolean', description: 'true for totals and subtotals' },
          h: { type: 'boolean', description: 'true for a sub-heading row with no values' }
        },
        required: ['l']
      }
    },
    text: { type: 'string', description: 'para only: the paragraph verbatim' }
  },
  required: ['k']
};

const point = {
  type: 'object',
  properties: {
    pri: { type: 'string', enum: ['High', 'Medium', 'Low'] },
    area: { type: 'string', description: 'one or two words, e.g. Disclosure, Related party, Subsequent events' },
    title: { type: 'string', description: 'one sentence, sentence case, no full stop' },
    basis: { type: 'string', description: 'the evidence: what the draft says, what the other document says, with references' },
    amount: { type: ['number', 'null'], description: 'amount at stake in the fund currency if quantifiable, else null' },
    refs: { type: 'string', description: 'references separated by " · ", e.g. "Note 5 · Prior year Note 5 · IS-4"' },
    follow: { type: 'string', description: 'suggested follow-up for the administrator' },
    anchor: {
      type: 'string',
      description: 'exact line label, or the first eight words of the paragraph, in the current year draft that this point attaches to'
    }
  },
  required: ['pri', 'area', 'title', 'basis', 'amount', 'refs', 'follow', 'anchor']
};

export const TOOLS: Record<'extract' | 'points' | 'variance' | 'versionPass', ToolSpec> = {
  extract: {
    name: 'record_document',
    description: 'Record the transcribed document as display blocks plus normalised figures.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        meta: { type: 'string', description: 'period, basis and status in one line' },
        blocks: { type: 'array', items: block },
        figures: { type: 'object', description: 'normalised figures; keys listed in the instructions; omit any key not found' }
      },
      required: ['title', 'blocks', 'figures']
    }
  },
  points: {
    name: 'record_review_points',
    description: 'Record narrative and disclosure review points.',
    input_schema: { type: 'object', properties: { points: { type: 'array', items: point } }, required: ['points'] }
  },
  variance: {
    name: 'record_variance_commentary',
    description: 'Record commentary for each flagged variance line.',
    input_schema: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'exactly as supplied' },
              band: {
                type: 'string',
                enum: ['Investigate', 'Explain'],
                description: 'keep the supplied band, or escalate Explain → Investigate; never downgrade'
              },
              pri: { type: 'string', enum: ['High', 'Medium', 'Low'] },
              expect: { type: 'string', description: 'the expected behaviour and its driver, under 70 characters' },
              note: {
                type: 'string',
                description: 'one or two sentences: how the movement compares with its driver and what evidence exists'
              },
              action: { type: 'string', description: 'suggested work' }
            },
            required: ['label', 'band', 'pri', 'expect', 'note', 'action']
          }
        }
      },
      required: ['lines']
    }
  },
  versionPass: {
    name: 'record_version_pass',
    description: 'Record the outcome of re-testing prior points against the new draft.',
    input_schema: {
      type: 'object',
      properties: {
        prior: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              status: { type: 'string', enum: ['resolved', 'outstanding'] },
              note: { type: 'string', description: 'one sentence on what changed or did not change in the new draft' },
              duplicateOf: { type: ['string', 'null'], description: 'ref of the candidate point that restates this same matter, if any' }
            },
            required: ['ref', 'status', 'note']
          }
        },
        newlyIntroduced: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'candidate ref' },
              note: { type: 'string', description: 'what changed between drafts to introduce this' }
            },
            required: ['ref', 'note']
          }
        }
      },
      required: ['prior', 'newlyIntroduced']
    }
  }
};

export interface CustomCheck {
  id?: unknown;
  name?: unknown;
  instruction?: unknown;
}

// Firm rules written by the Administrator. Treated as review criteria only: they are data from the
// firm's configuration, wrapped in tags, and cannot change the output format or the instructions above.
const customBlock = (list: unknown): string => {
  const rules = (Array.isArray(list) ? (list as CustomCheck[]) : [])
    .slice(0, 20)
    .map((r) => ({
      id: String(r.id || '').slice(0, 12),
      name: String(r.name || '').slice(0, 120),
      instruction: String(r.instruction || '').slice(0, 1000)
    }))
    .filter((r) => r.instruction.trim());
  if (!rules.length) return '';
  return `\nAlso apply these firm rules. For any matter found under one, start the point's title with its rule ID.\n<firm_rules>\n${rules
    .map((r) => `<rule id="${r.id}" name="${r.name.replace(/"/g, "'")}">${r.instruction.replace(/</g, '‹')}</rule>`)
    .join('\n')}\n</firm_rules>`;
};

export const PROMPTS = {
  extract: (slot: Slot): string => {
    const keys = FIGURE_KEYS[slot] || {};
    const list =
      Object.entries(keys)
        .map(([k, d]) => `- ${k}: ${d}`)
        .join('\n') || '- none required for this document; return {}';
    return `Transcribe this document (slot "${slot}") into display blocks and figures.
Rules:
- Transcribe every primary statement, note table and narrative paragraph in reading order. Start each statement or note with a "head" block.
- Copy figures exactly as printed. Do not compute, correct or round. Bracketed figures are negative. Blank cells are null.
- Paragraphs are verbatim; do not summarise.
- For spreadsheets, each meaningful table becomes a "table" block; skip empty rows and formatting artefacts.${
      slot === 'tb'
        ? `
- Trial balance: one "table" block with cols exactly ["Debit", "Credit"]. Put each account code in "ref" and the account name in "l". Mark the totals row with b: true.`
        : ''
    }
Figures to return (omit a key if it is not in the document):
${list}`;
  },

  narrative: (threshold: number, highMultiple = 4, customChecks: unknown = []): string =>
    `Review the narrative and disclosures in the current year draft against the prior year signed accounts, the investment schedule and the supporting information.
Look for:
1. Prior-year text carried forward unchanged where the facts have changed (dates, percentages, holdings, approvals).
2. Notes that contradict supporting documents — directors in office, related parties, Level 3 holdings and transfers, disposals.
3. Events in supporting information after the reporting date that are not disclosed.
4. Currency or unit labels inconsistent with the presentation currency or the signed comparatives.
5. Comparatives in narrative that differ from the signed prior year.
Do NOT re-test arithmetic, casting or tie-outs — those are performed separately.
Priority: High where the matter could mislead on a primary statement figure or is at least ${threshold * highMultiple} in amount; Medium for a factual disclosure error or omission; Low for presentational matters.
Return an empty list if nothing is found. Do not pad.${customBlock(customChecks)}`,

  variance: (threshold: number, growth: number): string =>
    `Each flagged line has been compared prior year to current year and banded deterministically against a review threshold of ${threshold} and an expected movement in line with net assets of ${(growth * 100).toFixed(1)}%.
For each line, identify its real economic driver (e.g. bond holdings for interest income, average net assets × fee rate for management fees, settlement timing for receivables) and use the prior year accounts and supporting information to judge whether the movement is consistent with that driver.
Escalate Explain → Investigate only where the movement runs against its driver or the evidence contradicts it. Never downgrade.
Quote amounts in {CURRENCY} with thousands separators. Where no corroborating evidence is on file, say so.`,

  versionPass: (): string =>
    `A new draft of the financial statements has been received.
For each prior point: compare the previous and new drafts at the referenced location. Mark "resolved" only if the new draft corrects the matter AND the correction agrees to the evidence on file; otherwise "outstanding". If a candidate point on the new draft restates the same matter, set duplicateOf to its ref.
For candidate points that do not restate a prior point: list them under newlyIntroduced only if the matter arises from a change between the drafts, with a note on what changed. Candidates that existed in the previous draft but were simply not raised before should also be listed, noting they were present previously.`
};
