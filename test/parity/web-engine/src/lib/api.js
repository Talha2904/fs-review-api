// Client side of the four Claude API call sites. Each hits the server proxy in server/index.js.
import { toPayload } from './files';

export const NO_SERVER = 'Real documents need the analysis server, which isn’t available on this page. Use the sample documents here, or run the app on your server with an API key (npm run dev).';

// Which fund the next Claude calls are for (for the server's activity log), and whether the fund's
// client permits AI (the server refuses when not).
let aiCtx = { engagementId: null, fundName: null, aiAllowed: true, currency: 'GBP', umbrella: null };
export const setAiContext = ctx => { aiCtx = { ...aiCtx, ...ctx }; };

async function post(path, body) {
  body = { ...body, _ctx: { engagementId: aiCtx.engagementId, fundName: aiCtx.fundName }, aiAllowed: aiCtx.aiAllowed, currency: aiCtx.currency, umbrella: aiCtx.umbrella };
  let r;
  try { r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error(NO_SERVER); }
  const out = await r.json().catch(() => null);
  // A page with no analysis server answers "not found" or with a page instead of JSON.
  if (!out || [404, 405, 501].includes(r.status)) throw new Error(r.ok ? NO_SERVER : (out?.error?.message || out?.error || NO_SERVER));
  if (!r.ok) throw new Error(out.error?.message || out.error || `The server could not complete the request (${r.status}).`);
  return out;
}

// Strip display-only fields before sending documents back to Claude, to save tokens.
const lean = d => d && { title: d.title, meta: d.meta, blocks: d.blocks };

// CLAUDE API ① — read an uploaded document into blocks + figures
export async function extractDocument(slot, file) {
  const payload = await toPayload(file);
  return post('/api/extract', { slot, file: payload }); // → { title, meta, blocks, figures }
}

// CLAUDE API ② — qualitative narrative & disclosure review
export async function reviewNarrative(docs, threshold, highMultiple = 4, customChecks = []) {
  const { points } = await post('/api/narrative-review', {
    threshold, highMultiple, customChecks, docs: { cy: lean(docs.cy), py: lean(docs.py), is: lean(docs.is), sup: lean(docs.sup) }
  });
  return points.map(p => ({ ...p, source: 'narrative' }));
}

// CLAUDE API ③ — commentary for variance lines the deterministic model put outside expectation
export async function explainVariances(lines, docs, threshold, growth) {
  const { lines: out } = await post('/api/explain-variances', {
    threshold, growth,
    lines: lines.map(({ label, group, cy, py, delta, pct, band }) => ({ label, group, cy, py, delta, pct: pct && +pct.toFixed(1), band })),
    docs: { py: lean(docs.py), sup: lean(docs.sup) }
  });
  return Object.fromEntries(out.map(l => [l.label, l])); // shape matches VAR_NOTES
}

// CLAUDE API ④ — re-test earlier points against a new draft
export async function runVersionPass({ priorPoints, candidatePoints, previousDraft, newDraft, supporting }) {
  const pick = p => ({ ref: p.ref, pri: p.pri, title: p.title, basis: p.basis, refs: p.refs, amount: p.amount, anchor: p.anchor });
  return post('/api/version-pass', {
    priorPoints: priorPoints.map(pick), candidatePoints: candidatePoints.map(pick),
    previousDraft: lean(previousDraft), newDraft: lean(newDraft), supporting: lean(supporting)
  }); // → { prior: [{ref,status,note,duplicateOf}], newlyIntroduced: [{ref,note}] }
}

export const apiPost = (path, body) => post(path, body); // used by OCR
