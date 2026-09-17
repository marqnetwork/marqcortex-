/**
 * DEMO BACKEND — the fabricated answers, behind a wall.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Until CP-1 these function bodies lived inside `services/dataService.ts`, one
 * `if (isDemo())` branch at a time, and `dataService` is imported by every
 * authenticated component in the product. So the fabricated pipeline, the
 * invented companies and the made-up team were not merely reachable from the
 * signed-in product — they were statically linked into it, and the only thing
 * standing between an operator and a $3.12M pipeline belonging to nobody was a
 * boolean nobody could see.
 *
 * Moving them here makes the boundary real in three ways:
 *
 *   1. AUTHENTICATED CODE CANNOT IMPORT THIS FILE. `tests/features/demoIsolation.test.ts`
 *      fails the build if it does. That test is the standing guarantee; this
 *      comment is only its explanation.
 *   2. `dataService` reaches it through `await import()` inside a branch that
 *      is unreachable unless `FEATURES.DEMO_EXPERIENCE` is on, so the fixtures
 *      land in their own chunk and never in the authenticated bundle.
 *   3. There is exactly one door. A component that wants demo data has to ask
 *      for a demo experience by name, which is a thing a reviewer can see.
 *
 * ── WHAT IS ALLOWED IN HERE ─────────────────────────────────────────────────
 *
 * Fixtures. Invented companies, invented people, invented money. That is the
 * point of the file and none of it is a defect — Product Reality §9 asked for
 * this data to be ISOLATED, not deleted, because a marketing walkthrough and a
 * sales demo are real uses and a product with nothing to show has nothing to
 * demonstrate.
 *
 * What is NOT allowed is for any of it to reach a signed-in operator who did
 * not ask for a demo. `isDemoExperience()` in `dataService` requires
 * `BACKEND_INTEGRATION` to be OFF as well as `DEMO_EXPERIENCE` to be ON, so a
 * live backend that fails can never be answered from this file.
 */

import { FEATURES } from '@/config/features';
import * as api from '@/app/lib/api';
import { normalizeTeamRole } from '@/app/lib/teamRole';
import type { ClientAuthContext } from '@/app/lib/session';
import type { ReviewerChecklist } from '@/app/types/reviewer-checklist';
import * as demo from '@/app/demo/fixtures/demoData';
import { generateClientReport as _generateClientReport } from '@/app/utils/clientReportGenerator';

function log(...args: any[]) {
  if (FEATURES.VERBOSE_LOGGING) console.log('🎭 [demoBackend]', ...args);
}

/**
 * The code the demo's second sign-in step accepts.
 *
 * Demo mode has no mail and no server, so step one acknowledges without sending
 * anything. This is a property of THIS FILE, which serves fixtures to nobody in
 * particular; the live path has no constant code of any kind and never consults
 * this value.
 */
export const DEMO_SIGN_IN_CODE = '000000';

export async function saveLead(data: api.LeadCapturePayload) {
  log('Save lead (demo mode):', data.email);
  return { success: true, leadId: `demo_lead_${Date.now()}` };
}

export async function saveExitIntentLead(email: string) {
  log('Save exit-intent lead (demo mode):', email);
  return { success: true, leadId: `demo_exit_${Date.now()}`, alreadyExists: false };
}

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
  log('Team login (demo mode)');
  if (email === demo.DEMO_TEAM_LOGIN.email && password === demo.DEMO_TEAM_LOGIN.password) {
    return {
      success: true,
      accessToken: 'demo_access_token_12345',
      // Demo mode signs in the one demo account, and it is the admin one —
      // stating the role here rather than leaving it to the fail-closed
      // default is what makes the demo show the admin experience it claims to.
      user: { id: 'user_001', email, name: 'Admin User', teamRole: 'admin' },
      // The demo signs into a demo tenant, and the shell names it. A demo that
      // reported "Workspace not reported" would be telling the truth about the
      // wire and a lie about the experience — and the fabricated name belongs
      // HERE, behind the demo boundary, which is the only place it may exist.
      organization: {
        organizationId: 'demo_org_001',
        organizationName: 'MARQ Demo Workspace',
        organizationSlug: 'marq-demo',
      },
      organizationUnavailableReason: null,
      otherOrganizations: 0,
    };
  }
  throw new Error('Invalid credentials. Use demo credentials shown below.');
}

export async function requestClientSignInCode(
  email: string,
): Promise<{ sent: boolean; message: string }> {
  log('Request client sign-in code (demo mode):', email);
  return {
    sent: true,
    message: `Demo mode: use code ${DEMO_SIGN_IN_CODE}.`,
  };
}

export async function exchangeClientSignInCode(
  email: string,
  code: string,
): Promise<{ exists: boolean; submissionId?: string; companyName?: string; sessionToken?: string }> {
  log('Exchange client sign-in code (demo mode):', email);
  if (code.trim() !== DEMO_SIGN_IN_CODE) return { exists: false };
  const match = demo.findDemoClient(email);
  if (match) {
    // A deterministic demo token from submissionId + email, so the same
    // fixture always produces the same token (no server needed).
    const demoToken = `demo_tok_${btoa(`${match.submissionId}:${email}`).replace(/=/g, '')}`;
    return { exists: true, submissionId: match.submissionId, companyName: match.companyName, sessionToken: demoToken };
  }
  return { exists: false };
}

export async function createSubmission(payload: api.SubmissionPayload) {
  log('Create submission (demo mode)');
  return { success: true, submissionId: `demo-${Date.now()}` };
}

export async function getSubmissions(accessToken: string) {
  log('Fetching submissions (demo mode)');
  const submissions = demo.getDemoSubmissions();
  return { success: true, submissions, total: submissions.length };
}

export async function updateSubmissionStatus(
  id: string,
  accessToken: string,
  updates: { status?: string; priority?: string; assignedTo?: string },
) {
  log('Update submission status (demo mode)', id, updates);
  // Return a mock updated submission
  const subs = demo.getDemoSubmissions();
  const sub = subs.find(s => s.id === id) || subs[0];
  return {
    success: true,
    submission: { ...sub, ...updates } as api.Submission,
  };
}

export async function bulkUpdateSubmissions(
  ids: string[],
  updates: { status?: string; priority?: string; assignedTo?: string },
  accessToken: string,
) {
  log('Bulk update (demo mode)', ids.length, 'items');
  return { success: true, updated: ids.length };
}

export async function getClientSubmission(submissionId: string, auth?: ClientAuthContext) {
  log('Get client submission (demo mode):', submissionId);
  const submission = demo.getDemoClientSubmission({ submissionId, clientEmail: auth?.email });
  return { success: true, submission };
}

export async function getClientReport(submissionId: string, auth?: ClientAuthContext) {
  log('Get client report (demo mode)');
  // Generate deterministic report from demo data
  const sub = demo.getDemoClientSubmission({ submissionId, clientEmail: auth?.email });
  const report = _generateClientReport(sub);
  return { success: true, report: report as any, aiPowered: false };
}

export async function getClientMessages(submissionId: string, auth?: ClientAuthContext) {
  log('Get client messages (demo mode)');
  const sub = demo.getDemoClientSubmission({ submissionId, clientEmail: auth?.email });
  const messages = demo.getDemoMessages(submissionId, sub.contact);
  return { success: true, messages };
}

export async function postClientMessage(
  submissionId: string,
  content: string,
  clientName: string,
  auth?: ClientAuthContext,
) {
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

export async function getTeamMessages(submissionId: string, accessToken: string) {
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

export async function postTeamReply(
  submissionId: string,
  content: string,
  accessToken: string,
  authorName: string,
) {
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

export async function getProposal(submissionId: string, accessToken: string) {
  log('Get proposal (demo mode)');
  return { success: true, proposal: null };
}

export async function saveProposal(submissionId: string, proposal: any, accessToken: string) {
  log('Save proposal (demo mode — not persisted)');
  return { success: true, proposal };
}

export async function sendProposal(submissionId: string, accessToken: string) {
  log('Send proposal (demo mode — not sent)');
  return { success: true, proposal: { status: 'sent', sentAt: new Date().toISOString() } };
}

export async function getClientProposal(submissionId: string, auth?: ClientAuthContext) {
  log('Get client proposal (demo mode)');
  const sub = demo.getDemoClientSubmission({ submissionId, clientEmail: auth?.email });
  const proposal = demo.getDemoProposal(sub.company);
  return { success: true, proposal };
}

export async function respondToProposal(
  submissionId: string,
  response: 'accepted' | 'rejected',
  clientName?: string,
  auth?: ClientAuthContext,
) {
  log('Respond to proposal (demo mode):', response);
  const sub = demo.getDemoClientSubmission({ submissionId, clientEmail: auth?.email });
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

export async function getProposalAnnotations(submissionId: string) {
  log('Get proposal annotations (demo mode)');
  return { success: true, annotations: [] };
}

export async function createProposalAnnotation(
  submissionId: string,
  payload: Omit<api.ProposalAnnotation, 'id' | 'submissionId' | 'createdAt'>,
) {
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

export async function deleteProposalAnnotation(submissionId: string, annotationId: string) {
  log('Delete annotation (demo mode)');
  return { success: true };
}

export async function trackEngagement(
  submissionId: string,
  type: api.EngagementEventType,
  meta?: Record<string, any>,
  auth?: ClientAuthContext,
) {
  return;
}

export async function getEngagementLog(submissionId: string, auth?: ClientAuthContext) {
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

export async function getEngagementSummary(accessToken: string, submissionIds: string[]) {
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

export async function getEngagementAnalytics(accessToken: string) {
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

/**
 * Demo analytics, in the shape the Analytics screen actually reads.
 *
 * This used to return `{ submissionCounts, dailyTrend }` — a shape that
 * predates the `AnalyticsData` the page has read for some time. The mismatch
 * was invisible because the page never called this function: in demo mode it
 * took a `generateDemoSubmissions()` branch instead and computed its own. CP-1
 * gave the page one path, and the first run of it crashed on
 * `analytics.byPriority.high`, taking the whole console to the route error
 * boundary.
 *
 * Two lessons, both acted on: a fixture that no code path exercises is a
 * fixture nobody knows is wrong, and a 200 in the wrong shape must not be able
 * to crash a surface (`buildPriorityData` and its siblings now narrow).
 */
export async function getAnalytics(accessToken: string) {
  log('Get analytics (demo mode)');
  return {
    success: true,
    analytics: {
      total: 6,
      byStatus: { new: 3, 'in-review': 2, completed: 1, approved: 0 },
      byPriority: { high: 2, medium: 3, low: 1 },
      avgQuality: 82,
      industryBreakdown: { 'Professional Services': 3, Manufacturing: 2, Retail: 1 },
      dailyTrend: [],
    },
  };
}

export async function getRevenueSnapshots(
  accessToken: string,
): Promise<{ snapshots: import('@/app/core/dashboardAggregator').DealSnapshot[]; source: 'demo' | 'live'; summary?: api.RevenueSnapshotSummary }> {
  log('Get revenue snapshots (demo mode) — MOCK_SNAPSHOTS');
  const { MOCK_SNAPSHOTS } = await import('@/app/demo/fixtures/revenueSnapshots');
  return { snapshots: MOCK_SNAPSHOTS, source: 'demo' };
}

export async function getNotifications(accessToken: string) {
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

export async function markNotificationsRead(accessToken: string) {
  log('Mark notifications read (demo mode)');
  return { success: true };
}

export async function getNotes(submissionId: string, accessToken: string) {
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

export async function addNote(
  submissionId: string,
  content: string,
  type: api.Note['type'],
  accessToken: string,
) {
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

export async function deleteNote(submissionId: string, noteId: string, accessToken: string) {
  log('Delete note (demo mode)');
  return { success: true };
}

export async function getReview(
  submissionId: string,
  reviewType: api.ReviewType,
  accessToken: string,
) {
  log('Get review (demo mode) — no persisted review');
  return { success: true, review: null as api.StoredReview | null };
}

export async function saveReview(
  submissionId: string,
  reviewType: api.ReviewType,
  checklist: ReviewerChecklist,
  accessToken: string,
) {
  log('Save review (demo mode) — echo only, not persisted');
  const review = {
    ...checklist,
    lead_id: submissionId,
    review_type: reviewType,
    updated_at: new Date().toISOString(),
  } as api.StoredReview;
  return { success: true, review };
}

export async function getEscalations(submissionId: string, accessToken: string) {
  log('Get escalations (demo mode) — none persisted');
  return { success: true, escalations: [] as api.EscalationRecord[] };
}

export async function createEscalation(
  submissionId: string,
  payload: api.CreateEscalationPayload,
  accessToken: string,
) {
  log('Create escalation (demo mode) — echo only, not persisted');
  const detectionCount = 1;
  const escalation: api.EscalationRecord = {
    id: `esc_demo_${Date.now()}`,
    submissionId,
    proposalId: payload.proposalId ?? null,
    objectionType: payload.objectionType,
    confidence: payload.confidence,
    atRisk: payload.atRisk,
    detectionCount,
    status: 'active',
    inputExcerpt: payload.inputExcerpt ?? '',
    companyName: payload.companyName ?? '',
    contactName: payload.contactName ?? '',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  return { success: true, escalation, detectionCount };
}

export async function resolveEscalation(
  submissionId: string,
  escalationId: string,
  accessToken: string,
) {
  log('Resolve escalation (demo mode) — no-op');
  return { success: true, escalation: null as unknown as api.EscalationRecord };
}

export async function createBooking(payload: api.CreateBookingPayload) {
  log('Create booking (demo mode) — echo only, not persisted');
  const booking: api.Booking = {
    id: `bk_demo_${Date.now()}`,
    schemaVersion: 2,
    submissionId: payload.submissionId ?? null,
    contactName: payload.contactName ?? '',
    contactEmail: (payload.contactEmail || '').toLowerCase(),
    companyName: payload.companyName ?? '',
    scheduledAt: payload.scheduledAt,
    priority: Boolean(payload.priority),
    status: 'requested',
    source: payload.source ?? 'score-page',
    createdAt: new Date().toISOString(),
  };
  return { success: true, booking };
}

export async function getBookings(accessToken: string) {
  log('Get bookings (demo mode) — none persisted');
  return { success: true, bookings: [] as api.Booking[], count: 0 };
}

export async function getBlockRegistry(proposalId: string, accessToken: string) {
  log('Get block registry (demo mode) — none persisted');
  return { success: true, registry: null as api.BlockRegistrySnapshot | null };
}

export async function saveBlockRegistry(
  proposalId: string,
  payload: api.SaveBlockRegistryPayload,
  accessToken: string,
) {
  log('Save block registry (demo mode) — echo only, not persisted');
  const registry: api.BlockRegistrySnapshot = {
    proposalId,
    blocks: payload.blocks,
    revisions: payload.revisions,
    locks: payload.locks,
    rev: (payload.baseRev ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  return { success: true, registry };
}

/** The demo workspace — the same organization the demo login resolves. */
export async function getOrganizationContext(accessToken: string) {
  log('Get organization context (demo mode)');
  return {
    success: true,
    organization: demo.getDemoOrganization(),
    organizationUnavailableReason: null,
    otherOrganizations: 0,
  };
}

/** The demo organizational spine. */
export async function getOrganizationStructure(accessToken: string) {
  log('Get organization structure (demo mode)');
  const structure = demo.getDemoOrganizationStructure();
  return {
    success: true,
    organization: demo.getDemoOrganization(),
    organizationUnavailableReason: null,
    structure,
    summary: {
      people: structure.people.length,
      peopleWithoutConsoleAccess: structure.people.filter(p => !p.hasConsoleAccess).length,
      departments: structure.departments.length,
      teams: structure.teams.length,
      businessUnits: structure.businessUnits.length,
      unassignedPeople: structure.people.filter(p => p.departmentId === null).length,
    },
  };
}

export async function getTeamMembers(accessToken: string) {
  log('Get team members (demo mode)');
  return { success: true, members: demo.getDemoTeamMembers() };
}

export async function inviteTeamMember(
  payload: { name: string; email: string; teamRole: string; tempPassword?: string },
  accessToken: string,
) {
  log('Invite team member (demo mode)');
  const member: api.TeamMemberRecord = {
    id: `user_demo_${Date.now()}`,
    email: payload.email,
    name: payload.name,
    teamRole: normalizeTeamRole(payload.teamRole),
    status: 'pending',
    joinedDate: new Date().toISOString(),
    lastActive: null,
    isSelf: false,
  };
  return { success: true, member, tempPassword: 'DemoPass123!' };
}

export async function updateTeamMember(
  id: string,
  updates: { name?: string; teamRole?: string },
  accessToken: string,
) {
  log('Update team member (demo mode)');
  const members = demo.getDemoTeamMembers();
  const member = members.find(m => m.id === id) || members[0];
  return { success: true, member: { ...member, ...updates } as api.TeamMemberRecord };
}

export async function removeTeamMember(id: string, accessToken: string) {
  log('Remove team member (demo mode)');
  return { success: true };
}

export async function getPlatformSettings(accessToken: string) {
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

export async function savePlatformSettings(
  payload: { platformSettings?: Partial<api.PlatformSettings>; profileName?: string },
  accessToken: string,
) {
  log('Save platform settings (demo mode — not persisted)');
  return { success: true };
}

export async function getCortexAnalysis(submissionId: string, accessToken: string) {
  log('Get CORTEX analysis (demo mode)');
  return { success: true, analysis: null };
}

export async function analyzeSubmission(submissionId: string, accessToken: string): Promise<never> {
  log('Analyze submission (demo mode — requires backend)');
  throw new Error('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
}

export async function clearCortexAnalysis(submissionId: string, accessToken: string) {
  log('Clear CORTEX analysis (demo mode)');
  return { success: true };
}

export async function getCortexStatus(accessToken: string) {
  log('Get CORTEX status (demo mode)');
  return { success: true, analyzed: {} as Record<string, api.CortexStatusEntry>, count: 0 };
}

export async function analyzeSubmissionsBatch(ids: string[], accessToken: string): Promise<never> {
  log('Batch analyze (demo mode — requires backend)');
  throw new Error('Backend integration is disabled. Enable it in feature flags to use AI analysis.');
}

export async function logOutcome(
  submissionId: string,
  payload: api.OutcomePayload,
  accessToken: string,
) {
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

export async function getOutcome(submissionId: string, accessToken: string) {
  log('Get outcome (demo mode)');
  return { success: true, outcome: null };
}

export async function getOutcomesMap(accessToken: string) {
  log('Get outcomes map (demo mode)');
  return {
    success: true,
    outcomes: {} as Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }>,
    count: 0,
  };
}

export async function getLearningLoop(accessToken: string) {
  log('Get learning loop (demo mode)');
  return { success: true, data: null, isEmpty: true };
}

export async function getPipelinePositions(accessToken: string) {
  log('Get pipeline positions (demo mode)');
  return { success: true, positions: {} as Record<string, string>, count: 0 };
}

export async function savePipelinePosition(submissionId: string, columnId: string, accessToken: string) {
  log('Save pipeline position (demo mode)');
  return { success: true, positions: { [submissionId]: columnId } };
}

export async function savePipelinePositions(positions: Record<string, string>, accessToken: string) {
  log('Save pipeline positions (demo mode)');
  return { success: true, positions };
}

export async function resetPipelinePositions(accessToken: string) {
  log('Reset pipeline positions (demo mode)');
  return { success: true };
}

export async function getColumnCapacities(accessToken: string) {
  log('Get column capacities (demo mode)');
  return { success: true, capacities: {} as Record<string, number> };
}

export async function saveColumnCapacities(capacities: Record<string, number>, accessToken: string) {
  log('Save column capacities (demo mode)');
  return { success: true, capacities };
}

export async function sendTestEmailRequest(accessToken: string) {
  log('Send test email (demo mode)');
  return { success: true, sent: false, resendKeyConfigured: false, to: 'demo@marqcortex.com' };
}

export async function sendWeeklyDigestRequest(accessToken: string) {
  log('Send weekly digest (demo mode)');
  return { success: true, reason: 'Demo mode — no email sent' };
}

export async function getEmailStatus(accessToken: string) {
  log('Get email status (demo mode)');
  return {
    success: true,
    resendConfigured: false,
    fromAddress: 'noreply@marqcortex.com',
    note: 'Demo mode — email not configured',
  };
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
  log('Enqueue emails (demo mode)');
  return { success: true, queued: payload.emails.length };
}

export async function getEmailQueue(accessToken: string) {
  log('Get email queue (demo mode)');
  return { success: true, emails: [], total: 0 };
}

export async function updateEmailStatus(
  emailId: string,
  status: 'sent' | 'skipped' | 'failed',
  accessToken: string,
) {
  log('Update email status (demo mode)');
  return { success: true };
}

export async function generateCortexNarrative(
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision',
  context: api.NarrativeContext,
  accessToken: string,
) {
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

export async function chatWithAI(
  req: api.AIChatRequest,
  accessToken: string,
) {
  log('AI chat (demo mode — requires backend)');
  return {
    success: true,
    reply: `[Demo Mode] I'd be happy to help analyze this. In production, I would use GPT-4o-mini to provide intelligent insights about ${req.section}. To enable AI chat, set BACKEND_INTEGRATION to true and ensure your OpenAI API key is configured.`,
    model: 'demo-mode',
    generated_at: new Date().toISOString(),
  } as api.AIChatResponse;
}

export async function blockAIAssist(
  req: api.BlockAIAssistRequest,
  accessToken: string,
): Promise<api.BlockAIAssistResponse> {
  log('Block AI assist (demo mode):', req.block_id, req.action);
  await new Promise(r => setTimeout(r, 1_200));
  const { buildMockBlockAIAssistApiResponse } = await import('@/app/core/aiAssistEngine');
  return buildMockBlockAIAssistApiResponse(req);
}

export async function proposalSectionCopilot(
  req: api.ProposalSectionCopilotRequest,
  accessToken: string,
  demo?: {
    draft: import('@/app/types/cortex-types').ProposalDraft;
    rejectionContexts: string[];
  },
): Promise<import('@/app/core/proposalCopilotEngine').SectionCopilotResult> {
  const engine = await import('@/app/core/proposalCopilotEngine');
  log('Proposal section copilot (demo mode):', req.section, req.action);
  await new Promise(r => setTimeout(r, 1_400));
  if (!demo) throw new Error('proposalSectionCopilot demo mode requires draft context');
  return engine.buildDemoSectionRevision(
    req.section as import('@/app/core/proposalCopilotEngine').SectionKey,
    req.action as import('@/app/core/proposalCopilotEngine').ActionKey,
    demo.draft,
    req.custom_prompt ?? '',
    demo.rejectionContexts,
  );
}

export async function copilotInterpret(
  req: api.CopilotInterpretRequest,
  accessToken: string,
  demoAllStates?: import('@/app/core/blockEngine').BlockState[],
): Promise<api.CopilotInterpretResponse> {
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

export async function ping() {
  return { success: true, message: 'pong (demo mode)', timestamp: new Date().toISOString(), server: 'demo' };
}

export async function healthCheck() {
  return { status: 'ok', timestamp: new Date().toISOString(), kvStore: 'demo' };
}

export async function testAuth(accessToken: string) {
  return { success: true, message: 'Auth OK (demo mode)', userId: 'demo_user_1', timestamp: new Date().toISOString() };
}

export async function getDiagnostics(accessToken: string) {
  return { success: true, diagnostics: [] };
}

// ============================================================================
// SIGN-IN HINTS
// ============================================================================

/**
 * What a demo login screen may display to help somebody in.
 *
 * `dataService.getDemoSignInHints()` is the only caller, and it answers `null`
 * unless this build is an explicitly designated demo — so a shipped product
 * never advertises a credential. That is not only hygiene: until S-7 the
 * deployed server used this same password as its `TEAM_ADMIN_PASSWORD`
 * fallback, so the string sitting in the bundle was a real administrator.
 */
export function getSignInHints() {
  return {
    team: { email: demo.DEMO_TEAM_LOGIN.email, password: demo.DEMO_TEAM_LOGIN.password },
    clients: demo.DEMO_CLIENTS.map(c => ({ email: c.email, companyName: c.companyName })),
    code: DEMO_SIGN_IN_CODE,
  };
}

// ============================================================================
// FIXTURES THE DESIGNATED DEMO SURFACES READ DIRECTLY
// ============================================================================
//
// Re-exported from here rather than from `dataService`, so the only modules
// that can see them are ones that named the demo boundary in an import.

export const DEMO_CLIENTS = demo.DEMO_CLIENTS;
export const DEMO_TEAM_LOGIN = demo.DEMO_TEAM_LOGIN;
export const DEMO_NURTURE_LEADS = demo.DEMO_NURTURE_LEADS;
export const findDemoClient = demo.findDemoClient;
export const getDemoSubmissions = demo.getDemoSubmissions;
export const getDemoTeamMembers = demo.getDemoTeamMembers;
export const getDemoMessages = demo.getDemoMessages;
export const getDemoProposal = demo.getDemoProposal;
export const getDemoEngagementEvents = demo.getDemoEngagementEvents;
export const getDemoScheduledMeeting = demo.getDemoScheduledMeeting;
export const getDemoClientSubmission = demo.getDemoClientSubmission;
