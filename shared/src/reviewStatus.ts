// Where each fund's review stands, and what each person needs to know: the portfolio's stages and the
// bell's notifications. Ported from the web app (PortfolioTab.jsx, lib/notifications.js) so the api works
// them out with the same rules; the api computes them, the screens only show them.
import { can, canClearPoint, type PermissionMatrix, type Role } from './roles.js';

// ---- portfolio stages -------------------------------------------------------------------------
export type TeamRole = 'preparer' | 'reviewer' | 'manager' | 'partner';
export type ScreenTab = 'docs' | 'sched' | 'signoff';

/** In order: the stage a fund's review has reached, who it waits for, and the screen to open. */
export const STAGES = [
  { name: 'Not started', owner: 'preparer', tab: 'docs' },
  { name: 'Preparing documents', owner: 'preparer', tab: 'docs' },
  { name: 'Sent back to preparer', owner: 'preparer', tab: 'docs' },
  { name: 'Ready to analyse', owner: 'reviewer', tab: 'docs' },
  { name: 'In review', owner: 'preparer', tab: 'sched' },
  { name: 'Returned to reviewer', owner: 'reviewer', tab: 'signoff' },
  { name: 'Ready for sign-off', owner: 'manager', tab: 'signoff' },
  { name: 'Awaiting partner', owner: 'partner', tab: 'signoff' },
  { name: 'Signed off', owner: null, tab: 'signoff' }
] as const satisfies readonly { name: string; owner: TeamRole | null; tab: ScreenTab }[];
export type StageName = (typeof STAGES)[number]['name'];

/** The few facts the stage depends on, which the api reads with aggregate queries. */
export interface FundProgress {
  hasDocuments: boolean;
  workflowState: string;
  signoffState: string;
  analysed: boolean;
  openPoints: number;
  respondedPoints: number;
}

export function stageOf(f: FundProgress): { stage: StageName; owner: TeamRole | null; tab: ScreenTab; order: number } {
  const so = f.signoffState;
  const stage: StageName =
    so === 'signed'
      ? 'Signed off'
      : so === 'manager-signed'
        ? 'Awaiting partner'
        : !f.hasDocuments
          ? 'Not started'
          : f.workflowState === 'returned'
            ? 'Sent back to preparer'
            : f.workflowState !== 'ready'
              ? 'Preparing documents'
              : !f.analysed
                ? 'Ready to analyse'
                : f.openPoints
                  ? 'In review'
                  : so === 'returned'
                    ? 'Returned to reviewer'
                    : 'Ready for sign-off';
  const order = STAGES.findIndex((s) => s.name === stage);
  const def = STAGES[order]!;
  // in review with responses: the responses are waiting for the reviewer
  const owner: TeamRole | null = stage === 'In review' && f.respondedPoints ? 'reviewer' : def.owner;
  return { stage, owner, tab: def.tab, order };
}

// ---- notifications -----------------------------------------------------------------------------
interface Who {
  id: string;
  name: string;
}
interface PointLike {
  id: string;
  ref: string;
  status: string;
  source?: string;
  content?: { title?: unknown };
  dueDate?: string | null;
  assignedTo?: Who | null;
  raisedBy?: Who | null;
  raisedAt: string;
  updatedAt: string;
}
interface MessageLike {
  id: string;
  pointId: string;
  kind: string;
  author: Who | null;
  at: string;
  text: string;
}
interface VersionLike {
  id: string;
  fileName: string;
  version: number;
  sample: boolean;
  sha256: string;
  uploadedAt: string;
  validation?: { ocrLow?: number; localReadable?: boolean } | null;
  confirmation?: unknown;
  readWith?: string | null;
}
interface HistoryLike {
  state: string;
  by: Who | null;
  at: string;
  reason?: string;
  text?: string;
}
/** One fund's review, in the review snapshot's shape. */
export interface ReviewLike {
  versions: VersionLike[];
  current: Partial<Record<string, VersionLike>>;
  workflow: { state: string; by?: Who | null; at?: string | null; reason?: string; history?: HistoryLike[] };
  signoff: { state: string; by?: Who | null; at?: string | null; text?: string; history?: HistoryLike[] };
  points: PointLike[];
  messages: MessageLike[];
  latestRun: { id: string; version: number; at: string; by?: Who | null; documentVersions?: Record<string, string> } | null;
}
export interface FundLike {
  id: string;
  entityId?: string;
  umbrella?: unknown;
  fund?: { name?: string; [k: string]: unknown };
}
export interface Notice {
  id: string;
  engagementId: string;
  fund: string;
  key: string;
  title: string;
  detail?: string | undefined;
  at?: string | null | undefined;
  tab: ScreenTab;
  ref?: string;
}

const contentKey = (v: VersionLike | null | undefined): string | null =>
  v ? v.sha256 || (v.sample ? 'sample:' + v.fileName : 'id:' + v.id) : null;
/** True when the documents now differ, by content, from the ones the analysis read. */
const changedSinceRun = (s: ReviewLike): boolean => {
  const run = s.latestRun;
  if (!run) return true;
  const byId = new Map(s.versions.map((v) => [v.id, v]));
  const before = Object.fromEntries(Object.entries(run.documentVersions || {}).map(([k, id]) => [k, byId.get(id) ?? null]));
  const slots = new Set([...Object.keys(before), ...Object.keys(s.current)]);
  return [...slots].some((k) => contentKey(before[k]) !== contentKey(s.current[k]));
};
const pick = (fundSetting: unknown, clientSetting: unknown): boolean =>
  fundSetting === 'on' ? true : fundSetting === 'off' ? false : !!clientSetting;

const EMPTY: ReviewLike = {
  versions: [],
  current: {},
  workflow: { state: 'preparing', history: [] },
  signoff: { state: 'none', history: [] },
  points: [],
  messages: [],
  latestRun: null
};

/**
 * What waits for this person (actions, which disappear once done) and what others did that concerns them
 * (updates, newest first, at most 60). A fund's named Preparer, Reviewer, Manager and Partner decide who is
 * "theirs"; when a name is empty, everyone whose role holds the matching permission is included.
 */
export function notificationsFor(
  user: { id: string; name: string; role: Role; active?: boolean },
  matrix: PermissionMatrix,
  funds: FundLike[],
  entities: { id: string; umbrella?: unknown }[],
  reviews: Record<string, ReviewLike>,
  today: string
): { actions: Notice[]; updates: Notice[] } {
  const actions: Notice[] = [],
    updates: Notice[] = [];
  const allowed = (perm: string) => can(user, perm, matrix);
  for (const eng of funds) {
    const engId = eng.id,
      s = reviews[engId] ?? EMPTY;
    const fund = String(eng.fund?.name || 'Untitled fund');
    const mine = (field: TeamRole, perm: string) => allowed(perm) && (eng.fund?.[field + 'Id'] ? eng.fund[field + 'Id'] === user.id : true);
    const add = (list: Notice[], item: Omit<Notice, 'id' | 'engagementId' | 'fund'>) =>
      list.push({ engagementId: engId, fund, ...item, id: `${list === actions ? 'a' : 'u'}:${engId}:${item.key}` });

    // ---- needs your action ----
    for (const p of s.points) {
      const ref = p.ref,
        title = String(p.content?.title ?? '');
      if (
        allowed('points.respond') &&
        ['open', 'reopened'].includes(p.status) &&
        (p.assignedTo ? p.assignedTo.id === user.id : mine('preparer', 'points.respond'))
      )
        add(actions, {
          key: 'respond:' + ref,
          title: p.status === 'reopened' ? `${ref} was reopened and needs your response` : `${ref} is waiting for your response`,
          detail: title,
          at: p.updatedAt,
          tab: 'sched',
          ref
        });
      const overdue = !!p.dueDate && p.status !== 'cleared' && p.dueDate < today;
      if (overdue && ['open', 'reopened'].includes(p.status) && p.assignedTo?.id === user.id)
        add(actions, {
          key: 'overdue:' + ref,
          title: `${ref} is overdue (due ${p.dueDate})`,
          detail: title,
          at: p.updatedAt,
          tab: 'sched',
          ref
        });
      if (p.status === 'responded' && canClearPoint(user, p, matrix))
        add(actions, {
          key: 'clear:' + ref,
          title: `${ref} has a response for you to review`,
          detail: title,
          at: p.updatedAt,
          tab: 'sched',
          ref
        });
    }
    const run = s.latestRun,
      wf = s.workflow,
      so = s.signoff;
    if (wf.state === 'returned' && mine('preparer', 'documents.attach'))
      add(actions, { key: 'docs-returned', title: 'Documents were sent back to you', detail: wf.reason, at: wf.at, tab: 'docs' });
    if (wf.state === 'ready' && so.state !== 'signed' && changedSinceRun(s) && mine('reviewer', 'analysis.run'))
      add(actions, {
        key: 'docs-ready',
        title: run ? 'Changed documents are ready to analyse again' : 'Documents are ready to analyse',
        detail: `Marked ready by ${wf.by?.name || 'the preparer'}`,
        at: wf.at,
        tab: 'docs'
      });
    const allCleared = s.points.every((p) => p.status === 'cleared');
    if (run && wf.state === 'ready' && allCleared && !['signed', 'returned'].includes(so.state) && mine('manager', 'review.signoff'))
      add(actions, {
        key: 'signoff',
        title: 'Ready for your sign-off',
        detail: `All ${s.points.length} review points are cleared`,
        at: so.at || run.at,
        tab: 'signoff'
      });
    if (so.state === 'manager-signed' && mine('partner', 'review.partnerSignoff'))
      add(actions, {
        key: 'partner',
        title: 'Ready for your partner sign-off',
        detail: `Signed off by the Manager, ${so.by?.name || ''}`,
        at: so.at,
        tab: 'signoff'
      });
    if (so.state === 'returned' && (allowed('points.clear') || allowed('points.clearAny')) && mine('reviewer', 'points.clear'))
      add(actions, { key: 'signoff-returned', title: 'The review was returned to you', detail: so.text, at: so.at, tab: 'signoff' });

    // a scanned document read with low OCR confidence: someone chooses AI, the OCR reading or a clearer scan
    for (const v of Object.values(s.current))
      if (v?.validation?.ocrLow && !v.confirmation && v.readWith !== 'ai' && mine('preparer', 'documents.attach'))
        add(actions, {
          key: 'ocr:' + v.id,
          title: `Low OCR confidence on ${v.fileName}`,
          detail: `${v.validation.ocrLow}% confidence: choose AI, the OCR reading, or a clearer scan`,
          at: v.uploadedAt,
          tab: 'docs'
        });

    // umbrella: a sister fund of the same client has a newer umbrella draft than this fund
    const ent = entities.find((x) => x.id === eng.entityId);
    if (pick(eng.umbrella, ent?.umbrella) && mine('preparer', 'documents.attach') && so.state !== 'signed') {
      const mineCy = s.current.cy;
      for (const sib of funds.filter((e) => e.entityId === eng.entityId && e.id !== engId && pick(e.umbrella, ent?.umbrella))) {
        const sc = reviews[sib.id]?.current?.cy;
        if (sc && !sc.sample && contentKey(sc) !== contentKey(mineCy) && (!mineCy || sc.uploadedAt > mineCy.uploadedAt))
          add(actions, {
            key: 'umb:' + sib.id,
            title: `A newer umbrella draft is in ${sib.fund?.name}`,
            detail: `${sc.fileName} (v${sc.version}): attach it here from the Documents screen`,
            at: sc.uploadedAt,
            tab: 'docs'
          });
      }
    }

    // ---- updates from other people ----
    const pointOf = new Map(s.points.map((p) => [p.id, p]));
    for (const m of s.messages) {
      const p = pointOf.get(m.pointId);
      if (!p || !m.author || m.author.id === user.id) continue;
      const who = m.author.name,
        ref = p.ref,
        toRaiser = p.raisedBy?.id === user.id,
        toAssignee = p.assignedTo?.id === user.id;
      const item = (title: string) => add(updates, { key: m.id, title, detail: m.text, at: m.at, tab: 'sched', ref });
      if (m.kind === 'response' && toRaiser) item(`${who} responded to ${ref}`);
      else if (m.kind === 'reopen' && toAssignee) item(`${who} reopened ${ref}`);
      else if (m.kind === 'clear' && toAssignee) item(`${who} cleared ${ref}`);
      // the analysis's own assignments are summarised once ("ran the analysis… N points assigned to you")
      else if (
        m.kind === 'assign' &&
        toAssignee &&
        m.text.includes(user.name) &&
        !(p.source === 'analysis' && m.author.id === p.raisedBy?.id && Math.abs(Date.parse(m.at) - Date.parse(p.raisedAt)) < 5000)
      )
        item(`${who} assigned ${ref} to you`);
      else if (m.kind === 'comment' && (toRaiser || toAssignee)) item(`${who} commented on ${ref}`);
      else if (m.kind === 'raise' && p.source === 'manual' && toAssignee) item(`${who} raised ${ref} for you`);
    }
    if (run && run.by?.id !== user.id && mine('preparer', 'points.respond')) {
      const n = s.points.filter((p) => p.assignedTo?.id === user.id && p.status !== 'cleared').length;
      add(updates, {
        key: 'run:' + run.id,
        title: `${run.by?.name} ran the analysis of draft v${run.version}`,
        detail: n ? `${n} point${n === 1 ? '' : 's'} assigned to you` : '',
        at: run.at,
        tab: 'sched'
      });
    }
    for (const h of wf.history || []) {
      if (!h.by || h.by.id === user.id) continue;
      if (h.state === 'ready' && mine('reviewer', 'analysis.run'))
        add(updates, { key: 'wf:' + h.at, title: `${h.by.name} marked the documents ready for review`, at: h.at, tab: 'docs' });
      if (h.state === 'returned' && mine('preparer', 'documents.attach'))
        add(updates, { key: 'wf:' + h.at, title: `${h.by.name} sent the documents back`, detail: h.reason, at: h.at, tab: 'docs' });
    }
    for (const h of so.history || []) {
      if (!h.by || h.by.id === user.id) continue;
      const t: Record<string, [string, boolean]> = {
        returned: [`${h.by.name} returned the review to the reviewer`, mine('reviewer', 'points.clear')],
        resubmitted: [`${h.by.name} resubmitted the review for sign-off`, mine('manager', 'review.signoff')],
        signed: [`${h.by.name} signed off ${fund}`, mine('preparer', 'points.respond') || mine('reviewer', 'points.clear')],
        unlocked: [`${h.by.name} unlocked ${fund} after sign-off`, mine('preparer', 'points.respond') || mine('reviewer', 'points.clear')]
      };
      const entry = t[h.state];
      if (entry && entry[1]) add(updates, { key: 'so:' + h.at, title: entry[0], detail: h.text, at: h.at, tab: 'signoff' });
    }
  }
  const newest = (a: Notice, b: Notice) => String(b.at || '').localeCompare(String(a.at || ''));
  actions.sort(newest);
  updates.sort(newest);
  return { actions, updates: updates.slice(0, 60) };
}
