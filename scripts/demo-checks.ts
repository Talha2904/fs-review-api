// Runs the casting (CHK-03) and notes tie-out (CHK-04) checks, without AI, over every demo-library draft and
// its clean control. A control should come back clean: anything it flags is a false alarm. A draft's flags
// should each be a seeded finding. Usage: npm run checks:demo -- [path to FS_Review_Demo_Library]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { castAll, notesTieOut, parseFinancialPdf } from '@fs-review/shared/analysis';

import { PdfJsDocumentReader } from '../src/infrastructure/documents/PdfJsDocumentReader.js';
const lib = process.argv[2] || '../FS_Review_Demo_Library';
const reader = new PdfJsDocumentReader();
const run = async (label: string, path: string) => {
  const doc = parseFinancialPdf(await reader.pdfContent(new Uint8Array(readFileSync(path))), 'cy') ?? parseFinancialPdf(await reader.pdfContent(new Uint8Array(readFileSync(path))), 'py');
  if (!doc) return console.log(label, 'NOT READ');
  const d = { title: '', blocks: doc.blocks };
  const bad = [...castAll(d).filter((c) => !c.ok).map((c) => `CAST ${c.where} [${c.col}] ${c.stated} vs ${c.comp}`), ...notesTieOut(d).filter((n) => !n.ok).map((n) => `TIE ${n.note} · ${n.total} ${n.comp} vs ${n.line} ${n.stated}`)];
  console.log(label.padEnd(18), bad.length ? '\n   ' + bad.join('\n   ') : 'clean');
};
for (const fw of ['FRS102', 'IFRS', 'USGAAP'])
  for (const c of readdirSync(join(lib, '01_Application_Inputs', fw))) {
    await run(c + ' draft', join(lib, '01_Application_Inputs', fw, c, '02_Current_Year_2025_Draft_FS.pdf'));
    await run(c + ' CONTROL', join(lib, '02_Evaluator_Only', 'Clean_Controls', c, '01_Clean_2025_Control_FS.pdf'));
  }
