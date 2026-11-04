// Reads every demo-library case with the app's own readers (no AI) and reports what each one found.
// Usage: tsx scripts/demo-readers.ts <path to FS_Review_Demo_Library>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFinancialPdf, parseInvestmentSchedule, parseTrialBalance } from '@fs-review/shared/analysis';

import { PdfJsDocumentReader } from '../src/infrastructure/documents/PdfJsDocumentReader.js';

const root = join(process.argv[2] || '../FS_Review_Demo_Library', '01_Application_Inputs');
const reader = new PdfJsDocumentReader();
for (const fw of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const c of readdirSync(join(root, fw.name))) {
    const dir = join(root, fw.name, c);
    const file = (p: string) => new Uint8Array(readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith(p))!)));
    const tb = parseTrialBalance(await reader.xlsxSheets(file('03')));
    const is = parseInvestmentSchedule(await reader.xlsxSheets(file('04')));
    const cy = parseFinancialPdf(await reader.pdfContent(file('02')), 'cy');
    const py = parseFinancialPdf(await reader.pdfContent(file('01')), 'py');
    console.log(
      c.padEnd(11),
      '| tb',
      tb ? `${JSON.stringify(tb.local)} dr ${tb.figures?.tbDr} cr ${tb.figures?.tbCr}` : 'NOT READ',
      '| is',
      is ? `${(is.figures?.sched as number[] | undefined)?.length ?? 0} lines (${is.sub ?? ''})` : 'NOT READ',
      '| cy',
      cy ? `missing ${JSON.stringify(cy.local?.missing)}` : 'NOT READ',
      '| py',
      py ? 'read' : 'NOT READ'
    );
  }
}
