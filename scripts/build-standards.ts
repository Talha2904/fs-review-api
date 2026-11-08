// Builds the standards index the AI review draws on (Phase 6): reads the FRS 102 and IFRS PDFs the firm supplied
// and splits them into short passages, each with the reference a review point can cite. Run it again when the
// standards change:
//   npx tsx scripts/build-standards.ts "../IFRS and FRS 102"
// It writes standards/frs102.json and standards/ifrs.json (committed; read by the api at run time; not under data/,
// which production mounts as a volume).
//
// Each passage is one numbered paragraph, cited "FRS 102 33.9" or "IAS 24 18", with the section title or heading
// it sits under. Lines are read in position order, not the PDF's storage order: the IFRS PDFs store a page's
// paragraph numbers after its text, in the margin level with the paragraph they number. Text with no number of its
// own (a worked example, a defined term) is cited by the paragraph it follows ("IAS 12 51 (continued)"). Only the
// standard itself is kept: approval, basis for conclusions, examples, guidance and amendments to others are not.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

export interface Passage {
  /** what a review point cites */
  ref: string;
  /** the standard ("FRS 102 Section 33", "IAS 24") */
  std: string;
  /** the section title or heading it sits under */
  topic: string;
  text: string;
}

interface Line {
  x: number;
  text: string;
}

async function linesOf(file: string): Promise<Line[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), disableWorker: true, verbosity: 0 }).promise;
  const pages: Line[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    // reading order by position, not by the order the PDF stores text in: the IFRS PDFs store each page's
    // paragraph numbers after its text, in the margin, level with the paragraph they number
    const items = (tc.items as { str: string; transform: number[]; width: number; height: number }[])
      .filter((it) => it.str.trim())
      .map((it) => ({ x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height || Math.abs(it.transform[3]!), s: it.str }));
    // footnote markers are small raised numbers ("established under³⁷ the law"): left out by size, before lines form
    const sizes = items.map((it) => it.h).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] ?? 0;
    const kept = items
      .filter((it) => !(/^\d{1,3}$/.test(it.s.trim()) && body && it.h < body * 0.75))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: { x: number; y: number; parts: typeof items }[] = [];
    for (const it of kept) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2) last.parts.push(it);
      else lines.push({ x: it.x, y: it.y, parts: [it] });
    }
    pages.push(
      lines.map((l) => {
        // amendment markers in the far margin ("*", "^") are not text
        // and footnote markers set small within the line ("established under 37 the law") are not text either
        const tall = Math.max(...l.parts.map((it) => it.h));
        const parts = l.parts
          .sort((a, b) => a.x - b.x)
          .filter((it, i, all) => !(all.length > 1 && /^[*^†‡#◊]+$/.test(it.s.trim())))
          .filter((it, i) => !(i > 0 && /^\d{1,3}$/.test(it.s.trim()) && it.h < tall * 0.8));
        if (!parts.length) return { x: Math.round(l.x), text: '' };
        // a wide gap after the first piece (a margin number) is kept as a tab, so the number stands apart
        let text = parts[0]!.s;
        for (let i = 1; i < parts.length; i++) {
          const prev = parts[i - 1]!,
            gap = parts[i]!.x - (prev.x + prev.w);
          // spaces the PDF leaves to positioning are put back
          const spaced = /\s$/.test(text) || /^\s/.test(parts[i]!.s);
          text += (i === 1 && gap > 12 ? '\t' : gap > 1 && !spaced ? ' ' : '') + parts[i]!.s;
        }
        return { x: Math.round(parts[0]!.x), text: text.replace(/[ \u00a0]+/g, ' ').trim() };
      })
    );
  }
  // a paragraph number set a little apart from its first line reads as a line of its own: join them
  return pages.map((all) => {
    const lines = all.filter((l) => l.text);
    const out: Line[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!,
        next = lines[i + 1];
      if (NUMBER_ONLY.test(l.text) && next && next.x > l.x + 12) {
        out.push({ x: l.x, text: `${l.text}\t${next.text}` });
        i++;
      } else out.push(l);
    }
    return out;
  });
}
const NUMBER_ONLY = /^(?:[A-Z]{1,2}\.?)?\d{1,3}(?:\.\d{1,3}){0,3}[A-Z]{0,2}$/;

const MAX = 2400; // characters per passage: a longer paragraph is split at a sentence into numbered parts

/** A long paragraph split at sentence ends into parts under the same reference ("IAS 12 81 (part 2)"). */
function split(p: Passage): Passage[] {
  const out: Passage[] = [];
  let rest = p.text.trim();
  while (rest.length > MAX) {
    const window = rest.slice(0, MAX);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    const at = cut > MAX * 0.5 ? cut + 1 : MAX;
    out.push({ ...p, text: rest.slice(0, at).trim() });
    rest = rest.slice(at).trim();
  }
  if (rest) out.push({ ...p, text: rest });
  return out.map((x, i) => (i === 0 ? x : { ...x, ref: `${p.ref} (part ${i + 1})` }));
}

/** One passage per reference: a repeated reference (a table fragment, a cross-reference) is numbered, not merged. */
function unique(list: Passage[]): Passage[] {
  const seen = new Map<string, number>();
  return list.map((p) => {
    const n = (seen.get(p.ref) ?? 0) + 1;
    seen.set(p.ref, n);
    return n === 1 ? p : { ...p, ref: `${p.ref} (${n})` };
  });
}

// ---- FRS 102 ------------------------------------------------------------------------------------------------

const FRS_PARA = /^((?:PBE)?\d{1,2}[A-Z]{0,2}\.\d{1,3}[A-Z]{0,2})\s+(.+)$/;
const sectionOf = (n: string) => n.replace(/^PBE/, '').split('.')[0]!;
const FRS_SECTION = /^Section (\d{1,2}[A-Z]{0,2})\s*$/;

async function frs102(file: string): Promise<Passage[]> {
  const out: Passage[] = [];
  const titles = new Map<string, string>();
  let cur: Passage | null = null;
  let pendingSection: string | null = null;
  let example = false; // inside a worked example: not a requirement, left out
  let done = false; // past Section 35: the appendices (glossary, legal references, amendment history) are not taken
  for (const page of await linesOf(file)) {
    if (done) break;
    for (const [i, l] of page.entries()) {
      if (/^\d+ FRS 102 \(|^FRS 102 \(.*\) \d+$|^© |Financial Reporting Council \d+$|^\d+ Financial Reporting Council$/.test(l.text)) continue; // running header and footer
      if (pendingSection === '35' && /^(Appendix\b|Glossary$)/.test(l.text)) {
        done = true;
        break;
      }
      if (/^Example\b/.test(l.text)) {
        example = true;
        continue;
      }
      const sec = FRS_SECTION.exec(l.text);
      if (sec) {
        pendingSection = sec[1]!;
        const next = page[i + 1]?.text;
        if (next && !FRS_PARA.test(next) && !titles.has(sec[1]!)) titles.set(sec[1]!, next);
        continue;
      }
      const m = FRS_PARA.exec(l.text);
      if (m && (!pendingSection || sectionOf(m[1]!) === pendingSection || titles.has(sectionOf(m[1]!)))) {
        if (cur) out.push(cur);
        example = false;
        const s = sectionOf(m[1]!);
        cur = { ref: `FRS 102 ${m[1]}`, std: `FRS 102 Section ${s}`, topic: titles.get(s) ?? '', text: m[2]! };
        continue;
      }
      if (cur && !example && cur.text.length < MAX * 4) cur.text += ' ' + l.text;
    }
  }
  if (cur) out.push(cur);
  // table-of-contents lines ("33.1 – 33.14") and cross-reference stubs carry no requirement
  const clean = (t: string) => t.replace(/\s*Financial Reporting Council \d+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return unique(
    out
      .map((p) => ({ ...p, topic: p.topic || titles.get(p.std.replace('FRS 102 Section ', '')) || '', text: clean(p.text) }))
      .filter((p) => p.text.length >= 40 && !/^[–-]\s*\d/.test(p.text))
  ).flatMap(split);
}

// ---- IFRS ---------------------------------------------------------------------------------------------------

// the standard's title from its file name ("ias-10-events-after-the-reporting-period.pdf"): searches match on it
const stdTitle = (file: string) => {
  const t = basename(file, '.pdf')
    .replace(/^(ias|ifrs)-\d+-/, '')
    .replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const stdName = (file: string) => {
  const m = /^(ias|ifrs)-(\d+)/.exec(basename(file));
  return m ? `${m[1]!.toUpperCase()} ${m[2]}` : basename(file, '.pdf');
};

// an IFRS paragraph number: 1, 17A, B5.4.1, BC12, IE3, C7
const IFRS_PARA = /^((?:[A-Z]{1,2}\.?)?\d{1,3}(?:\.\d{1,3}){0,3}[A-Z]{0,2})\t(.+)$/;
const seriesOf = (n: string) => /^[A-Z]*/.exec(n)![0];
const numOf = (n: string) => +(/\d+/.exec(n)?.[0] ?? 0);

async function ifrs(file: string): Promise<Passage[]> {
  const std = stdName(file);
  const title = stdTitle(file);
  const topicOf = (h: string) => (h ? `${title}: ${h}` : title);
  const out: Passage[] = [];
  let heading = '';
  let cur: Passage | null = null;
  let last: string | null = null; // the last paragraph number taken: numbers only move forward within a series
  let continued = 0; // unnumbered passages after the same paragraph: "(continued)", "(continued 2)" …
  const flush = () => {
    // text with no number of its own must say something: a heading or a row of asterisks alone is left out
    const unnumbered = cur?.ref.includes('(continued');
    if (cur && cur.text.length >= (unnumbered ? 120 : 40) && /[a-z]{3}/.test(cur.text)) out.push(...split(cur));
    cur = null;
  };
  for (const page of await linesOf(file)) {
    const margin = Math.min(...page.map((l) => l.x));
    for (const l of page) {
      if (/^(IAS|IFRS) \d+$|© IFRS Foundation|^A\d+$/.test(l.text)) continue; // running header and footer
      // the standard only: what follows is approval, basis for conclusions, examples or guidance
      if (/^\d{1,2}[A-Z][a-z]/.test(l.text) && Math.abs(l.x - margin) <= 6) continue; // a footnote ("1In April 2024 …")
      // the standard only: what follows is approval, basis for conclusions, examples, guidance or amendments to others
      if (
        last &&
        /^(Approval by the Board|Basis for Conclusions|Illustrative Examples|Implementation Guidance|DISSENTING OPINION|The amendments? contained in this appendix|This amendment contained in this appendix)/i.test(
          l.text
        )
      ) {
        flush();
        return out;
      }
      const m = IFRS_PARA.exec(l.text);
      if (m && Math.abs(l.x - margin) <= 6) {
        const n = m[1]!;
        const forward = !last || seriesOf(n) !== seriesOf(last) || numOf(n) >= numOf(last);
        if (forward) {
          flush();
          last = n;
          continued = 0;
          cur = { ref: `${std} ${n}`, std, topic: topicOf(heading), text: m[2]! };
          continue;
        }
        // a number going backwards is a footnote at the foot of the page: not part of the standard's text
        continue;
      }
      if (!last) continue; // front matter before paragraph 1
      // a heading: a short line at the margin that starts with a capital, after a finished sentence (a line
      // continuing an unfinished one, an example or a footnote is text, not a heading)
      const isHeading =
        Math.abs(l.x - margin) <= 6 &&
        /^[A-Z]/.test(l.text) &&
        l.text.length < 110 &&
        !/[.;:,]$/.test(l.text) &&
        (!cur || /[.:;)]$/.test(cur.text));
      if (isHeading && !cur?.text.endsWith('-')) {
        flush();
        heading = l.text;
        continue;
      }
      // text with no number of its own (a worked example, a defined term) is cited by the paragraph it follows
      if (!cur) {
        continued++;
        cur = { ref: `${std} ${last} (continued${continued > 1 ? ` ${continued}` : ''})`, std, topic: topicOf(heading), text: '' };
      }
      const c: Passage = cur;
      c.text += (c.text ? ' ' : '') + l.text;
    }
  }
  flush();
  return unique(out);
}

// ---- run ----------------------------------------------------------------------------------------------------

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error('Give the folder that holds "FRS 102" and "IFRS".');
  const outDir = join(process.cwd(), 'standards');
  mkdirSync(outDir, { recursive: true });
  const frsFiles = readdirSync(join(root, 'FRS 102')).filter((f) => /^FRS_102_.*\.pdf$/i.test(f));
  const frs = (await Promise.all(frsFiles.map((f) => frs102(join(root, 'FRS 102', f))))).flat();
  const ifrsAll: Passage[] = [];
  for (const f of readdirSync(join(root, 'IFRS'))
    .filter((x) => x.endsWith('.pdf'))
    .sort())
    ifrsAll.push(...(await ifrs(join(root, 'IFRS', f))));
  writeFileSync(join(outDir, 'frs102.json'), JSON.stringify(frs));
  writeFileSync(join(outDir, 'ifrs.json'), JSON.stringify(ifrsAll));
  const size = (a: Passage[]) => `${a.length} passages, ${Math.round(a.reduce((n, p) => n + p.text.length, 0) / 1000)}k characters`;
  console.log(`FRS 102: ${size(frs)}\nIFRS: ${size(ifrsAll)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
