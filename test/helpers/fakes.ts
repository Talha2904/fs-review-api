// In-memory implementations of every port, and a test app wired with the real use cases.
// Tests exercise the same routes and rules as production, with no database or network.
import { createHash } from 'node:crypto';

import {
  DEFAULT_MATRIX,
  EMPTY_BILLING,
  normalizeMatrix,
  type AiSettings,
  type BillingState,
  type PermissionMatrix
} from '@fs-review/shared';

import type { UseCases } from '../../src/application/UseCases.js';
import { ActivityRecorder } from '../../src/application/activity/ActivityRecorder.js';
import { ListActivity } from '../../src/application/activity/ListActivity.js';
import {
  GetAiSettings,
  GetAiStatus,
  LoadAiSettings,
  SaveAiSettings,
  TestAiConnection
} from '../../src/application/ai/AiSettingsUseCases.js';
import { RunAiStep } from '../../src/application/ai/RunAiStep.js';
import {
  AnalysisContextLoader,
  GetAnalysisJob,
  RecoverAnalysisJobs,
  RunAnalysisJob,
  StartAnalysis
} from '../../src/application/analysis/AnalysisJobUseCases.js';
import { SaveAnalysisRun, SyncAnalysisPoints } from '../../src/application/analysis/AnalysisUseCases.js';
import { BillingActions } from '../../src/application/billing/BillingActions.js';
import {
  ApplyBillingAction,
  EmailInvoice,
  GetBilling,
  GetIntegrations,
  RefreshFxRate
} from '../../src/application/billing/BillingUseCases.js';
import { ConnectXero, DisconnectXero, SendInvoiceToXero } from '../../src/application/billing/XeroUseCases.js';
import { GetCheckRuleConfig, SaveCheckRuleConfig } from '../../src/application/config/CheckRuleConfigUseCases.js';
import { GetChecklists, SaveChecklist } from '../../src/application/config/ChecklistUseCases.js';
import { CreateUser } from '../../src/application/identity/CreateUser.js';
import { GetAuthStatus } from '../../src/application/identity/GetAuthStatus.js';
import { ListPeople } from '../../src/application/identity/ListPeople.js';
import { ListUsers } from '../../src/application/identity/ListUsers.js';
import { RequestPasswordReset } from '../../src/application/identity/RequestPasswordReset.js';
import { ResetPassword } from '../../src/application/identity/ResetPassword.js';
import { ResolveSession } from '../../src/application/identity/ResolveSession.js';
import { GetPermissions, SavePermissions } from '../../src/application/identity/SavePermissions.js';
import { SetupFirstAdmin } from '../../src/application/identity/SetupFirstAdmin.js';
import { SignIn, StartSession } from '../../src/application/identity/SignIn.js';
import { SignOut } from '../../src/application/identity/SignOut.js';
import { UpdateUser } from '../../src/application/identity/UpdateUser.js';
import { ReadScannedPages } from '../../src/application/ocr/ReadScannedPages.js';
import type { ActivityLog, ActivityQuery, UsageRow } from '../../src/application/ports/ActivityLog.js';
import type { AiGateway, StructuredCall, StructuredResult } from '../../src/application/ports/AiGateway.js';
import type { AiSettingsRepository } from '../../src/application/ports/AiSettingsRepository.js';
import type { AnalysisJob, AnalysisJobRepository, AnalysisJobStatus } from '../../src/application/ports/AnalysisJobRepository.js';
import type { AnalysisRun, AnalysisRunRepository } from '../../src/application/ports/AnalysisRunRepository.js';
import type { BellReadModel } from '../../src/application/ports/BellReadModel.js';
import type { BillingRepository } from '../../src/application/ports/BillingRepository.js';
import type { CheckRuleConfig, CheckRuleConfigRepository } from '../../src/application/ports/CheckRuleConfigRepository.js';
import type { ChecklistAnswerRepository, DisclosureChecklist } from '../../src/application/ports/ChecklistAnswerRepository.js';
import type { ChecklistTemplate, ChecklistTemplateRepository } from '../../src/application/ports/ChecklistTemplateRepository.js';
import type { Clock } from '../../src/application/ports/Clock.js';
import type { DocumentChanges, DocumentRepository } from '../../src/application/ports/DocumentRepository.js';
import type { EngagementRecord, EngagementRepository } from '../../src/application/ports/EngagementRepository.js';
import type { EntityRecord, EntityRepository } from '../../src/application/ports/EntityRepository.js';
import type { FileStorage, StoredFile } from '../../src/application/ports/FileStorage.js';
import type { FxRate, FxRateSource } from '../../src/application/ports/FxRateSource.js';
import type { IdGenerator } from '../../src/application/ports/IdGenerator.js';
import type { Logger } from '../../src/application/ports/Logger.js';
import { LOGIN_WINDOW_MS, type LoginThrottle } from '../../src/application/ports/LoginThrottle.js';
import type { MailMessage, Mailer } from '../../src/application/ports/Mailer.js';
import type { OcrEngine, OcrPage } from '../../src/application/ports/OcrEngine.js';
import type { PasswordHash, PasswordHasher } from '../../src/application/ports/PasswordHasher.js';
import type { PasswordReset, PasswordResetRepository } from '../../src/application/ports/PasswordResetRepository.js';
import type { PermissionRepository } from '../../src/application/ports/PermissionRepository.js';
import type { EvidenceRepository, PointMessageRepository, PointRepository } from '../../src/application/ports/PointRepository.js';
import type { FundActivity, PortfolioReadModel } from '../../src/application/ports/PortfolioReadModel.js';
import type { DocumentReading, ReadingRepository } from '../../src/application/ports/ReadingRepository.js';
import type { ReportRepository, ReviewReport } from '../../src/application/ports/ReportRepository.js';
import type { Session, SessionRepository } from '../../src/application/ports/SessionRepository.js';
import type { Signoff, SignoffRepository } from '../../src/application/ports/SignoffRepository.js';
import type { Tokens } from '../../src/application/ports/Tokens.js';
import type { UserRepository } from '../../src/application/ports/UserRepository.js';
import type { Workflow, WorkflowRepository } from '../../src/application/ports/WorkflowRepository.js';
import type { XeroClient, XeroCreatedInvoice, XeroInvoicePayload } from '../../src/application/ports/XeroClient.js';
import type { XeroConnection, XeroConnectionRepository, XeroTokens } from '../../src/application/ports/XeroConnectionRepository.js';
import { AnswerChecklistItem } from '../../src/application/review/ChecklistAnswerUseCases.js';
import {
  AttachDocument,
  AttachSampleDocument,
  ConfirmDocument,
  DownloadDocument,
  RemoveDocument,
  SetDocumentReadWith,
  SetDocumentValidation
} from '../../src/application/review/DocumentUseCases.js';
import { ListEngagements, SaveEngagement } from '../../src/application/review/EngagementUseCases.js';
import { ListEntities, SaveEntity } from '../../src/application/review/EntityUseCases.js';
import {
  ActOnPoint,
  AddEvidence,
  AssignPoint,
  CommentOnPoint,
  DownloadEvidence,
  RaisePoint,
  SetPointMeta
} from '../../src/application/review/PointUseCases.js';
import { GetNotifications, GetPortfolio } from '../../src/application/review/PortfolioUseCases.js';
import { buildSnapshot, GetReviewSnapshot, ListReviewSnapshots } from '../../src/application/review/ReviewSnapshot.js';
import { AddReport, DownloadReport, SetSignoff } from '../../src/application/review/SignoffUseCases.js';
import { SetWorkflowState } from '../../src/application/review/WorkflowUseCases.js';
import { ReviewAccess } from '../../src/application/review/access.js';
import type { ActivityEntry } from '../../src/domain/activity/ActivityEntry.js';
import { AppError } from '../../src/domain/errors.js';
import type { User } from '../../src/domain/identity/User.js';
import { currentVersions, type DocumentVersion, type Person } from '../../src/domain/review/Document.js';
import type { PointEvidence, PointMessage, ReviewPoint } from '../../src/domain/review/Point.js';
import { PdfJsDocumentReader } from '../../src/infrastructure/documents/PdfJsDocumentReader.js';
import { InProcessEventBus } from '../../src/infrastructure/events/InProcessEventBus.js';
import { InProcessJobQueue } from '../../src/infrastructure/jobs/InProcessJobQueue.js';
import { createApp } from '../../src/interface/http/app.js';

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silentLogger };

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-28T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  nowIso(): string {
    return this.current.toISOString();
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SeqIds implements IdGenerator {
  private n = 0;
  next(): string {
    return `id-${String(++this.n).padStart(4, '0')}`;
  }
}

export class FakeTokens implements Tokens {
  private n = 0;
  secret(): string {
    return `secret-${++this.n}-${'x'.repeat(40)}`;
  }
  fingerprint(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
  fingerprintBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}

/** Fast and deterministic; not for production. */
export class PlainHasher implements PasswordHasher {
  async hash(password: string): Promise<PasswordHash> {
    return { hash: `h:${password}`, salt: 's' };
  }
  async verify(password: string, stored: PasswordHash): Promise<boolean> {
    return stored.hash === `h:${password}`;
  }
}

export class MemoryUsers implements UserRepository {
  rows = new Map<string, User>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByUsername(username: string) {
    return [...this.rows.values()].find((u) => u.username === username) ?? null;
  }
  async findByEmail(email: string) {
    return [...this.rows.values()].find((u) => u.email && u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async findByLogin(login: string) {
    return (await this.findByUsername(login)) ?? (await this.findByEmail(login));
  }
  async list() {
    return [...this.rows.values()];
  }
  async count() {
    return this.rows.size;
  }
  async create(u: User) {
    this.rows.set(u.id, { ...u });
  }
  async createFirst(u: User) {
    if (this.rows.size) return false;
    this.rows.set(u.id, { ...u });
    return true;
  }
  async update(u: User) {
    this.rows.set(u.id, { ...u });
  }
}

export class MemorySessions implements SessionRepository {
  rows = new Map<string, Session>();
  async create(s: Session) {
    this.rows.set(s.tokenHash, { ...s });
  }
  async findActive(tokenHash: string, now: string) {
    const s = this.rows.get(tokenHash);
    return s && !s.revokedAt && s.expiresAt > now ? s : null;
  }
  async revoke(tokenHash: string, at: string) {
    const s = this.rows.get(tokenHash);
    if (s) s.revokedAt = at;
  }
  async revokeAllForUser(userId: string, at: string) {
    for (const s of this.rows.values()) if (s.userId === userId && !s.revokedAt) s.revokedAt = at;
  }
  async revokeOthersForUser(userId: string, keep: string, at: string) {
    for (const s of this.rows.values()) if (s.userId === userId && !s.revokedAt && s.tokenHash !== keep) s.revokedAt = at;
  }
  async deleteExpired(before: string) {
    let n = 0;
    for (const [k, s] of this.rows) {
      if (s.expiresAt < before) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }
}

export class MemoryThrottle implements LoginThrottle {
  rows = new Map<string, { count: number; firstAt: number }>();
  async hit(key: string, now: string) {
    const t = new Date(now).getTime();
    const r = this.rows.get(key);
    if (!r || t - r.firstAt > LOGIN_WINDOW_MS) {
      this.rows.set(key, { count: 1, firstAt: t });
      return { count: 1 };
    }
    r.count++;
    return { count: r.count };
  }
  async clear(key: string) {
    this.rows.delete(key);
  }
}

export class MemoryPermissions implements PermissionRepository {
  matrix: PermissionMatrix = normalizeMatrix(DEFAULT_MATRIX);
  async get() {
    return this.matrix;
  }
  async save(m: PermissionMatrix) {
    this.matrix = normalizeMatrix(m);
  }
}

export class MemoryActivity implements ActivityLog {
  entries: ActivityEntry[] = [];
  async append(e: ActivityEntry) {
    this.entries.push(e);
  }
  async list(q: ActivityQuery) {
    return this.entries
      .filter((e) => !q.engagementId || e.engagementId === q.engagementId)
      .slice()
      .reverse()
      .slice(0, q.limit);
  }
  async usage(): Promise<UsageRow[]> {
    return this.entries
      .filter((e) => e.usage && e.engagementId)
      .map((e) => ({
        id: e.id,
        at: e.at,
        engagementId: e.engagementId as string,
        fundName: e.fundName ?? '',
        ...(e.usage as NonNullable<ActivityEntry['usage']>)
      }));
  }
}

export class MemoryAiSettings implements AiSettingsRepository {
  value: AiSettings | null = null;
  async get() {
    return this.value;
  }
  async save(s: AiSettings) {
    this.value = s;
  }
}

export class MemoryResets implements PasswordResetRepository {
  rows: PasswordReset[] = [];
  async create(r: PasswordReset) {
    this.rows = [...this.rows.filter((x) => !(x.userId === r.userId && !x.usedAt)), { ...r }];
  }
  async findByTokenHash(h: string) {
    return this.rows.find((r) => r.tokenHash === h) ?? null;
  }
  async markUsed(id: string, at: string) {
    const r = this.rows.find((x) => x.id === id && !x.usedAt);
    if (r) r.usedAt = at;
    return !!r;
  }
  async deleteUnusedForUser(userId: string) {
    this.rows = this.rows.filter((x) => !(x.userId === userId && !x.usedAt));
  }
}

export class MemoryBilling implements BillingRepository {
  state: BillingState = EMPTY_BILLING;
  async get() {
    return this.state;
  }
  async update<T>(change: (s: BillingState) => { state: BillingState; result: T }) {
    const { state, result } = change(this.state);
    this.state = JSON.parse(JSON.stringify(state));
    return result;
  }
}

export class MemoryXeroConnections implements XeroConnectionRepository {
  value: XeroConnection | null = null;
  async get() {
    return this.value;
  }
  async save(c: XeroConnection) {
    this.value = c;
  }
  async clear() {
    this.value = null;
  }
}

export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  constructor(
    public configured = true,
    public from = 'test@example.com'
  ) {}
  async send(m: MailMessage) {
    if (!this.configured) throw new Error('Email isn’t set up on the server.');
    this.sent.push(m);
  }
}

export class FakeAi implements AiGateway {
  calls: StructuredCall[] = [];
  constructor(
    public configured = true,
    public answer: unknown = { ok: true }
  ) {}
  keyStatus() {
    return { configured: this.configured, last4: this.configured ? 'k3y1' : '' };
  }
  async structured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    this.calls.push(call);
    return { output: this.answer as T, model: call.model, inputTokens: 1000, outputTokens: 100 };
  }
  async ping(model: string) {
    return { model, ms: 12 };
  }
}

export class FakeOcr implements OcrEngine {
  async readPage(): Promise<OcrPage> {
    return { lines: [{ words: [{ text: '1,234', x0: 0, x1: 10, y0: 0, y1: 10, conf: 95 }] }], confidence: 95 };
  }
}

export class FakeFx implements FxRateSource {
  constructor(public rate: FxRate = { rate: 0.8, date: '2026-10-28', source: 'test' }) {}
  async latestUsdToGbp() {
    return this.rate;
  }
}

export class FakeXero implements XeroClient {
  configured = true;
  created: XeroInvoicePayload[] = [];
  authorizeUrl(state: string) {
    return `https://xero.test/auth?state=${state}`;
  }
  async exchangeCode(): Promise<XeroTokens> {
    return { access: 'a', refresh: 'r', expiresAt: Date.now() + 1800e3 };
  }
  async refresh(): Promise<XeroTokens> {
    return { access: 'a2', refresh: 'r2', expiresAt: Date.now() + 1800e3 };
  }
  async connections() {
    return [{ tenantId: 't1', tenantName: 'Demo Company' }];
  }
  async createInvoice(_t: XeroTokens, _tenant: string, inv: XeroInvoicePayload, _key: string): Promise<XeroCreatedInvoice> {
    this.created.push(inv);
    return { invoiceId: 'xero-1', status: 'AUTHORISED', total: 1 };
  }
}

export class MemoryEntities implements EntityRepository {
  rows = new Map<string, EntityRecord>();
  async list() {
    return [...this.rows.values()].sort((a, b) => a.doc.name.localeCompare(b.doc.name));
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByNameKey(key: string) {
    return [...this.rows.values()].find((r) => r.doc.name.toLowerCase().replace(/\s+/g, '') === key) ?? null;
  }
  async create(r: EntityRecord) {
    this.rows.set(r.doc.id, r);
  }
  async update(r: EntityRecord) {
    this.rows.set(r.doc.id, r);
  }
}

export class MemoryEngagements implements EngagementRepository {
  rows = new Map<string, EngagementRecord>();
  async list() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findDuplicate(entityId: string | null, fundName: string, yearEnd: string, exceptId: string | null) {
    const key = fundName.toLowerCase().replace(/\s+/g, '');
    return (
      [...this.rows.values()].find(
        (r) =>
          r.doc.id !== exceptId &&
          (r.doc.entityId || null) === entityId &&
          r.doc.fund.yearEnd === yearEnd &&
          r.doc.fund.name.toLowerCase().replace(/\s+/g, '') === key
      ) ?? null
    );
  }
  async create(r: EngagementRecord) {
    this.rows.set(r.doc.id, r);
  }
  async update(r: EngagementRecord) {
    this.rows.set(r.doc.id, r);
  }
}

export class MemoryCheckRuleConfig implements CheckRuleConfigRepository {
  value: CheckRuleConfig | null = null;
  async get() {
    return this.value;
  }
  async save(c: CheckRuleConfig) {
    this.value = c;
  }
}

export class MemoryChecklists implements ChecklistTemplateRepository {
  current = new Map<string, ChecklistTemplate>();
  history: ChecklistTemplate[] = [];
  async list() {
    return [...this.current.values()];
  }
  async get(framework: string) {
    return this.current.get(framework) ?? null;
  }
  async save(t: ChecklistTemplate) {
    this.current.set(t.framework, t);
    this.history.push(t);
  }
}

export class MemoryStorage implements FileStorage {
  files = new Map<string, StoredFile>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.files.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

export class MemoryDocuments implements DocumentRepository {
  rows = new Map<string, DocumentVersion>();
  async listByEngagement(engagementId: string) {
    return [...this.rows.values()]
      .filter((v) => v.engagementId === engagementId)
      .sort((a, b) => a.slot.localeCompare(b.slot) || a.version - b.version);
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(v: DocumentVersion) {
    if ([...this.rows.values()].some((x) => x.engagementId === v.engagementId && x.slot === v.slot && x.version === v.version))
      throw new AppError('CONFLICT', 'Another version of this document was attached at the same moment. Try again.');
    this.rows.set(v.id, { ...v });
  }
  async patch(id: string, c: DocumentChanges) {
    const v = this.rows.get(id);
    if (!v || v.removedAt) return false;
    this.rows.set(id, { ...v, ...c });
    return true;
  }
  async markRemoved(id: string, by: Person, at: string) {
    const v = this.rows.get(id);
    if (!v || v.removedAt) return false;
    this.rows.set(id, { ...v, removedAt: at, removedBy: by });
    return true;
  }
}

export class MemoryWorkflows implements WorkflowRepository {
  rows = new Map<string, Workflow>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async save(w: Workflow) {
    this.rows.set(w.engagementId, w);
  }
}

export class MemorySignoffs implements SignoffRepository {
  rows = new Map<string, Signoff>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async save(s: Signoff) {
    this.rows.set(s.engagementId, s);
  }
}

export class MemoryRuns implements AnalysisRunRepository {
  rows: AnalysisRun[] = [];
  async latest(id: string) {
    return [...this.rows].reverse().find((r) => r.engagementId === id) ?? null;
  }
  async latestAll() {
    const out = new Map<string, AnalysisRun>();
    for (const r of this.rows) out.set(r.engagementId, r);
    return [...out.values()].map(({ result: _r, ...summary }) => summary);
  }
  async create(r: AnalysisRun) {
    this.rows.push(r);
  }
}

export class MemoryJobs implements AnalysisJobRepository {
  rows: AnalysisJob[] = [];
  async create(j: AnalysisJob) {
    this.rows.push({ ...j });
  }
  async createIfIdle(j: AnalysisJob) {
    if (this.rows.some((r) => r.engagementId === j.engagementId && (r.status === 'queued' || r.status === 'running'))) return false;
    this.rows.push({ ...j });
    return true;
  }
  async update(j: AnalysisJob) {
    this.rows = this.rows.map((r) => (r.id === j.id ? { ...j } : r));
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async latest(id: string) {
    return [...this.rows].reverse().find((r) => r.engagementId === id) ?? null;
  }
  async latestAll() {
    const out = new Map<string, AnalysisJob>();
    for (const r of this.rows) out.set(r.engagementId, r);
    return [...out.values()];
  }
  async listByStatus(statuses: AnalysisJobStatus[]) {
    return this.rows.filter((r) => statuses.includes(r.status));
  }
}

export class MemoryReadings implements ReadingRepository {
  rows = new Map<string, DocumentReading>();
  async get(key: string) {
    return this.rows.get(key) ?? null;
  }
  async findBySha256(shas: string[]) {
    return [...this.rows.values()].filter((r) => shas.includes(r.sha256));
  }
  async save(r: DocumentReading) {
    this.rows.set(r.key, r);
  }
}

export class MemoryPoints implements PointRepository {
  rows = new Map<string, ReviewPoint>();
  async listByEngagement(id: string) {
    return [...this.rows.values()].filter((p) => p.engagementId === id);
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(p: ReviewPoint) {
    if ([...this.rows.values()].some((x) => x.engagementId === p.engagementId && x.ref === p.ref))
      throw new AppError('CONFLICT', `${p.ref} was raised at the same moment.`);
    this.rows.set(p.id, { ...p });
  }
  async update(p: ReviewPoint, expectedUpdatedAt: string) {
    if (this.rows.get(p.id)?.updatedAt !== expectedUpdatedAt)
      throw new AppError('CONFLICT', `${p.ref} was changed by someone else at the same moment.`);
    this.rows.set(p.id, { ...p });
  }
  async touch(id: string, at: string) {
    const p = this.rows.get(id);
    if (p) this.rows.set(id, { ...p, updatedAt: at });
  }
}

/** The portfolio read model over the in-memory stores (the Prisma one uses aggregate queries). */
/** The bell's reads over the memory repositories, with the same filters as PrismaBellReadModel. */
export class MemoryBellReadModel implements BellReadModel {
  constructor(
    private readonly s: {
      documents: MemoryDocuments;
      workflows: MemoryWorkflows;
      signoffs: MemorySignoffs;
      points: MemoryPoints;
      runs: MemoryRuns;
      messages: MemoryMessages;
    }
  ) {}
  async reviews(userId: string, messagesSince: string) {
    const points = [...this.s.points.rows.values()];
    const theirs = new Set(points.filter((p) => p.raisedBy?.id === userId || p.assignedTo?.id === userId).map((p) => p.id));
    const ids = new Set([...this.s.documents.rows.values()].map((v) => v.engagementId));
    for (const m of [this.s.workflows.rows, this.s.signoffs.rows]) for (const k of m.keys()) ids.add(k);
    for (const p of points) ids.add(p.engagementId);
    for (const r of this.s.runs.rows) ids.add(r.engagementId);
    return Object.fromEntries(
      [...ids].map((id) => [
        id,
        buildSnapshot(
          id,
          {
            versions: [...this.s.documents.rows.values()].filter((v) => v.engagementId === id),
            workflow: this.s.workflows.rows.get(id) ?? null,
            signoff: this.s.signoffs.rows.get(id) ?? null,
            points: points.filter((p) => p.engagementId === id),
            messages: this.s.messages.rows.filter((m) => m.engagementId === id && theirs.has(m.pointId) && m.at >= messagesSince),
            checklist: null,
            reports: [],
            latestRun: [...this.s.runs.rows].reverse().find((r) => r.engagementId === id) ?? null,
            latestJob: null
          },
          true
        )
      ])
    );
  }
}

export class MemoryPortfolioReadModel implements PortfolioReadModel {
  constructor(
    private readonly s: {
      documents: MemoryDocuments;
      workflows: MemoryWorkflows;
      signoffs: MemorySignoffs;
      points: MemoryPoints;
      runs: MemoryRuns;
      messages: MemoryMessages;
    }
  ) {}
  async activity(today: string): Promise<FundActivity[]> {
    const ids = new Set([...this.s.documents.rows.values()].map((v) => v.engagementId));
    for (const m of [this.s.workflows.rows, this.s.signoffs.rows]) for (const k of m.keys()) ids.add(k);
    for (const p of this.s.points.rows.values()) ids.add(p.engagementId);
    for (const r of this.s.runs.rows) ids.add(r.engagementId);
    return [...ids].map((id) => {
      const versions = [...this.s.documents.rows.values()].filter((v) => v.engagementId === id);
      const points = [...this.s.points.rows.values()].filter((p) => p.engagementId === id);
      const open = points.filter((p) => p.status !== 'cleared');
      const times = [
        ...versions.map((v) => v.uploadedAt),
        this.s.workflows.rows.get(id)?.at,
        this.s.signoffs.rows.get(id)?.at,
        ...this.s.runs.rows.filter((r) => r.engagementId === id).map((r) => r.at),
        ...this.s.messages.rows.filter((m) => m.engagementId === id).map((m) => m.at)
      ].filter((t): t is string => !!t);
      return {
        engagementId: id,
        hasDocuments: Object.keys(currentVersions(versions)).length > 0,
        workflowState: this.s.workflows.rows.get(id)?.state ?? 'preparing',
        signoffState: this.s.signoffs.rows.get(id)?.state ?? 'none',
        analysed: this.s.runs.rows.some((r) => r.engagementId === id),
        openPoints: open.length,
        respondedPoints: open.filter((p) => p.status === 'responded').length,
        overduePoints: open.filter((p) => p.dueDate && p.dueDate < today).length,
        lastActivityAt: times.sort().at(-1) ?? null
      };
    });
  }
}

export class MemoryMessages implements PointMessageRepository {
  rows: PointMessage[] = [];
  async listByEngagement(id: string) {
    return this.rows.filter((m) => m.engagementId === id);
  }
  async listAll() {
    return [...this.rows];
  }
  async create(m: PointMessage) {
    this.rows.push(m);
  }
}

export class MemoryEvidence implements EvidenceRepository {
  rows = new Map<string, PointEvidence>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByEngagement(id: string) {
    return [...this.rows.values()].filter((e) => e.engagementId === id);
  }
  async create(e: PointEvidence) {
    this.rows.set(e.id, e);
  }
}

export class MemoryAnswers implements ChecklistAnswerRepository {
  rows = new Map<string, DisclosureChecklist>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async update(id: string, change: (c: DisclosureChecklist | null) => DisclosureChecklist) {
    const c = change(this.rows.get(id) ?? null);
    this.rows.set(id, c);
    return c;
  }
}

export class MemoryReports implements ReportRepository {
  rows = new Map<string, ReviewReport>();
  async listByEngagement(id: string) {
    return [...this.rows.values()].filter((r) => r.engagementId === id);
  }
  async listAll() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(r: ReviewReport) {
    this.rows.set(r.id, r);
  }
}

export interface TestWorld {
  app: ReturnType<typeof createApp>;
  uc: UseCases;
  clock: FakeClock;
  users: MemoryUsers;
  sessions: MemorySessions;
  permissions: MemoryPermissions;
  log: MemoryActivity;
  mailer: FakeMailer;
  ai: FakeAi;
  billing: MemoryBilling;
  xero: FakeXero;
  xeroConnections: MemoryXeroConnections;
  entities: MemoryEntities;
  engagements: MemoryEngagements;
  checklists: MemoryChecklists;
  documents: MemoryDocuments;
  workflows: MemoryWorkflows;
  signoffs: MemorySignoffs;
  storage: MemoryStorage;
  events: InProcessEventBus;
  billingActions: BillingActions;
  runs: MemoryRuns;
  jobs: MemoryJobs;
  queue: InProcessJobQueue;
  readings: MemoryReadings;
  recoverJobs: RecoverAnalysisJobs;
  points: MemoryPoints;
  messages: MemoryMessages;
  answers: MemoryAnswers;
  reports: MemoryReports;
}

export function buildTestWorld(opts: { mailConfigured?: boolean; aiConfigured?: boolean } = {}): TestWorld {
  const clock = new FakeClock();
  const ids = new SeqIds();
  const tokens = new FakeTokens();
  const hasher = new PlainHasher();
  const users = new MemoryUsers();
  const sessions = new MemorySessions();
  const throttle = new MemoryThrottle();
  const permissions = new MemoryPermissions();
  const log = new MemoryActivity();
  const aiSettings = new MemoryAiSettings();
  const resets = new MemoryResets();
  const billing = new MemoryBilling();
  const xeroConnections = new MemoryXeroConnections();
  const mailer = new FakeMailer(opts.mailConfigured ?? true);
  const ai = new FakeAi(opts.aiConfigured ?? true);
  const xero = new FakeXero();
  const entities = new MemoryEntities();
  const engagements = new MemoryEngagements();
  const checkRuleConfig = new MemoryCheckRuleConfig();
  const checklists = new MemoryChecklists();
  const documents = new MemoryDocuments();
  const workflows = new MemoryWorkflows();
  const signoffs = new MemorySignoffs();
  const storage = new MemoryStorage();
  const events = new InProcessEventBus();
  const access = new ReviewAccess(engagements, signoffs, workflows);
  const runs = new MemoryRuns();
  const readings = new MemoryReadings();
  const points = new MemoryPoints();
  const messages = new MemoryMessages();
  const evidence = new MemoryEvidence();
  const answers = new MemoryAnswers();
  const reports = new MemoryReports();
  const jobs = new MemoryJobs();
  const snapshotSources = { documents, workflows, signoffs, points, messages, checklists: answers, reports, runs, jobs };
  const reader = new PdfJsDocumentReader();
  const queue = new InProcessJobQueue(1, silentLogger);
  const ocr = new FakeOcr();
  const listSnapshots = new ListReviewSnapshots(snapshotSources);
  const appUrl = 'http://localhost:5173';

  const activity = new ActivityRecorder(log, clock, ids);
  const startSession = new StartSession(sessions, tokens, ids, clock);
  const loadAi = new LoadAiSettings(aiSettings, 'claude-sonnet-5-5');
  const billingActions = new BillingActions(billing, log, clock, ids, activity);
  const runAiStep = new RunAiStep(loadAi, ai, activity);
  const saveAnalysisRun = new SaveAnalysisRun(access, runs, documents, workflows, ids, clock, events);
  const syncAnalysisPoints = new SyncAnalysisPoints(access, points, messages, ids, clock, events);
  const contexts = new AnalysisContextLoader(engagements, entities, checkRuleConfig, documents, workflows, runs, loadAi, ai, points);
  const runJob = new RunAnalysisJob({
    jobs,
    contexts,
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
    logger: silentLogger
  });
  queue.handle((id) => runJob.execute(id));

  const uc: UseCases = {
    resolveSession: new ResolveSession(sessions, users, tokens, clock),
    getAuthStatus: new GetAuthStatus(users, mailer, appUrl),
    setupFirstAdmin: new SetupFirstAdmin(users, hasher, ids, clock, activity, startSession),
    signIn: new SignIn(users, hasher, throttle, startSession, activity, clock),
    signOut: new SignOut(sessions, tokens, clock, activity),
    listUsers: new ListUsers(users),
    createUser: new CreateUser(users, hasher, ids, clock, activity),
    updateUser: new UpdateUser(users, sessions, hasher, clock, activity, resets, tokens),
    listPeople: new ListPeople(users),
    getPermissions: new GetPermissions(permissions),
    savePermissions: new SavePermissions(permissions, clock, activity),
    requestPasswordReset: new RequestPasswordReset(users, resets, mailer, tokens, ids, clock, activity, silentLogger, appUrl),
    resetPassword: new ResetPassword(users, resets, sessions, hasher, tokens, clock, activity),
    activity,
    listActivity: new ListActivity(log),
    getAiStatus: new GetAiStatus(loadAi, ai),
    getAiSettings: new GetAiSettings(loadAi, ai),
    saveAiSettings: new SaveAiSettings(aiSettings, loadAi, ai, clock, activity),
    testAiConnection: new TestAiConnection(loadAi, ai, activity),
    runAiStep,
    readScannedPages: new ReadScannedPages(ocr, activity),
    getBilling: new GetBilling(billingActions),
    applyBillingAction: new ApplyBillingAction(billingActions),
    getIntegrations: new GetIntegrations(mailer, xero, xeroConnections, false),
    emailInvoice: new EmailInvoice(billingActions, billing, mailer),
    refreshFxRate: new RefreshFxRate(billingActions, new FakeFx()),
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
    listReviewSnapshots: listSnapshots,
    getPortfolio: new GetPortfolio(
      engagements,
      entities,
      users,
      new MemoryPortfolioReadModel({ documents, workflows, signoffs, points, runs, messages }),
      clock
    ),
    getNotifications: new GetNotifications(
      engagements,
      entities,
      new MemoryBellReadModel({ documents, workflows, signoffs, points, runs, messages }),
      clock
    ),
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
    startAnalysis: new StartAnalysis(access, contexts, jobs, queue, ids, clock, events),
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

  const app = createApp({
    logger: silentLogger,
    httpLogger: ((_req: unknown, _res: unknown, next: () => void) => next()) as never,
    corsOrigins: [appUrl],
    version: '0.1.0-test',
    secureCookies: false,
    docsPublic: true,
    health: { startedAt: Date.now(), pingDatabase: async () => null },
    uc,
    permissions,
    events
  });

  return {
    app,
    uc,
    clock,
    users,
    sessions,
    permissions,
    log,
    mailer,
    ai,
    billing,
    xero,
    xeroConnections,
    entities,
    engagements,
    checklists,
    documents,
    workflows,
    signoffs,
    storage,
    events,
    billingActions,
    runs,
    jobs,
    queue,
    readings,
    recoverJobs: new RecoverAnalysisJobs(jobs, queue, clock),
    points,
    messages,
    answers,
    reports
  };
}

/** Reads the session cookie a response set, for the next request. */
export const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }): string => {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first ?? '').split(';')[0] ?? '';
};
