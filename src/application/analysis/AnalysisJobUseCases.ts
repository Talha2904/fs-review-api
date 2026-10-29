// Analysis on the server (Phase 6, ADR 0008). Starting an analysis checks what the screens used to check,
// saves a queued job and returns at once; the job runs in the background, reports each step over the
// event stream, then saves the review points and the run exactly as the browser did, and logs it.
import type { PermissionMatrix, Slot } from '@fs-review/shared';
import {
  AI_REASON,
  currencyOf,
  fundAi,
  ocrContent,
  runChecks,
  settingsSignature,
  setupFor,
  umbrellaFor,
  withSetup,
  type AnalysisResult,
  type DocSlot,
  type LibraryRule,
  type PdfContent,
  type Reading,
  type Setup,
  type Umbrella
} from '@fs-review/shared/analysis';

import { AppError, conflict, notFound, validationFailed } from '../../domain/errors.js';
import { actorOf, type Actor } from '../../domain/identity/User.js';
import {
  changedSince,
  currentVersions,
  isCleared,
  REQUIRED_SLOTS,
  type DocumentVersion,
  type Person
} from '../../domain/review/Document.js';
import type { EngagementDocument } from '../../domain/review/Engagement.js';
import type { EntityDocument } from '../../domain/review/Entity.js';
import type { ReviewPoint } from '../../domain/review/Point.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { LoadAiSettings } from '../ai/AiSettingsUseCases.js';
import type { RunAiStep } from '../ai/RunAiStep.js';
import type { AiGateway } from '../ports/AiGateway.js';
import { isActiveJob, type AnalysisJob, type AnalysisJobRepository, type AnalysisMode } from '../ports/AnalysisJobRepository.js';
import type { AnalysisRun, AnalysisRunRepository } from '../ports/AnalysisRunRepository.js';
import type { CheckRuleConfigRepository } from '../ports/CheckRuleConfigRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { DocumentReader } from '../ports/DocumentReader.js';
import type { DocumentRepository } from '../ports/DocumentRepository.js';
import type { EngagementRepository } from '../ports/EngagementRepository.js';
import type { EntityRepository } from '../ports/EntityRepository.js';
import type { EventBus } from '../ports/EventBus.js';
import type { FileStorage } from '../ports/FileStorage.js';
import type { IdGenerator } from '../ports/IdGenerator.js';
import type { JobQueue } from '../ports/JobQueue.js';
import type { Logger } from '../ports/Logger.js';
import type { OcrEngine } from '../ports/OcrEngine.js';
import type { PermissionRepository } from '../ports/PermissionRepository.js';
import type { PointRepository } from '../ports/PointRepository.js';
import type { ReadingRepository } from '../ports/ReadingRepository.js';
import type { UserRepository } from '../ports/UserRepository.js';
import type { WorkflowRepository } from '../ports/WorkflowRepository.js';
import type { ReviewAccess } from '../review/access.js';

import { AiAnalysisSteps } from './AiAnalysisSteps.js';
import { ANALYSIS_STEPS, liveAnalysis, sampleAnalysis, type AnalysisFile } from './AnalysisPipeline.js';
import type { AnalysisPointInput, SaveAnalysisRun, SyncAnalysisPoints } from './AnalysisUseCases.js';

const who = (a: Actor): Person => ({ id: a.id, name: a.name, role: a.role });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Everything an analysis of one fund depends on, gathered once. */
export interface AnalysisContext {
  engagement: EngagementDocument;
  entity: EntityDocument | null;
  setup: Setup;
  library: LibraryRule[];
  currency: string;
  versions: DocumentVersion[];
  current: Partial<Record<Slot, DocumentVersion>>;
  workflowState: string;
  latestRun: AnalysisRun | null;
  /** the fund's review points now (references in use) */
  points: ReviewPoint[];
  aiAllowed: boolean;
  aiFlags: { extract: boolean; narrative: boolean; explain: boolean; version: boolean };
  model: string;
  /** why real documents cannot be read by AI here, or '' */
  readBlock: string;
  umbrella: Umbrella | null;
  umbrellaName: string;
}

export class AnalysisContextLoader {
  constructor(
    private readonly engagements: EngagementRepository,
    private readonly entities: EntityRepository,
    private readonly checkRules: CheckRuleConfigRepository,
    private readonly documents: DocumentRepository,
    private readonly workflows: WorkflowRepository,
    private readonly runs: AnalysisRunRepository,
    private readonly loadAi: LoadAiSettings,
    private readonly gateway: AiGateway,
    private readonly points: PointRepository
  ) {}

  async load(engagementId: string): Promise<AnalysisContext> {
    const rec = await this.engagements.findById(engagementId);
    if (!rec) throw notFound('That engagement');
    const engagement = rec.doc;
    const [entityRec, config, versions, workflow, latestRun, ai, all, points] = await Promise.all([
      engagement.entityId ? this.entities.findById(engagement.entityId) : Promise.resolve(null),
      this.checkRules.get(),
      this.documents.listByEngagement(engagementId),
      this.workflows.get(engagementId),
      this.runs.latest(engagementId),
      this.loadAi.execute(),
      this.engagements.list(),
      this.points.listByEngagement(engagementId)
    ]);
    const entity = entityRec?.doc ?? null;
    const { setup, library } = setupFor(
      engagement,
      entity,
      config ? { rules: config.rules, overrides: config.overrides, custom: config.custom } : null
    );
    // What AI may do for this fund: the server's key, the Administrator's settings and the client's permission.
    const state = fundAi(engagement, entity);
    const aiAllowed = state === 'permitted';
    const serverKey = this.gateway.keyStatus().configured;
    const aiOn = serverKey && !!ai.enabled && aiAllowed;
    const steps: Partial<Record<string, boolean>> = ai.steps || {};
    const aiFlags = {
      extract: aiOn && steps.extract !== false,
      narrative: aiOn && steps.narrative !== false,
      explain: aiOn && steps.explain !== false,
      version: aiOn && steps.version !== false
    };
    const readBlock = !aiAllowed
      ? `${AI_REASON[state as Exclude<typeof state, 'permitted'>]} Real documents can be attached and checked but not analysed; the built-in sample documents can still be analysed.`
      : !serverKey
        ? 'No Claude API key is configured on the server, so real documents can’t be analysed. An Administrator can check this under AI Settings.'
        : !ai.enabled
          ? 'AI is turned off, so real documents can be attached and checked but not analysed. An Administrator can turn it on under AI Settings.'
          : !aiFlags.extract
            ? 'Reading real documents is turned off under AI Settings, so real documents can be checked but not analysed.'
            : '';
    // Umbrella accounts: this fund's figures are read from its own column or section; the other umbrella
    // funds of the same client tell the reader where sections end.
    const isUmbrella = umbrellaFor(engagement, entity);
    const umbrellaName = isUmbrella ? String(engagement.umbrellaName || engagement.fund?.name || '') : '';
    const siblings = isUmbrella
      ? all.map((r) => r.doc).filter((e) => e.entityId === engagement.entityId && e.id !== engagement.id && umbrellaFor(e, entity))
      : [];
    const umbrella = isUmbrella
      ? { name: umbrellaName, names: [umbrellaName, ...siblings.map((e) => String(e.umbrellaName || e.fund?.name || '')).filter(Boolean)] }
      : null;
    return {
      engagement,
      entity,
      setup,
      library,
      currency: currencyOf(setup.fund?.currency),
      versions,
      current: currentVersions(versions),
      workflowState: workflow?.state ?? 'preparing',
      latestRun,
      points,
      aiAllowed,
      aiFlags,
      model: ai.model,
      readBlock,
      umbrella,
      umbrellaName
    };
  }
}

/** The first reason this fund cannot be analysed now, or ''. The same rules the Documents tab applies. */
export function analysisBlocker(ctx: AnalysisContext, mode: AnalysisMode): string {
  const docs = Object.values(ctx.current) as DocumentVersion[];
  if (ctx.workflowState !== 'ready') return 'The documents must be marked ready for review before they are analysed.';
  if (!REQUIRED_SLOTS.every((s) => ctx.current[s])) return 'Every required document must be attached before the analysis runs.';
  if (docs.some((v) => v.validation?.status === 'checking')) return 'A document is still being checked. Wait for the check to finish.';
  if (!docs.every(isCleared)) return 'A document needs a check or confirmation before the analysis runs.';
  const needsAi = (v: DocumentVersion | undefined) => !!v && !v.sample && (!v.validation?.localReadable || v.readWith === 'ai');
  if (mode === 'nextDraft') return needsAi(ctx.current.cy) ? ctx.readBlock : '';
  if (ctx.latestRun && changedSince(ctx.versions, ctx.latestRun.documentVersions).length === 0)
    return 'Nothing has changed since the last analysis. Attach a new version of a document to analyse again.';
  return docs.some(needsAi) ? ctx.readBlock : '';
}

/** Starts an analysis: checks it can run, saves a queued job and hands it to the queue. */
export class StartAnalysis {
  constructor(
    private readonly access: ReviewAccess,
    private readonly contexts: AnalysisContextLoader,
    private readonly jobs: AnalysisJobRepository,
    private readonly queue: JobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus
  ) {}

  async execute(actor: Actor | null, matrix: PermissionMatrix, engagementId: string, mode: AnalysisMode): Promise<AnalysisJob> {
    const by = await this.access.writer(actor, matrix, engagementId, ['analysis.run']);
    if (isActiveJob(await this.jobs.latest(engagementId))) throw conflict('An analysis of this fund is already running.');
    const ctx = await this.contexts.load(engagementId);
    const blocker = analysisBlocker(ctx, mode);
    if (blocker) throw validationFailed(blocker);
    const now = this.clock.nowIso();
    const job: AnalysisJob = {
      id: this.ids.next(),
      engagementId,
      mode,
      status: 'queued',
      step: 0,
      total: ANALYSIS_STEPS.length,
      error: null,
      runId: null,
      requestedBy: who(by),
      createdAt: now,
      startedAt: null,
      finishedAt: null
    };
    if (!(await this.jobs.createIfIdle(job))) throw conflict('An analysis of this fund is already running.');
    await this.events.publish({
      topic: 'analysis_jobs',
      engagementId,
      at: now,
      data: { jobId: job.id, status: job.status, step: 0, total: job.total }
    });
    this.queue.enqueue(job.id);
    return job;
  }
}

export class GetAnalysisJob {
  constructor(
    private readonly access: ReviewAccess,
    private readonly jobs: AnalysisJobRepository
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, jobId: string): Promise<AnalysisJob> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw notFound('That analysis');
    await this.access.reader(actor, matrix, job.engagementId);
    return job;
  }
}

export interface RunAnalysisJobDeps {
  jobs: AnalysisJobRepository;
  contexts: AnalysisContextLoader;
  users: UserRepository;
  permissions: PermissionRepository;
  storage: FileStorage;
  readings: ReadingRepository;
  reader: DocumentReader;
  ocr: OcrEngine;
  runAiStep: RunAiStep;
  syncPoints: SyncAnalysisPoints;
  saveRun: SaveAnalysisRun;
  activity: ActivityRecorder;
  clock: Clock;
  events: EventBus;
  logger: Logger;
}

/** Runs one queued analysis as the person who started it. Called by the job queue. */
export class RunAnalysisJob {
  constructor(private readonly d: RunAnalysisJobDeps) {}

  async execute(jobId: string): Promise<void> {
    const queued = await this.d.jobs.findById(jobId);
    if (!queued || queued.status !== 'queued') return;
    let job: AnalysisJob = { ...queued, status: 'running', startedAt: this.d.clock.nowIso() };
    let progress = Promise.resolve();
    const tick = (step: number) => {
      job = { ...job, step };
      const snapshot = job;
      progress = progress.then(() => this.save(snapshot)).catch(() => undefined);
    };
    let fundName: string | null = null,
      actor: Actor | null = null;
    try {
      await this.save(job);
      const user = await this.d.users.findById(job.requestedBy.id);
      if (!user?.active) throw validationFailed('The person who started this analysis can no longer sign in.');
      actor = actorOf(user);
      const matrix = await this.d.permissions.get();
      const ctx = await this.d.contexts.load(job.engagementId);
      fundName = ctx.engagement.fund?.name || null;
      const blocker = analysisBlocker(ctx, job.mode);
      if (blocker) throw validationFailed(blocker);

      const nextDraft = job.mode === 'nextDraft';
      const previous = nextDraft ? ((ctx.latestRun?.result as unknown as AnalysisResult | undefined) ?? null) : null;
      const docs = Object.values(ctx.current) as DocumentVersion[];
      const demo = docs.every((v) => v.sample);
      const result = demo
        ? sampleAnalysis(nextDraft ? 3 : 2, ctx.setup, tick)
        : await liveAnalysis(
            {
              files: this.files(ctx),
              setup: ctx.setup,
              library: ctx.library,
              previous,
              ai: ctx.aiFlags,
              umbrella: ctx.umbrella,
              currency: ctx.currency,
              existing: ctx.points.map((p) => ({ ref: p.ref, title: String(p.content.title ?? '') }))
            },
            {
              reader: this.d.reader,
              ai: new AiAnalysisSteps(
                (input) =>
                  this.d.runAiStep.execute(actor, matrix, input, {
                    engagementId: job.engagementId,
                    fundName,
                    aiAllowed: ctx.aiAllowed,
                    currency: ctx.currency,
                    umbrella: ctx.umbrella ? ctx.umbrellaName : null
                  }),
                this.d.reader
              ),
              readings: this.readingCache(ctx, actor),
              ocr: (f) => this.readScan(f, actor as Actor, job.engagementId, fundName),
              tick
            }
          );
      await progress;

      // Nothing is saved if the fund changed while the analysis ran: documents replaced, sent back or signed off,
      // or this job given up as stuck.
      const read = Object.fromEntries(Object.entries(ctx.current).map(([slot, v]) => [slot, (v as DocumentVersion).id]));
      const now = await this.d.contexts.load(job.engagementId);
      const nowIds = Object.fromEntries(Object.entries(now.current).map(([slot, v]) => [slot, (v as DocumentVersion).id]));
      if (JSON.stringify(nowIds) !== JSON.stringify(read))
        throw validationFailed('The documents changed while the analysis ran. Run it again.');
      if (now.workflowState !== 'ready') throw validationFailed('The documents were sent back while the analysis ran.');
      if ((await this.d.jobs.findById(job.id))?.status !== 'running') return;

      // Saved as the browser saved them: the points (new ones assigned to the preparer), then the run.
      await this.d.syncPoints.execute(
        actor,
        matrix,
        job.engagementId,
        result.points as unknown as AnalysisPointInput[],
        await this.preparerOf(ctx),
        result.version
      );
      const run = await this.d.saveRun.execute(actor, matrix, job.engagementId, {
        result: result as unknown as Record<string, unknown>,
        analysedAt: this.d.clock.nowIso(),
        settingsSig: settingsSignature(ctx.setup),
        documentVersions: read
      });
      const diffs = runChecks(withSetup(result.K, ctx.setup), ctx.setup, result.docs, ctx.library).filter(
        (c) => c.result === 'Difference'
      ).length;
      const reads = result.aiReads;
      await this.d.activity.record({
        actor,
        category: 'Analysis',
        summary: nextDraft
          ? `Ran the version pass on ${fundName} with ${ctx.current.cy?.fileName ?? 'the next draft'} (draft v${result.version})`
          : `Ran the analysis on ${fundName} (draft v${result.version})`,
        details: `${diffs} check${diffs === 1 ? '' : 's'} differ · ${result.points.length} review points${demo ? ' · sample documents' : ''}${
          reads ? ` · AI read ${plural(reads.read.length, 'document')}, reused ${plural(reads.reused.length, 'earlier reading')}` : ''
        }`,
        engagementId: job.engagementId,
        fundName
      });
      job = { ...job, status: 'done', step: job.total, runId: run.id, finishedAt: this.d.clock.nowIso() };
      await this.save(job);
    } catch (e) {
      await progress;
      const message =
        e instanceof AppError
          ? e.message
          : 'The analysis could not be completed. Try again, and tell an Administrator if it keeps failing.';
      if (!(e instanceof AppError)) this.d.logger.error({ err: e, jobId }, 'Analysis job failed');
      job = { ...job, status: 'failed', error: message, finishedAt: this.d.clock.nowIso() };
      await this.save(job).catch((err: unknown) => this.d.logger.error({ err, jobId }, 'Could not record a failed analysis job'));
      await this.d.activity
        .record({
          actor,
          category: 'Analysis',
          summary: `Analysis failed on ${fundName ?? 'a fund'}`,
          details: message,
          engagementId: job.engagementId,
          fundName
        })
        .catch(() => undefined);
    }
  }

  private async save(job: AnalysisJob) {
    await this.d.jobs.update(job);
    await this.d.events.publish({
      topic: 'analysis_jobs',
      engagementId: job.engagementId,
      at: this.d.clock.nowIso(),
      data: { jobId: job.id, status: job.status, step: job.step, total: job.total }
    });
  }

  private files(ctx: AnalysisContext): Partial<Record<DocSlot, AnalysisFile>> {
    const out: Partial<Record<DocSlot, AnalysisFile>> = {};
    for (const [slot, v] of Object.entries(ctx.current) as [DocSlot, DocumentVersion][]) {
      let bytes: Promise<Uint8Array> | null = null;
      out[slot] = {
        name: v.fileName,
        sample: v.sample,
        sha256: v.sha256,
        readWith: v.readWith,
        bytes: () =>
          (bytes ??= (async () => {
            const stored = v.storageKey ? await this.d.storage.get(v.storageKey) : null;
            if (!stored) throw validationFailed(`The file for ${v.fileName} could not be found in storage.`);
            return stored.bytes;
          })())
      };
    }
    return out;
  }

  /** AI readings kept by content: an umbrella document is read separately for each sub-fund. */
  private readingCache(ctx: AnalysisContext, actor: Actor | null) {
    const key = (slot: DocSlot, sha: string) =>
      `${ctx.umbrella && slot !== 'sup' ? `${slot}@${ctx.umbrellaName}` : slot}:${sha}:${ctx.model || 'default'}`;
    return {
      get: async (slot: DocSlot, sha: string) => ((await this.d.readings.get(key(slot, sha)))?.reading as Reading | undefined) ?? null,
      put: async (slot: DocSlot, sha: string, reading: Reading) =>
        this.d.readings.save({
          key: key(slot, sha),
          slot,
          sha256: sha,
          model: ctx.model,
          reading,
          readBy: actor ? who(actor) : null,
          readAt: this.d.clock.nowIso()
        })
    };
  }

  /** A scanned PDF read with OCR on this server (no AI). The reading is kept by content, like AI readings. */
  private async readScan(f: AnalysisFile, actor: Actor, engagementId: string, fundName: string | null): Promise<PdfContent> {
    const key = `ocr:${f.sha256}`;
    const kept = f.sha256 ? await this.d.readings.get(key) : null;
    if (kept) return kept.reading as PdfContent;
    const t0 = Date.now();
    const { pages, pageCount } = await this.d.reader.pdfPageImages(await f.bytes());
    const read = [];
    for (const p of pages) read.push(await this.d.ocr.readPage(p.png));
    const content = ocrContent(read, pages, pageCount);
    if (f.sha256)
      await this.d.readings.save({
        key,
        slot: 'ocr',
        sha256: f.sha256,
        model: 'tesseract',
        reading: content,
        readBy: who(actor),
        readAt: this.d.clock.nowIso()
      });
    await this.d.activity.record({
      actor,
      category: 'Documents',
      summary: `Read ${plural(pages.length, 'scanned page')} with OCR`,
      details: `${f.name} · ${Date.now() - t0} ms · no AI`,
      engagementId,
      fundName
    });
    return content;
  }

  /** New points are assigned to the fund's preparer, when that person is an active Preparer. */
  private async preparerOf(ctx: AnalysisContext): Promise<Person | null> {
    const id = ctx.engagement.fund?.preparerId;
    if (typeof id !== 'string' || !id) return null;
    const u = await this.d.users.findById(id);
    return u && u.active && u.role === 'Preparer' ? { id: u.id, name: u.name, role: u.role } : null;
  }
}

/** After a restart: a job that was running cannot be resumed and is marked failed; queued jobs run again. */
export class RecoverAnalysisJobs {
  constructor(
    private readonly jobs: AnalysisJobRepository,
    private readonly queue: JobQueue,
    private readonly clock: Clock
  ) {}
  /** A job running far longer than any analysis takes is given up, so the fund is not blocked until a restart. */
  async reapStale(maxMinutes = 30): Promise<number> {
    const cutoff = this.clock.now().getTime() - maxMinutes * 60_000;
    let n = 0;
    for (const job of await this.jobs.listByStatus(['running']))
      if (job.startedAt && Date.parse(job.startedAt) < cutoff) {
        await this.jobs.update({
          ...job,
          status: 'failed',
          error: 'The analysis took too long and was stopped. Run it again.',
          finishedAt: this.clock.nowIso()
        });
        n++;
      }
    return n;
  }

  async execute(): Promise<{ failed: number; requeued: number }> {
    let failed = 0,
      requeued = 0;
    for (const job of await this.jobs.listByStatus(['running', 'queued'])) {
      if (job.status === 'running') {
        await this.jobs.update({
          ...job,
          status: 'failed',
          error: 'The server restarted while this analysis was running. Run it again.',
          finishedAt: this.clock.nowIso()
        });
        failed++;
      } else {
        this.queue.enqueue(job.id);
        requeued++;
      }
    }
    return { failed, requeued };
  }
}
