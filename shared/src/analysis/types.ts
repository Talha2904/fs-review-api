// Shapes the analysis engine works on. A document is read (by the app's own readers or by AI) into
// display blocks plus normalised figures; the checks run on the figures and the blocks.
// The blocks come from AI as well as from code, so the types are deliberately open: unknown extra
// properties are carried through untouched.

/** One line of a table: a label, one value per column, and display hints. */
export interface Row {
  l: string;
  v?: (number | null)[];
  ref?: string;
  /** a sub-heading inside the table */
  h?: boolean | number;
  /** a bold line: a subtotal or total */
  b?: boolean | number;
  /** decimal places, for per-share figures */
  dp?: number;
  /** the review point this line is anchored on */
  flag?: string;
  [extra: string]: unknown;
}

/** A heading, a paragraph or a table. `k` says which. */
export interface Block {
  k: string;
  title?: string;
  sub?: string;
  text?: string;
  cols?: string[];
  label?: string;
  rows?: Row[];
  flag?: string;
  [extra: string]: unknown;
}

/** A total compared with the sum of its parts. */
export interface CastResult {
  where: string;
  col: string;
  stated: number;
  comp: number;
  ok: boolean;
}

export interface OcrSummary {
  pages: number;
  confidence: number;
}

/** A document as the screens show it and the checks read it. */
export interface Doc {
  title: string;
  meta?: string;
  blocks: Block[];
  sub?: string;
  umbrellaCast?: CastResult[];
  ocr?: OcrSummary;
  [extra: string]: unknown;
}

export type DocSlot = 'cy' | 'py' | 'tb' | 'is' | 'sup';
export type Docs = Partial<Record<DocSlot, Doc>>;

/** Normalised figures the checks run on (see FIGURES in checkLibrary). Lists are lines to be added up. */
export interface Figures {
  ca?: number[] | undefined;
  cl?: number[] | undefined;
  statedTA?: number | null | undefined;
  statedNA?: number | null | undefined;
  pyNA?: number | null | undefined;
  pyOpenNA?: number | null | undefined;
  subs?: number | undefined;
  reds?: number | undefined;
  dists?: number | undefined;
  ops?: number | null | undefined;
  income?: number[] | undefined;
  statedIncome?: number | null | undefined;
  exp?: number[] | undefined;
  sciExp?: number | undefined;
  statedNote4?: number | null | undefined;
  hier?: number[] | undefined;
  sched?: number[] | undefined;
  mgmtRate?: number | undefined;
  mgmtCharged?: number | null | undefined;
  tbDr?: number | undefined;
  tbCr?: number | undefined;
  feeMonths?: number | undefined;
  [key: string]: number | number[] | null | undefined;
}

/** A document read: what the readers and AI return. */
export interface Reading extends Doc {
  figures?: Figures;
  /** what the app's own reader found, when it read the document without AI */
  local?: { missing?: string[]; [extra: string]: unknown };
}

/** Text and positioned lines of a PDF, from its text layer or from OCR. */
export interface PdfCell {
  x: number;
  x2: number;
  str: string;
}
export interface PdfLine {
  page: number;
  y: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
  cells: PdfCell[];
}
export interface PdfContent {
  text: string;
  pageCount: number;
  lines: PdfLine[];
  ocr?: OcrSummary;
}

/** A worksheet as rows of cell values (numbers, text, dates or blanks). */
export interface Sheet {
  name: string;
  rows: unknown[][];
}

export interface RuleSetting {
  on?: boolean;
  tol?: number | null | undefined;
  tolKind?: string | undefined;
  [extra: string]: unknown;
}

/** A rule in the firm's check library. */
export interface LibraryRule {
  id: string;
  name: string;
  desc?: string;
  version?: string;
  tol?: number | null;
  tolKind?: string;
  approvedBy?: string;
  status?: string;
  engine?: string;
  impl?: string[];
  gap?: string;
  defaultOff?: boolean;
  builtIn?: boolean;
  def?: { terms?: { sign: number; key: string }[]; stated?: string; instruction?: string };
  [extra: string]: unknown;
}

/** An engagement's settings as the analysis uses them: the engagement document with its effective rules. */
export interface Setup {
  fund?: { name?: string; yearEnd?: string; currency?: string; [extra: string]: unknown };
  threshold: number;
  highMultiple?: number;
  feeRatePct?: number | string | null;
  feeMonths?: number;
  varianceMode?: string;
  investigatePct?: number;
  explainPct?: number;
  narrative?: boolean;
  rules: Record<string, RuleSetting>;
  tbMap?: Record<string, string>;
  [extra: string]: unknown;
}

export type CheckResult = 'Agrees' | 'Difference' | 'Not tested';

/** One row of the checks table. */
export interface Check {
  id: string;
  rule?: string | undefined;
  name: string;
  area: string;
  refs: string;
  anchor?: string;
  follow: string;
  detail: string;
  comp: number | null;
  stated: number | null;
  diff: number | null;
  result: CheckResult;
  /** a check that counts findings (dates, currency) rather than a money difference */
  count?: boolean;
}

export type Priority = 'High' | 'Medium' | 'Low';

/** A review point, as the analysis raises it. */
export interface Point {
  ref?: string | undefined;
  pri: Priority;
  area?: string | undefined;
  title: string;
  basis?: string | undefined;
  amount?: number | null | undefined;
  refs?: string | undefined;
  follow?: string | undefined;
  anchor?: string | undefined;
  rule?: string | undefined;
  source?: string | undefined;
  status?: string | undefined;
  agent?: string | undefined;
  agentNote?: string | undefined;
  aiDrafted?: boolean | undefined;
  [extra: string]: unknown;
}

/** Commentary on one variance line. */
export interface VarNote {
  band: string;
  pri: string;
  expect: string;
  note: string;
  action: string;
  onlyIfFlagged?: string;
  aiDrafted?: boolean;
  [extra: string]: unknown;
}

/** What one analysis produces and what is stored with the run. */
export interface AnalysisResult {
  docs: Docs;
  K: Figures;
  points: Point[];
  varNotes: Record<string, VarNote>;
  version: number;
  priorResolved: unknown[];
  demo: boolean;
  aiSkipped?: string[];
  aiReads?: { read: string[]; reused: string[]; local: string[] };
}
