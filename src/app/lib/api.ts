/**
 * Frontend API client — calls the Supabase Edge Function server
 */
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { FEATURES } from '@/config/features';
import type { ClientAuthContext } from '@/app/lib/session';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-324f4fbe`;

const headers = (token?: string | null) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token || publicAnonKey}`,
});

/** Prefer server-issued client session token; fall back to anon key + email query */
function clientHeaders(auth?: ClientAuthContext) {
  return headers(auth?.sessionToken);
}

function withEmailQuery(url: URL, auth?: ClientAuthContext) {
  if (auth?.email) url.searchParams.set('email', auth.email);
}

// ============================================================================
// HEALTH CHECK & DIAGNOSTIC ENDPOINTS
// ============================================================================

export async function ping() {
  try {
    if (FEATURES.VERBOSE_LOGGING) console.log('🏓 Pinging server...');
    const res = await fetch(`${BASE}/ping`, {
      headers: headers(),
    });
    const data = await res.json();
    if (FEATURES.VERBOSE_LOGGING) console.log('🏓 Ping response:', data);
    if (!res.ok) throw new Error(data.error || 'Ping failed');
    return data as { success: boolean; message: string; timestamp: string; server: string };
  } catch (err) {
    console.error('❌ Ping failed:', {
      error: err,
      message: err instanceof Error ? err.message : String(err),
      BASE,
    });
    throw err;
  }
}

export async function testAuth(accessToken: string) {
  try {
    if (FEATURES.VERBOSE_LOGGING) console.log('🔐 Testing authentication...');
    const res = await fetch(`${BASE}/test-auth`, {
      headers: headers(accessToken),
    });
    const data = await res.json();
    if (FEATURES.VERBOSE_LOGGING) console.log('🔐 Auth test response:', data);
    if (!res.ok) throw new Error(data.error || 'Auth test failed');
    return data as { success: boolean; message: string; userId: string; timestamp: string };
  } catch (err) {
    console.error('❌ Auth test failed:', {
      error: err,
      message: err instanceof Error ? err.message : String(err),
      BASE,
      accessToken: accessToken ? 'present' : 'missing',
    });
    throw err;
  }
}

export async function healthCheck() {
  try {
    if (FEATURES.VERBOSE_LOGGING) {
      console.log('🏥 Performing health check...');
      console.log('🏥 Target URL:', `${BASE}/health`);
      console.log('🏥 BASE constant:', BASE);
      console.log('🏥 Headers:', headers());
    }
    
    const res = await fetch(`${BASE}/health`, {
      headers: headers(),
    });
    
    if (FEATURES.VERBOSE_LOGGING) {
      console.log('🏥 Response status:', res.status, res.statusText);
      console.log('🏥 Response headers:', Object.fromEntries(res.headers.entries()));
    }
    
    const text = await res.text();
    if (FEATURES.VERBOSE_LOGGING) console.log('🏥 Response text:', text);
    
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ Failed to parse health check response as JSON');
      throw new Error(`Invalid JSON response (status ${res.status}): ${text.substring(0, 100)}`);
    }
    
    if (FEATURES.VERBOSE_LOGGING) console.log('🏥 Health check response:', data);
    if (!res.ok) throw new Error(data.error || 'Health check failed');
    return data as { status: string; timestamp: string; kvStore: string };
  } catch (err) {
    console.error('❌ Health check failed:', {
      error: err,
      message: err instanceof Error ? err.message : String(err),
      BASE,
    });
    throw err;
  }
}

export async function getDiagnostics(accessToken: string) {
  try {
    if (FEATURES.VERBOSE_LOGGING) {
      console.log('🔍 Fetching diagnostics from:', `${BASE}/diagnostic`);
      console.log('   Access token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'MISSING');
    }
    
    let res;
    try {
      res = await fetch(`${BASE}/diagnostic`, {
        headers: headers(accessToken),
      });
      if (FEATURES.VERBOSE_LOGGING) console.log('📥 Response received - status:', res.status, res.statusText);
    } catch (fetchErr: any) {
      console.error('❌ Fetch failed (network error or CORS):', fetchErr);
      console.error('   Fetch error name:', fetchErr?.name);
      console.error('   Fetch error message:', fetchErr?.message);
      console.error('   Fetch error stack:', fetchErr?.stack?.substring(0, 200));
      throw new Error(`Network request failed: ${fetchErr?.message || 'Unknown network error'}. Check server logs and CORS configuration.`);
    }
    
    let data;
    try {
      const text = await res.text();
      if (FEATURES.VERBOSE_LOGGING) console.log('📄 Response text (first 500 chars):', text.substring(0, 500));
      data = JSON.parse(text);
      if (FEATURES.VERBOSE_LOGGING) console.log('📦 Response data parsed:', data);
    } catch (jsonErr: any) {
      console.error('❌ Failed to parse JSON response:', jsonErr);
      throw new Error(`Server returned invalid JSON (status: ${res.status}). Server may be down or returning HTML error page.`);
    }
    
    if (!res.ok) {
      const errorMsg = data.error || data.message || 'Diagnostics failed';
      console.error('❌ Server error:', errorMsg);
      throw new Error(errorMsg);
    }
    return data;
  } catch (err: any) {
    console.error('❌ Diagnostics failed:', {
      error: err,
      errorName: err?.name,
      errorConstructor: err?.constructor?.name,
      message: err?.message,
      stack: err?.stack?.substring(0, 200),
      BASE,
      accessToken: accessToken ? 'present' : 'missing',
    });
    throw err;
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Submission {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  industryId: string;
  employees: string;
  revenue: string;
  submittedAt: string;
  submittedDate: string;
  status: 'new' | 'in-review' | 'completed' | 'approved';
  priority: 'low' | 'medium' | 'high';
  completionScore: number;
  qualityScore: number;
  aiScore: number;
  roiPotential: string;
  answers: Record<number, string | number>;
  isRead: boolean;
  assignedTo?: string;
  updatedAt?: string;
  engagement?: {
    reportViewCount: number;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    ctaClickedAt: string | null;
    pdfPrintedAt: string | null;
  };
}

// ============================================================================
// TEAM AUTH
// ============================================================================

export async function teamLogin(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/team/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data as { success: boolean; accessToken: string; user: { id: string; email: string; name: string } };
}

// ============================================================================
// CLIENT AUTH
// ============================================================================

export async function verifyClientEmail(email: string) {
  const res = await fetch(`${BASE}/auth/client/verify`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data as { exists: boolean; submissionId?: string; companyName?: string; sessionToken?: string };
}

// ============================================================================
// SUBMISSIONS
// ============================================================================

export interface SubmissionPayload {
  contactName: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  answers: Record<number, string | number>;
  /** Pass the client-computed readinessScore so server stores the same number */
  readinessScore?: number;
}

export async function createSubmission(payload: SubmissionPayload) {
  const res = await fetch(`${BASE}/submissions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save submission');
  return data as { success: boolean; submissionId: string };
}

export async function getSubmissions(accessToken: string) {
  try {
    if (FEATURES.VERBOSE_LOGGING) {
      console.log('📤 Fetching submissions from:', `${BASE}/submissions`);
      console.log('   Access token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'MISSING');
      console.log('   Headers:', headers(accessToken));
    }
    
    let res;
    try {
      res = await fetch(`${BASE}/submissions`, {
        headers: headers(accessToken),
      });
      if (FEATURES.VERBOSE_LOGGING) {
        console.log('📥 Response received - status:', res.status, res.statusText);
        console.log('   Response headers:', Object.fromEntries(res.headers.entries()));
      }
    } catch (fetchErr) {
      console.error('❌ Fetch failed (network error or CORS):', fetchErr);
      console.error('   Fetch error type:', typeof fetchErr);
      console.error('   Fetch error name:', fetchErr?.constructor?.name);
      console.error('   Fetch error message:', fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
      throw new Error(`Network request failed: ${fetchErr instanceof Error ? fetchErr.message : 'Unknown network error'}. Check if server is running and CORS is configured.`);
    }
    
    let data;
    try {
      const text = await res.text();
      if (FEATURES.VERBOSE_LOGGING) console.log('📄 Response text (first 500 chars):', text.substring(0, 500));
      data = JSON.parse(text);
      if (FEATURES.VERBOSE_LOGGING) console.log('📦 Response data parsed:', data);
    } catch (jsonErr) {
      console.error('❌ Failed to parse JSON response:', jsonErr);
      throw new Error(`Server returned invalid JSON (status: ${res.status})`);
    }
    
    if (!res.ok) {
      const errorMsg = data.error || data.details || 'Failed to fetch submissions';
      console.error('❌ Server error:', errorMsg);
      throw new Error(errorMsg);
    }
    return data as { success: boolean; submissions: Submission[]; total: number };
  } catch (err) {
    console.error('getSubmissions error details:', {
      error: err,
      errorName: err?.constructor?.name,
      message: err instanceof Error ? err.message : String(err),
      BASE,
      accessToken: accessToken ? 'present' : 'missing',
      type: typeof err,
    });
    throw new Error(`Failed to fetch submissions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function updateSubmissionStatus(
  id: string,
  accessToken: string,
  updates: { status?: string; priority?: string; assignedTo?: string },
) {
  const res = await fetch(`${BASE}/submissions/${id}/status`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update submission');
  return data as { success: boolean; submission: Submission };
}

export async function bulkUpdateSubmissions(
  ids: string[],
  updates: { status?: string; priority?: string; assignedTo?: string },
  accessToken: string,
) {
  const res = await fetch(`${BASE}/submissions/bulk`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify({ ids, ...updates }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Bulk update failed');
  return data as { success: boolean; updated: number };
}

export async function getClientSubmission(
  submissionId: string,
  auth?: ClientAuthContext,
) {
  const url = new URL(`${BASE}/client/submission/${submissionId}`);
  withEmailQuery(url, auth);
  const res = await fetch(url.toString(), {
    headers: clientHeaders(auth),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Submission not found');
  return data as { success: boolean; submission: Submission };
}

export type EngagementEventType =
  | 'report_viewed'
  | 'cta_clicked'
  | 'pdf_printed'
  | 'portal_opened'
  | 'proposal_viewed'
  | 'meeting_scheduled'
  | 'message_sent';

export interface EngagementEvent {
  id:    string;
  type:  EngagementEventType;
  at:    string;
  meta?: Record<string, any>;
}

export async function trackEngagement(
  submissionId: string,
  type: EngagementEventType,
  meta?: Record<string, any>,
  auth?: ClientAuthContext,
) {
  if (!FEATURES.BACKEND_INTEGRATION) return; // Skip in demo mode
  try {
    await fetch(`${BASE}/client/submission/${submissionId}/engagement`, {
      method: 'POST',
      headers: clientHeaders(auth),
      body: JSON.stringify({ type, ...(meta ? { meta } : {}) }),
    });
  } catch {
    // Engagement tracking is non-critical — silently swallow errors
  }
}

export async function getEngagementLog(submissionId: string, auth?: ClientAuthContext) {
  const url = new URL(`${BASE}/client/submission/${submissionId}/engagement/log`);
  withEmailQuery(url, auth);
  const res = await fetch(url.toString(), {
    headers: clientHeaders(auth),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch engagement log');
  return data as { success: boolean; events: EngagementEvent[] };
}

// 13E: batch fetch latest engagement event per submission (team auth)
export async function getEngagementSummary(
  accessToken: string,
  submissionIds: string[],
): Promise<{ success: boolean; summary: Record<string, EngagementEvent | null> }> {
  if (!submissionIds.length) return { success: true, summary: {} };
  const qs  = encodeURIComponent(submissionIds.join(','));
  const res = await fetch(`${BASE}/cortex/engagement-summary?ids=${qs}`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch engagement summary');
  return data;
}

export async function getAnalytics(accessToken: string) {
  const res = await fetch(`${BASE}/analytics/overview`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Analytics error');
  return data;
}

export async function getEngagementAnalytics(accessToken: string) {
  const res = await fetch(`${BASE}/analytics/engagement`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Engagement analytics error');
  return data as { success: boolean; engagement: EngagementAnalytics };
}

export interface EngagementAnalytics {
  reportDelivery: {
    reportAvailable: number;
    totalViewed: number;
    totalCTAClicked: number;
    totalPDFSaved: number;
    totalViews: number;
    avgViewsPerViewed: number;
    viewRate: number;
    ctaRate: number;
    pdfRate: number;
  };
  notes: {
    total: number;
    submissionsWithNotes: number;
    byType: Record<string, number>;
    topCommented: { id: string; company: string; count: number }[];
  };
  topEngagedLeads: {
    id: string;
    company: string;
    industry: string;
    status: string;
    viewCount: number;
    lastViewedAt: string | null;
    ctaClicked: boolean;
    pdfSaved: boolean;
    noteCount: number;
    engagementScore: number;
  }[];
  recentActivity: {
    type: string;
    company: string;
    detail: string;
    timestamp: string;
    submissionId: string;
  }[];
}

// ============================================================================
// MESSAGING
// ============================================================================

export interface Message {
  id: string;
  submissionId: string;
  author: 'client' | 'team';
  authorName: string;
  content: string;
  createdAt: string;
}

/** Client reads the full thread (client auth) */
export async function getClientMessages(submissionId: string, auth?: ClientAuthContext) {
  const url = new URL(`${BASE}/submissions/${submissionId}/messages`);
  withEmailQuery(url, auth);
  const res = await fetch(url.toString(), {
    headers: clientHeaders(auth),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch messages');
  return data as { success: boolean; messages: Message[] };
}

/** Client posts a new message (client auth) */
export async function postClientMessage(
  submissionId: string,
  content: string,
  clientName: string,
  auth?: ClientAuthContext,
) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/messages`, {
    method: 'POST',
    headers: clientHeaders(auth),
    body: JSON.stringify({ content, clientName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return data as { success: boolean; message: Message };
}

/** Team reads the full thread + unread count (team auth) */
export async function getTeamMessages(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/messages/team`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch messages');
  return data as { success: boolean; messages: Message[]; unreadFromClient: number };
}

/** Team posts a reply (team auth) */
export async function postTeamReply(
  submissionId: string,
  content: string,
  accessToken: string,
  authorName: string,
) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/messages/team`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ content, authorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send reply');
  return data as { success: boolean; message: Message };
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export interface AppNotification {
  id: string;
  type: 'new_submission' | 'status_change' | 'urgent';
  title: string;
  message: string;
  submissionId: string;
  createdAt: string;
  read: boolean;
  meta?: Record<string, string>;
}

export async function getNotifications(accessToken: string) {
  try {
    if (FEATURES.VERBOSE_LOGGING) {
      console.log('📤 Fetching notifications from:', `${BASE}/notifications`);
      console.log('   Access token:', accessToken ? `${accessToken.substring(0, 20)}...` : 'MISSING');
    }
    
    let res;
    try {
      res = await fetch(`${BASE}/notifications`, {
        headers: headers(accessToken),
      });
      if (FEATURES.VERBOSE_LOGGING) console.log('📥 Response received - status:', res.status, res.statusText);
    } catch (fetchErr) {
      console.error('❌ Fetch failed (network error or CORS):', fetchErr);
      console.error('   Fetch error message:', fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
      throw new Error(`Network request failed: ${fetchErr instanceof Error ? fetchErr.message : 'Unknown network error'}`);
    }
    
    let data;
    try {
      const text = await res.text();
      if (FEATURES.VERBOSE_LOGGING) console.log('📄 Response text (first 500 chars):', text.substring(0, 500));
      data = JSON.parse(text);
      if (FEATURES.VERBOSE_LOGGING) console.log('📦 Response data parsed:', data);
    } catch (jsonErr) {
      console.error('❌ Failed to parse JSON response:', jsonErr);
      throw new Error(`Server returned invalid JSON (status: ${res.status})`);
    }
    
    if (!res.ok) {
      const errorMsg = data.error || data.details || 'Failed to fetch notifications';
      console.error('❌ Server error:', errorMsg);
      throw new Error(errorMsg);
    }
    return data as { success: boolean; notifications: AppNotification[]; unreadCount: number };
  } catch (err) {
    console.error('getNotifications error details:', {
      error: err,
      errorName: err?.constructor?.name,
      message: err instanceof Error ? err.message : String(err),
      BASE,
      accessToken: accessToken ? 'present' : 'missing',
      type: typeof err,
    });
    throw new Error(`Failed to fetch notifications: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function markNotificationsRead(accessToken: string) {
  const res = await fetch(`${BASE}/notifications/read`, {
    method: 'POST',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to mark notifications read');
  return data as { success: boolean };
}

// ============================================================================
// NOTES
// ============================================================================

export interface Note {
  id: string;
  kvKey: string;
  submissionId: string;
  content: string;
  type: 'note' | 'action' | 'flag' | 'insight';
  authorName: string;
  authorEmail: string;
  createdAt: string;
}

export async function getNotes(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/notes`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch notes');
  return data as { success: boolean; notes: Note[] };
}

export async function addNote(
  submissionId: string,
  content: string,
  type: Note['type'],
  accessToken: string,
) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/notes`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ content, type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add note');
  return data as { success: boolean; note: Note };
}

export async function deleteNote(
  submissionId: string,
  noteId: string,
  accessToken: string,
) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/notes/${noteId}`, {
    method: 'DELETE',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete note');
  return data as { success: boolean };
}

// ============================================================================
// PROPOSALS
// ============================================================================

export async function getProposal(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/proposal`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch proposal');
  return data as { success: boolean; proposal: any | null };
}

export async function saveProposal(submissionId: string, proposal: any, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/proposal`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(proposal),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save proposal');
  return data as { success: boolean; proposal: any };
}

export async function sendProposal(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/proposal/send`, {
    method: 'POST',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send proposal');
  return data as { success: boolean; proposal: any };
}

export async function getClientProposal(submissionId: string, auth?: ClientAuthContext) {
  const url = new URL(`${BASE}/client/submission/${submissionId}/proposal`);
  withEmailQuery(url, auth);
  const res = await fetch(url.toString(), {
    headers: clientHeaders(auth),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch proposal');
  return data as { success: boolean; proposal: any | null };
}

export async function respondToProposal(
  submissionId: string,
  response: 'accepted' | 'rejected',
  clientName?: string,
  auth?: ClientAuthContext,
) {
  const res = await fetch(`${BASE}/client/submission/${submissionId}/proposal/respond`, {
    method: 'POST',
    headers: clientHeaders(auth),
    body: JSON.stringify({ response, clientName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to respond to proposal');
  return data as { success: boolean; proposal: any };
}

// ============================================================================
// PROPOSAL ANNOTATIONS — 13B
// ============================================================================

export interface ProposalAnnotation {
  id:           string;
  submissionId: string;
  sectionKey:   string;
  selectedText: string;
  comment:      string;
  author:       string;
  color:        string;  // hex
  createdAt:    string;  // ISO
}

export async function getProposalAnnotations(submissionId: string) {
  const res = await fetch(`${BASE}/proposal/annotations/${submissionId}`, {
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch annotations');
  return data as { success: boolean; annotations: ProposalAnnotation[] };
}

export async function createProposalAnnotation(
  submissionId: string,
  payload: Omit<ProposalAnnotation, 'id' | 'submissionId' | 'createdAt'>,
) {
  const res = await fetch(`${BASE}/proposal/annotations/${submissionId}`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create annotation');
  return data as { success: boolean; annotation: ProposalAnnotation };
}

export async function deleteProposalAnnotation(submissionId: string, annotationId: string) {
  const res = await fetch(`${BASE}/proposal/annotations/${submissionId}/${annotationId}`, {
    method:  'DELETE',
    headers: headers(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete annotation');
  return data as { success: boolean };
}

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

export interface TeamMemberRecord {
  id: string;
  email: string;
  name: string;
  teamRole: 'admin' | 'reviewer' | 'viewer';
  status: 'active' | 'pending';
  joinedDate: string;
  lastActive: string | null;
  isSelf: boolean;
}

export async function getTeamMembers(accessToken: string) {
  const res = await fetch(`${BASE}/team/members`, { headers: headers(accessToken) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch team members');
  return data as { success: boolean; members: TeamMemberRecord[] };
}

export async function inviteTeamMember(
  payload: { name: string; email: string; teamRole: string; tempPassword?: string },
  accessToken: string,
) {
  const res = await fetch(`${BASE}/team/invite`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to invite team member');
  return data as { success: boolean; member: TeamMemberRecord; tempPassword: string };
}

export async function updateTeamMember(
  id: string,
  updates: { name?: string; teamRole?: string },
  accessToken: string,
) {
  const res = await fetch(`${BASE}/team/members/${id}`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update team member');
  return data as { success: boolean; member: TeamMemberRecord };
}

export async function removeTeamMember(id: string, accessToken: string) {
  const res = await fetch(`${BASE}/team/members/${id}`, {
    method: 'DELETE',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to remove team member');
  return data as { success: boolean };
}

// ============================================================================
// SETTINGS
// ============================================================================

export interface PlatformSettings {
  brandingName: string;
  defaultAssignee: string;
  autoAssign: boolean;
  notificationPrefs: {
    newSubmission: boolean;
    reportReady: boolean;
    teamActivity: boolean;
    weeklyDigest: boolean;
    proposalViewed: boolean;
    proposalAccepted: boolean;
    messageReceived: boolean;
  };
  updatedAt?: string;
}

export interface SettingsResponse {
  success: boolean;
  currentUser: { id: string; email: string; name: string; teamRole: string };
  platformSettings: PlatformSettings;
  health: {
    submissionCounts: { new: number; 'in-review': number; completed: number; approved: number; total: number };
    serverTime: string;
    recentActivity: any[];
  };
}

export async function getPlatformSettings(accessToken: string) {
  const res = await fetch(`${BASE}/settings`, { headers: headers(accessToken) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load settings');
  return data as SettingsResponse;
}

export async function savePlatformSettings(
  payload: { platformSettings?: Partial<PlatformSettings>; profileName?: string },
  accessToken: string,
) {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save settings');
  return data as { success: boolean };
}

export async function sendTestEmailRequest(accessToken: string) {
  const res = await fetch(`${BASE}/test-email`, {
    method: 'POST',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send test email');
  return data as { success: boolean; sent: boolean; resendKeyConfigured: boolean; to: string };
}

export async function sendWeeklyDigestRequest(accessToken: string) {
  const res = await fetch(`${BASE}/email/weekly-digest`, {
    method: 'POST',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send weekly digest');
  return data as { success: boolean; to?: string; reason?: string };
}

export async function getEmailStatus(accessToken: string) {
  const res = await fetch(`${BASE}/email/status`, {
    method: 'GET',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to check email status');
  return data as { success: boolean; resendConfigured: boolean; fromAddress: string; note: string };
}

// ============================================================================
// CORTEX AI ANALYSIS
// ============================================================================

export interface CortexAnalysisResult {
  submissionId: string;
  analyzedAt: string;
  model: string;
  status: 'complete' | 'pending' | 'error';
  urgencyLevel: number;
  impactPotential: number;
  readinessScore: 'Low' | 'Medium' | 'High';
  confidenceScore: 'Low' | 'Medium' | 'High' | 'Very High';
  primaryPainSignal: string;
  aiScore: number;
  qualityScore: number;
  priority: 'low' | 'medium' | 'high';
  coreProblems: {
    title: string;
    whatsbroken: string;
    whyBreaking: string;
    whatBreaksNext: string;
    urgencyScore: number;
    editable: boolean;
  }[];
  pillarHeatmap: {
    operationsExecution: number;
    revenueGrowth: number;
    systemsAutomation: number;
    aiReadinessGovernance: number;
  };
  riskFlags: {
    type: string;
    label: string;
    description: string;
    severity: 'critical' | 'high' | 'medium';
  }[];
  recommendation: {
    primaryService: string;
    primaryServiceLabel: string;
    reasoning: string;
    notRecommended: { service: string; reason: string }[];
    focusAreas: string[];
    suggestedTimeline: string;
    recommendationStatus: 'pending';
  };
  roiEstimate: {
    hoursSavedPerMonth: { conservative: number; aggressive: number };
    costAvoidedPerMonth: { conservative: number; aggressive: number };
    revenueLeakageReduced: { conservative: number; aggressive: number };
    operationalRiskReduction: 'low' | 'medium' | 'high' | 'very-high';
    notes: string;
    confidenceLevel: 'conservative';
  };
  callPrep: {
    leadId: string;
    suggestedAgenda: string[];
    keyQuestionsToValidate: string[];
    expectedObjections: { objection: string; response: string }[];
    doNotPitchYetWarnings: string[];
    expansionSignalsToListenFor: string[];
  };
  analysisNotes: string;
}

/** Fetch previously stored CORTEX AI analysis for a submission */
export async function getCortexAnalysis(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/cortex`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch cortex analysis');
  return data as { success: boolean; analysis: CortexAnalysisResult | null };
}

/** Trigger CORTEX AI analysis for a submission (calls OpenAI) */
export async function analyzeSubmission(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/analyze`, {
    method: 'POST',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = data.error || 'Analysis failed';
    const extended = (data as any).keyMissing ? Object.assign(new Error(err), { keyMissing: true }) : new Error(err);
    throw extended;
  }
  return data as { success: boolean; analysis: CortexAnalysisResult };
}

/** Clear stored CORTEX analysis so it can be re-run */
export async function clearCortexAnalysis(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/cortex`, {
    method: 'DELETE',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to clear cortex analysis');
  return data as { success: boolean };
}

// ============================================================================
// CLIENT REPORT (AI-powered, public)
// ============================================================================

/**
 * Fetch AI-powered client report for a submission.
 * Returns null report if the submission hasn't been AI-analyzed yet.
 */
export async function getClientReport(submissionId: string, auth?: ClientAuthContext) {
  const url = new URL(`${BASE}/client/submission/${submissionId}/report`);
  withEmailQuery(url, auth);
  const res = await fetch(url.toString(), {
    headers: clientHeaders(auth),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch client report');
  return data as { success: boolean; report: ClientReportPayload | null; aiPowered: boolean };
}

/** Shape of the AI-enriched client report returned by the server */
export interface ClientReportPayload {
  companyName: string;
  industry: string;
  generatedDate: string;
  contactName: string;
  contactEmail: string;
  readinessLevel: 'Low' | 'Medium' | 'High';
  readinessInterpretation: string;
  whatThisMeans: string[];
  immediateRisk: string;
  coreIssues: {
    title: string;
    problem: string;
    whyItExists: string;
    businessImpact: string[];
  }[];
  operationalHeatmap: {
    operationsExecution: { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    revenueGrowth:       { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    systemsAutomation:   { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
    aiReadiness:         { score: 'red' | 'yellow' | 'green'; label: string; explanation: string };
  };
  highImpactAI: string[];
  shouldNotAutomate: string[];
  recommendedService: string;
  whyFirst: string;
  whatItUnlocks: string;
  impactRange: {
    hoursSavedPerMonth: string;
    costLeakageReduced: string;
    revenueAcceleration: string;
    disclaimer: string;
  };
  callSchedulingUrl: string;
}

// ============================================================================
// CORTEX STATUS (team auth)
// ============================================================================

export interface CortexStatusEntry {
  analyzedAt: string;
  aiScore: number;
  model: string;
  priority: string;
}

/** Fetch a map of submissionId → { analyzedAt, aiScore, model } for all AI-analyzed submissions */
export async function getCortexStatus(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/status`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch cortex status');
  return data as { success: boolean; analyzed: Record<string, CortexStatusEntry>; count: number };
}

// ============================================================================
// BATCH ANALYZE (team auth)
// ============================================================================

export interface BatchAnalyzeResult {
  id: string;
  success: boolean;
  aiScore?: number;
  error?: string;
}

/** Run AI analysis on multiple submissions (max 10, processes sequentially) */
export async function analyzeSubmissionsBatch(ids: string[], accessToken: string) {
  const res = await fetch(`${BASE}/submissions/analyze-batch`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = data.error || 'Batch analysis failed';
    const extended = (data as any).keyMissing ? Object.assign(new Error(err), { keyMissing: true }) : new Error(err);
    throw extended;
  }
  return data as { success: boolean; results: BatchAnalyzeResult[]; analyzed: number; total: number };
}

// ============================================================================
// OUTCOME LOGGING
// ============================================================================

export interface OutcomePayload {
  didConvert: boolean;
  conversionValue?: number | null;
  lostReason?: string | null;
  recommendationWorked?: boolean | null;
  whatWeLearned?: string;
  improvementAreas?: string[];
}

export interface OutcomeRecord extends OutcomePayload {
  submissionId: string;
  loggedAt: string;
  loggedBy: string;
  industry: string;
  company: string;
  aiScore: number;
  recommendedService: string;
  submittedAt: string;
}

/** Log a deal outcome (win or loss) for a submission */
export async function logOutcome(submissionId: string, payload: OutcomePayload, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/outcome`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to log outcome');
  return data as { success: boolean; outcome: OutcomeRecord };
}

/** Fetch the stored outcome for a submission */
export async function getOutcome(submissionId: string, accessToken: string) {
  const res = await fetch(`${BASE}/submissions/${submissionId}/outcome`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch outcome');
  return data as { success: boolean; outcome: OutcomeRecord | null };
}

/** Fetch all outcomes as a submissionId → summary map (for lead card badges) */
export async function getOutcomesMap(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/outcomes`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch outcomes map');
  return data as { success: boolean; outcomes: Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }>; count: number };
}

// ============================================================================
// LEARNING LOOP
// ============================================================================

export interface ScoreBand {
  range: string;
  total: number;
  converted: number;
  rate: number | null;
}

export interface LearningLoopData {
  totalOutcomes: number;
  totalConverted: number;
  totalLost: number;
  conversionRate: number;
  totalRevenue: number;
  avgDealSize: number;
  recommendationAccuracy: number | null;
  avgDaysToClose: number | null;
  byIndustry: {
    industry: string;
    total: number;
    converted: number;
    conversionRate: number;
    avgDealSize: number;
  }[];
  scoreCorrelation: {
    highScore: ScoreBand;
    midScore: ScoreBand;
    lowScore: ScoreBand;
  };
  topLostReasons: { reason: string; count: number }[];
  recentOutcomes: {
    submissionId: string;
    company: string;
    industry: string;
    didConvert: boolean;
    conversionValue: number | null;
    recommendedService: string;
    recommendationWorked: boolean | null;
    aiScore: number;
    loggedAt: string;
  }[];
  improvementAreas: { area: string; count: number }[];
}

/** Fetch aggregated learning loop intelligence */
export async function getLearningLoop(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/learning-loop`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch learning loop');
  return data as { success: boolean; data: LearningLoopData | null; isEmpty: boolean };
}

// ============================================================================
// PIPELINE POSITIONS — kanban board layout persistence (team auth)
// ============================================================================

/** Fetch the full saved pipeline positions map (submissionId → columnId) */
export async function getPipelinePositions(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/pipeline-positions`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch pipeline positions');
  return data as { success: boolean; positions: Record<string, string>; count: number };
}

/** Save a single card's column position after a drag-and-drop */
export async function savePipelinePosition(submissionId: string, columnId: string, accessToken: string) {
  const res = await fetch(`${BASE}/cortex/pipeline-positions`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ submissionId, columnId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save pipeline position');
  return data as { success: boolean; positions: Record<string, string> };
}

/** Bulk-save pipeline positions (used on initial mount to seed defaults) */
export async function savePipelinePositions(positions: Record<string, string>, accessToken: string) {
  const res = await fetch(`${BASE}/cortex/pipeline-positions`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ positions }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save pipeline positions');
  return data as { success: boolean; positions: Record<string, string> };
}

/** Reset all saved pipeline positions (clears the KV entry) */
export async function resetPipelinePositions(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/pipeline-positions`, {
    method: 'DELETE',
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to reset pipeline positions');
  return data as { success: boolean };
}

// ============================================================================
// COLUMN CAPACITIES — WIP limits per kanban column (team auth)
// ============================================================================

/** Fetch the stored column capacity map { columnId → maxCards (0 = unlimited) } */
export async function getColumnCapacities(accessToken: string) {
  const res = await fetch(`${BASE}/cortex/column-capacities`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch column capacities');
  return data as { success: boolean; capacities: Record<string, number> };
}

/** Persist the full column capacity map */
export async function saveColumnCapacities(capacities: Record<string, number>, accessToken: string) {
  const res = await fetch(`${BASE}/cortex/column-capacities`, {
    method: 'PUT',
    headers: headers(accessToken),
    body: JSON.stringify({ capacities }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save column capacities');
  return data as { success: boolean; capacities: Record<string, number> };
}

// ============================================================================
// EMAIL NURTURE QUEUE
// ============================================================================

export interface QueuedEmailPayload {
  id: string;
  templateId: string;
  subject: string;
  previewText: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
  readinessScore?: number;
  bottleneckTheme?: string;
}

/** Enqueue nurture emails for a submission */
export async function enqueueEmails(
  payload: {
    submissionId: string;
    contactName: string;
    contactEmail: string;
    companyName: string;
    industry: string;
    readinessScore: number;
    bottleneckTheme: string;
    emails: QueuedEmailPayload[];
  },
) {
  const res = await fetch(`${BASE}/email-queue`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to enqueue emails');
  return data as { success: boolean; queued: number };
}

/** Fetch all queued emails (team auth) */
export async function getEmailQueue(accessToken: string) {
  const res = await fetch(`${BASE}/email-queue`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch email queue');
  return data as { success: boolean; emails: any[]; total: number };
}

/** Update email status (team auth) */
export async function updateEmailStatus(
  emailId: string,
  status: 'sent' | 'skipped' | 'failed',
  accessToken: string,
) {
  const res = await fetch(`${BASE}/email-queue/${emailId}`, {
    method: 'PATCH',
    headers: headers(accessToken),
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update email status');
  return data as { success: boolean; email?: any };
}

// ============================================================================
// CORTEX NARRATIVE GENERATION — GPT-4o-mini explanation layers
// ============================================================================

export interface NarrativeContext {
  company: string;
  industry: string;
  employee_estimate: number;
  current_version: string;
  assumptions: Record<string, number>;
  top_recommendation?: {
    problem_title: string;
    severity_score: number;
    pillar_impact: string[];
    confidence_score: number;
    priority_score: {
      impact_score: number;
      feasibility_score: number;
      risk_score: number;
      computed_priority: number;
    };
    why_first: string;
    evidence_strength?: {
      validated_signals: number;
      cross_department_validations: number;
      contradiction_flags: number;
    };
  };
  recommendation_count: number;
}

export interface NarrativeResponse {
  success: boolean;
  type: string;
  narrative: string;
  model: string;
  generated_at: string;
  error?: string;
  keyMissing?: boolean;
}

/** Generate a GPT-4o-mini narrative explanation for a portfolio state */
export async function generateCortexNarrative(
  type: 'why_now' | 'confidence_reasoning' | 'strategic_decision',
  context: NarrativeContext,
  accessToken: string,
): Promise<NarrativeResponse> {
  const res = await fetch(`${BASE}/cortex/narrative`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ type, context }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Narrative generation failed') as any;
    err.keyMissing = data.keyMissing;
    throw err;
  }
  return data as NarrativeResponse;
}

// ============================================================================
// GLOBAL AI CHAT — conversational AI for any section (team auth)
// ============================================================================

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatLeadContext {
  companyName: string;
  industry: string;
  companySize: string;
  primaryPainSignal: string;
  recommendedService?: string;
  roiSummary?: string;
}

export interface AIChatRequest {
  message: string;
  section: string;
  sectionLabel: string;
  sectionContent?: string;
  lead?: AIChatLeadContext;
  history: AIChatMessage[];
}

export interface AIChatResponse {
  success: boolean;
  reply: string;
  applyContent?: string;
  model: string;
  generated_at: string;
  error?: string;
  keyMissing?: boolean;
}

export async function chatWithAI(
  req: AIChatRequest,
  accessToken: string,
): Promise<AIChatResponse> {
  const res = await fetch(`${BASE}/ai/chat`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(req),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'AI chat failed') as any;
    err.keyMissing = data.keyMissing;
    throw err;
  }
  return data as AIChatResponse;
}

// ============================================================================
// BLOCK AI ASSIST + COPILOT — per-block AI actions (team auth)
// ============================================================================

export type BlockAIAction = 'ai_improve' | 'ai_expand' | 'ai_simplify' | 'fix_issues';

export interface BlockAIAssistRequest {
  block_id:        string;
  block_type:      string;
  title:           string;
  current_content: Record<string, unknown>;
  action:          BlockAIAction;
  context: {
    company:           string;
    industry:          string;
    tone:              string;
    roi_snapshot?:     Record<string, unknown>;
    scope_boundaries?: Record<string, unknown>;
    linked_diagnoses?: Record<string, unknown>[];
  };
}

export interface BlockAIAssistResponse {
  proposed_content: Record<string, unknown>;
  diff_summary:     string;
  change_type:      BlockAIAction;
  model:            string;
  generated_at:     string;
  error?:           string;
  keyMissing?:      boolean;
}

export async function blockAIAssist(
  req: BlockAIAssistRequest,
  accessToken: string,
): Promise<BlockAIAssistResponse> {
  const res = await fetch(`${BASE}/blocks/ai-assist`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(req),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Block AI assist failed') as Error & { keyMissing?: boolean };
    err.keyMissing = data.keyMissing;
    throw err;
  }
  return data as BlockAIAssistResponse;
}

export type CopilotPatchIntent =
  | 'rewrite_tone'
  | 'expand_detail'
  | 'simplify_client_view'
  | 'fix_ready_gate_failures'
  | 'align_solution_to_diagnosis'
  | 'generate_missing_blocks'
  | 'summarize_for_email';

export interface CopilotBlockSummary {
  block_id:    string;
  block_type:  string;
  title:       string;
  status:      string;
  has_pending: boolean;
  is_locked:   boolean;
}

export interface CopilotInterpretRequest {
  user_input:      string;
  scope:           string;
  entity_id:       string;
  block_summaries: CopilotBlockSummary[];
  context: {
    company:  string;
    industry: string;
  };
}

export interface CopilotPatchTarget {
  block_id:    string;
  block_type:  string;
  title:       string;
  action:      BlockAIAction;
  rationale:   string;
  constraints: {
    tone?:         string;
    do_not_change: string[];
  };
}

export interface CopilotInterpretResponse {
  intent:              CopilotPatchIntent;
  intent_label:        string;
  targets:             CopilotPatchTarget[];
  skipped:             Array<{ block_id: string; title: string; reason: string }>;
  roi_recalc_required: boolean;
  error?:              string;
  keyMissing?:         boolean;
}

export async function copilotInterpret(
  req: CopilotInterpretRequest,
  accessToken: string,
): Promise<CopilotInterpretResponse> {
  const res = await fetch(`${BASE}/blocks/copilot-interpret`, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(req),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Copilot interpret failed') as Error & { keyMissing?: boolean };
    err.keyMissing = data.keyMissing;
    throw err;
  }
  return data as CopilotInterpretResponse;
}

// ============================================================================
// LEAD CAPTURE
// ============================================================================

export interface LeadCapturePayload {
  name?: string;
  email: string;
  phone?: string;
  website?: string;
}

export async function captureLead(payload: LeadCapturePayload) {
  try {
    if (FEATURES.VERBOSE_LOGGING) console.log('📧 Capturing lead...', payload.email);
    const res = await fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lead capture failed');
    return data as { success: boolean; leadId: string };
  } catch (err) {
    console.error('❌ Lead capture failed:', {
      error: err,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function captureExitIntentLead(email: string) {
  try {
    if (FEATURES.VERBOSE_LOGGING) console.log('🎯 Capturing exit-intent lead...', email);
    const res = await fetch(`${BASE}/leads/exit-intent`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Exit-intent capture failed');
    return data as { success: boolean; leadId: string; alreadyExists?: boolean };
  } catch (err) {
    console.error('❌ Exit-intent capture failed:', {
      error: err,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}