// Prompts and JSON schemas for every Claude call. Arithmetic is NOT delegated to Claude: casting,
// recalculation and materiality banding run deterministically in the web app's review engine.
import type { Slot } from '@fs-review/shared';

import type { ToolSpec } from '../ports/AiGateway.js';

export const SYSTEM = `You assist the reviewer of the year-end financial statements of {ENTITY}, prepared under {FRAMEWORK}.
You support the reviewer's judgement; you never conclude that statements are complete or correct.
Be factual, terse and specific. Cite the note or page, the worksheet and cell or account code, or the supporting document and page for every assertion.
Amounts are in {CURRENCY}, the presentation currency, unless the document says otherwise. Do not invent facts, terms, transactions, amounts or requirements of the standards that are not supported by the documents provided.`;

// What the entity is (the entity's type, kept in step with ENTITY_TYPES in the web app's EntityModal).
// Empty is an open-ended fund: every entity before types existed was one.
const ENTITY_TEXT: Record<string, string> = {
  '': 'an open-ended investment fund',
  'Open-ended fund': 'an open-ended investment fund',
  'Private equity fund': 'a private equity fund (usually a limited partnership: investors hold partners’ capital, not redeemable shares)',
  'Private debt fund': 'a private debt fund (its loans may be held at fair value or at amortised cost, according to its stated policy)',
  'Investment manager': 'an investment management company (an operating company with revenue, staff costs and tax, not an investment fund)',
  'Trust or fiduciary company': 'a trust or fiduciary services company (an operating company, not an investment fund)',
  'Other company': 'an operating company',
  // the Consolidated Review looks at several related entities at once
  'Group of related entities': 'a group of related entities reviewed together: funds, their manager and other connected companies'
};
export const describeEntity = (type: string | null | undefined): string => ENTITY_TEXT[type ?? ''] ?? `an entity described as “${type}”`;
export const describeFramework = (fw: string | null | undefined): string =>
  fw && fw !== 'Other'
    ? `${fw === 'IFRS' ? 'IFRS Accounting Standards' : fw === 'US GAAP' ? 'US GAAP' : fw}, using the requirements effective for the reporting period`
    : 'the accounting framework stated in the documents (identify it from them)';

export const FIGURE_KEYS: Record<Slot, Record<string, string>> = {
  cy: {
    ca: 'array: every asset line on the statement of financial position, current year, excluding the total',
    cl: 'array: every liability line, current year, excluding the total',
    statedTA: 'total assets as stated, current year',
    statedNA:
      'net assets or total equity as stated, current year (net assets attributable to holders of redeemable shares, partners’ capital or shareholders’ equity)',
    pyNA: 'net assets or equity at the beginning of the year per the statement of changes in net assets, equity or partners’ capital',
    pyOpenNA: 'net assets or equity at the beginning of the PRIOR year (comparative of the same statement)',
    subs: 'subscriptions, share issues or capital contributions in the year (positive)',
    reds: 'redemptions or capital withdrawals in the year (positive)',
    dists: 'distributions or dividends in the year per the statement of changes (positive; 0 if none)',
    ops: 'profit for the year, or increase in net assets from operations, current year',
    income: 'array: each income line (investment income, or revenue for a company), current year, excluding the total',
    statedIncome: 'total income or total revenue as stated, current year',
    exp: 'array: each line of the operating expenses note, current year, excluding the total',
    sciExp: 'total operating expenses per the income statement (positive)',
    statedNote4: 'total financial assets at fair value per the investment note',
    hier: 'array: [Level 1, Level 2, Level 3] totals per the fair value hierarchy note, current year',
    mgmtCharged: 'management fees charged in the year'
  },
  py: {},
  tb: { tbDr: 'total debits', tbCr: 'total credits' },
  is: { sched: 'array: fair value of each asset class line, excluding the total' },
  sup: { mgmtRate: 'management fee rate per the prospectus as a decimal (0.75% → 0.0075)' },
  ag: {}
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
    follow: { type: 'string', description: 'suggested follow-up for the preparer' },
    anchor: {
      type: 'string',
      description: 'exact line label, or the first eight words of the paragraph, in the current year draft that this point attaches to'
    },
    kind: {
      type: 'string',
      enum: ['Adjustment', 'Classification', 'Disclosure', 'Judgement'],
      description:
        'Adjustment: a supported error that needs a journal; Classification: presentation only, totals unchanged; Disclosure: wording or a missing or wrong note; Judgement: a matter needing judgement or evidence not on file'
    },
    evidence: {
      type: 'string',
      description: 'exact evidence locations separated by " · ": file and page, worksheet and cell or row, account code, clause'
    },
    fix: {
      type: 'string',
      description: 'proposed correction; for an Adjustment the journal, e.g. "Dr 4000 Fee revenue 240,000 / Cr 1110 Fee accruals 240,000"'
    },
    pbtEffect: {
      type: ['number', 'null'],
      description: 'effect of the correction on profit before tax (negative reduces profit); 0 if none; null if it cannot be quantified'
    },
    taxEffect: {
      type: ['number', 'null'],
      description: 'effect on the tax charge (negative reduces it), only when the rate or computation is in the documents; else null'
    },
    netAssetsEffect: {
      type: ['number', 'null'],
      description: 'effect on net assets or equity after tax (negative reduces them); 0 for classification or disclosure only'
    },
    missing: { type: 'string', description: 'information still needed to conclude; empty if none' }
  },
  required: [
    'pri',
    'area',
    'title',
    'basis',
    'amount',
    'refs',
    'follow',
    'anchor',
    'kind',
    'evidence',
    'fix',
    'pbtEffect',
    'netAssetsEffect'
  ]
};

export const TOOLS: Record<'extract' | 'points' | 'variance' | 'versionPass' | 'consolidated', ToolSpec> = {
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
    description: 'Record the accounting, narrative and disclosure review points, with a director-level summary.',
    input_schema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: point },
        summary: {
          type: 'string',
          description:
            'director-level summary in three to five sentences: the main matters and their combined effect on profit and net assets'
        },
        readyForApproval: { type: 'boolean', description: 'false while any matter should prevent approval' },
        blockers: { type: 'array', items: { type: 'string' }, description: 'titles of the matters that should prevent approval' }
      },
      required: ['points', 'summary', 'readyForApproval', 'blockers']
    }
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
  consolidated: {
    name: 'record_consolidated_review',
    description: 'Record the inter-entity pairs, the review points common to several funds, and a short summary.',
    input_schema: {
      type: 'object',
      properties: {
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              a: { type: 'string', description: 'id of a line in one entity' },
              b: { type: 'string', description: 'id of the line in another entity recording the same balance or transaction' },
              relationship: { type: 'string', description: 'a few words, e.g. "Management fee: fund and manager"' },
              note: { type: 'string', description: 'one sentence on why these two lines are the same balance' }
            },
            required: ['a', 'b', 'relationship', 'note']
          }
        },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'the shared matter, one sentence, sentence case' },
              points: {
                type: 'array',
                items: { type: 'object', properties: { fund: { type: 'string' }, ref: { type: 'string' } }, required: ['fund', 'ref'] }
              }
            },
            required: ['title', 'points']
          }
        },
        summary: { type: 'string', description: 'two to four sentences for the partner' }
      },
      required: ['pairs', 'groups', 'summary']
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
    `Review the current year draft as a senior financial reporting reviewer. The draft and the trial balance are drafts, not assumed correct. Use the prior year signed accounts, the trial balance, the supporting schedules, the minutes and the agreements and correspondence. Some may be absent.

A. Accounting. Test each of these against the evidence:
1. Recognition and cut-off: income, fees or costs booked in the wrong period, against the service period or effective date in the agreements.
2. Completeness: liabilities, accruals, bonuses or commitments approved or incurred by the year end (minutes, agreements) but not recorded.
3. Measurement: impairment or credit-loss allowances, fair values and valuation inputs, against the schedules and the entity's stated policy elections.
4. Classification: current or non-current (by the repayment terms), debt or equity, presentation of balances.
5. Events after the reporting period: adjusting or non-adjusting, by the date the condition arose.
6. Capital and equity movements, related parties and commitments, against the schedules and minutes.
7. The statements against the trial balance and the schedules: a balance in the statements or a note that differs from the ledger or a schedule.
For each Adjustment give the journal, the effect on profit before tax, on tax (only when the rate or computation is in the documents) and on net assets. Do not double-count a downstream effect of the same error; separate journals from presentation or disclosure corrections.

B. Narrative and disclosure:
1. Prior-year text carried forward unchanged where the facts have changed (dates, percentages, holdings, approvals).
2. Notes that contradict the supporting documents: directors in office, related parties, holdings, disposals, terms.
3. Events after the reporting date that are not disclosed, or disclosed wrongly.
4. Currency or unit labels inconsistent with the presentation currency or the signed comparatives.
5. Comparatives that differ from the signed prior year.

Rules:
- Raise a matter only when the documents support it. Something that often signals an error is not one by itself: a significant interest does not always require consolidation, a later event is not always adjusting, a loan at fair value through profit or loss has no separate amortised-cost credit-loss allowance, and a balanced trial balance can still be wrong.
- Where the evidence is incomplete, say what is missing and mark the point Judgement rather than asserting an error.
- Apply the requirements effective for the reporting period and the entity's explicit policy elections.
- Casting runs separately, so do not restate a pure addition error within one table. Do raise a balance that does not roll forward or agree between statements: an opening or closing figure that differs from the balance sheet, the signed prior year or the other primary statements.
Priority: High where the matter would change a primary statement figure, should prevent approval, or is at least ${threshold * highMultiple} in amount; Medium for a factual disclosure error or omission; Low for presentational matters.
Return an empty list if nothing is found. Do not pad. Finish with the summary, whether the statements are ready for approval, and the matters that should prevent it.${customBlock(customChecks)}`,

  variance: (threshold: number, growth: number): string =>
    `Each flagged line has been compared prior year to current year and banded deterministically against a review threshold of ${threshold} and an expected movement in line with net assets of ${(growth * 100).toFixed(1)}%.
For each line, identify its real economic driver (e.g. bond holdings for interest income, average net assets × fee rate for management fees, settlement timing for receivables) and use the prior year accounts and supporting information to judge whether the movement is consistent with that driver.
Escalate Explain → Investigate only where the movement runs against its driver or the evidence contradicts it. Never downgrade.
Quote amounts in {CURRENCY} with thousands separators. Where no corroborating evidence is on file, say so.
Keep each note to one or two short sentences: there may be many lines.`,

  consolidated: (): string =>
    `These are related entities reviewed together. You are given, for the entities whose clients permit AI: the entities (id, name, type); balance-sheet and related-party note lines that may involve another entity in the group (id, fund, where, label, amount, currency, side: receivable, payable, or flow for a charge or income in the year); and the open review points of each fund. A label may be a short sentence from a related-party note. Each line carries its own currency.
1. Pairs: match a line in one entity with the line in another entity that records the same balance or transaction from the other side, e.g. a fund's management fee payable with the manager's fee receivable from that fund, or a loan receivable with the borrower's loan payable. Entities are often named by role ("the manager", "the general partner", "the parent"): use the entity types and names to decide which entity is meant. Pair only when the lines support it; never pair two lines of the same entity, and use each line at most once. Do not compute or restate differences: the app compares the amounts.
2. Groups: list review points from two or more funds that describe the same matter, even if worded differently. Leave out points that only look alike.
3. Summary: two to four sentences for the partner on the links found, which do not agree, and matters common to several funds.
Return empty lists where nothing qualifies. Do not invent lines, points or ids.`,

  versionPass: (): string =>
    `A new draft of the financial statements has been received.
For each prior point: compare the previous and new drafts at the referenced location. Mark "resolved" only if the new draft corrects the matter AND the correction agrees to the evidence on file; otherwise "outstanding". If a candidate point on the new draft restates the same matter, set duplicateOf to its ref.
For candidate points that do not restate a prior point: list them under newlyIntroduced only if the matter arises from a change between the drafts, with a note on what changed. Candidates that existed in the previous draft but were simply not raised before should also be listed, noting they were present previously.`
};
