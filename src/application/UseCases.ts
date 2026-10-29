// The set of use cases the HTTP layer can call. Built once by container.ts; routes receive it and
// never construct a use case or adapter themselves.
import type { ActivityRecorder } from './activity/ActivityRecorder.js';
import type { ListActivity } from './activity/ListActivity.js';
import type { GetAiSettings, GetAiStatus, SaveAiSettings, TestAiConnection } from './ai/AiSettingsUseCases.js';
import type { RunAiStep } from './ai/RunAiStep.js';
import type { GetAnalysisJob, StartAnalysis } from './analysis/AnalysisJobUseCases.js';
import type { SaveAnalysisRun, SyncAnalysisPoints } from './analysis/AnalysisUseCases.js';
import type { ApplyBillingAction, EmailInvoice, GetBilling, GetIntegrations, RefreshFxRate } from './billing/BillingUseCases.js';
import type { ConnectXero, DisconnectXero, SendInvoiceToXero } from './billing/XeroUseCases.js';
import type { GetCheckRuleConfig, SaveCheckRuleConfig } from './config/CheckRuleConfigUseCases.js';
import type { GetChecklists, SaveChecklist } from './config/ChecklistUseCases.js';
import type { CreateUser } from './identity/CreateUser.js';
import type { GetAuthStatus } from './identity/GetAuthStatus.js';
import type { ListPeople } from './identity/ListPeople.js';
import type { ListUsers } from './identity/ListUsers.js';
import type { RequestPasswordReset } from './identity/RequestPasswordReset.js';
import type { ResetPassword } from './identity/ResetPassword.js';
import type { ResolveSession } from './identity/ResolveSession.js';
import type { GetPermissions, SavePermissions } from './identity/SavePermissions.js';
import type { SetupFirstAdmin } from './identity/SetupFirstAdmin.js';
import type { SignIn } from './identity/SignIn.js';
import type { SignOut } from './identity/SignOut.js';
import type { UpdateUser } from './identity/UpdateUser.js';
import type { ReadScannedPages } from './ocr/ReadScannedPages.js';
import type { AnswerChecklistItem } from './review/ChecklistAnswerUseCases.js';
import type {
  AttachDocument,
  AttachSampleDocument,
  ConfirmDocument,
  DownloadDocument,
  RemoveDocument,
  SetDocumentReadWith,
  SetDocumentValidation
} from './review/DocumentUseCases.js';
import type { ListEngagements, SaveEngagement } from './review/EngagementUseCases.js';
import type { ListEntities, SaveEntity } from './review/EntityUseCases.js';
import type {
  ActOnPoint,
  AddEvidence,
  AssignPoint,
  CommentOnPoint,
  DownloadEvidence,
  RaisePoint,
  SetPointMeta
} from './review/PointUseCases.js';
import type { GetNotifications, GetPortfolio } from './review/PortfolioUseCases.js';
import type { GetReviewSnapshot, ListReviewSnapshots } from './review/ReviewSnapshot.js';
import type { AddReport, DownloadReport, SetSignoff } from './review/SignoffUseCases.js';
import type { SetWorkflowState } from './review/WorkflowUseCases.js';

export interface UseCases {
  listEntities: ListEntities;
  saveEntity: SaveEntity;
  listEngagements: ListEngagements;
  saveEngagement: SaveEngagement;
  getCheckRuleConfig: GetCheckRuleConfig;
  saveCheckRuleConfig: SaveCheckRuleConfig;
  getChecklists: GetChecklists;
  saveChecklist: SaveChecklist;
  getReviewSnapshot: GetReviewSnapshot;
  listReviewSnapshots: ListReviewSnapshots;
  getPortfolio: GetPortfolio;
  getNotifications: GetNotifications;
  attachDocument: AttachDocument;
  attachSampleDocument: AttachSampleDocument;
  setDocumentValidation: SetDocumentValidation;
  setDocumentReadWith: SetDocumentReadWith;
  confirmDocument: ConfirmDocument;
  removeDocument: RemoveDocument;
  downloadDocument: DownloadDocument;
  setWorkflowState: SetWorkflowState;
  saveAnalysisRun: SaveAnalysisRun;
  syncAnalysisPoints: SyncAnalysisPoints;
  startAnalysis: StartAnalysis;
  getAnalysisJob: GetAnalysisJob;
  raisePoint: RaisePoint;
  setPointMeta: SetPointMeta;
  assignPoint: AssignPoint;
  commentOnPoint: CommentOnPoint;
  actOnPoint: ActOnPoint;
  addEvidence: AddEvidence;
  downloadEvidence: DownloadEvidence;
  answerChecklistItem: AnswerChecklistItem;
  setSignoff: SetSignoff;
  addReport: AddReport;
  downloadReport: DownloadReport;
  resolveSession: ResolveSession;
  getAuthStatus: GetAuthStatus;
  setupFirstAdmin: SetupFirstAdmin;
  signIn: SignIn;
  signOut: SignOut;
  listUsers: ListUsers;
  createUser: CreateUser;
  updateUser: UpdateUser;
  listPeople: ListPeople;
  getPermissions: GetPermissions;
  savePermissions: SavePermissions;
  requestPasswordReset: RequestPasswordReset;
  resetPassword: ResetPassword;
  activity: ActivityRecorder;
  listActivity: ListActivity;
  getAiStatus: GetAiStatus;
  getAiSettings: GetAiSettings;
  saveAiSettings: SaveAiSettings;
  testAiConnection: TestAiConnection;
  runAiStep: RunAiStep;
  readScannedPages: ReadScannedPages;
  getBilling: GetBilling;
  applyBillingAction: ApplyBillingAction;
  getIntegrations: GetIntegrations;
  emailInvoice: EmailInvoice;
  refreshFxRate: RefreshFxRate;
  connectXero: ConnectXero;
  disconnectXero: DisconnectXero;
  sendInvoiceToXero: SendInvoiceToXero;
}
