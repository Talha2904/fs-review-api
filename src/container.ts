// Composition root. The one place that knows which adapter implements which port.
// Use cases and routes receive their dependencies from here and never construct adapters themselves.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UseCases } from './application/UseCases.js';
import { ActivityRecorder } from './application/activity/ActivityRecorder.js';
import { ListActivity } from './application/activity/ListActivity.js';
import { GetAiSettings, GetAiStatus, LoadAiSettings, SaveAiSettings, TestAiConnection } from './application/ai/AiSettingsUseCases.js';
import { RunAiStep } from './application/ai/RunAiStep.js';
import {
  AnalysisContextLoader,
  GetAnalysisJob,
  RecoverAnalysisJobs,
  RunAnalysisJob,
  StartAnalysis
} from './application/analysis/AnalysisJobUseCases.js';
import { SaveAnalysisRun, SyncAnalysisPoints } from './application/analysis/AnalysisUseCases.js';
import { BillingActions } from './application/billing/BillingActions.js';
import { ApplyBillingAction, EmailInvoice, GetBilling, GetIntegrations, RefreshFxRate } from './application/billing/BillingUseCases.js';
import { ConnectXero, DisconnectXero, SendInvoiceToXero } from './application/billing/XeroUseCases.js';
import { GetCheckRuleConfig, SaveCheckRuleConfig } from './application/config/CheckRuleConfigUseCases.js';
import { GetChecklists, SaveChecklist } from './application/config/ChecklistUseCases.js';
import { CreateUser } from './application/identity/CreateUser.js';
import { GetAuthStatus } from './application/identity/GetAuthStatus.js';
import { ListPeople } from './application/identity/ListPeople.js';
import { ListUsers } from './application/identity/ListUsers.js';
import { RequestPasswordReset } from './application/identity/RequestPasswordReset.js';
import { ResetPassword } from './application/identity/ResetPassword.js';
import { ResolveSession } from './application/identity/ResolveSession.js';
import { GetPermissions, SavePermissions } from './application/identity/SavePermissions.js';
import { SetupFirstAdmin } from './application/identity/SetupFirstAdmin.js';
import { SignIn, StartSession } from './application/identity/SignIn.js';
import { SignOut } from './application/identity/SignOut.js';
import { UpdateUser } from './application/identity/UpdateUser.js';
import { ReadScannedPages } from './application/ocr/ReadScannedPages.js';
import type { Clock } from './application/ports/Clock.js';
import type { EventBus } from './application/ports/EventBus.js';
import type { IdGenerator } from './application/ports/IdGenerator.js';
import type { Logger } from './application/ports/Logger.js';
import type { PermissionRepository } from './application/ports/PermissionRepository.js';
import { AnswerChecklistItem } from './application/review/ChecklistAnswerUseCases.js';
import {
  AttachDocument,
  AttachSampleDocument,
  ConfirmDocument,
  DownloadDocument,
  RemoveDocument,
  SetDocumentReadWith,
  SetDocumentValidation
} from './application/review/DocumentUseCases.js';
import { ListEngagements, SaveEngagement } from './application/review/EngagementUseCases.js';
import { ListEntities, SaveEntity } from './application/review/EntityUseCases.js';
import {
  ActOnPoint,
  AddEvidence,
  AssignPoint,
  CommentOnPoint,
  DownloadEvidence,
  RaisePoint,
  SetPointMeta
} from './application/review/PointUseCases.js';
import { GetNotifications, GetPortfolio } from './application/review/PortfolioUseCases.js';
import { GetReviewSnapshot, ListReviewSnapshots } from './application/review/ReviewSnapshot.js';
import { AddReport, DownloadReport, SetSignoff } from './application/review/SignoffUseCases.js';
import { SetWorkflowState } from './application/review/WorkflowUseCases.js';
import { ReviewAccess } from './application/review/access.js';
import type { Env } from './config/env.js';
import { SYSTEM_ACTOR } from './domain/identity/User.js';
import { AnthropicGateway } from './infrastructure/ai/AnthropicGateway.js';
import { SystemClock } from './infrastructure/clock/SystemClock.js';
import { CryptoTokens } from './infrastructure/crypto/CryptoTokens.js';
import { ScryptPasswordHasher } from './infrastructure/crypto/ScryptPasswordHasher.js';
import { createDb, pingDb, type Db } from './infrastructure/db/prisma.js';
import { PrismaActivityLog } from './infrastructure/db/repositories/PrismaActivityLog.js';
import { PrismaAiSettingsRepository } from './infrastructure/db/repositories/PrismaAiSettingsRepository.js';
import { PrismaAnalysisJobRepository } from './infrastructure/db/repositories/PrismaAnalysisJobRepository.js';
import { PrismaAnalysisRunRepository } from './infrastructure/db/repositories/PrismaAnalysisRunRepository.js';
import { PrismaBellReadModel } from './infrastructure/db/repositories/PrismaBellReadModel.js';
import { PrismaBillingRepository } from './infrastructure/db/repositories/PrismaBillingRepository.js';
import { PrismaCheckRuleConfigRepository } from './infrastructure/db/repositories/PrismaCheckRuleConfigRepository.js';
import { PrismaChecklistAnswerRepository } from './infrastructure/db/repositories/PrismaChecklistAnswerRepository.js';
import { PrismaChecklistTemplateRepository } from './infrastructure/db/repositories/PrismaChecklistTemplateRepository.js';
import { PrismaDocumentRepository } from './infrastructure/db/repositories/PrismaDocumentRepository.js';
import { PrismaEngagementRepository } from './infrastructure/db/repositories/PrismaEngagementRepository.js';
import { PrismaEntityRepository } from './infrastructure/db/repositories/PrismaEntityRepository.js';
import { PrismaLoginThrottle } from './infrastructure/db/repositories/PrismaLoginThrottle.js';
import { PrismaPasswordResetRepository } from './infrastructure/db/repositories/PrismaPasswordResetRepository.js';
import { PrismaPermissionRepository } from './infrastructure/db/repositories/PrismaPermissionRepository.js';
import {
  PrismaEvidenceRepository,
  PrismaPointMessageRepository,
  PrismaPointRepository
} from './infrastructure/db/repositories/PrismaPointRepositories.js';
import { PrismaPortfolioReadModel } from './infrastructure/db/repositories/PrismaPortfolioReadModel.js';
import { PrismaReadingRepository } from './infrastructure/db/repositories/PrismaReadingRepository.js';
import { PrismaReportRepository } from './infrastructure/db/repositories/PrismaReportRepository.js';
import { PrismaSessionRepository } from './infrastructure/db/repositories/PrismaSessionRepository.js';
import { PrismaSignoffRepository } from './infrastructure/db/repositories/PrismaSignoffRepository.js';
import { PrismaUserRepository } from './infrastructure/db/repositories/PrismaUserRepository.js';
import { PrismaWorkflowRepository } from './infrastructure/db/repositories/PrismaWorkflowRepository.js';
import { PrismaXeroConnectionRepository } from './infrastructure/db/repositories/PrismaXeroConnectionRepository.js';
import { IsolatedDocumentReader } from './infrastructure/documents/IsolatedDocumentReader.js';
import { InProcessEventBus } from './infrastructure/events/InProcessEventBus.js';
import { FrankfurterRates } from './infrastructure/fx/FrankfurterRates.js';
import { UuidGenerator } from './infrastructure/ids/UuidGenerator.js';
import { InProcessJobQueue } from './infrastructure/jobs/InProcessJobQueue.js';
import { createHttpLogger, createLogger } from './infrastructure/logging/logger.js';
import { NodemailerMailer } from './infrastructure/mail/NodemailerMailer.js';
import { TesseractEngine } from './infrastructure/ocr/TesseractEngine.js';
import { LocalDiskStorage } from './infrastructure/storage/LocalDiskStorage.js';
import { S3Storage } from './infrastructure/storage/S3Storage.js';
import { XeroHttpClient } from './infrastructure/xero/XeroHttpClient.js';

export interface Container {
  env: Env;
  version: string;
  logger: Logger;
  httpLogger: ReturnType<typeof createHttpLogger>;
  clock: Clock;
  ids: IdGenerator;
  events: EventBus;
  db: Db;
  permissions: PermissionRepository;
  uc: UseCases;
  mailer: NodemailerMailer;
  pingDatabase: () => Promise<boolean | null>;
  /** Background work the server starts after listen(): returns a stop function. */
  startSchedulers: () => () => void;
  shutdown: () => Promise<void>;
}

/** The api folder, so data directories are found no matter where the process was started from. */
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageVersion = (): string => {
  try {
    const require = createRequire(import.meta.url);
    return (JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
};

export function buildContainer(env: Env): Container {
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  if (env.EVENT_BUS === 'redis') throw new Error('EVENT_BUS=redis is planned for Phase 5; use memory for now.');

  // ---- adapters ----
  const db = createDb(env.DATABASE_URL);
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const tokens = new CryptoTokens();
  const hasher = new ScryptPasswordHasher();
  const events = new InProcessEventBus();
  const users = new PrismaUserRepository(db);
  const sessions = new PrismaSessionRepository(db);
  const throttle = new PrismaLoginThrottle(db);
  const permissions = new PrismaPermissionRepository(db);
  const log = new PrismaActivityLog(db);
  const aiSettings = new PrismaAiSettingsRepository(db);
  const resets = new PrismaPasswordResetRepository(db);
  const billing = new PrismaBillingRepository(db);
  const xeroConnections = new PrismaXeroConnectionRepository(db);
  const entities = new PrismaEntityRepository(db);
  const engagements = new PrismaEngagementRepository(db);
  const checkRuleConfig = new PrismaCheckRuleConfigRepository(db);
  const checklists = new PrismaChecklistTemplateRepository(db);
  const documents = new PrismaDocumentRepository(db);
  const workflows = new PrismaWorkflowRepository(db);
  const signoffs = new PrismaSignoffRepository(db);
  // S3 when configured (MinIO locally, Supabase Storage or S3 in production); the api's disk otherwise.
  const storage =
    env.S3_ENDPOINT || env.S3_ACCESS_KEY
      ? new S3Storage({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE
        })
      : new LocalDiskStorage(path.resolve(apiRoot, env.FILES_DIR));
  const access = new ReviewAccess(engagements, signoffs, workflows);
  const runs = new PrismaAnalysisRunRepository(db);
  const readings = new PrismaReadingRepository(db);
  const points = new PrismaPointRepository(db);
  const messages = new PrismaPointMessageRepository(db);
  const evidence = new PrismaEvidenceRepository(db);
  const answers = new PrismaChecklistAnswerRepository(db);
  const reports = new PrismaReportRepository(db);
  const jobs = new PrismaAnalysisJobRepository(db);
  const snapshotSources = { documents, workflows, signoffs, points, messages, checklists: answers, reports, runs, jobs };
  const reader = new IsolatedDocumentReader();
  const listReviewSnapshots = new ListReviewSnapshots(snapshotSources); // untrusted documents are parsed in worker threads
  const queue = new InProcessJobQueue(env.ANALYSIS_WORKERS, logger);
  const gateway = new AnthropicGateway(env.ANTHROPIC_API_KEY);
  const ocr = new TesseractEngine(path.resolve(apiRoot, env.OCR_CACHE_DIR));
  const mailer = new NodemailerMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    secure: env.SMTP_SECURE,
    from: env.MAIL_FROM
  });
  const rates = new FrankfurterRates(env.FX_URL);
  const xero = new XeroHttpClient({
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUri: env.XERO_REDIRECT_URI,
    authUrl: env.XERO_AUTH_URL,
    tokenUrl: env.XERO_TOKEN_URL,
    apiBase: env.XERO_API_BASE
  });

  // ---- use cases ----
  const activity = new ActivityRecorder(log, clock, ids);
  const startSession = new StartSession(sessions, tokens, ids, clock);
  const loadAi = new LoadAiSettings(aiSettings, env.CLAUDE_MODEL);
  const billingActions = new BillingActions(billing, log, clock, ids, activity);
  const refreshFxRate = new RefreshFxRate(billingActions, rates);
  const runAiStep = new RunAiStep(loadAi, gateway, activity);
  const saveAnalysisRun = new SaveAnalysisRun(access, runs, documents, workflows, ids, clock, events);
  const syncAnalysisPoints = new SyncAnalysisPoints(access, points, messages, ids, clock, events);
  const analysisContexts = new AnalysisContextLoader(
    engagements,
    entities,
    checkRuleConfig,
    documents,
    workflows,
    runs,
    loadAi,
    gateway,
    points
  );
  const runAnalysisJob = new RunAnalysisJob({
    jobs,
    contexts: analysisContexts,
    users,
    permissions,
    storage,
    readings,
    reader,
    ocr,
    runAiStep,
    syncPoints: syncAnalysisPoints,
    saveRun: saveAnalysisRun,
    activity,
    clock,
    events,
    logger
  });
  queue.handle((jobId) => runAnalysisJob.execute(jobId));
  const recoverJobs = new RecoverAnalysisJobs(jobs, queue, clock);

  const uc: UseCases = {
    resolveSession: new ResolveSession(sessions, users, tokens, clock),
    getAuthStatus: new GetAuthStatus(users, mailer, env.APP_URL),
    setupFirstAdmin: new SetupFirstAdmin(users, hasher, ids, clock, activity, startSession),
    signIn: new SignIn(users, hasher, throttle, startSession, activity, clock),
    signOut: new SignOut(sessions, tokens, clock, activity),
    listUsers: new ListUsers(users),
    createUser: new CreateUser(users, hasher, ids, clock, activity),
    updateUser: new UpdateUser(users, sessions, hasher, clock, activity, resets, tokens),
    listPeople: new ListPeople(users),
    getPermissions: new GetPermissions(permissions),
    savePermissions: new SavePermissions(permissions, clock, activity),
    requestPasswordReset: new RequestPasswordReset(users, resets, mailer, tokens, ids, clock, activity, logger, env.APP_URL),
    resetPassword: new ResetPassword(users, resets, sessions, hasher, tokens, clock, activity),
    activity,
    listActivity: new ListActivity(log),
    getAiStatus: new GetAiStatus(loadAi, gateway),
    getAiSettings: new GetAiSettings(loadAi, gateway),
    saveAiSettings: new SaveAiSettings(aiSettings, loadAi, gateway, clock, activity),
    testAiConnection: new TestAiConnection(loadAi, gateway, activity),
    runAiStep,
    readScannedPages: new ReadScannedPages(ocr, activity),
    getBilling: new GetBilling(billingActions),
    applyBillingAction: new ApplyBillingAction(billingActions),
    getIntegrations: new GetIntegrations(mailer, xero, xeroConnections, env.BILLING_FX_AUTO),
    emailInvoice: new EmailInvoice(billingActions, billing, mailer),
    refreshFxRate,
    connectXero: new ConnectXero(xero, xeroConnections, tokens, clock),
    disconnectXero: new DisconnectXero(xeroConnections),
    sendInvoiceToXero: new SendInvoiceToXero(billingActions, billing, xero, xeroConnections, clock),
    listEntities: new ListEntities(entities),
    saveEntity: new SaveEntity(entities, ids, clock),
    listEngagements: new ListEngagements(engagements),
    saveEngagement: new SaveEngagement(engagements, entities, ids, clock, signoffs),
    getCheckRuleConfig: new GetCheckRuleConfig(checkRuleConfig),
    saveCheckRuleConfig: new SaveCheckRuleConfig(checkRuleConfig, clock),
    getChecklists: new GetChecklists(checklists),
    saveChecklist: new SaveChecklist(checklists, ids, clock),
    getReviewSnapshot: new GetReviewSnapshot(access, snapshotSources),
    listReviewSnapshots,
    getPortfolio: new GetPortfolio(engagements, entities, users, new PrismaPortfolioReadModel(db), clock),
    getNotifications: new GetNotifications(engagements, entities, new PrismaBellReadModel(db, { workflows, signoffs, runs }), clock),
    attachDocument: new AttachDocument(access, documents, points, storage, tokens, ids, clock, events),
    attachSampleDocument: new AttachSampleDocument(access, documents, ids, clock, events),
    setDocumentValidation: new SetDocumentValidation(access, documents, clock, events),
    setDocumentReadWith: new SetDocumentReadWith(access, documents, clock, events),
    confirmDocument: new ConfirmDocument(access, documents, clock, events),
    removeDocument: new RemoveDocument(access, documents, clock, events),
    downloadDocument: new DownloadDocument(access, documents, storage),
    setWorkflowState: new SetWorkflowState(access, workflows, documents, clock, events, jobs),
    saveAnalysisRun,
    syncAnalysisPoints,
    startAnalysis: new StartAnalysis(access, analysisContexts, jobs, queue, ids, clock, events),
    getAnalysisJob: new GetAnalysisJob(access, jobs),
    raisePoint: new RaisePoint(access, points, messages, ids, clock, events, users),
    setPointMeta: new SetPointMeta(access, points, messages, ids, clock, events),
    assignPoint: new AssignPoint(access, points, messages, ids, clock, events, users),
    commentOnPoint: new CommentOnPoint(access, points, messages, ids, clock, events),
    actOnPoint: new ActOnPoint(access, points, messages, ids, clock, events, documents, evidence),
    addEvidence: new AddEvidence(access, points, evidence, storage, tokens, ids, clock),
    downloadEvidence: new DownloadEvidence(access, evidence, storage),
    answerChecklistItem: new AnswerChecklistItem(access, answers, clock, events),
    setSignoff: new SetSignoff({
      access,
      signoffs,
      engagements,
      entities,
      workflows,
      runs,
      jobs,
      documents,
      points,
      checklists: answers,
      checkRules: checkRuleConfig,
      billing: billingActions,
      clock,
      events
    }),
    addReport: new AddReport(access, reports, signoffs, storage, tokens, ids, clock, events),
    downloadReport: new DownloadReport(access, reports, storage)
  };

  return {
    env,
    version: packageVersion(),
    logger,
    httpLogger: createHttpLogger(logger),
    clock,
    ids,
    events,
    db,
    permissions,
    uc,
    mailer,
    pingDatabase: () => pingDb(db),
    startSchedulers: () => {
      const timers: NodeJS.Timeout[] = [];
      // analyses interrupted by a restart are marked failed; queued ones run again
      recoverJobs
        .execute()
        .then((r) => (r.failed || r.requeued ? logger.info(r, 'Recovered analysis jobs after a restart') : undefined))
        .catch((e) => logger.warn({ err: e }, 'Could not recover analysis jobs'));
      if (env.BILLING_FX_AUTO) {
        // twice a day, like the old server; failures are logged and retried next time
        timers.push(
          setInterval(
            () => refreshFxRate.run(SYSTEM_ACTOR).catch((e) => logger.warn({ err: e }, 'Automatic exchange rate update failed')),
            12 * 3600 * 1000
          ).unref()
        );
      }
      // an analysis stuck for over 30 minutes is given up, so the fund can be analysed again
      timers.push(
        setInterval(
          () => recoverJobs.reapStale(30).catch((e) => logger.warn({ err: e }, 'Could not check for stuck analysis jobs')),
          5 * 60_000
        ).unref()
      );
      // expired sessions are swept hourly so the table stays small
      timers.push(
        setInterval(() => sessions.deleteExpired(new Date(Date.now() - 24 * 3600e3).toISOString()).catch(() => undefined), 3600e3).unref()
      );
      return () => timers.forEach((t) => clearInterval(t));
    },
    shutdown: async () => {
      // let running analyses finish for up to 20 seconds
      await Promise.race([queue.idle(), new Promise((r) => setTimeout(r, 20_000).unref())]);
      await ocr.close().catch(() => undefined);
      await db.$disconnect();
    }
  };
}
