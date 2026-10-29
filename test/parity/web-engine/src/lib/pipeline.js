// Orchestrates one analysis run. Demo mode replays the sample fund with no network calls.
import * as S from '../data/sampleFund';
import { runChecks, pointsFromChecks, rankPoints, annotateFlags, applyV3, varianceModel } from './review';
import { extractDocument, reviewNarrative, explainVariances, runVersionPass } from './api';
import { ruleOn } from '../data/checkLibrary';

export const SLOTS = ['cy', 'py', 'tb', 'is', 'sup'];
const SLOT_KEYS = {
  cy: ['ca', 'cl', 'statedTA', 'statedNA', 'pyNA', 'pyOpenNA', 'subs', 'reds', 'dists', 'ops', 'income', 'statedIncome', 'exp', 'sciExp', 'statedNote4', 'hier', 'mgmtCharged'],
  py: [], tb: ['tbDr', 'tbCr'], is: ['sched'], sup: ['mgmtRate']
};
const SAMPLE_K = { ...S.K, pyOpenNA: 379904870 };
const wait = ms => new Promise(r => setTimeout(r, ms));
const pad = n => 'RP-' + String(n).padStart(2, '0');

// Demo points are scripted, so the engagement removes the ones whose rule is switched off.
// RP-01 arises from either CHK-07 or CHK-08, so it stays while either is on.
const DEMO_RULES = { 'RP-01': ['CHK-07', 'CHK-08'], 'RP-03': ['CHK-11'], 'RP-06': ['CHK-10'], 'RP-08': ['CHK-05'] };
const DEMO_NARRATIVE = ['RP-02', 'RP-04', 'RP-05', 'RP-07'];
const keepDemo = (p, setup) => DEMO_NARRATIVE.includes(p.ref) ? setup.narrative
  : DEMO_RULES[p.ref] ? DEMO_RULES[p.ref].some(id => ruleOn(setup, id)) : true;

// Figures that the engagement can override or add before the checks run.
export const withSetup = (K, setup) => ({
  ...K, feeMonths: setup.feeMonths,
  mgmtRate: setup.feeRatePct != null && setup.feeRatePct !== '' ? setup.feeRatePct / 100 : K.mgmtRate
});
export const varianceOpts = setup => ({ mode: setup.varianceMode, investigatePct: setup.investigatePct, explainPct: setup.explainPct });

const docShell = (slot, ex, fileName) => ({
  ...S.docs[slot], title: ex.title || S.docs[slot].title, meta: ex.meta || '', blocks: ex.blocks || [], sub: fileName, ...(ex.umbrellaCast ? { umbrellaCast: ex.umbrellaCast } : {}), ...(ex.ocr ? { ocr: ex.ocr } : {})
});

export async function demoAnalysis(version, tick, setup) {
  for (let i = 1; i <= S.steps.length; i++) { await wait(260); tick(i); }
  const v3 = version === 3;
  const docs = { ...S.docs, cy: v3 ? applyV3(S.docs.cy) : S.docs.cy };
  const K = { ...SAMPLE_K, statedNote4: v3 ? S.K.statedNote4v3 : S.K.statedNote4 }; // raw figures; engagement settings are applied when checks run
  const points = S.basePoints.concat(v3 ? S.v3Points : []).filter(p => keepDemo(p, setup)).map(p => {
    const agent = v3 ? p.v3 : p.v2;
    return { ...p, agent, agentNote: v3 ? p.v3note : p.v2note, status: agent === 'resolved' ? 'cleared' : 'open' };
  });
  return { docs, K, points, varNotes: ruleOn(setup, 'CHK-11') ? S.VAR_NOTES : {}, version: v3 ? 3 : 2, priorResolved: v3 ? [] : S.resolvedV2, demo: true };
}

// ai: which AI steps may run ({ narrative, explain, version }); skipped steps are listed in result.aiSkipped.
// readings: optional cache { get(slot, sha256), put(slot, sha256, reading) }; a document whose content was
// read before is reused instead of being sent to AI again. result.aiReads says how many were read and reused.
import { parseTrialBalance } from './tbReader';
import { parseInvestmentSchedule } from './isReader';
import { xlsxContent, pdfText } from './docText';
import { parseFinancialPdf } from './fsReader';
import { ocrPdf, cachedOcr, isScanned } from './ocr';
import { apiPost } from './api';

export async function liveAnalysis(files, setup, tick, previous, library = [], ai = {}, readings = null, umbrella = null, opts = {}) {
  const aiSkipped = [], aiReads = { read: [], reused: [], local: [] };
  const th = setup.threshold;
  const docs = {}, figures = {};
  let step = 0; const next = () => tick(++step);

  // ① Extraction (parallel). Sample files fall back to the sample fund for that slot.
  const extracted = await Promise.all(SLOTS.filter(s => files[s]).map(async slot => {
    const f = files[slot];
    if (f.sample) return [slot, { ...S.docs[slot] }, Object.fromEntries(SLOT_KEYS[slot].map(k => [k, SAMPLE_K[k]]))];
    // An Excel trial balance or investment schedule is read by the app itself, without AI, when its
    // layout is recognised; otherwise it is read by AI as before.
    if ((slot === 'tb' || slot === 'is') && /\.xlsx$/i.test(f.name || f.file?.name || '')) {
      const sheets = (await xlsxContent(f.file)).sheets;
      const local = slot === 'tb' ? parseTrialBalance(sheets) : parseInvestmentSchedule(sheets);
      if (local) { aiReads.local.push(slot); return [slot, docShell(slot, local, f.name), local.figures]; }
    }
    // A digitally produced PDF of the statements or supporting information is read by the app when
    // it finds every figure; a partial reading is used only when AI is not available to read it fully.
    if (['cy', 'py', 'sup'].includes(slot) && /\.pdf$/i.test(f.name || f.file?.name || '') && f.file && f.readWith !== 'ai') {   // 'ai': chosen after low OCR confidence
      let content = await pdfText(f.file);
      // scanned: use the OCR reading made at upload, or read it now on the server (no AI)
      if (isScanned(content)) content = cachedOcr(f.sha256) || (opts.ocr ? await ocrPdf(f.file, { sha256: f.sha256, post: apiPost }).catch(() => content) : content);
      const local = parseFinancialPdf(content, slot, slot === 'sup' ? null : umbrella);
      if (local && (!local.local.missing.length || ai.extract === false)) { aiReads.local.push(slot); return [slot, docShell(slot, local, f.name), local.figures]; }
    }
    const cached = readings && f.sha256 ? readings.get(slot, f.sha256) : null;
    const ex = cached || await extractDocument(slot, f.file);
    if (cached) aiReads.reused.push(slot);
    else { aiReads.read.push(slot); if (readings && f.sha256) await readings.put(slot, f.sha256, ex); }
    return [slot, docShell(slot, ex, f.name), ex.figures || {}];
  }));
  extracted.forEach(([slot, doc, fig]) => { docs[slot] = doc; Object.assign(figures, fig); });
  next(); next(); next();

  const K = { mgmtRate: undefined, ...figures }; // raw extracted figures; engagement settings are applied when checks run
  const checks = runChecks(withSetup(K, setup), setup, docs, library);
  const checkPoints = pointsFromChecks(checks, th, setup.highMultiple);
  next(); next();

  // ② Narrative review
  const customNarrative = library.filter(r => r.engine === 'custom-narrative' && ruleOn(setup, r.id)).map(r => ({ id: r.id, name: r.name, instruction: r.def?.instruction || '' }));
  if (setup.narrative && ai.narrative === false) aiSkipped.push('Narrative review');
  const narrative = setup.narrative && ai.narrative !== false
    ? (await reviewNarrative(docs, th, setup.highMultiple, customNarrative)).map(p => ({ ...p, aiDrafted: true })) : [];
  next();

  // ③ Variance commentary on lines outside expectation
  const growth = K.pyNA && K.statedNA ? K.statedNA / K.pyNA - 1 : 0;
  const flagged = ruleOn(setup, 'CHK-11') ? varianceModel(docs.cy, {}, th, growth, varianceOpts(setup)).rows.filter(r => r.band !== 'Expected' && !r.sub) : [];
  if (flagged.length && ai.explain === false) aiSkipped.push('Variance explanations');
  const rawNotes = flagged.length && ai.explain !== false ? await explainVariances(flagged, docs, th, growth) : {};
  const varNotes = Object.fromEntries(Object.entries(rawNotes).map(([k, v]) => [k, { ...v, aiDrafted: true }]));
  next();

  let candidates = rankPoints([...checkPoints, ...narrative]);
  let points, priorResolved = [];

  // New references continue after the highest one used so far, so a reference is never reused.
  const nextRef = () => Math.max(0, ...(previous?.points || []).map(p => +(/^RP-(\d+)$/.exec(p.ref)?.[1] || 0))) + 1;
  if (!previous) {
    points = candidates.map((p, i) => ({ ...p, ref: pad(i + 1), status: 'open', agent: 'new', agentNote: 'Raised on this version.' }));
  } else if (ai.version === false) {
    // Version pass without AI: earlier points are matched to this draft's points by title.
    aiSkipped.push('Version pass');
    const prior = previous.points.filter(p => p.agent !== 'resolved'), start = nextRef();
    const byTitle = new Map(candidates.map(c => [c.title, c]));
    const carried = prior.map(p => byTitle.has(p.title)
      ? { ...p, ...byTitle.get(p.title), ref: p.ref, status: p.status, agent: 'outstanding', agentNote: 'Still raised on this draft (matched by the app, not AI).' }
      : { ...p, agent: 'resolved', agentNote: 'No longer raised on this draft (matched by the app, not AI).' });
    const priorTitles = new Set(prior.map(p => p.title));
    const fresh = candidates.filter(c => !priorTitles.has(c.title)).map((c, i) => ({ ...c, ref: pad(start + i), status: 'open', agent: 'new', agentNote: 'Raised on this draft.' }));
    points = [...carried, ...fresh];
  } else {
    // ④ Version pass against the previous result
    const start = nextRef();
    candidates = candidates.map((p, i) => ({ ...p, ref: pad(start + i) }));
    const prior = previous.points.filter(p => p.agent !== 'resolved');
    const vp = await runVersionPass({ priorPoints: prior, candidatePoints: candidates, previousDraft: previous.docs.cy, newDraft: docs.cy, supporting: docs.sup });
    const byRef = Object.fromEntries((vp.prior || []).map(x => [x.ref, x]));
    const carried = prior.map(p => {
      const r = byRef[p.ref] || { status: 'outstanding', note: 'Not re-tested.' };
      return { ...p, agent: r.status, agentNote: r.note, status: r.status === 'resolved' ? 'cleared' : p.status };
    });
    const dupes = new Set((vp.prior || []).map(x => x.duplicateOf).filter(Boolean));
    const fresh = (vp.newlyIntroduced || []).filter(n => !dupes.has(n.ref)).map(n => {
      const c = candidates.find(c => c.ref === n.ref);
      return c && { ...c, status: 'open', agent: 'new', agentNote: n.note };
    }).filter(Boolean);
    points = [...carried, ...fresh];
  }
  next();

  docs.cy = annotateFlags(docs.cy, points);
  return { docs, K, points, varNotes, version: previous ? previous.version + 1 : 1, priorResolved, demo: false, aiSkipped, aiReads };
}
