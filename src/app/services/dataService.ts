/**
 * DATA SERVICE — Single source of truth for ALL data access
 *
 * EVERY component imports from here instead of directly from api.ts or demoData.ts.
 * The FEATURES.BACKEND_INTEGRATION check lives HERE — nowhere else.
 *
 * ============================================================================
 * 80/20 MIGRATION CHECKLIST  (handoff-ready — all code tasks complete)
 * ============================================================================
 *
 * THE 20% THAT CHANGES (backend swap — OPS ONLY, no code changes):
 *   [ ] 1. Deploy Supabase Edge Function:
 *          supabase functions deploy make-server-324f4fbe
 *   [ ] 2. Set FEATURES.BACKEND_INTEGRATION = true in /src/config/features.ts
 *   [ ] 3. Verify all 68 server routes return correct shapes (see /API_SPECIFICATIONS.md)
 *   [ ] 4. Set secrets in Supabase Edge Function dashboard:
 *          - RESEND_API_KEY (email delivery)
 *          - OPENAI_API_KEY (AI chat, narrative, block assist, copilot)
 *   [ ] 5. Done. Zero component changes needed.
 *
 * THE 80% THAT STAYS UNTOUCHED:
 *   ✓ All UI components (no @/app/lib/api imports remaining)
 *   ✓ All business logic (scoring, ROI, CORTEX engine)
 *   ✓ All state management (DashboardContext, GlobalAIChatContext)
 *   ✓ All routing (createHashRouter, all routes)
 *   ✓ All service function signatures (callers see identical interfaces)
 *   ✓ All type definitions (re-exported from api.ts through this file)
 *
 * IMPORT HYGIENE RULES (enforced):
 *   ✓ All 11 components that had direct @/app/lib/api imports are fixed
 *   ✓ clientReportGenerator.ts imports Submission from dataService
 *   ✓ ClientSolutionView generates solutions dynamically from Submission data
 *   ✓ ClientPortal passes generated solutions to ClientSolutionView
 *   ✓ generateClientReport + ClientReportData re-exported here; ClientPortal
 *       no longer imports clientReportGenerator directly (leak closed)
 */

import { FEATURES } from '@/config/features';

// ── Re-export ALL types so components only import from here ─────────────────
export type {
  Submission,
  SubmissionPayload,
  Message,
  EngagementEvent,
  EngagementEventType,
  EngagementAnalytics,
  AppNotification,
  Note,
  ProposalAnnotation,
  TeamMemberRecord,
  PlatformSettings,
  SettingsResponse,
  CortexAnalysisResult,
  CortexStatusEntry,
  BatchAnalyzeResult,
  ClientReportPayload,
  OutcomePayload,
  OutcomeRecord,
  ScoreBand,
  LearningLoopData,
  NarrativeContext,
  NarrativeResponse,
  AIChatMessage,
  AIChatLeadContext,
  AIChatRequest,
  AIChatResponse,
  BlockAIAssistRequest,
  BlockAIAssistResponse,
  ProposalSectionCopilotRequest,
  ProposalSectionCopilotResponse,
  ProposalCopilotSection,
  ProposalCopilotAction,
  CopilotInterpretRequest,
  CopilotInterpretResponse,
  QueuedEmailPayload,
  LeadCapturePayload,
  ReviewType,
  StoredReview,
  ObjectionTypeName,
  EscalationRecord,
  CreateEscalationPayload,
  Booking,
  CreateBookingPayload,
  BlockRegistrySnapshot,
  SaveBlockRegistryPayload,
} from '@/app/lib/api';

// Re-export the reviewer checklist type so components import it from dataService
export type { ReviewerChecklist } from '@/app/types/reviewer-checklist';

// Re-export the canonical client auth contract. Four portal components already
// import ClientAuthContext from this module; this is the export they resolve to.
export type { ClientAuthContext } from '@/app/lib/session';

// Re-export the demo fixture TYPES. A type is erased at build time, so this
// carries no fixture data into the authenticated bundle — it only lets a
// designated demo surface name the shape it is rendering.
export type { DemoClient, DemoNurtureLead } from '@/app/demo/fixtures/demoData';

// Re-export clientReportGenerator type so components only need dataService
export type { ClientReportData } from '@/app/utils/clientReportGenerator';

// ── Internal imports (not re-exported) ──────────────────────────────────────
import { normalizeTeamRole } from '@/app/lib/teamRole';
import * as api from '@/app/lib/api';
import type { ClientAuthContext } from '@/app/lib/session';
import type { ReviewerChecklist } from '@/app/types/reviewer-checklist';
import { generateClientReport as _generateClientReport } from '@/app/utils/clientReportGenerator';
import { requireProductBackend } from '@/app/services/productData';

// Re-export the product-data contract so a surface needs one import to both
// fetch and render honestly.
export {
  ProductDataUnavailableError,
  classifyProductDataError,
  requireProductBackend,
  hasProductBackend,
  isEmptyAnswer,
  REASON_HEADLINE,
  REASON_DETAIL,
} from '@/app/services/productData';
export type { ProductDataReason } from '@/app/services/productData';

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(...args: any[]) {
  if (FEATURES.VERBOSE_LOGGING) console.log('📦 [dataService]', ...args);
}

/**
 * Is this an explicitly designated demo experience?
 *
 * Note the second half. Before CP-1 the question was `!BACKEND_INTEGRATION` —
 * "is the backend off?" — which meant the ANSWER TO A FAILURE was a fixture.
 * Requiring `BACKEND_INTEGRATION` to be off as well as `DEMO_EXPERIENCE` to be
 * on makes the two mutually exclusive by construction: once a real backend is
 * configured, no code path in this file can reach a fabricated answer, whatever
 * the other flag says and however badly the backend behaves.
 *
 * Both false — the shipped default — is an authenticated product that reports
 * honestly that it is not connected.
 */
function isDemoExperience(): boolean {
  return FEATURES.DEMO_EXPERIENCE && !FEATURES.BACKEND_INTEGRATION;
}

/**
 * The one door to the fabricated answers.
 *
 * A dynamic import, deliberately: it keeps `@/app/demo/*` out of the
 * authenticated bundle's module graph, and it makes every call site that wants
 * a fixture visible as one line of code that names the demo boundary.
 */
type DemoBackend = typeof import('@/app/demo/demoBackend');

async function demoBackend<T>(use: (backend: DemoBackend) => T | Promise<T>): Promise<T> {
  const backend = await import('@/app/demo/demoBackend');
  return use(backend);
}

// ============================================================================
// 0. LEAD CAPTURE (no auth — public funnel)
// ============================================================================

/** Capture lead from the lead magnet form */
export async function saveLead(data: api.LeadCapturePayload) {
  if (isDemoExperience()) return demoBackend(b => b.saveLead(data));
  requireProductBackend();
  return api.captureLead(data);
}

/** Capture exit-intent email (email-only, simplified) */
export async function saveExitIntentLead(email: string) {
  if (isDemoExperience()) return demoBackend(b => b.saveExitIntentLead(email));
  requireProductBackend();
  return api.captureExitIntentLead(email);
}

// ============================================================================
// 1. AUTH
// ============================================================================

/** Team login — demo mode accepts fixed credentials */
export async function teamLogin(
  email: string,
  password: string,
): Promise<{
  success: boolean;
  accessToken: string;
  user: { id: string; email: string; name: string; teamRole?: string };
  organization?: unknown;
  organizationUnavailableReason?: unknown;
  otherOrganizations?: number;
}> {
  if (isDemoExperience()) return demoBackend(b => b.teamLogin(email, password));
  requireProductBackend();
  return api.teamLogin(email, password);
}

/**
 * Client sign-in, step one — ask for a code.
 *
 * There is no constant code on this path and no fixture behind it. The demo's
 * fixed code lives in `@/app/demo/demoBackend`, which this function can only
 * reach through `isDemoExperience()`, and which a live configuration can never
 * reach at all.
 */
export async function requestClientSignInCode(
  email: string,
): Promise<{ sent: boolean; message: string }> {
  if (isDemoExperience()) return demoBackend(b => b.requestClientSignInCode(email));
  requireProductBackend();
  return api.requestClientSignInCode(email);
}

/** Client sign-in, step two — exchange the code for a session. */
export async function exchangeClientSignInCode(
  email: string,
  code: string,
): Promise<{ exists: boolean; submissionId?: string; companyName?: string; sessionToken?: string }> {
  if (isDemoExperience()) return demoBackend(b => b.exchangeClientSignInCode(email, code));
  requireProductBackend();
  return api.exchangeClientSignInCode(email, code);
}

/**
 * The sign-in hints a DEMO shows, or `null` in every other configuration.
 *
 * These used to be three synchronous re-exports of the fixture module, which
 * meant the shipped login screens imported the demo credentials whether or not
 * they rendered them — and the shipped bundle therefore contained them. Asking
 * for them is now an async question that answers `null` unless this build is an
 * explicitly designated demo, so a login screen renders the hint block only
 * where the hint is true.
 */
export async function getDemoSignInHints(): Promise<{
  team: { email: string; password: string };
  clients: { email: string; companyName: string }[];
  code: string;
} | null> {
  if (!isDemoExperience()) return null;
  return demoBackend(b => b.getSignInHints());
}

// ============================================================================
// 2. SUBMISSIONS (Team-side)
// ============================================================================

/** Create a new submission */
export async function createSubmission(payload: api.SubmissionPayload) {
  if (isDemoExperience()) return demoBackend(b => b.createSubmission(payload));
  requireProductBackend();
  return api.createSubmission(payload);
}

/** Get all submissions (team auth) */
export async function getSubmissions(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getSubmissions(accessToken));
  requireProductBackend();
  return api.getSubmissions(accessToken);
}

/** Update submission status */
export async function updateSubmissionStatus(
  id: string,
  accessToken: string,
  updates: { status?: string; priority?: string; assignedTo?: string },
) {
  if (isDemoExperience()) return demoBackend(b => b.updateSubmissionStatus(id, accessToken, updates));
  requireProductBackend();
  return api.updateSubmissionStatus(id, accessToken, updates);
}

/** Bulk update submissions */
export async function bulkUpdateSubmissions(
  ids: string[],
  updates: { status?: string; priority?: string; assignedTo?: string },
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.bulkUpdateSubmissions(ids, updates, accessToken));
  requireProductBackend();
  return api.bulkUpdateSubmissions(ids, updates, accessToken);
}

// ============================================================================
// 3. CLIENT PORTAL
// ============================================================================

/**
 * Get a client's submission.
 *
 * The second parameter is the caller's `ClientAuthContext` — the same value
 * `api.getClientSubmission` has always declared and forwarded to the server as
 * the `Authorization` header (`auth.sessionToken`) plus the `?email=` fallback
 * query. It was annotated `email?: string` here, which described neither the
 * value the only caller passes (ClientPortal passes `clientAuth`) nor the value
 * this wrapper hands on.
 */
export async function getClientSubmission(submissionId: string, auth?: ClientAuthContext) {
  if (isDemoExperience()) return demoBackend(b => b.getClientSubmission(submissionId, auth));
  requireProductBackend();
  return api.getClientSubmission(submissionId, auth);
}

/** Get client report (AI-powered or deterministic) */
export async function getClientReport(submissionId: string, auth?: ClientAuthContext) {
  if (isDemoExperience()) return demoBackend(b => b.getClientReport(submissionId, auth));
  requireProductBackend();
  return api.getClientReport(submissionId, auth);
}

// ============================================================================
// 4. MESSAGING
// ============================================================================

/** Client reads messages */
export async function getClientMessages(submissionId: string, auth?: ClientAuthContext) {
  if (isDemoExperience()) return demoBackend(b => b.getClientMessages(submissionId, auth));
  requireProductBackend();
  return api.getClientMessages(submissionId, auth);
}

/** Client posts a message */
export async function postClientMessage(
  submissionId: string,
  content: string,
  clientName: string,
  auth?: ClientAuthContext,
) {
  if (isDemoExperience()) return demoBackend(b => b.postClientMessage(submissionId, content, clientName, auth));
  requireProductBackend();
  return api.postClientMessage(submissionId, content, clientName, auth);
}

/** Team reads messages (team auth) */
export async function getTeamMessages(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getTeamMessages(submissionId, accessToken));
  requireProductBackend();
  return api.getTeamMessages(submissionId, accessToken);
}

/** Team posts a reply */
export async function postTeamReply(
  submissionId: string,
  content: string,
  accessToken: string,
  authorName: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.postTeamReply(submissionId, content, accessToken, authorName));
  requireProductBackend();
  return api.postTeamReply(submissionId, content, accessToken, authorName);
}

// ============================================================================
// 5. PROPOSALS
// ============================================================================

/** Get proposal (team auth) */
export async function getProposal(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getProposal(submissionId, accessToken));
  requireProductBackend();
  return api.getProposal(submissionId, accessToken);
}

/** Save proposal (team auth) */
export async function saveProposal(submissionId: string, proposal: any, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.saveProposal(submissionId, proposal, accessToken));
  requireProductBackend();
  return api.saveProposal(submissionId, proposal, accessToken);
}

/** Send proposal to client */
export async function sendProposal(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.sendProposal(submissionId, accessToken));
  requireProductBackend();
  return api.sendProposal(submissionId, accessToken);
}

/** Client fetches their proposal */
export async function getClientProposal(submissionId: string, auth?: ClientAuthContext) {
  if (isDemoExperience()) return demoBackend(b => b.getClientProposal(submissionId, auth));
  requireProductBackend();
  return api.getClientProposal(submissionId, auth);
}

/** Client responds to proposal */
export async function respondToProposal(
  submissionId: string,
  response: 'accepted' | 'rejected',
  clientName?: string,
  auth?: ClientAuthContext,
) {
  if (isDemoExperience()) return demoBackend(b => b.respondToProposal(submissionId, response, clientName, auth));
  requireProductBackend();
  return api.respondToProposal(submissionId, response, clientName, auth);
}

// ============================================================================
// 6. PROPOSAL ANNOTATIONS
// ============================================================================

export async function getProposalAnnotations(submissionId: string) {
  if (isDemoExperience()) return demoBackend(b => b.getProposalAnnotations(submissionId));
  requireProductBackend();
  return api.getProposalAnnotations(submissionId);
}

export async function createProposalAnnotation(
  submissionId: string,
  payload: Omit<api.ProposalAnnotation, 'id' | 'submissionId' | 'createdAt'>,
) {
  if (isDemoExperience()) return demoBackend(b => b.createProposalAnnotation(submissionId, payload));
  requireProductBackend();
  return api.createProposalAnnotation(submissionId, payload);
}

export async function deleteProposalAnnotation(submissionId: string, annotationId: string) {
  if (isDemoExperience()) return demoBackend(b => b.deleteProposalAnnotation(submissionId, annotationId));
  requireProductBackend();
  return api.deleteProposalAnnotation(submissionId, annotationId);
}

// ============================================================================
// 7. ENGAGEMENT
// ============================================================================

/** Track engagement event (silently skipped in demo mode) */
export async function trackEngagement(
  submissionId: string,
  type: api.EngagementEventType,
  meta?: Record<string, any>,
  auth?: ClientAuthContext,
) {
  if (isDemoExperience()) return demoBackend(b => b.trackEngagement(submissionId, type, meta, auth));
  requireProductBackend();
  return api.trackEngagement(submissionId, type, meta, auth);
}

/** Get engagement log */
export async function getEngagementLog(submissionId: string, auth?: ClientAuthContext) {
  if (isDemoExperience()) return demoBackend(b => b.getEngagementLog(submissionId, auth));
  requireProductBackend();
  return api.getEngagementLog(submissionId, auth);
}

/** Get engagement summary (batch, team auth) */
export async function getEngagementSummary(accessToken: string, submissionIds: string[]) {
  if (isDemoExperience()) return demoBackend(b => b.getEngagementSummary(accessToken, submissionIds));
  requireProductBackend();
  return api.getEngagementSummary(accessToken, submissionIds);
}

/** Get engagement analytics (team auth) */
export async function getEngagementAnalytics(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getEngagementAnalytics(accessToken));
  requireProductBackend();
  return api.getEngagementAnalytics(accessToken);
}

// ============================================================================
// 8. ANALYTICS
// ============================================================================

export async function getAnalytics(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getAnalytics(accessToken));
  requireProductBackend();
  return api.getAnalytics(accessToken);
}

/**
 * Revenue Intelligence deal snapshots. Demo mode returns the seeded
 * MOCK_SNAPSHOTS (deterministic); live mode fetches deterministically-derived
 * snapshots from persisted data. Aggregation runs client-side either way, so the
 * dashboard behaves identically — only the data source changes.
 */
export async function getRevenueSnapshots(
  accessToken: string,
): Promise<{ snapshots: import('@/app/core/dashboardAggregator').DealSnapshot[]; source: 'demo' | 'live'; summary?: api.RevenueSnapshotSummary }> {
  if (isDemoExperience()) return demoBackend(b => b.getRevenueSnapshots(accessToken));
  requireProductBackend();
  const res = await api.getRevenueSnapshots(accessToken);
  return { snapshots: res.snapshots, source: 'live', summary: res.summary };
}

// ============================================================================
// 9. NOTIFICATIONS
// ============================================================================

export async function getNotifications(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getNotifications(accessToken));
  requireProductBackend();
  return api.getNotifications(accessToken);
}

export async function markNotificationsRead(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.markNotificationsRead(accessToken));
  requireProductBackend();
  return api.markNotificationsRead(accessToken);
}

// ============================================================================
// 10. NOTES
// ============================================================================

export async function getNotes(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getNotes(submissionId, accessToken));
  requireProductBackend();
  return api.getNotes(submissionId, accessToken);
}

export async function addNote(
  submissionId: string,
  content: string,
  type: api.Note['type'],
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.addNote(submissionId, content, type, accessToken));
  requireProductBackend();
  return api.addNote(submissionId, content, type, accessToken);
}

export async function deleteNote(submissionId: string, noteId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.deleteNote(submissionId, noteId, accessToken));
  requireProductBackend();
  return api.deleteNote(submissionId, noteId, accessToken);
}

// ============================================================================
// 10b. REVIEWER CHECKLIST — CortexReviewerModule quality-gate persistence
// ============================================================================

export async function getReview(
  submissionId: string,
  reviewType: api.ReviewType,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.getReview(submissionId, reviewType, accessToken));
  requireProductBackend();
  return api.getReview(submissionId, reviewType, accessToken);
}

export async function saveReview(
  submissionId: string,
  reviewType: api.ReviewType,
  checklist: ReviewerChecklist,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.saveReview(submissionId, reviewType, checklist, accessToken));
  requireProductBackend();
  return api.saveReview(submissionId, reviewType, checklist, accessToken);
}

// ============================================================================
// 10c. OBJECTION ESCALATIONS — ObjectionHandlerPanel escalation persistence
// ============================================================================

export async function getEscalations(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getEscalations(submissionId, accessToken));
  requireProductBackend();
  return api.getEscalations(submissionId, accessToken);
}

export async function createEscalation(
  submissionId: string,
  payload: api.CreateEscalationPayload,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.createEscalation(submissionId, payload, accessToken));
  requireProductBackend();
  return api.createEscalation(submissionId, payload, accessToken);
}

export async function resolveEscalation(
  submissionId: string,
  escalationId: string,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.resolveEscalation(submissionId, escalationId, accessToken));
  requireProductBackend();
  return api.resolveEscalation(submissionId, escalationId, accessToken);
}

// ============================================================================
// 10d. INSTANT BOOKING — priority-call booking persistence
// ============================================================================

export async function createBooking(payload: api.CreateBookingPayload) {
  if (isDemoExperience()) return demoBackend(b => b.createBooking(payload));
  requireProductBackend();
  return api.createBooking(payload);
}

export async function getBookings(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getBookings(accessToken));
  requireProductBackend();
  return api.getBookings(accessToken);
}

// ============================================================================
// 10e. BLOCK REGISTRY — BlockRegistryPanel persistence
// ============================================================================

export async function getBlockRegistry(proposalId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getBlockRegistry(proposalId, accessToken));
  requireProductBackend();
  return api.getBlockRegistry(proposalId, accessToken);
}

export async function saveBlockRegistry(
  proposalId: string,
  payload: api.SaveBlockRegistryPayload,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.saveBlockRegistry(proposalId, payload, accessToken));
  requireProductBackend();
  return api.saveBlockRegistry(proposalId, payload, accessToken);
}

// ============================================================================
// 11. TEAM MANAGEMENT
// ============================================================================

/**
 * The organization this session is working inside, re-read live.
 *
 * The login response carries the same answer, and it goes stale: a membership
 * suspended after sign-in leaves the shell naming an organization the operator
 * was removed from. This is how a surface asks again.
 */
export async function getOrganizationContext(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getOrganizationContext(accessToken));
  requireProductBackend();
  return api.getOrganizationContext(accessToken);
}

/** The organizational spine — people, departments, teams, business units. */
export async function getOrganizationStructure(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getOrganizationStructure(accessToken));
  requireProductBackend();
  return api.getOrganizationStructure(accessToken);
}

/**
 * The spine's write path (CP-4).
 *
 * `requireProductBackend()` and no demo branch, deliberately. CP-1's rule is
 * that a failure is never answered with a fixture; a WRITE that appeared to
 * succeed against demo data would be worse than that — it would report a
 * change that no system anywhere made. The demo experience shows a fixed
 * organization and offers no controls to change it.
 */
export async function createOrganizationRecord(
  entity: api.SpineEntityPath, payload: Record<string, unknown>, accessToken: string,
) {
  requireProductBackend();
  return api.createOrganizationRecord(entity, payload, accessToken);
}

export async function updateOrganizationRecord(
  entity: api.SpineEntityPath, id: string, payload: Record<string, unknown>, accessToken: string,
) {
  requireProductBackend();
  return api.updateOrganizationRecord(entity, id, payload, accessToken);
}

export async function archiveOrganizationRecord(
  entity: api.SpineEntityPath, id: string, accessToken: string,
) {
  requireProductBackend();
  return api.archiveOrganizationRecord(entity, id, accessToken);
}

export async function addOrganizationTeamMember(
  payload: { teamId: string; personId: string; isLead?: boolean }, accessToken: string,
) {
  requireProductBackend();
  return api.addOrganizationTeamMember(payload, accessToken);
}

export async function removeOrganizationTeamMember(
  teamId: string, personId: string, accessToken: string,
) {
  requireProductBackend();
  return api.removeOrganizationTeamMember(teamId, personId, accessToken);
}

export async function getTeamMembers(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getTeamMembers(accessToken));
  requireProductBackend();
  return api.getTeamMembers(accessToken);
}

export async function inviteTeamMember(
  payload: { name: string; email: string; teamRole: string; tempPassword?: string },
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.inviteTeamMember(payload, accessToken));
  requireProductBackend();
  return api.inviteTeamMember(payload, accessToken);
}

export async function updateTeamMember(
  id: string,
  updates: { name?: string; teamRole?: string },
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.updateTeamMember(id, updates, accessToken));
  requireProductBackend();
  return api.updateTeamMember(id, updates, accessToken);
}

export async function removeTeamMember(id: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.removeTeamMember(id, accessToken));
  requireProductBackend();
  return api.removeTeamMember(id, accessToken);
}

// ============================================================================
// 12. SETTINGS
// ============================================================================

export async function getPlatformSettings(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getPlatformSettings(accessToken));
  requireProductBackend();
  return api.getPlatformSettings(accessToken);
}

export async function savePlatformSettings(
  payload: { platformSettings?: Partial<api.PlatformSettings>; profileName?: string },
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.savePlatformSettings(payload, accessToken));
  requireProductBackend();
  return api.savePlatformSettings(payload, accessToken);
}

// ============================================================================
// 13. CORTEX AI ANALYSIS
// ============================================================================

export async function getCortexAnalysis(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getCortexAnalysis(submissionId, accessToken));
  requireProductBackend();
  return api.getCortexAnalysis(submissionId, accessToken);
}

export async function analyzeSubmission(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.analyzeSubmission(submissionId, accessToken));
  requireProductBackend();
  return api.analyzeSubmission(submissionId, accessToken);
}

export async function clearCortexAnalysis(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.clearCortexAnalysis(submissionId, accessToken));
  requireProductBackend();
  return api.clearCortexAnalysis(submissionId, accessToken);
}

export async function getCortexStatus(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getCortexStatus(accessToken));
  requireProductBackend();
  return api.getCortexStatus(accessToken);
}

export async function analyzeSubmissionsBatch(ids: string[], accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.analyzeSubmissionsBatch(ids, accessToken));
  requireProductBackend();
  return api.analyzeSubmissionsBatch(ids, accessToken);
}

// ============================================================================
// 14. OUTCOMES & LEARNING LOOP
// ============================================================================

export async function logOutcome(
  submissionId: string,
  payload: api.OutcomePayload,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.logOutcome(submissionId, payload, accessToken));
  requireProductBackend();
  return api.logOutcome(submissionId, payload, accessToken);
}

export async function getOutcome(submissionId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getOutcome(submissionId, accessToken));
  requireProductBackend();
  return api.getOutcome(submissionId, accessToken);
}

export async function getOutcomesMap(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getOutcomesMap(accessToken));
  requireProductBackend();
  return api.getOutcomesMap(accessToken);
}

export async function getLearningLoop(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getLearningLoop(accessToken));
  requireProductBackend();
  return api.getLearningLoop(accessToken);
}

// ============================================================================
// 15. PIPELINE (Kanban)
// ============================================================================

export async function getPipelinePositions(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getPipelinePositions(accessToken));
  requireProductBackend();
  return api.getPipelinePositions(accessToken);
}

export async function savePipelinePosition(submissionId: string, columnId: string, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.savePipelinePosition(submissionId, columnId, accessToken));
  requireProductBackend();
  return api.savePipelinePosition(submissionId, columnId, accessToken);
}

export async function savePipelinePositions(positions: Record<string, string>, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.savePipelinePositions(positions, accessToken));
  requireProductBackend();
  return api.savePipelinePositions(positions, accessToken);
}

export async function resetPipelinePositions(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.resetPipelinePositions(accessToken));
  requireProductBackend();
  return api.resetPipelinePositions(accessToken);
}

// ============================================================================
// 16. COLUMN CAPACITIES
// ============================================================================

export async function getColumnCapacities(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getColumnCapacities(accessToken));
  requireProductBackend();
  return api.getColumnCapacities(accessToken);
}

export async function saveColumnCapacities(capacities: Record<string, number>, accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.saveColumnCapacities(capacities, accessToken));
  requireProductBackend();
  return api.saveColumnCapacities(capacities, accessToken);
}

// ============================================================================
// 17. EMAIL
// ============================================================================

export async function sendTestEmailRequest(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.sendTestEmailRequest(accessToken));
  requireProductBackend();
  return api.sendTestEmailRequest(accessToken);
}

export async function sendWeeklyDigestRequest(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.sendWeeklyDigestRequest(accessToken));
  requireProductBackend();
  return api.sendWeeklyDigestRequest(accessToken);
}

export async function getEmailStatus(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getEmailStatus(accessToken));
  requireProductBackend();
  return api.getEmailStatus(accessToken);
}

export async function enqueueEmails(payload: {
  submissionId: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  industry: string;
  readinessScore: number;
  bottleneckTheme: string;
  emails: api.QueuedEmailPayload[];
}) {
  if (isDemoExperience()) return demoBackend(b => b.enqueueEmails(payload));
  requireProductBackend();
  return api.enqueueEmails(payload);
}

export async function getEmailQueue(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getEmailQueue(accessToken));
  requireProductBackend();
  return api.getEmailQueue(accessToken);
}

export async function updateEmailStatus(
  emailId: string,
  status: 'sent' | 'skipped' | 'failed',
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.updateEmailStatus(emailId, status, accessToken));
  requireProductBackend();
  return api.updateEmailStatus(emailId, status, accessToken);
}

// ============================================================================
// 18. AI — Narrative & Chat
// ============================================================================

export async function generateCortexNarrative(
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision',
  context: api.NarrativeContext,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.generateCortexNarrative(type, context, accessToken));
  requireProductBackend();
  return api.generateCortexNarrative(type, context, accessToken);
}

export async function chatWithAI(
  req: api.AIChatRequest,
  accessToken: string,
) {
  if (isDemoExperience()) return demoBackend(b => b.chatWithAI(req, accessToken));
  requireProductBackend();
  return api.chatWithAI(req, accessToken);
}

/** Per-block AI assist — Block Registry / Copilot apply pipeline */
export async function blockAIAssist(
  req: api.BlockAIAssistRequest,
  accessToken: string,
): Promise<api.BlockAIAssistResponse> {
  if (isDemoExperience()) return demoBackend(b => b.blockAIAssist(req, accessToken));
  requireProductBackend();
  return api.blockAIAssist(req, accessToken);
}

/**
 * Proposal Section Copilot — section-level rewrite/explain for the 6 proposal
 * sections. Demo mode returns a deterministic mock revision; live mode routes
 * through the backend (Intelligence Gateway) and re-applies fact-lock on the
 * client as defence-in-depth. Returns the same shape in both modes.
 */
export async function proposalSectionCopilot(
  req: api.ProposalSectionCopilotRequest,
  accessToken: string,
  demo?: {
    draft: import('@/app/types/cortex-types').ProposalDraft;
    rejectionContexts: string[];
  },
): Promise<import('@/app/core/proposalCopilotEngine').SectionCopilotResult> {
  const engine = await import('@/app/core/proposalCopilotEngine');
  if (isDemoExperience()) return demoBackend(b => b.proposalSectionCopilot(req, accessToken, demo));
  requireProductBackend();
  const res = await api.proposalSectionCopilot(req, accessToken);
  return engine.assembleLiveResult(
    req.section as import('@/app/core/proposalCopilotEngine').SectionKey,
    req.current_content,
    res.proposed_content,
    res.diff_summary,
  );
}

/** Copilot patch plan interpreter — no edits, plan only */
export async function copilotInterpret(
  req: api.CopilotInterpretRequest,
  accessToken: string,
  demoAllStates?: import('@/app/core/blockEngine').BlockState[],
): Promise<api.CopilotInterpretResponse> {
  if (isDemoExperience()) return demoBackend(b => b.copilotInterpret(req, accessToken, demoAllStates));
  requireProductBackend();
  return api.copilotInterpret(req, accessToken);
}

// ============================================================================
// 19. HEALTH & DIAGNOSTICS
// ============================================================================

export async function ping() {
  if (isDemoExperience()) return demoBackend(b => b.ping());
  requireProductBackend();
  return api.ping();
}

export async function healthCheck() {
  if (isDemoExperience()) return demoBackend(b => b.healthCheck());
  requireProductBackend();
  return api.healthCheck();
}

export async function testAuth(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.testAuth(accessToken));
  requireProductBackend();
  return api.testAuth(accessToken);
}

export async function getDiagnostics(accessToken: string) {
  if (isDemoExperience()) return demoBackend(b => b.getDiagnostics(accessToken));
  requireProductBackend();
  return api.getDiagnostics(accessToken);
}

// ============================================================================
// 20. THE CONVENIENCE EXPORTS THAT USED TO LIVE HERE
// ============================================================================
//
// `getDemoSubmissions`, `getDemoTeamMembers`, `getDemoMessages`,
// `getDemoProposal`, `getDemoEngagementEvents`, `getDemoScheduledMeeting`,
// `getDemoClientSubmission`, `DEMO_CLIENTS`, `DEMO_TEAM_LOGIN` and
// `DEMO_NURTURE_LEADS` were exported from this file, synchronously, and eleven
// authenticated components imported them — most of them as the FALLBACK inside
// a `catch`. That is the precise mechanism Product Reality §9 describes: a
// backend failure and a healthy backend rendered the same invented companies,
// so nobody could tell them apart, including the people building it.
//
// They are gone from here on purpose. The fixtures still exist, in
// `@/app/demo/fixtures`, reachable only through `@/app/demo/demoBackend` and
// only when this build is an explicitly designated demo. A component that
// wants demo data now has to ask for a demo, and the surfaces that used to
// fall back render an honest state instead — see `ProductDataState`.

/**
 * Re-export generateClientReport so ClientPortal (and any future callers)
 * always route through the service layer — never importing the utility directly.
 */
export { _generateClientReport as generateClientReport };

// ============================================================================
// 21. SOLUTION GENERATOR — Dynamic solutions from diagnostic answers
// ============================================================================

export interface SolutionItem {
  problem: string;
  problemPlain: string;
  solution: string;
  solutionPlain: string;
  whyThisSolution: string;
  expectedOutcome: string;
  icon: 'speed' | 'money' | 'people' | 'insight' | 'automation' | 'quality';
}

/**
 * Generate tailored solutions from a client's actual diagnostic answers.
 * Analyzes the 14 answers for pain signals and maps them to specific solutions.
 * Falls back to default solutions when answers are empty.
 */
export function generateSolutionsFromDiagnostic(
  answers: Record<number | string, string>,
  companyName: string,
  industry: string,
): SolutionItem[] {
  const answerValues = Object.values(answers).filter(a => typeof a === 'string' && a.length > 20);
  if (answerValues.length === 0) return [];

  const allText = answerValues.join(' ').toLowerCase();
  const solutions: SolutionItem[] = [];

  // ── Signal detection — scan answers for pain patterns ──────────────────

  // 1. Manual processes / copy-paste / spreadsheet dependency
  if (/manual|copy.?paste|spreadsheet|google.?sheet|hours.?per.?day|hours.?every|time.?consuming/i.test(allText)) {
    const manualAnswer = answerValues.find(a => /manual|copy.?paste|spreadsheet/i.test(a.toLowerCase())) || answerValues[0];
    solutions.push({
      problem: 'Too much manual work slowing down your team',
      problemPlain: `Based on what you told us, your team is spending significant time on manual, repetitive tasks — things like copying data between systems, maintaining spreadsheets, and processing information by hand. ${extractSnippet(manualAnswer, 'manual')}`,
      solution: 'Automated Workflow Pipeline',
      solutionPlain: `We connect your systems so information flows automatically between them. When something happens in one system (like a new order or a customer request), every other system that needs to know gets updated instantly — no human in the middle.`,
      whyThisSolution: `Because every hour ${companyName}'s team spends on repetitive data entry is an hour they're not spending on growing the business. This is typically the highest-ROI fix we implement.`,
      expectedOutcome: 'Recover 5-8 hours per day of manual work and reduce data entry errors by 90%',
      icon: 'speed',
    });
  }

  // 2. Customer service / support overload
  if (/support|ticket|customer.?service|help.?desk|repetitive.?question|chatbot|intercom|zendesk/i.test(allText)) {
    const csAnswer = answerValues.find(a => /support|ticket|customer.?service/i.test(a.toLowerCase())) || '';
    solutions.push({
      problem: 'Customer support is stretched thin',
      problemPlain: `Your team is handling a high volume of customer inquiries, and many of them are the same questions asked over and over. ${extractSnippet(csAnswer, 'support')} This keeps your support staff too busy to handle the complex issues that actually need human expertise.`,
      solution: 'Intelligent Support Automation',
      solutionPlain: `We set up a smart system that handles the repetitive questions automatically — instantly, 24/7. It learns your specific products, policies, and processes. Your human team only sees the questions that genuinely need a person.`,
      whyThisSolution: `Because hiring more support staff is expensive and doesn't scale. This lets ${companyName} grow your customer base without growing your support costs proportionally.`,
      expectedOutcome: 'Automatically handle 40-60% of support inquiries, improving response time to under 30 seconds',
      icon: 'people',
    });
  }

  // 3. Inventory / data fragmentation
  if (/inventory|stock|oversell|sync|disconnected|fragmented|multiple.?system|three.?different|doesn.?t.?talk/i.test(allText)) {
    solutions.push({
      problem: 'Critical data lives in disconnected systems',
      problemPlain: `Your important business data is spread across multiple systems that don't communicate with each other. This creates gaps, inconsistencies, and forces your team to manually check and reconcile information across platforms — a recipe for errors and missed opportunities.`,
      solution: 'Unified Data Hub',
      solutionPlain: `We create one central source of truth that all your systems feed into and read from. Every update happens once and propagates everywhere automatically. No more conflicting numbers, no more manual reconciliation.`,
      whyThisSolution: `Because decisions made on inconsistent data are risky decisions. ${companyName} needs to trust the numbers before you can confidently scale.`,
      expectedOutcome: 'Eliminate data inconsistencies and save 5+ hours per week of manual reconciliation',
      icon: 'quality',
    });
  }

  // 4. Marketing / reporting fragmentation
  if (/marketing|campaign|report|dashboard|analytics|meta|google.?ads|tiktok|ad.?spend|attribution|performance.?data/i.test(allText)) {
    solutions.push({
      problem: 'Marketing insights are scattered and stale',
      problemPlain: `Your marketing performance data is spread across multiple advertising platforms and dashboards. Someone on your team spends hours pulling numbers together manually, and by the time decisions get made, the data is already outdated.`,
      solution: 'Real-Time Marketing Intelligence',
      solutionPlain: `We build a single dashboard that automatically combines all your marketing data in real time. You see exactly what's working and what isn't — at a glance — so you can shift budget to winning campaigns immediately.`,
      whyThisSolution: `Because ${companyName} is making marketing spend decisions on incomplete, stale information. Every day you're not optimizing in real time, you're leaving money on the table.`,
      expectedOutcome: 'Cut reporting time by 80% and improve marketing ROI by 15-25% through faster optimization',
      icon: 'insight',
    });
  }

  // 5. Churn / retention / onboarding
  if (/churn|retention|onboarding|cancel|lifetime.?value|customer.?lifetime|post.?purchase|engagement/i.test(allText)) {
    solutions.push({
      problem: 'Customers are leaving and you\'re not sure why',
      problemPlain: `Your customer retention isn't where it needs to be. Whether it's incomplete onboarding, lack of engagement tracking, or no proactive outreach, customers are slipping away — and you don't have a systematic way to identify at-risk accounts before they leave.`,
      solution: 'Proactive Retention Engine',
      solutionPlain: `We build a system that monitors customer health signals — usage patterns, engagement levels, support interactions — and flags at-risk accounts before they churn. Your team gets actionable alerts with specific steps to re-engage each customer.`,
      whyThisSolution: `Because acquiring a new customer costs 5-7x more than keeping an existing one. For ${companyName}, reducing churn by even a few percentage points translates directly to significant revenue growth.`,
      expectedOutcome: 'Reduce churn by 25-40% through early detection and proactive intervention',
      icon: 'money',
    });
  }

  // 6. Sales / founder dependency
  if (/founder|sales.?process|close.?rate|pipeline|demo|pitch|crm|lead|outbound|referral/i.test(allText)) {
    solutions.push({
      problem: 'Growth is bottlenecked by key-person dependency',
      problemPlain: `Your sales or business development process depends too heavily on one or two people. Whether it's the founder doing all the demos, or a single person who holds all the client relationships — this creates a ceiling on how fast you can grow.`,
      solution: 'Systematized Growth Playbook',
      solutionPlain: `We capture what makes your best performers effective and build it into repeatable systems — templates, scripts, automated follow-ups, and a structured pipeline that anyone on the team can execute.`,
      whyThisSolution: `Because ${companyName} can't scale beyond what one person can handle. Systematizing the sales motion means you can hire, train, and ramp new team members in weeks instead of months.`,
      expectedOutcome: 'Reduce founder sales dependency by 60% and unlock 2-3x pipeline capacity',
      icon: 'automation',
    });
  }

  // 7. Financial visibility
  if (/financial|p&l|profitab|quickbooks|excel|month.?end|billing|invoice|dunning|failed.?payment/i.test(allText)) {
    solutions.push({
      problem: 'No real-time visibility into financial health',
      problemPlain: `Your financial reporting is delayed and manual. You don't know if a project, product line, or customer segment is profitable until weeks or months after the fact — too late to course-correct.`,
      solution: 'Live Financial Dashboard',
      solutionPlain: `We set up real-time financial tracking that shows profitability by project, product, and customer segment as it happens. You'll know exactly where money is going and where it's coming from, every day.`,
      whyThisSolution: `Because flying blind on profitability is one of the most expensive mistakes a growing business can make. ${companyName} needs financial clarity to confidently invest in growth.`,
      expectedOutcome: 'Identify and address unprofitable activities within days instead of months',
      icon: 'money',
    });
  }

  // 8. Scope creep / project management
  if (/scope.?creep|underestimate|over.?budget|project.?manage|utilization|resource.?alloc|timesheet|hours/i.test(allText)) {
    solutions.push({
      problem: 'Projects consistently run over scope and budget',
      problemPlain: `Your projects frequently exceed their original estimates, eating into margins. Scope creep, inconsistent time tracking, and unclear resource allocation make it hard to know which projects are actually profitable — until it's too late.`,
      solution: 'Smart Project Intelligence',
      solutionPlain: `We implement systems that track project health in real time — comparing actual hours against estimates, flagging scope changes immediately, and showing project profitability as work is happening, not after it's done.`,
      whyThisSolution: `Because ${companyName} can't improve margins without knowing where they're being lost. Real-time project visibility turns every PM into a profit-conscious decision-maker.`,
      expectedOutcome: 'Reduce scope overruns by 40-50% and improve project margins by 10-15%',
      icon: 'insight',
    });
  }

  // Return top 5 most relevant, or all if fewer
  return solutions.slice(0, 5);
}

/** Extract a relevant snippet from an answer for context */
function extractSnippet(answer: string, keyword: string): string {
  if (!answer || answer.length < 30) return '';
  // Find the sentence containing the keyword
  const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const relevant = sentences.find(s => s.toLowerCase().includes(keyword));
  if (relevant) {
    return `You mentioned: "${relevant.trim()}."`;
  }
  // Otherwise use the first sentence
  if (sentences.length > 0) {
    return `You mentioned: "${sentences[0].trim()}."`;
  }
  return '';
}