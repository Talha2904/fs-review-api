// The four Claude steps of an analysis, with the same requests and answer shapes the web app used
// (src/lib/api.js), sent through RunAiStep so the settings, the client's permission and the activity
// log with token counts all apply as before.
import type { Doc, DocSlot, Docs, Point, Reading, VarianceRow, VarNote } from '@fs-review/shared/analysis';

import type { AiStepInput } from '../ai/RunAiStep.js';
import type { DocumentReader } from '../ports/DocumentReader.js';

import type { AnalysisAi, AnalysisFile } from './AnalysisPipeline.js';

/** Runs one AI step as the user who started the analysis. */
export type RunStep = (input: AiStepInput) => Promise<unknown>;

/** Display-only fields are stripped before documents go back to Claude, to save tokens. */
const lean = (d: Doc | undefined) => d && { title: d.title, meta: d.meta, blocks: d.blocks };

export class AiAnalysisSteps implements AnalysisAi {
  constructor(
    private readonly runStep: RunStep,
    private readonly reader: DocumentReader
  ) {}

  /** 1. Reads an uploaded document into blocks and figures. PDFs go as base64; workbooks as CSV text. */
  async extract(slot: DocSlot, file: AnalysisFile): Promise<Reading> {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const bytes = await file.bytes();
    let payload;
    if (ext === 'pdf') payload = { fileName: file.name, mediaType: 'application/pdf', data: Buffer.from(bytes).toString('base64') };
    else if (ext === 'xlsx') payload = { fileName: file.name, mediaType: 'text/csv', text: await this.reader.xlsxText(bytes) };
    else throw new Error(`“${file.name}” is not a PDF or an Excel (.xlsx) file.`);
    return (await this.runStep({ step: 'extract', slot, file: payload })) as Reading;
  }

  /** 2. Qualitative narrative and disclosure review. */
  async narrative(
    docs: Docs,
    threshold: number,
    highMultiple = 4,
    customChecks: { id: string; name: string; instruction: string }[] = []
  ): Promise<Point[]> {
    const out = (await this.runStep({
      step: 'narrative',
      threshold,
      highMultiple,
      customChecks,
      docs: { cy: lean(docs.cy), py: lean(docs.py), is: lean(docs.is), sup: lean(docs.sup) }
    })) as { points?: Point[] };
    return (out.points || []).map((p) => ({ ...p, source: 'narrative' }));
  }

  /** 3. Commentary for the variance lines the model put outside expectation, keyed by line label. */
  async explain(lines: VarianceRow[], docs: Docs, threshold: number, growth: number): Promise<Record<string, VarNote>> {
    const out = (await this.runStep({
      step: 'explain',
      threshold,
      growth,
      lines: lines.map(({ label, group, cy, py, delta, pct, band }) => ({
        label,
        group,
        cy,
        py,
        delta,
        pct: pct && +pct.toFixed(1),
        band
      })),
      docs: { py: lean(docs.py), sup: lean(docs.sup) }
    })) as { lines?: (VarNote & { label: string })[] };
    return Object.fromEntries((out.lines || []).map((l) => [l.label, l]));
  }

  /** 4. Re-tests earlier points against a new draft. */
  async versionPass(input: {
    priorPoints: Point[];
    candidatePoints: Point[];
    previousDraft: Doc | undefined;
    newDraft: Doc | undefined;
    supporting: Doc | undefined;
  }) {
    const pick = (p: Point) => ({
      ref: p.ref,
      pri: p.pri,
      title: p.title,
      basis: p.basis,
      refs: p.refs,
      amount: p.amount,
      anchor: p.anchor
    });
    return (await this.runStep({
      step: 'version',
      priorPoints: input.priorPoints.map(pick),
      candidatePoints: input.candidatePoints.map(pick),
      previousDraft: lean(input.previousDraft),
      newDraft: lean(input.newDraft),
      supporting: lean(input.supporting)
    })) as Awaited<ReturnType<AnalysisAi['versionPass']>>;
  }
}
