import type { PermissionMatrix, SignoffState } from '@fs-review/shared';
import { ruleOn, setupFor } from '@fs-review/shared/analysis';

import { notFound, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { changedSince, type Person } from '../../domain/review/Document.js';
import type { EngagementDocument } from '../../domain/review/Engagement.js';
import type { EntityDocument } from '../../domain/review/Entity.js';
import type { BillingActions } from '../billing/BillingActions.js';
import { requireAnyPermission, requirePermission } from '../identity/authorize.js';
import { isActiveJob, type AnalysisJobRepository } from '../ports/AnalysisJobRepository.js';
import type { AnalysisRunRepository } from '../ports/AnalysisRunRepository.js';
import type { CheckRuleConfigRepository } from '../ports/CheckRuleConfigRepository.js';
import type { ChecklistAnswerRepository } from '../ports/ChecklistAnswerRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { FileStorage } from '../ports/FileStorage.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { PointRepository } from '../ports/PointRepository.js';
import type { ReportRepository, ReviewReport, ReviewReportView } from '../ports/ReportRepository.js';
import { EMPTY_SIGNOFF, type Signoff, type SignoffRepository } from '../ports/SignoffRepository.js';
import type { Tokens } from '../ports/Tokens.js';
import type { WorkflowRepository } from '../ports/WorkflowRepository.js';

import type { ReviewAccess } from './access.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
const pick = (fund: string | undefined, client: boolean | undefined) => (fund === 'on' ? true : fund === 'off' ? false : !!client);

/**
 * The sign-off state machine, with the checks the browser used to make now made here:
 * documents marked ready, an analysis recorded, every point cleared, the checklist complete.
 * Partner sign-off where the client or fund requires it. Final sign-off and unlock tell Finance.
 */
export interface SignoffDeps {
  access: ReviewAccess;
  signoffs: SignoffRepository;
  engagements: EngagementRepository;
  entities: EntityRepository;
  workflows: WorkflowRepository;
  runs: AnalysisRunRepository;
  jobs: AnalysisJobRepository;
  documents: DocumentRepository;
  points: PointRepository;
  checklists: ChecklistAnswerRepository;
  checkRules: CheckRuleConfigRepository;
  billing: BillingActions;
  clock: Clock;
  events: EventBus;
}

export class SetSignoff {
  constructor(private readonly d: SignoffDeps) {}

  async execute(
    actor: Actor | null,
    matrix: PermissionMatrix,
    engagementId: string,
    state: SignoffState,
    text = '',
    summary: unknown = null,
    ip?: string
  ): Promise<Signoff> {
    const by = await this.d.access.reader(actor, matrix, engagementId);
    const eng = (await this.d.engagements.findById(engagementId))!.doc;
    const ent = eng.entityId ? await this.d.entities.findById(eng.entityId) : null;
    const cur = (await this.d.signoffs.get(engagementId)) ?? EMPTY_SIGNOFF(engagementId);
    // Once the Manager has signed for a Partner to follow, the Partner step is fixed: a later change of the
    // client's or fund's setting cannot turn it off.
    const partnerRequired = cur.state === 'manager-signed' || pick(eng.partnerSignoff, ent?.doc.partnerSignoff);
    if (isActiveJob(await this.d.jobs.latest(engagementId)))
      throw validationFailed('An analysis of this fund is running. Wait for it to finish.');

    switch (state) {
      case 'manager-signed':
        requirePermission(by, 'review.signoff', matrix);
        if (!partnerRequired) throw validationFailed('This client does not require partner sign-off; sign off the review instead.');
        if (['manager-signed', 'signed'].includes(cur.state)) throw validationFailed('The review is already signed off.');
        await this.checkReady(engagementId, eng, ent?.doc ?? null);
        break;
      case 'signed':
        if (partnerRequired) {
          if (cur.state !== 'manager-signed')
            throw validationFailed('The Manager signs off first; the Partner then gives the final sign-off.');
          requirePermission(by, 'review.partnerSignoff', matrix);
          if (cur.by?.id === by.id)
            throw validationFailed('The partner sign-off must be given by someone other than the Manager who signed off.');
        } else {
          requirePermission(by, 'review.signoff', matrix);
          if (cur.state === 'signed') throw validationFailed('The review is already signed off.');
          await this.checkReady(engagementId, eng, ent?.doc ?? null);
        }
        break;
      case 'returned':
        requireAnyPermission(by, ['review.signoff', 'review.partnerSignoff'], matrix, 'Your role cannot return a review.');
        if (cur.state === 'signed') throw validationFailed('A signed-off review must be unlocked, not returned.');
        if (!String(text || '').trim()) throw validationFailed('Give the reason for returning the review.');
        break;
      case 'resubmitted':
        requirePermission(by, 'analysis.run', matrix);
        if (cur.state !== 'returned') throw validationFailed('Only a returned review can be resubmitted.');
        break;
      case 'unlocked':
        requirePermission(by, 'review.signoff', matrix);
        if (!['signed', 'manager-signed'].includes(cur.state)) throw validationFailed('Only a signed-off review can be unlocked.');
        if (!String(text || '').trim()) throw validationFailed('Give the reason for unlocking the review.');
        break;
      default:
        throw validationFailed('Unknown sign-off state.');
    }
    const now = this.d.clock.nowIso();
    const entry = { state, by: who(by), at: now, text: String(text || ''), summary: summary ?? null };
    const next: Signoff = { engagementId, ...entry, history: [...cur.history, entry] };
    await this.d.signoffs.save(next);

    // Finance learns of a final sign-off and of an unlock: what it needs to invoice, no review content. The two
    // are kept together: if the billing event cannot be saved, the sign-off is put back and the error reported.
    if (state === 'signed' || state === 'unlocked') {
      const event = billingEventFor(eng, ent?.doc ?? null, by, now, String(text || ''));
      try {
        await this.d.billing.apply(by, { type: state === 'signed' ? 'signoff' : 'unlock', event }, ip);
      } catch (e) {
        await this.d.signoffs.save(cur);
        throw e;
      }
    }
    await this.d.events.publish({ topic: 'signoffs', engagementId, at: now });
    return next;
  }

  private async checkReady(engagementId: string, eng: EngagementDocument, ent: EntityDocument | null): Promise<void> {
    const wf = await this.d.workflows.get(engagementId);
    if (wf?.state !== 'ready') throw validationFailed('The documents are not marked ready for review.');
    const run = await this.d.runs.latest(engagementId);
    if (!run) throw validationFailed('The analysis has not been run.');
    // the analysis must be of the documents as they are now (a revised document may have arrived on a response)
    const changed = changedSince(await this.d.documents.listByEngagement(engagementId), run.documentVersions);
    if (changed.length)
      throw validationFailed(
        `The documents changed since the last analysis (${changed.map((s) => SLOT_NAMES[s] ?? s).join(', ')}). Run the analysis again before signing off.`
      );
    const open = (await this.d.points.listByEngagement(engagementId)).filter((p) => p.status !== 'cleared');
    if (open.length)
      throw validationFailed(
        `${open.length} review point${open.length === 1 ? ' is' : 's are'} not cleared: ${open
          .slice(0, 3)
          .map((p) => p.ref)
          .join(', ')}${open.length > 3 ? '…' : ''}.`
      );
    // CHK-13: where the disclosure checklist is switched on for the fund, it must exist and be complete
    const config = await this.d.checkRules.get();
    const { setup } = setupFor(eng, ent, config ? { rules: config.rules, overrides: config.overrides, custom: config.custom } : null);
    const c = await this.d.checklists.get(engagementId);
    if (ruleOn(setup, 'CHK-13') && ent?.framework && !c) throw validationFailed('The disclosure checklist has not been completed.');
    if (c) {
      const unanswered = c.items.filter((i) => !c.answers[i.id]);
      if (unanswered.length)
        throw validationFailed(`${unanswered.length} disclosure checklist item${unanswered.length === 1 ? ' is' : 's are'} not answered.`);
    }
  }
}

const SLOT_NAMES: Partial<Record<string, string>> = {
  cy: 'Current Year Draft Financial Statements',
  py: 'Prior Year Signed Financial Statements',
  tb: 'Trial Balance',
  is: 'Investment Schedule',
  sup: 'Supporting Information'
};

function billingEventFor(eng: EngagementDocument, ent: EntityDocument | null, by: Actor, at: string, conclusion: string) {
  const yearEnd = String(eng.fund?.yearEnd || '');
  return {
    engagementId: eng.id,
    fundName: String(eng.fund?.name || ''),
    entityName: ent?.name || '',
    clientName: ent?.client || ent?.name || String(eng.fund?.name || ''),
    billingEmail: ent?.billingEmail || '',
    yearEnd,
    yearEndLabel: yearEnd
      ? new Date(yearEnd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      : '',
    signedBy: by.name,
    signedAt: at,
    conclusion
  };
}

/** The review report PDF the web app makes at a final sign-off. Allowed while the review is locked, since that is when it is made. */
export class AddReport {
  constructor(
    private readonly access: ReviewAccess,
    private readonly reports: ReportRepository,
    private readonly signoffs: SignoffRepository,
    private readonly storage: FileStorage,
    private readonly tokens: Tokens,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string, bytes: Uint8Array): Promise<ReviewReportView> {
    const by = await this.access.reader(actor, matrix, engagementId);
    requireAnyPermission(by, ['review.signoff', 'review.partnerSignoff'], matrix, 'Your role cannot file a review report.');
    if (!bytes.length || bytes[0] !== 0x25 || bytes[1] !== 0x50) throw validationFailed('The report must be a PDF.');
    const s = await this.signoffs.get(engagementId);
    if (s?.state !== 'signed') throw validationFailed('The review report is filed at the final sign-off.');
    const fin = [...(s?.history ?? [])].reverse().find((h) => h.state === 'signed');
    const id = this.ids.next();
    const storageKey = `engagements/${engagementId}/reports/${id}`;
    await this.storage.put(storageKey, bytes, 'application/pdf');
    const rec: ReviewReport = {
      id,
      engagementId,
      version: (await this.reports.listByEngagement(engagementId)).length + 1,
      sha256: this.tokens.fingerprintBytes(bytes),
      size: bytes.length,
      storageKey,
      by: who(by),
      at: this.clock.nowIso(),
      signedBy: fin?.by ?? null,
      signedAt: fin?.at ?? null
    };
    await this.reports.create(rec);
    await this.events.publish({ topic: 'review_reports', engagementId, at: rec.at });
    const { storageKey: _k, ...view } = rec;
    return view;
  }
}

export class DownloadReport {
  constructor(
    private readonly access: ReviewAccess,
    private readonly reports: ReportRepository,
    private readonly storage: FileStorage
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, id: string): Promise<{ version: number; bytes: Uint8Array }> {
    const r = await this.reports.findById(id);
    if (!r) throw notFound('That review report');
    await this.access.reader(actor, matrix, r.engagementId);
    const f = await this.storage.get(r.storageKey);
    if (!f) throw notFound('That review report’s file');
    return { version: r.version, bytes: f.bytes };
  }
}
