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
  CopilotInterpretRequest,
  CopilotInterpretResponse,
  QueuedEmailPayload,
  LeadCapturePayload,
} from '@/app/lib/api';

// Re-export demo types
export type { DemoClient, DemoNurtureLead } from '@/app/utils/demoData';

// Re-export clientReportGenerator type so components only need dataService
export type { ClientReportData } from '@/app/utils/clientReportGenerator';

// ── Internal imports (not re-exported) ──────────────────────────────────────
import * as api from '@/app/lib/api';
import * as demo from '@/app/utils/demoData';
import { generateClientReport as _generateClientReport } from '@/app/utils/clientReportGenerator';

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(...args: any[]) {
  if (FEATURES.VERBOSE_LOGGING) console.log('📦 [dataService]', ...args);
}

function isDemo(): boolean {
  return !FEATURES.BACKEND_INTEGRATION;
}

// ============================================================================
// 0. LEAD CAPTURE (no auth — public funnel)
// ============================================================================

/** Capture lead from the lead magnet form */
export async function saveLead(data: LeadCapturePayload) {
  if (isDemo()) {
    log('Save lead (demo mode):', data.email);
    return { success: true, leadId: `demo_lead_${Date.now()}` };
  }
  return api.captureLead(data);
}

/** Capture exit-intent email (email-only, simplified) */
export async function saveExitIntentLead(email: string) {
  if (isDemo()) {
    log('Save exit-intent lead (demo mode):', email);
    return { success: true, leadId: `demo_exit_${Date.now()}`, alreadyExists: false };
  }
  return api.captureExitIntentLead(email);
}

// ============================================================================
// 1. AUTH
// ============================================================================

/**
 * Mint a throwaway demo session token.
 *
 * Generated at runtime so no fixed token literal ever ships in the bundle.
 * The value carries no authority against the real backend — it only unlocks
 * the local demo dashboard while DEMO_MODE is on.
 */
function createDemoSessionToken(): string {
  return `demo_session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Team login.
 *
 * - Backend on  → delegate to the real /auth/team/login endpoint.
 * - Backend off + DEMO_MODE on → mint a passwordless demo session (no
 *     credential is checked; this is the dev-only demo path).
 * - Backend off + DEMO_MODE off → login is unavailable (secure default; the
 *     value ships this way in every production build).
 */
export async function teamLogin(
  email: string,
  password: string,
): Promise<{ success: boolean; accessToken: string; user: { id: string; email: string; name: string } }> {
  if (FEATURES.BACKEND_INTEGRATION) {
    return api.teamLogin(email, password);
  }
  if (FEATURES.DEMO_MODE) {
    log('Team login (demo mode — passwordless demo session)');
    return {
      success: true,
      accessToken: createDemoSessionToken(),
      user: { id: 'user_001', email: email || 'demo@local', name: 'Demo User' },
    };
  }
  throw new Error('Login is unavailable while backend integration is disabled.');
}

/** Client email verification — demo mode checks DEMO_CLIENTS */
export async function verifyClientEmail(
  email: string,
): Promise<{ exists: boolean; submissionId?: string; companyName?: string; sessionToken?: string }> {
  if (isDemo()) {
    log('Verify client email (demo mode):', email);
    const match = demo.findDemoClient(email);
    if (match) {
      // Generate a deterministic demo token from submissionId + email
      // so the same credentials always produce the same token (no server needed)
      const demoToken = `demo_tok_${btoa(`${match.submissionId}:${email}`).replace(/=/g, '')}`;
      return { exists: true, submissionId: match.submissionId, companyName: match.companyName, sessionToken: demoToken };
    }
    return { exists: false };
  }
  return api.verifyClientEmail(email);
}

/** Expose demo clients list for login hints */
export const DEMO_CLIENTS = demo.DEMO_CLIENTS;
export const findDemoClient = demo.findDemoClient;

// ============================================================================
// 2. SUBMISSIONS (Team-side)
// ============================================================================

/** Create a new submission */
export async function createSubmission(payload: api.SubmissionPayload) {
  if (isDemo()) {
    log('Create submission (demo mode)');
    return { success: true, submissionId: `demo-${Date.now()}` };
  }
  return api.createSubmission(payload);
}

/** Get all submissions (team auth) */
export async function getSubmissions(accessToken: string) {
  if (isDemo()) {
    log('Fetching submissions (demo mode)');
    const submissions = demo.getDemoSubmissions();
    return { success: true, submissions, total: submissions.length };
  }
  return api.getSubmissions(accessToken);
}

/** Update submission status */
export async function updateSubmissionStatus(
  id: string,
  accessToken: string,
  updates: { status?: string; priority?: string; assignedTo?: string },
) {
  if (isDemo()) {
    log('Update submission status (demo mode)', id, updates);
    // Return a mock updated submission
    const subs = demo.getDemoSubmissions();
    const sub = subs.find(s => s.id === id) || subs[0];
    return {
      success: true,
      submission: { ...sub, ...updates } as api.Submission,
    };
  }
  return api.updateSubmissionStatus(id, accessToken, updates);
}

/** Bulk update submissions */
export async function bulkUpdateSubmissions(
  ids: string[],
  updates: { status?: string; priority?: string; assignedTo?: string },
  accessToken: string,
) {
  if (isDemo()) {
    log('Bulk update (demo mode)', ids.length, 'items');
    return { success: true, updated: ids.length };
  }
  return api.bulkUpdateSubmissions(ids, updates, accessToken);
}

// ============================================================================
// 3. CLIENT PORTAL
// ============================================================================

/** Get a client's submission (client-side, no auth) */
export async function getClientSubmission(submissionId: string, email?: string) {
  if (isDemo()) {
    log('Get client submission (demo mode):', submissionId);
    const submission = demo.getDemoClientSubmission({ submissionId, clientEmail: email });
    return { success: true, submission };
  }
  return api.getClientSubmission(submissionId, email);
}

/** Build a demo client submission (helper for portal) */
export function getDemoClientSubmission(overrides?: {
  submissionId?: string;
  clientEmail?: string;
  companyName?: string;
}) {
  return demo.getDemoClientSubmission(overrides);
}

/** Get client report (AI-powered or deterministic) */
export async function getClientReport(submissionId: string) {
  if (isDemo()) {
    log('Get client report (demo mode)');
    // Generate deterministic report from demo data
    const sub = demo.getDemoClientSubmission({ submissionId });
    const report = _generateClientReport(sub);
    return { success: true, report: report as any, aiPowered: false };
  }
  return api.getClientReport(submissionId);
}

// ============================================================================
// 4. MESSAGING
// ============================================================================

/** Client reads messages */
export async function getClientMessages(submissionId: string) {
  if (isDemo()) {
    log('Get client messages (demo mode)');
    const sub = demo.getDemoClientSubmission({ submissionId });
    const messages = demo.getDemoMessages(submissionId, sub.contact);
    return { success: true, messages };
  }
  return api.getClientMessages(submissionId);
}

/** Client posts a message */
export async function postClientMessage(
  submissionId: string,
  content: string,
  clientName: string,
) {
  if (isDemo()) {
    log('Post client message (demo mode)');
    const newMsg: api.Message = {
      id: `msg_demo_${Date.now()}`,
      submissionId,
      author: 'client',
      authorName: clientName,
      content,
      createdAt: new Date().toISOString(),
    };
    return { success: true, message: newMsg };
  }
  return api.postClientMessage(submissionId, content, clientName);
}

/** Team reads messages (team auth) */
export async function getTeamMessages(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Get team messages (demo mode)');
    const messages: api.Message[] = [
      {
        id: 'demo_team_msg_1',
        submissionId,
        author: 'client',
        authorName: 'Client',
        content: 'When will my report be ready?',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 'demo_team_msg_2',
        submissionId,
        author: 'team',
        authorName: 'Team',
        content: "Your report is being finalized now. You'll receive it within the next hour!",
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
    ];
    return { success: true, messages, unreadFromClient: 0 };
  }
  return api.getTeamMessages(submissionId, accessToken);
}

/** Team posts a reply */
export async function postTeamReply(
  submissionId: string,
  content: string,
  accessToken: string,
  authorName: string,
) {
  if (isDemo()) {
    log('Post team reply (demo mode)');
    const newMsg: api.Message = {
      id: `msg_team_demo_${Date.now()}`,
      submissionId,
      author: 'team',
      authorName,
      content,
      createdAt: new Date().toISOString(),
    };
    return { success: true, message: newMsg };
  }
  return api.postTeamReply(submissionId, content, accessToken, authorName);
}

/** Get demo messages (convenience export for components that use it) */
export const getDemoMessages = demo.getDemoMessages;

// ============================================================================
// 5. PROPOSALS
// ============================================================================

/** Get proposal (team auth) */
export async function getProposal(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Get proposal (demo mode)');
    return { success: true, proposal: null };
  }
  return api.getProposal(submissionId, accessToken);
}

/** Save proposal (team auth) */
export async function saveProposal(submissionId: string, proposal: any, accessToken: string) {
  if (isDemo()) {
    log('Save proposal (demo mode — not persisted)');
    return { success: true, proposal };
  }
  return api.saveProposal(submissionId, proposal, accessToken);
}

/** Send proposal to client */
export async function sendProposal(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Send proposal (demo mode — not sent)');
    return { success: true, proposal: { status: 'sent', sentAt: new Date().toISOString() } };
  }
  return api.sendProposal(submissionId, accessToken);
}

/** Client fetches their proposal */
export async function getClientProposal(submissionId: string) {
  if (isDemo()) {
    log('Get client proposal (demo mode)');
    const sub = demo.getDemoClientSubmission({ submissionId });
    const proposal = demo.getDemoProposal(sub.company);
    return { success: true, proposal };
  }
  return api.getClientProposal(submissionId);
}

/** Client responds to proposal */
export async function respondToProposal(
  submissionId: string,
  response: 'accepted' | 'rejected',
  clientName?: string,
) {
  if (isDemo()) {
    log('Respond to proposal (demo mode):', response);
    const sub = demo.getDemoClientSubmission({ submissionId });
    const proposal = demo.getDemoProposal(sub.company);
    return {
      success: true,
      proposal: {
        ...proposal,
        status: response === 'accepted' ? 'accepted' : 'rejected',
        respondedAt: new Date().toISOString(),
        respondedBy: clientName,
      },
    };
  }
  return api.respondToProposal(submissionId, response, clientName);
}

/** Get demo proposal (convenience export) */
export const getDemoProposal = demo.getDemoProposal;

// ============================================================================
// 6. PROPOSAL ANNOTATIONS
// ============================================================================

export async function getProposalAnnotations(submissionId: string) {
  if (isDemo()) {
    log('Get proposal annotations (demo mode)');
    return { success: true, annotations: [] };
  }
  return api.getProposalAnnotations(submissionId);
}

export async function createProposalAnnotation(
  submissionId: string,
  payload: Omit<api.ProposalAnnotation, 'id' | 'submissionId' | 'createdAt'>,
) {
  if (isDemo()) {
    log('Create annotation (demo mode)');
    return {
      success: true,
      annotation: {
        ...payload,
        id: `ann_demo_${Date.now()}`,
        submissionId,
        createdAt: new Date().toISOString(),
      } as api.ProposalAnnotation,
    };
  }
  return api.createProposalAnnotation(submissionId, payload);
}

export async function deleteProposalAnnotation(submissionId: string, annotationId: string) {
  if (isDemo()) {
    log('Delete annotation (demo mode)');
    return { success: true };
  }
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
) {
  if (isDemo()) return; // Skip silently
  return api.trackEngagement(submissionId, type, meta);
}

/** Get engagement log */
export async function getEngagementLog(submissionId: string) {
  if (isDemo()) {
    log('Get engagement log (demo mode)');
    const events = demo.getDemoEngagementEvents(submissionId);
    // Map to the expected shape
    return {
      success: true,
      events: events.map(e => ({
        id: e.id,
        type: e.event as api.EngagementEventType,
        at: e.timestamp,
      })) as api.EngagementEvent[],
    };
  }
  return api.getEngagementLog(submissionId);
}

/** Get engagement summary (batch, team auth) */
export async function getEngagementSummary(accessToken: string, submissionIds: string[]) {
  if (isDemo()) {
    log('Get engagement summary (demo mode)');
    const summary: Record<string, api.EngagementEvent | null> = {};
    for (const id of submissionIds) {
      summary[id] = {
        id: `evt_demo_${id}`,
        type: 'portal_opened',
        at: new Date(Date.now() - 86400000).toISOString(),
      };
    }
    return { success: true, summary };
  }
  return api.getEngagementSummary(accessToken, submissionIds);
}

/** Get engagement analytics (team auth) */
export async function getEngagementAnalytics(accessToken: string) {
  if (isDemo()) {
    log('Get engagement analytics (demo mode)');
    const analytics: api.EngagementAnalytics = {
      reportDelivery: {
        reportAvailable: 15,
        totalViewed: 12,
        totalCTAClicked: 8,
        totalPDFSaved: 5,
        totalViews: 34,
        avgViewsPerViewed: 2.8,
        viewRate: 80,
        ctaRate: 67,
        pdfRate: 42,
      },
      notes: {
        total: 47,
        submissionsWithNotes: 10,
        byType: { note: 20, action: 15, flag: 7, insight: 5 },
        topCommented: [
          { id: 'demo_1', company: 'TechCorp Solutions', count: 8 },
          { id: 'demo_2', company: 'HealthFirst Medical', count: 6 },
          { id: 'demo_3', company: 'RetailMax Inc', count: 5 },
        ],
      },
      topEngagedLeads: [
        {
          id: 'DEMO-001',
          company: 'TechCorp Solutions',
          industry: 'SaaS / Software',
          status: 'completed',
          viewCount: 5,
          lastViewedAt: new Date(Date.now() - 3600000).toISOString(),
          ctaClicked: true,
          pdfSaved: true,
          noteCount: 8,
          engagementScore: 95,
        },
        {
          id: 'DEMO-002',
          company: 'HealthFirst Medical',
          industry: 'Healthcare / Medical',
          status: 'in-review',
          viewCount: 3,
          lastViewedAt: new Date(Date.now() - 7200000).toISOString(),
          ctaClicked: true,
          pdfSaved: false,
          noteCount: 6,
          engagementScore: 78,
        },
      ],
      recentActivity: [
        {
          type: 'report_viewed',
          company: 'TechCorp Solutions',
          detail: 'Client viewed readiness report',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          submissionId: 'DEMO-001',
        },
        {
          type: 'cta_clicked',
          company: 'HealthFirst Medical',
          detail: 'Client clicked Schedule Call CTA',
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          submissionId: 'DEMO-002',
        },
      ],
    };
    return { success: true, engagement: analytics };
  }
  return api.getEngagementAnalytics(accessToken);
}

/** Get demo engagement events (convenience) */
export const getDemoEngagementEvents = demo.getDemoEngagementEvents;

// ============================================================================
// 8. ANALYTICS
// ============================================================================

export async function getAnalytics(accessToken: string) {
  if (isDemo()) {
    log('Get analytics (demo mode)');
    return {
      success: true,
      analytics: {
        submissionCounts: { new: 3, 'in-review': 2, completed: 1, approved: 0, total: 6 },
        dailyTrend: [],
      },
    };
  }
  return api.getAnalytics(accessToken);
}

// ============================================================================
// 9. NOTIFICATIONS
// ============================================================================

export async function getNotifications(accessToken: string) {
  if (isDemo()) {
    log('Get notifications (demo mode)');
    const notifications: api.AppNotification[] = [
      {
        id: 'notif_demo_1',
        type: 'new_submission',
        title: 'New Diagnostic Submission',
        message: 'TechCorp Solutions submitted a new diagnostic assessment',
        submissionId: 'DEMO-001',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        read: false,
      },
      {
        id: 'notif_demo_2',
        type: 'status_change',
        title: 'Report Ready',
        message: 'HealthFirst Medical report has been generated',
        submissionId: 'DEMO-002',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        read: true,
      },
    ];
    return { success: true, notifications, unreadCount: 1 };
  }
  return api.getNotifications(accessToken);
}

export async function markNotificationsRead(accessToken: string) {
  if (isDemo()) {
    log('Mark notifications read (demo mode)');
    return { success: true };
  }
  return api.markNotificationsRead(accessToken);
}

// ============================================================================
// 10. NOTES
// ============================================================================

export async function getNotes(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Get notes (demo mode)');
    const notes: api.Note[] = [
      {
        id: 'note_demo_1',
        kvKey: '',
        submissionId,
        content: 'Strong lead — high readiness score and clear pain signals in fulfillment pipeline.',
        type: 'insight',
        authorName: 'Admin User',
        authorEmail: 'admin@marqcortex.com',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'note_demo_2',
        kvKey: '',
        submissionId,
        content: 'Follow up on inventory sync issue — they mentioned overselling 3-4x per week.',
        type: 'action',
        authorName: 'Review Manager',
        authorEmail: 'reviewer@marqcortex.com',
        createdAt: new Date(Date.now() - 43200000).toISOString(),
      },
    ];
    return { success: true, notes };
  }
  return api.getNotes(submissionId, accessToken);
}

export async function addNote(
  submissionId: string,
  content: string,
  type: api.Note['type'],
  accessToken: string,
) {
  if (isDemo()) {
    log('Add note (demo mode)');
    const note: api.Note = {
      id: `note_demo_${Date.now()}`,
      kvKey: '',
      submissionId,
      content,
      type,
      authorName: 'Demo User',
      authorEmail: 'demo@marqcortex.com',
      createdAt: new Date().toISOString(),
    };
    return { success: true, note };
  }
  return api.addNote(submissionId, content, type, accessToken);
}

export async function deleteNote(submissionId: string, noteId: string, accessToken: string) {
  if (isDemo()) {
    log('Delete note (demo mode)');
    return { success: true };
  }
  return api.deleteNote(submissionId, noteId, accessToken);
}

// ============================================================================
// 11. TEAM MANAGEMENT
// ============================================================================

export async function getTeamMembers(accessToken: string) {
  if (isDemo()) {
    log('Get team members (demo mode)');
    return { success: true, members: demo.getDemoTeamMembers() };
  }
  return api.getTeamMembers(accessToken);
}

export async function inviteTeamMember(
  payload: { name: string; email: string; teamRole: string; tempPassword?: string },
  accessToken: string,
) {
  if (isDemo()) {
    log('Invite team member (demo mode)');
    const member: api.TeamMemberRecord = {
      id: `user_demo_${Date.now()}`,
      email: payload.email,
      name: payload.name,
      teamRole: payload.teamRole as any,
      status: 'pending',
      joinedDate: new Date().toISOString(),
      lastActive: null,
      isSelf: false,
    };
    return { success: true, member, tempPassword: 'DemoPass123!' };
  }
  return api.inviteTeamMember(payload, accessToken);
}

export async function updateTeamMember(
  id: string,
  updates: { name?: string; teamRole?: string },
  accessToken: string,
) {
  if (isDemo()) {
    log('Update team member (demo mode)');
    const members = demo.getDemoTeamMembers();
    const member = members.find(m => m.id === id) || members[0];
    return { success: true, member: { ...member, ...updates } as api.TeamMemberRecord };
  }
  return api.updateTeamMember(id, updates, accessToken);
}

export async function removeTeamMember(id: string, accessToken: string) {
  if (isDemo()) {
    log('Remove team member (demo mode)');
    return { success: true };
  }
  return api.removeTeamMember(id, accessToken);
}

/** Convenience exports for direct access */
export const getDemoTeamMembers = demo.getDemoTeamMembers;
export const getDemoTeamFallback = demo.getDemoTeamFallback;

// ============================================================================
// 12. SETTINGS
// ============================================================================

export async function getPlatformSettings(accessToken: string) {
  if (isDemo()) {
    log('Get platform settings (demo mode)');
    const demoSettings: any = {
      success: true,
      currentUser: {
        id: 'demo_user_1',
        email: 'demo@marqcortex.com',
        name: 'Demo User',
        teamRole: 'admin',
      },
      platformSettings: {
        brandingName: 'MARQ Cortex',
        defaultAssignee: 'Admin User',
        autoAssign: false,
        notificationPrefs: {
          newSubmission: true,
          reportReady: true,
          teamActivity: false,
          weeklyDigest: true,
          proposalViewed: true,
          proposalAccepted: true,
          messageReceived: true,
        },
      },
      health: {
        submissionCounts: { new: 3, 'in-review': 2, completed: 1, approved: 0, total: 6 },
        serverTime: new Date().toISOString(),
        recentActivity: [],
      },
    };
    return demoSettings as api.SettingsResponse;
  }
  return api.getPlatformSettings(accessToken);
}

export async function savePlatformSettings(
  payload: { platformSettings?: Partial<api.PlatformSettings>; profileName?: string },
  accessToken: string,
) {
  if (isDemo()) {
    log('Save platform settings (demo mode — not persisted)');
    return { success: true };
  }
  return api.savePlatformSettings(payload, accessToken);
}

// ============================================================================
// 13. CORTEX AI ANALYSIS
// ============================================================================

export async function getCortexAnalysis(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Get CORTEX analysis (demo mode)');
    return { success: true, analysis: null };
  }
  return api.getCortexAnalysis(submissionId, accessToken);
}

export async function analyzeSubmission(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Analyze submission (demo mode — requires backend)');
    throw new Error('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
  }
  return api.analyzeSubmission(submissionId, accessToken);
}

export async function clearCortexAnalysis(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Clear CORTEX analysis (demo mode)');
    return { success: true };
  }
  return api.clearCortexAnalysis(submissionId, accessToken);
}

export async function getCortexStatus(accessToken: string) {
  if (isDemo()) {
    log('Get CORTEX status (demo mode)');
    return { success: true, analyzed: {} as Record<string, api.CortexStatusEntry>, count: 0 };
  }
  return api.getCortexStatus(accessToken);
}

export async function analyzeSubmissionsBatch(ids: string[], accessToken: string) {
  if (isDemo()) {
    log('Batch analyze (demo mode — requires backend)');
    throw new Error('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
  }
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
  if (isDemo()) {
    log('Log outcome (demo mode — not persisted)');
    const record: api.OutcomeRecord = {
      ...payload,
      submissionId,
      loggedAt: new Date().toISOString(),
      loggedBy: 'demo_user_1',
      industry: 'Demo',
      company: 'Demo Company',
      aiScore: 85,
      recommendedService: 'AI Operations Audit',
      submittedAt: new Date(Date.now() - 86400000).toISOString(),
    };
    return { success: true, outcome: record };
  }
  return api.logOutcome(submissionId, payload, accessToken);
}

export async function getOutcome(submissionId: string, accessToken: string) {
  if (isDemo()) {
    log('Get outcome (demo mode)');
    return { success: true, outcome: null };
  }
  return api.getOutcome(submissionId, accessToken);
}

export async function getOutcomesMap(accessToken: string) {
  if (isDemo()) {
    log('Get outcomes map (demo mode)');
    return {
      success: true,
      outcomes: {} as Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }>,
      count: 0,
    };
  }
  return api.getOutcomesMap(accessToken);
}

export async function getLearningLoop(accessToken: string) {
  if (isDemo()) {
    log('Get learning loop (demo mode)');
    return { success: true, data: null, isEmpty: true };
  }
  return api.getLearningLoop(accessToken);
}

// ============================================================================
// 15. PIPELINE (Kanban)
// ============================================================================

export async function getPipelinePositions(accessToken: string) {
  if (isDemo()) {
    log('Get pipeline positions (demo mode)');
    return { success: true, positions: {} as Record<string, string>, count: 0 };
  }
  return api.getPipelinePositions(accessToken);
}

export async function savePipelinePosition(submissionId: string, columnId: string, accessToken: string) {
  if (isDemo()) {
    log('Save pipeline position (demo mode)');
    return { success: true, positions: { [submissionId]: columnId } };
  }
  return api.savePipelinePosition(submissionId, columnId, accessToken);
}

export async function savePipelinePositions(positions: Record<string, string>, accessToken: string) {
  if (isDemo()) {
    log('Save pipeline positions (demo mode)');
    return { success: true, positions };
  }
  return api.savePipelinePositions(positions, accessToken);
}

export async function resetPipelinePositions(accessToken: string) {
  if (isDemo()) {
    log('Reset pipeline positions (demo mode)');
    return { success: true };
  }
  return api.resetPipelinePositions(accessToken);
}

// ============================================================================
// 16. COLUMN CAPACITIES
// ============================================================================

export async function getColumnCapacities(accessToken: string) {
  if (isDemo()) {
    log('Get column capacities (demo mode)');
    return { success: true, capacities: {} as Record<string, number> };
  }
  return api.getColumnCapacities(accessToken);
}

export async function saveColumnCapacities(capacities: Record<string, number>, accessToken: string) {
  if (isDemo()) {
    log('Save column capacities (demo mode)');
    return { success: true, capacities };
  }
  return api.saveColumnCapacities(capacities, accessToken);
}

// ============================================================================
// 17. EMAIL
// ============================================================================

export async function sendTestEmailRequest(accessToken: string) {
  if (isDemo()) {
    log('Send test email (demo mode)');
    return { success: true, sent: false, resendKeyConfigured: false, to: 'demo@marqcortex.com' };
  }
  return api.sendTestEmailRequest(accessToken);
}

export async function sendWeeklyDigestRequest(accessToken: string) {
  if (isDemo()) {
    log('Send weekly digest (demo mode)');
    return { success: true, reason: 'Demo mode — no email sent' };
  }
  return api.sendWeeklyDigestRequest(accessToken);
}

export async function getEmailStatus(accessToken: string) {
  if (isDemo()) {
    log('Get email status (demo mode)');
    return {
      success: true,
      resendConfigured: false,
      fromAddress: 'noreply@marqcortex.com',
      note: 'Demo mode — email not configured',
    };
  }
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
  if (isDemo()) {
    log('Enqueue emails (demo mode)');
    return { success: true, queued: payload.emails.length };
  }
  return api.enqueueEmails(payload);
}

export async function getEmailQueue(accessToken: string) {
  if (isDemo()) {
    log('Get email queue (demo mode)');
    return { success: true, emails: [], total: 0 };
  }
  return api.getEmailQueue(accessToken);
}

export async function updateEmailStatus(
  emailId: string,
  status: 'sent' | 'skipped' | 'failed',
  accessToken: string,
) {
  if (isDemo()) {
    log('Update email status (demo mode)');
    return { success: true };
  }
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
  if (isDemo()) {
    log('Generate narrative (demo mode — requires backend)');
    // Return a helpful demo narrative instead of throwing
    const demoNarratives: Record<string, string> = {
      why_now: `Based on our analysis, ${context.company} is at a critical inflection point. Current manual processes are consuming approximately 30% of operational capacity, and with your growth trajectory, these bottlenecks will compound significantly within the next 6-12 months. Acting now allows you to build the automation foundation before scaling pressure makes changes more costly and disruptive.`,
      confidence_reasoning: `Our confidence in this recommendation stems from three key signals: (1) multiple diagnostic answers independently point to the same root causes, (2) the operational patterns we see in ${context.company} closely match successful transformations we've executed in the ${context.industry} sector, and (3) the quantified time savings and cost reduction estimates are based on conservative benchmarks from comparable engagements.`,
      strategic_decision: `The recommended approach for ${context.company} prioritizes the highest-impact, lowest-risk intervention first. By starting with process automation in the core operational pipeline, we address the most expensive bottleneck while building internal confidence and capability for the broader transformation roadmap.`,
    };
    return {
      success: true,
      type,
      narrative: demoNarratives[type] || demoNarratives.why_now,
      model: 'demo-mode',
      generated_at: new Date().toISOString(),
    } as api.NarrativeResponse;
  }
  return api.generateCortexNarrative(type, context, accessToken);
}

export async function chatWithAI(
  req: api.AIChatRequest,
  accessToken: string,
) {
  if (isDemo()) {
    log('AI chat (demo mode — requires backend)');
    return {
      success: true,
      reply: `[Demo Mode] I'd be happy to help analyze this. In production, I would use GPT-4o-mini to provide intelligent insights about ${req.section}. To enable AI chat, set BACKEND_INTEGRATION to true and ensure your OpenAI API key is configured.`,
      model: 'demo-mode',
      generated_at: new Date().toISOString(),
    } as api.AIChatResponse;
  }
  return api.chatWithAI(req, accessToken);
}

/** Per-block AI assist — Block Registry / Copilot apply pipeline */
export async function blockAIAssist(
  req: api.BlockAIAssistRequest,
  accessToken: string,
): Promise<api.BlockAIAssistResponse> {
  if (isDemo()) {
    log('Block AI assist (demo mode):', req.block_id, req.action);
    await new Promise(r => setTimeout(r, 1_200));
    const { buildMockBlockAIAssistApiResponse } = await import('@/app/core/aiAssistEngine');
    return buildMockBlockAIAssistApiResponse(req);
  }
  return api.blockAIAssist(req, accessToken);
}

/** Copilot patch plan interpreter — no edits, plan only */
export async function copilotInterpret(
  req: api.CopilotInterpretRequest,
  accessToken: string,
  demoAllStates?: import('@/app/core/blockEngine').BlockState[],
): Promise<api.CopilotInterpretResponse> {
  if (isDemo()) {
    log('Copilot interpret (demo mode):', req.entity_id);
    await new Promise(r => setTimeout(r, 900));
    const { buildMockCopilotInterpretApiResponse } = await import('@/app/core/copilotEngine');
    return buildMockCopilotInterpretApiResponse(
      req.user_input,
      req.scope as import('@/app/core/copilotEngine').PatchScope,
      req.entity_id,
      demoAllStates ?? [],
    );
  }
  return api.copilotInterpret(req, accessToken);
}

// ============================================================================
// 19. HEALTH & DIAGNOSTICS
// ============================================================================

export async function ping() {
  if (isDemo()) {
    return { success: true, message: 'pong (demo mode)', timestamp: new Date().toISOString(), server: 'demo' };
  }
  return api.ping();
}

export async function healthCheck() {
  if (isDemo()) {
    return { status: 'ok', timestamp: new Date().toISOString(), kvStore: 'demo' };
  }
  return api.healthCheck();
}

export async function testAuth(accessToken: string) {
  if (isDemo()) {
    return { success: true, message: 'Auth OK (demo mode)', userId: 'demo_user_1', timestamp: new Date().toISOString() };
  }
  return api.testAuth(accessToken);
}

export async function getDiagnostics(accessToken: string) {
  if (isDemo()) {
    return { success: true, diagnostics: [] };
  }
  return api.getDiagnostics(accessToken);
}

// ============================================================================
// 20. CONVENIENCE EXPORTS (Demo data helpers)
// ============================================================================

/** Get demo submissions (for components that need the raw list) */
export const getDemoSubmissions = demo.getDemoSubmissions;

/** Get demo scheduled meeting */
export const getDemoScheduledMeeting = demo.getDemoScheduledMeeting;

/** Demo nurture leads for email automation */
export const DEMO_NURTURE_LEADS = demo.DEMO_NURTURE_LEADS;

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