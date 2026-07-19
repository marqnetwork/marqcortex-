import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";
import {
  sendTeamNewSubmissionEmail,
  sendClientUnderReviewEmail,
  sendClientReportReadyEmail,
  sendProposalSentEmail,
  sendTeamProposalViewedEmail,
  sendProposalRespondedEmail,
  sendNewClientMessageEmail,
  sendTeamReplyEmail,
  sendWeeklyDigestEmail,
  sendTestEmail,
  isResendConfigured,
  sendNurtureEmail,
} from "./emailService.ts";
import { runCortexAnalysis } from "./cortexAnalysis.ts";
import { generateNarrative, type NarrativeRequest } from "./cortexNarrative.ts";
import { handleBlockAIAssist, type BlockAIAssistRequest } from "./blockAiAssist.ts";
import { handleCopilotInterpret, type CopilotInterpretRequest } from "./copilotPatch.ts";
import {
  handleProposalSectionCopilot,
  VALID_SECTIONS,
  VALID_ACTIONS,
  type ProposalSectionCopilotRequest,
} from "./proposalSectionCopilot.ts";
import {
  deriveDealSnapshots,
  summarizeSnapshots,
  type RawSubmission,
  type RawProposal,
  type RawOutcome,
  type RawEscalation,
} from "./revenueSnapshot.ts";
import { handleCortexChat, type ChatRequest } from "./cortexChat.ts";
import { resolveAdminSeed } from "./adminSeedPolicy.ts";
import {
  normalizeBooking,
  migrateBookingRecord,
  type BookingRecord,
} from "./bookings/bookingRecord.ts";

const app = new Hono();

// CORS MUST be first to handle preflight OPTIONS requests.
// Production lockdown: set ALLOWED_ORIGINS (comma-separated list of exact origins,
// e.g. "https://app.marqcortex.com,https://marqcortex.com"). When set, only those
// origins are allowed and credentialed requests are permitted. When unset, we fall
// back to permissive '*' WITHOUT credentials — auth uses Authorization: Bearer
// tokens (not cookies), and the '*' + credentials:true combination is invalid per
// the CORS spec and must never be shipped.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "/*",
  cors({
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: ALLOWED_ORIGINS.length > 0,
  }),
);

app.use('*', logger(console.log));

// ── In-memory rate limiter ───────────────────────────────────────────────────
// Tracks requests per IP. Resets naturally when the edge function cold-starts.
// Production upgrade: use Redis or Supabase KV for distributed rate limiting.
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120;          // max requests per window per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  c.header('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - entry.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > RATE_LIMIT_MAX) {
    console.log(`🚫 Rate limit exceeded for IP ${ip}: ${entry.count}/${RATE_LIMIT_MAX}`);
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }

  await next();
});

// Periodic cleanup of stale rate-limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

// Custom request logger middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const url = c.req.url;
  console.log(`\n🔵 Incoming ${method} ${url}`);
  // Just log the method and url, headers object causes issues
  
  await next();
  
  const duration = Date.now() - start;
  console.log(`✅ Completed ${method} ${url} in ${duration}ms\n`);
});

// Global error handler — catch any unhandled errors and return proper JSON
app.onError((err, c) => {
  // Full detail is logged server-side only.
  console.error('❌ UNHANDLED ERROR:', err);
  console.error('Error name:', err?.name);
  console.error('Error message:', err?.message);
  console.error('Error stack:', err?.stack);
  console.error('Error type:', typeof err);
  console.error('Error stringified:', String(err));

  // Never leak internal error messages, names, or stack traces to clients.
  return c.json({
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
    path: c.req.url,
  }, 500);
});

// ============================================================================
// SUPABASE ADMIN CLIENT (service role — never expose to frontend)
// ============================================================================

// Validate environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL) {
  console.error('❌ CRITICAL: SUPABASE_URL environment variable is not set!');
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ CRITICAL: SUPABASE_SERVICE_ROLE_KEY environment variable is not set!');
}
if (!SUPABASE_ANON_KEY) {
  console.error('❌ CRITICAL: SUPABASE_ANON_KEY environment variable is not set!');
}

console.log('✅ Environment variables check:');
console.log(`   - SUPABASE_URL: ${SUPABASE_URL ? 'Set' : 'MISSING'}`);
console.log(`   - SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? 'Set (length: ' + SUPABASE_SERVICE_ROLE_KEY.length + ')' : 'MISSING'}`);
console.log(`   - SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? 'Set (length: ' + SUPABASE_ANON_KEY.length + ')' : 'MISSING'}`);

const supabaseAdmin = createClient(
  SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY!,
);

// ============================================================================
// SEED ADMIN USER ON STARTUP (idempotent)
// ============================================================================

async function seedAdminUser() {
  try {
    console.log('🔧 Seeding admin user...');
    // Fail closed: only seed when BOTH email and password are explicitly
    // configured. No default/hardcoded credential is ever used (Batch 6 — W6+W7).
    // This supersedes the earlier ALLOW_DEMO_ADMIN opt-in: there is no code path
    // that can create an admin account with the source-committed demo password.
    const adminPassword = Deno.env.get('TEAM_ADMIN_PASSWORD');
    const decision = resolveAdminSeed({
      email: Deno.env.get('TEAM_ADMIN_EMAIL'),
      password: adminPassword,
      name: Deno.env.get('TEAM_ADMIN_NAME'),
    });
    if (!decision.seed) {
      console.log(`⏭️ Admin seed skipped — ${decision.reason}`);
      return;
    }
    const adminEmail = decision.email!;
    const adminName = decision.name!;

    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const adminExists = existingUsers?.users?.some(u => u.email === adminEmail);
    if (!adminExists) {
      const { error } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword!,
        user_metadata: { name: adminName, role: 'team', teamRole: 'admin' },
        email_confirm: true,
      });
      if (error) {
        console.log('⚠️ Admin user creation error:', error.message);
      } else {
        console.log(`✅ Admin user created: ${adminEmail}`);
      }
    } else {
      console.log('✅ Admin user already exists');
    }
  } catch (err) {
    console.log('⚠️ Seed admin error (non-fatal):', err?.message || String(err));
  }
}

// ============================================================================
// TEST DATABASE CONNECTIVITY ON STARTUP
// ============================================================================

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connectivity...');
    const testKey = 'startup_test_' + Date.now();
    const testValue = 'ok';
    
    await kv.set(testKey, testValue);
    const retrieved = await kv.get(testKey);
    await kv.del(testKey);
    
    if (retrieved === testValue) {
      console.log('✅ Database connection successful!');
      return true;
    } else {
      console.error('❌ Database connection test failed: value mismatch');
      console.error('   Expected:', testValue);
      console.error('   Got:', retrieved);
      return false;
    }
  } catch (err) {
    console.error('❌ Database connection test failed:', err);
    console.error('   Error details:', err?.message);
    console.error('   Error stack:', err?.stack);
    return false;
  }
}

// Run startup tasks asynchronously (don't block server startup)
Promise.all([
  seedAdminUser(),
  testDatabaseConnection()
]).then(() => {
  console.log('✅ Startup tasks completed');
}).catch((err) => {
  console.error('⚠️ Startup tasks error (non-fatal):', err);
});

console.log('');
console.log('====================================');
console.log('🚀 MARQ Cortex Diagnostic Platform Server');
console.log('====================================');
console.log('');

// ============================================================================
// HELPER — verify team JWT
// ============================================================================

async function verifyTeamToken(authHeader: string | null): Promise<string | null> {
  try {
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('⚠️ verifyTeamToken: No Bearer token found');
      return null;
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      console.log('⚠️ verifyTeamToken: Empty token after Bearer');
      return null;
    }
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error) {
      console.log('⚠️ verifyTeamToken: Auth error:', error.message);
      return null;
    }
    if (!user) {
      console.log('⚠️ verifyTeamToken: No user found');
      return null;
    }
    console.log('✅ verifyTeamToken: User verified:', user.id);
    return user.id;
  } catch (err) {
    console.error('❌ verifyTeamToken: Exception caught:', err);
    console.error('   Error details:', err?.message);
    return null;
  }
}

// ============================================================================
// HELPER — require team ADMIN role (server-side authorization)
// ============================================================================
// verifyTeamToken only proves a caller is an authenticated team user. Sensitive
// team-management operations (creating members, changing roles, removing members)
// additionally require an admin role, enforced here on the server — the frontend
// hiding a button is not an authorization control. Roles that are explicitly
// non-admin are rejected; 'admin'/'super_admin' and legacy-unset roles are
// allowed (matching the existing display default of `teamRole || 'admin'`), so
// no existing admin loses access.

const NON_ADMIN_TEAM_ROLES = new Set(['viewer', 'reviewer', 'member', 'client']);

async function getTeamRole(userId: string): Promise<string | null> {
  try {
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    const role = user?.user_metadata?.teamRole;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; res: Response };

/** Require an authenticated team ADMIN. Returns the caller id or a ready-to-return error response. */
async function requireTeamAdmin(c: any): Promise<AdminAuthResult> {
  const userId = await verifyTeamToken(c.req.header('Authorization'));
  if (!userId) return { ok: false, res: c.json({ error: "Unauthorized" }, 401) };
  const role = await getTeamRole(userId);
  if (role && NON_ADMIN_TEAM_ROLES.has(role)) {
    console.log(`🚫 requireTeamAdmin: caller ${userId} role="${role}" denied admin action`);
    return { ok: false, res: c.json({ error: "Forbidden — team admin role required" }, 403) };
  }
  return { ok: true, userId };
}

// ============================================================================
// HELPER — safe JSON parse (handles JSONB that might be string or object)
// ============================================================================

function safeJsonParse(value: any): any {
  // Handle null, undefined, empty string
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // If it's already an object (parsed by JSONB), return it
  if (typeof value === 'object') {
    // Verify it's a valid object (not null, not broken)
    try {
      // Make sure it's not an array of primitives or malformed object
      if (Array.isArray(value)) return value;
      // Ensure the object is serializable and not corrupted
      if (Object.keys(value).length === 0 && value.constructor === Object) {
        // Empty object is valid
        return value;
      }
      return value;
    } catch (err) {
      console.log('⚠️ Object validation error:', err);
      return null;
    }
  }
  
  // If it's a string, try to parse it
  if (typeof value === 'string') {
    const trimmed = value.trim();
    
    // Empty string after trim
    if (!trimmed) return null;
    
    // Check if it looks like JSON
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      // Not a JSON object/array, might be a plain string value or ISO date
      // Just return the trimmed string
      return trimmed;
    }
    
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(trimmed);
      return parsed;
    } catch (err) {
      console.log('⚠️ JSON parse error for value:', trimmed.substring(0, 100), 'Error:', err);
      return null;
    }
  }
  
  // For primitives (numbers, booleans), return as-is
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  
  // Unknown type
  console.log('⚠️ Unknown value type in safeJsonParse:', typeof value);
  return null;
}

/**
 * Parse an array of raw kv values from getByPrefix('sub:') into submission objects.
 * Filters out non-submission entries (e.g. simple string email-to-id mappings
 * from sub_email: keys that might get matched) and malformed JSON, returning
 * only valid submission objects that have an `id` property.
 */
function parseSubmissions(rawArray: any[]): any[] {
  if (!Array.isArray(rawArray)) return [];
  const results: any[] = [];
  for (const raw of rawArray) {
    try {
      const parsed = safeJsonParse(raw);
      // A valid submission must be an object with an id field
      if (parsed && typeof parsed === 'object' && parsed.id) {
        results.push(parsed);
      }
    } catch {
      // Skip unparseable entries silently
    }
  }
  return results;
}

// ============================================================================
// HELPERS — notification prefs + gated email firing
// ============================================================================

async function getNotifPrefs(): Promise<Record<string, boolean>> {
  try {
    const raw = await kv.get('settings:platform');
    if (!raw) return {};
    const settings = safeJsonParse(raw);
    return settings.notificationPrefs || {};
  } catch {
    return {};
  }
}

async function getTeamEmail(): Promise<string> {
  // Look up team admin emails from Supabase Auth users with team role
  try {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    if (users && users.length > 0) {
      // Prefer admins, fall back to any team user
      const admin = users.find(u => u.user_metadata?.role === 'team' && u.user_metadata?.teamRole === 'admin');
      if (admin?.email) return admin.email;
      const anyTeam = users.find(u => u.user_metadata?.role === 'team');
      if (anyTeam?.email) return anyTeam.email;
      // Fall back to first user with an email
      const firstWithEmail = users.find(u => !!u.email);
      if (firstWithEmail?.email) return firstWithEmail.email;
    }
  } catch (err) {
    console.log('⚠️ getTeamEmail: Could not look up team users:', err);
  }
  // Final fallback — reads from env or defaults
  const fallback = Deno.env.get('TEAM_ADMIN_EMAIL') || 'admin@marqcortex.com';
  console.log(`⚠️ getTeamEmail: Using fallback email: ${fallback}`);
  return fallback;
}

/** Fire an email only if the given preference key is enabled (defaults true if absent). */
function fireEmail(enabled: boolean, fn: () => Promise<void>, label: string): void {
  if (!enabled) {
    console.log(`📧 [EMAIL GATED — "${label}" disabled in notification prefs]`);
    return;
  }
  fn().catch(err => console.log(`${label} email error (non-fatal):`, err));
}

// ============================================================================
// TEST ENDPOINTS
// ============================================================================

// Simple ping endpoint (no auth, no KV access)
app.get("/make-server-324f4fbe/ping", (c) => {
  console.log('🏓 PING endpoint hit');
  return c.json({ 
    success: true, 
    message: "pong", 
    timestamp: new Date().toISOString(),
    server: "MARQ Cortex Diagnostic Platform",
  });
});

// Test auth endpoint (auth required, no KV access)
app.get("/make-server-324f4fbe/test-auth", async (c) => {
  console.log('🔐 TEST-AUTH endpoint hit');
  try {
    const authHeader = c.req.header('Authorization');
    console.log('   Auth header present:', !!authHeader);
    
    const userId = await verifyTeamToken(authHeader);
    console.log('   User ID:', userId);
    
    if (!userId) {
      return c.json({ error: "Unauthorized - No valid token" }, 401);
    }
    
    return c.json({ 
      success: true, 
      message: "Authentication successful", 
      userId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('❌ TEST-AUTH error:', err);
    return c.json({ 
      error: `Test auth failed: ${err?.message || String(err)}`,
      errorType: err?.name,
    }, 500);
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get("/make-server-324f4fbe/health", async (c) => {
  try {
    // Test KV store connectivity
    const testKey = 'health_check_test';
    await kv.set(testKey, 'ok');
    const testValue = await kv.get(testKey);
    await kv.del(testKey);
    
    const kvHealthy = testValue === 'ok';
    
    return c.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      kvStore: kvHealthy ? 'connected' : 'error',
    });
  } catch (err) {
    console.error('Health check error:', err);
    return c.json({ 
      status: "error", 
      timestamp: new Date().toISOString(),
      kvStore: 'error',
      error: String(err),
    }, 500);
  }
});

// ============================================================================
// DIAGNOSTIC — Database stats (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/diagnostic", async (c) => {
  console.log('🔍 GET /diagnostic endpoint hit');
  try {
    const authHeader = c.req.header('Authorization');
    console.log('🔐 Auth header present:', !!authHeader);
    
    const userId = await verifyTeamToken(authHeader);
    console.log('🔐 User ID from token:', userId ? 'valid' : 'invalid');
    if (!userId) {
      console.log('❌ Unauthorized diagnostic request');
      return c.json({ error: "Unauthorized" }, 401);
    }

    console.log('📂 Fetching diagnostic data from KV store...');
    // Get counts from different prefixes with individual error handling
    let subs = [];
    let notifs = [];
    let notes = [];
    let proposals = [];
    
    try {
      subs = await kv.getByPrefix('sub:');
      console.log(`📦 Submissions fetched: ${subs?.length || 0}`);
    } catch (subErr) {
      console.error('❌ Error fetching submissions:', subErr);
      subs = [];
    }
    
    try {
      notifs = await kv.getByPrefix('notif:');
      console.log(`📦 Notifications fetched: ${notifs?.length || 0}`);
    } catch (notifErr) {
      console.error('❌ Error fetching notifications:', notifErr);
      notifs = [];
    }
    
    try {
      notes = await kv.getByPrefix('note:');
      console.log(`📦 Notes fetched: ${notes?.length || 0}`);
    } catch (noteErr) {
      console.error('❌ Error fetching notes:', noteErr);
      notes = [];
    }
    
    try {
      proposals = await kv.getByPrefix('proposal:');
      console.log(`📦 Proposals fetched: ${proposals?.length || 0}`);
    } catch (propErr) {
      console.error('❌ Error fetching proposals:', propErr);
      proposals = [];
    }

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      counts: {
        submissions: Array.isArray(subs) ? subs.length : 0,
        notifications: Array.isArray(notifs) ? notifs.length : 0,
        notes: Array.isArray(notes) ? notes.length : 0,
        proposals: Array.isArray(proposals) ? proposals.length : 0,
      },
      types: {
        submissions: Array.isArray(subs) ? 'array' : typeof subs,
        notifications: Array.isArray(notifs) ? 'array' : typeof notifs,
        notes: Array.isArray(notes) ? 'array' : typeof notes,
        proposals: Array.isArray(proposals) ? 'array' : typeof proposals,
      },
      samples: {
        submission: subs?.[0] ? typeof subs[0] : 'none',
        notification: notifs?.[0] ? typeof notifs[0] : 'none',
      }
    };
    
    console.log('✅ Diagnostic data retrieved successfully');
    return c.json(result);
  } catch (err) {
    console.error('❌ Diagnostic error:', err);
    console.error('   Error message:', err?.message);
    console.error('   Error stack:', err?.stack);
    return c.json({ 
      error: `Diagnostic failed: ${err?.message || String(err)}`,
      errorType: err?.name || 'Unknown',
      stack: err?.stack,
    }, 500);
  }
});

// ============================================================================
// LEAD CAPTURE — store leads from landing page funnel (no auth required)
// ============================================================================

app.post("/make-server-324f4fbe/leads/capture", async (c) => {
  try {
    const body = await c.req.json();
    const { name, email, phone, website } = body;

    if (!email) {
      return c.json({ error: "Email is required for lead capture" }, 400);
    }

    const leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lead = {
      id: leadId,
      name: name || '',
      email,
      phone: phone || '',
      website: website || '',
      source: 'lead_magnet',
      capturedAt: new Date().toISOString(),
    };

    await kv.set(`lead:${leadId}`, JSON.stringify(lead));
    // Also index by email for dedup lookups
    await kv.set(`lead_email:${email}`, leadId);

    console.log(`✅ Lead captured: ${email} (${leadId})`);

    // Fire new-lead notification email (non-blocking, reusing submission alert)
    getNotifPrefs().then(async (prefs) => {
      const teamAddr = await getTeamEmail();
      fireEmail(
        prefs.newSubmission !== false,
        () => sendTeamNewSubmissionEmail({
          id: leadId,
          company: website || 'Unknown Company',
          contact: name || 'Unknown',
          email,
          industry: 'Lead Magnet',
          priority: 'medium',
          completionScore: 0,
          qualityScore: 0,
          submittedDate: new Date().toISOString(),
        }, teamAddr),
        'New Lead Capture',
      );
    });

    return c.json({ success: true, leadId });
  } catch (err: any) {
    console.error('❌ Lead capture error:', err);
    return c.json({ error: `Lead capture failed: ${err?.message || String(err)}` }, 500);
  }
});

app.post("/make-server-324f4fbe/leads/exit-intent", async (c) => {
  try {
    const body = await c.req.json();
    const { email } = body;

    if (!email) {
      return c.json({ error: "Email is required for exit-intent capture" }, 400);
    }

    // Check if we already have this lead
    const existingLeadId = await kv.get(`lead_email:${email}`);
    if (existingLeadId) {
      console.log(`ℹ️ Exit-intent lead already exists: ${email}`);
      return c.json({ success: true, leadId: existingLeadId, alreadyExists: true });
    }

    const leadId = `lead_exit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lead = {
      id: leadId,
      email,
      source: 'exit_intent',
      capturedAt: new Date().toISOString(),
    };

    await kv.set(`lead:${leadId}`, JSON.stringify(lead));
    await kv.set(`lead_email:${email}`, leadId);

    console.log(`✅ Exit-intent lead captured: ${email} (${leadId})`);

    return c.json({ success: true, leadId });
  } catch (err: any) {
    console.error('❌ Exit-intent capture error:', err);
    return c.json({ error: `Exit-intent capture failed: ${err?.message || String(err)}` }, 500);
  }
});

// ============================================================================
// AUTH — TEAM LOGIN (proxy to Supabase Auth)
// ============================================================================

app.post("/make-server-324f4fbe/auth/team/login", async (c) => {
  try {
    const { email, password } = await c.req.json();
    if (!email || !password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Use Supabase Auth to sign in
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      console.log('Team login failed:', error?.message);
      return c.json({ error: "Invalid email or password" }, 401);
    }

    return c.json({
      success: true,
      accessToken: data.session.access_token,
      user: {
        id: data.user?.id,
        email: data.user?.email,
        name: data.user?.user_metadata?.name || 'Team Member',
      },
    });
  } catch (err) {
    console.log('Team login error:', err);
    return c.json({ error: `Team login server error: ${err}` }, 500);
  }
});

// ============================================================================
// AUTH — CLIENT EMAIL VERIFICATION
// ============================================================================

app.post("/make-server-324f4fbe/auth/client/verify", async (c) => {
  try {
    const { email } = await c.req.json();
    if (!email) {
      return c.json({ error: "Email is required" }, 400);
    }

    const emailKey = `sub_email:${email.toLowerCase().trim()}`;
    const submissionId = await kv.get(emailKey);

    if (!submissionId) {
      return c.json({ exists: false });
    }

    // Get submission for company name
    const submission = await kv.get(`sub:${submissionId}`);
    const parsed = submission ? (typeof submission === 'string' ? JSON.parse(submission) : submission) : null;

    // ── F-003: Issue a server-side session token ────────────────────────────
    // Token is stored in KV with 8-hour TTL; required for protected client routes.
    const sessionToken = `client_${crypto.randomUUID()}`;
    const tokenKey = `client_session:${sessionToken}`;
    const tokenPayload = {
      submissionId,
      email: email.toLowerCase().trim(),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
    await kv.set(tokenKey, JSON.stringify(tokenPayload));
    console.log(`✅ Client session token issued for ${email} → ${submissionId}`);

    return c.json({
      exists: true,
      submissionId,
      companyName: parsed?.company || 'Your Company',
      sessionToken,
    });
  } catch (err) {
    console.log('Client verify error:', err);
    return c.json({ error: `Client verification error: ${err}` }, 500);
  }
});

// ── F-003: Helper — verify client session token ───────────────────────────────
async function verifyClientToken(authHeader: string | null): Promise<{ submissionId: string; email: string } | null> {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    if (!token?.startsWith('client_')) return null; // not a client token
    const raw = await kv.get(`client_session:${token}`);
    if (!raw) return null;
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (new Date(payload.expiresAt) < new Date()) {
      await kv.del(`client_session:${token}`); // expired — clean up
      return null;
    }
    return { submissionId: payload.submissionId, email: payload.email };
  } catch {
    return null;
  }
}

type ClientAccessResult =
  | { ok: true; session: { submissionId: string; email: string } }
  | { ok: false; status: number; error: string };

/** Require client auth for a submission-scoped route (token preferred, email fallback on GET). */
async function requireClientAccess(
  authHeader: string | null,
  submissionId: string,
  emailQuery?: string | null,
): Promise<ClientAccessResult> {
  const clientSession = await verifyClientToken(authHeader);
  if (clientSession) {
    if (clientSession.submissionId !== submissionId) {
      return { ok: false, status: 404, error: 'Submission not found' };
    }
    return { ok: true, session: clientSession };
  }

  if (emailQuery) {
    const raw = await kv.get(`sub:${submissionId}`);
    if (!raw) return { ok: false, status: 404, error: 'Submission not found' };
    const submission = safeJsonParse(raw);
    const reqEmail = emailQuery.toLowerCase().trim();
    const subEmail = String(submission?.email ?? '').toLowerCase().trim();
    if (reqEmail !== subEmail) {
      return { ok: false, status: 404, error: 'Submission not found' };
    }
    return { ok: true, session: { submissionId, email: reqEmail } };
  }

  return { ok: false, status: 401, error: 'Authentication required: provide session token or email' };
}

// ============================================================================
// HELPER — store a notification in KV
// ============================================================================

async function storeNotification(payload: {
  type: 'new_submission' | 'status_change' | 'urgent';
  title: string;
  message: string;
  submissionId: string;
  meta?: Record<string, string>;
}) {
  const id = `notif:${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  await kv.set(id, JSON.stringify({
    id,
    ...payload,
    createdAt: new Date().toISOString(),
  }));
}

// ============================================================================
// SUBMISSIONS — CREATE (public, no auth needed)
// ============================================================================

app.post("/make-server-324f4fbe/submissions", async (c) => {
  try {
    const body = await c.req.json();
    const {
      contactName,
      email,
      phone,
      website,
      industry,
      answers,
    } = body;

    if (!email || !industry) {
      return c.json({ error: "Email and industry are required" }, 400);
    }

    // Generate submission ID
    const id = `SUB-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const submittedAt = new Date().toISOString();

    // Derive company from website or email
    let company = 'Unknown Company';
    if (website) {
      try {
        const url = website.startsWith('http') ? website : `https://${website}`;
        const hostname = new URL(url).hostname.replace('www.', '');
        company = hostname.split('.')[0];
        company = company.charAt(0).toUpperCase() + company.slice(1);
      } catch {
        company = email.split('@')[1]?.split('.')[0] || 'Unknown';
        company = company.charAt(0).toUpperCase() + company.slice(1);
      }
    } else if (email) {
      company = email.split('@')[1]?.split('.')[0] || 'Unknown';
      company = company.charAt(0).toUpperCase() + company.slice(1);
    }

    // Calculate completion score based on answer count and quality
    const totalQuestions = Object.keys(answers || {}).length;
    const filledAnswers = Object.values(answers || {}).filter(a => a && String(a).trim().length > 10).length;
    const completionScore = Math.min(100, Math.round((filledAnswers / Math.max(totalQuestions, 1)) * 100));

    // Quality score based on average answer length
    const avgLength = totalQuestions > 0
      ? Object.values(answers || {}).reduce((sum: number, a) => sum + String(a).length, 0) / totalQuestions
      : 0;
    const qualityScore = Math.min(100, Math.round(Math.min(avgLength / 3, 100)));

    const priority = completionScore > 80 ? 'high' : completionScore > 60 ? 'medium' : 'low';

    // ── F-001: Use client-computed readinessScore as aiScore if provided ──────
    // Eliminates dual-scoring drift: client computes readinessScore via
    // computeInstantScore (keyword analysis), server stores the SAME number.
    // Fallback to simple average only for direct API calls without a client score.
    const clientReadinessScore = typeof body.readinessScore === 'number' && body.readinessScore > 0
      ? Math.min(100, Math.max(0, Math.round(body.readinessScore)))
      : Math.round((completionScore + qualityScore) / 2);

    const submission = {
      id,
      company,
      contact: contactName || email.split('@')[0],
      email: email.toLowerCase().trim(),
      phone: phone || '',
      website: website || '',
      industry: industryLabel(industry),
      industryId: industry,
      employees: 'Not specified',
      revenue: 'Not specified',
      submittedAt,
      submittedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'new',
      priority,
      completionScore,
      qualityScore,
      aiScore: clientReadinessScore,
      roiPotential: 'TBD',
      answers: answers || {},
      isRead: false,
    };

    // Save submission
    await kv.set(`sub:${id}`, JSON.stringify(submission));

    // Map email → submissionId for client lookup
    await kv.set(`sub_email:${email.toLowerCase().trim()}`, id);

    console.log(`✅ Submission saved: ${id} for ${email}`);

    // Store in-app notification
    await storeNotification({
      type: priority === 'high' ? 'urgent' : 'new_submission',
      title: 'New Submission',
      message: `${submission.company} submitted the diagnostic (${priority} priority)`,
      submissionId: id,
      meta: { company: submission.company, industry: submission.industry, priority },
    });

    // Fire team email gated by notification prefs
    const notifPrefs1 = await getNotifPrefs();
    const teamEmail1  = await getTeamEmail();
    fireEmail(
      notifPrefs1.newSubmission !== false,
      () => sendTeamNewSubmissionEmail(submission, teamEmail1),
      'newSubmission',
    );

    return c.json({ success: true, submissionId: id });

  } catch (err) {
    console.log('Create submission error:', err);
    return c.json({ error: `Failed to save submission: ${err}` }, 500);
  }
});

// ============================================================================
// SUBMISSIONS — LIST (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/submissions", async (c) => {
  console.log('🔍 GET /submissions endpoint hit');
  try {
    const authHeader = c.req.header('Authorization');
    console.log('🔐 Auth header present:', !!authHeader);
    
    const userId = await verifyTeamToken(authHeader);
    console.log('🔐 User ID from token:', userId ? 'valid' : 'invalid');
    if (!userId) {
      console.log('❌ Unauthorized request');
      return c.json({ error: "Unauthorized — valid team token required" }, 401);
    }

    console.log('📂 Fetching submissions from KV store...');
    // Get all submissions using prefix scan with error handling
    let allSubmissions;
    try {
      allSubmissions = await kv.getByPrefix('sub:');
      console.log(`📦 Raw submissions fetched successfully: ${allSubmissions?.length || 0}`);
    } catch (kvError) {
      console.error('❌ KV store error while fetching submissions:', kvError);
      console.error('KV error stack:', kvError?.stack);
      return c.json({ 
        error: `Database error: ${kvError?.message || String(kvError)}`,
        details: 'Failed to connect to database. Please check Supabase connection.',
      }, 500);
    }
    
    console.log(`📦 Raw submissions count from KV: ${allSubmissions?.length || 0}`);
    
    // Safety check: ensure we have an array
    if (!Array.isArray(allSubmissions)) {
      console.log('⚠️ getByPrefix returned non-array:', typeof allSubmissions);
      return c.json({ success: true, submissions: [], total: 0 });
    }
    
    const parsed = parseSubmissions(allSubmissions)
      .sort((a, b) => {
        try {
          const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
          const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
          // Handle invalid dates (NaN)
          const aValid = !isNaN(aTime) ? aTime : 0;
          const bValid = !isNaN(bTime) ? bTime : 0;
          return bValid - aValid;
        } catch (err) {
          console.log('Sort error for submissions:', err);
          return 0;
        }
      });

    console.log(`✅ Fetched ${parsed.length} submissions (filtered from ${allSubmissions?.length || 0} raw entries)`);
    return c.json({ success: true, submissions: parsed, total: parsed.length });
  } catch (err) {
    console.error('❌ List submissions error:', err);
    console.error('   Error type:', typeof err);
    console.error('   Error name:', err?.name);
    console.error('   Error message:', err?.message);
    console.error('   Error stack:', err?.stack);
    console.error('   Error stringified:', String(err));
    return c.json({ 
      error: `Failed to fetch submissions: ${err?.message || String(err)}`,
      errorType: err?.name || 'Unknown',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

// ============================================================================
// SUBMISSIONS — GET ONE (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/submissions/:id", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param('id');
    const raw = await kv.get(`sub:${id}`);
    if (!raw) {
      return c.json({ error: "Submission not found" }, 404);
    }

    return c.json({ success: true, submission: safeJsonParse(raw) });
  } catch (err) {
    console.log('Get submission error:', err);
    return c.json({ error: `Failed to fetch submission: ${err}` }, 500);
  }
});

// ============================================================================
// SUBMISSIONS — UPDATE STATUS (team auth required)
// ============================================================================

app.patch("/make-server-324f4fbe/submissions/:id/status", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param('id');
    const { status, priority } = await c.req.json();

    const raw = await kv.get(`sub:${id}`);
    if (!raw) {
      return c.json({ error: "Submission not found" }, 404);
    }

    const submission = safeJsonParse(raw);
    const prevStatus = submission.status;
    if (status) submission.status = status;
    if (priority) submission.priority = priority;
    submission.updatedAt = new Date().toISOString();

    await kv.set(`sub:${id}`, JSON.stringify(submission));
    console.log(`✅ Submission ${id} updated: status=${status}, priority=${priority}`);

    // Store in-app notification for status changes
    if (status && status !== prevStatus) {
      const statusLabels: Record<string, string> = {
        'in-review': 'moved to In Review',
        'completed':  'report marked as Ready',
        'approved':   'marked as Converted',
      };
      if (statusLabels[status]) {
        await storeNotification({
          type: status === 'completed' ? 'status_change' : 'status_change',
          title: status === 'completed' ? 'Report Ready' : 'Status Updated',
          message: `${submission.company} ${statusLabels[status]}`,
          submissionId: id,
          meta: { company: submission.company, status },
        });
      }

      // Fire client emails gated by notification prefs
      const notifPrefs2 = await getNotifPrefs();
      if (status === 'in-review') {
        // Client under-review email is always sent (it's a client transactional email)
        sendClientUnderReviewEmail(submission).catch(err =>
          console.log('Under-review email error (non-fatal):', err)
        );
      } else if (status === 'completed') {
        // reportReady gates the "report is ready" email to the client
        fireEmail(
          notifPrefs2.reportReady !== false,
          () => sendClientReportReadyEmail(submission),
          'reportReady',
        );
      }
    }

    return c.json({ success: true, submission });
  } catch (err) {
    console.log('Update submission error:', err);
    return c.json({ error: `Failed to update submission: ${err}` }, 500);
  }
});

// ============================================================================
// SUBMISSIONS — BULK UPDATE (team auth required)
// ============================================================================

app.patch("/make-server-324f4fbe/submissions/bulk", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { ids, status, priority, assignedTo } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids must be a non-empty array" }, 400);
    }

    const results = await Promise.all(
      ids.map(async (id: string) => {
        const raw = await kv.get(`sub:${id}`);
        if (!raw) return { id, success: false, error: 'Not found' };

        const sub = safeJsonParse(raw);
        const prevStatus = sub.status;

        if (status)     sub.status     = status;
        if (priority)   sub.priority   = priority;
        if (assignedTo !== undefined) sub.assignedTo = assignedTo;
        sub.updatedAt = new Date().toISOString();

        await kv.set(`sub:${id}`, JSON.stringify(sub));

        // Notify on status change
        if (status && status !== prevStatus) {
          await storeNotification({
            type: 'status_change',
            title: 'Bulk Status Update',
            message: `${sub.company} moved to ${status}`,
            submissionId: id,
            meta: { company: sub.company, status },
          });
        }

        return { id, success: true };
      })
    );

    const succeeded = results.filter(r => r.success).length;
    console.log(`✅ Bulk update: ${succeeded}/${ids.length} submissions updated`);
    return c.json({ success: true, updated: succeeded, results });
  } catch (err) {
    console.log('Bulk update error:', err);
    return c.json({ error: `Bulk update failed: ${err}` }, 500);
  }
});

// ============================================================================
// CLIENT — GET OWN SUBMISSION
// ============================================================================

app.get("/make-server-324f4fbe/client/submission/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const authHeader = c.req.header('Authorization');
    const access = await requireClientAccess(authHeader, id, c.req.query('email'));
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const raw = await kv.get(`sub:${id}`);
    if (!raw) {
      return c.json({ error: "Submission not found" }, 404);
    }

    const submission = safeJsonParse(raw);
    return c.json({ success: true, submission });
  } catch (err) {
    console.log('Client get submission error:', err);
    return c.json({ error: `Failed to fetch submission: ${err}` }, 500);
  }
});

// ============================================================================
// CLIENT — TRACK ENGAGEMENT (client auth required)
// ============================================================================

app.post("/make-server-324f4fbe/client/submission/:id/engagement", async (c) => {
  try {
    const id = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), id);
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const body = await c.req.json();
    const { type, meta } = body;

    const validTypes = [
      'report_viewed', 'cta_clicked', 'pdf_printed',
      // 13C: new event types
      'portal_opened', 'proposal_viewed', 'meeting_scheduled', 'message_sent',
    ];
    if (!validTypes.includes(type)) {
      return c.json({ error: "Invalid engagement type" }, 400);
    }

    const raw = await kv.get(`sub:${id}`);
    if (!raw) return c.json({ error: "Submission not found" }, 404);

    const submission = safeJsonParse(raw);
    const now = new Date().toISOString();

    // Initialise engagement object if absent
    if (!submission.engagement) {
      submission.engagement = {
        reportViewCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        ctaClickedAt: null,
        pdfPrintedAt: null,
      };
    }

    // Update legacy aggregate fields (backward compat)
    if (type === 'report_viewed') {
      submission.engagement.reportViewCount = (submission.engagement.reportViewCount || 0) + 1;
      if (!submission.engagement.firstViewedAt) submission.engagement.firstViewedAt = now;
      submission.engagement.lastViewedAt = now;
    } else if (type === 'cta_clicked') {
      submission.engagement.ctaClickedAt = submission.engagement.ctaClickedAt || now;
    } else if (type === 'pdf_printed') {
      submission.engagement.pdfPrintedAt = submission.engagement.pdfPrintedAt || now;
    }

    await kv.set(`sub:${id}`, JSON.stringify(submission));

    // ── 13C: Append to discrete event log ─────────────────────────────────
    // KV key: eng_log:{submissionId}  →  JSON array newest-first, max 50 entries
    const logKey  = `eng_log:${id}`;
    const logRaw  = await kv.get(logKey);
    const parsed  = logRaw ? safeJsonParse(logRaw) : [];
    // Ensure we have an array for the event log
    const logArr: any[] = Array.isArray(parsed) ? parsed : [];
    const event = {
      id:   `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      at:   now,
      ...(meta ? { meta } : {}),
    };
    logArr.unshift(event);             // newest first
    await kv.set(logKey, JSON.stringify(logArr.slice(0, 50)));
    // ───────────────────────────────────────────────────────────────────────

    console.log(`✅ Engagement tracked for ${id}: ${type}`);
    return c.json({ success: true, engagement: submission.engagement, event });
  } catch (err) {
    console.log('Engagement tracking error:', err);
    return c.json({ error: `Failed to track engagement: ${err}` }, 500);
  }
});

// ── 13C: GET engagement event log (client auth required) ─────────────────────
app.get("/make-server-324f4fbe/client/submission/:id/engagement/log", async (c) => {
  try {
    const id = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), id, c.req.query('email'));
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const logRaw = await kv.get(`eng_log:${id}`);
    const parsed = logRaw ? safeJsonParse(logRaw) : [];
    // Ensure we return an array
    const events: any[] = Array.isArray(parsed) ? parsed : [];
    console.log(`✅ Fetched ${events.length} engagement events for ${id}`);
    return c.json({ success: true, events });
  } catch (err) {
    console.log('Get engagement log error:', err);
    return c.json({ error: `Failed to fetch engagement log: ${err}` }, 500);
  }
});

// ── 13E: GET engagement summary — batch latest event per submission ───────────
// Team-auth required. Query: ?ids=id1,id2,... (comma-sep, max 100)
// Returns: { success: true, summary: Record<submissionId, LatestEvent | null> }
app.get("/make-server-324f4fbe/cortex/engagement-summary", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const rawIds = c.req.query('ids') ?? '';
    const ids    = rawIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);

    const summary: Record<string, any> = {};
    await Promise.all(ids.map(async id => {
      try {
        const logRaw = await kv.get(`eng_log:${id}`);
        const parsed = logRaw ? safeJsonParse(logRaw) : [];
        // Ensure we have an array before accessing [0]
        const events: any[] = Array.isArray(parsed) ? parsed : [];
        summary[id] = events[0] ?? null; // newest-first → [0] is latest
      } catch {
        summary[id] = null;
      }
    }));

    console.log(`✅ Engagement summary fetched for ${ids.length} submissions`);
    return c.json({ success: true, summary });
  } catch (err) {
    console.log('Engagement summary error:', err);
    return c.json({ error: `Failed to fetch engagement summary: ${err}` }, 500);
  }
});

// ============================================================================
// ANALYTICS — OVERVIEW  (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/analytics/overview", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    // ── Fetch all submissions and proposals in parallel ──────────────────────
    const [rawSubs, rawProposals] = await Promise.all([
      kv.getByPrefix('sub:'),
      kv.getByPrefix('proposal:'),
    ]);

    // Safety check: ensure we have arrays
    const submissionsArray = Array.isArray(rawSubs) ? rawSubs : [];
    const proposalsArray = Array.isArray(rawProposals) ? rawProposals : [];

    const submissions: any[] = parseSubmissions(submissionsArray);

    const proposals: any[] = proposalsArray
      .map((p: any) => {
        try {
          return safeJsonParse(p);
        } catch (err) {
          console.log('Failed to parse proposal in analytics:', err);
          return null;
        }
      })
      .filter(p => p && typeof p === 'object' && p.id);

    const now   = new Date();
    const msDay = 86_400_000;

    // ── Time windows ─────────────────────────────────────────────────────────
    const weekStart     = new Date(now.getTime() - 7  * msDay);
    const prevWeekStart = new Date(now.getTime() - 14 * msDay);

    const thisWeekSubs = submissions.filter(s => new Date(s.submittedAt) >= weekStart);
    const lastWeekSubs = submissions.filter(s => {
      const d = new Date(s.submittedAt);
      return d >= prevWeekStart && d < weekStart;
    });

    const weeklyChangeRaw = lastWeekSubs.length > 0
      ? Math.round(((thisWeekSubs.length - lastWeekSubs.length) / lastWeekSubs.length) * 100)
      : (thisWeekSubs.length > 0 ? 100 : 0);

    // ── Core aggregations ────────────────────────────────────────────────────
    const byStatus:   Record<string, number> = { new: 0, 'in-review': 0, completed: 0, approved: 0 };
    const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
    const industryBreakdown: Record<string, number> = {};

    let totalQuality    = 0;
    let totalCompletion = 0;
    let totalAiScore    = 0;
    let totalReviewMs   = 0;
    let reviewedCount   = 0;

    for (const sub of submissions) {
      const st = sub.status || 'new';
      byStatus[st] = (byStatus[st] || 0) + 1;

      const pr = sub.priority || 'low';
      byPriority[pr] = (byPriority[pr] || 0) + 1;

      const ind = sub.industry || 'Unknown';
      industryBreakdown[ind] = (industryBreakdown[ind] || 0) + 1;

      totalQuality    += Number(sub.qualityScore)    || 0;
      totalCompletion += Number(sub.completionScore) || 0;
      totalAiScore    += Number(sub.aiScore)         || 0;

      if (sub.reviewedAt && sub.submittedAt) {
        const ms = new Date(sub.reviewedAt).getTime() - new Date(sub.submittedAt).getTime();
        if (ms > 0) { totalReviewMs += ms; reviewedCount++; }
      }
    }

    const total         = submissions.length;
    const avgQuality    = total > 0 ? Math.round(totalQuality    / total) : 0;
    const avgCompletion = total > 0 ? Math.round(totalCompletion / total) : 0;
    const avgAiScore    = total > 0 ? Math.round(totalAiScore    / total) : 0;
    const avgTimeToReviewHours = reviewedCount > 0
      ? Math.round((totalReviewMs / reviewedCount) / 3_600_000 * 10) / 10
      : null;

    const conversionRate = total > 0
      ? Math.round(((byStatus.approved || 0) / total) * 100)
      : 0;

    // ── Proposal stats ───────────────────────────────────────────────────────
    const proposalCounts = { draft: 0, sent: 0, viewed: 0, accepted: 0, rejected: 0 };
    for (const p of proposals) {
      const st = p.status as keyof typeof proposalCounts;
      if (st && st in proposalCounts) proposalCounts[st]++;
    }
    const propTotal          = proposals.length;
    const propConversionRate = proposalCounts.sent > 0
      ? Math.round((proposalCounts.accepted / proposalCounts.sent) * 100)
      : 0;
    const propViewRate = proposalCounts.sent > 0
      ? Math.round(((proposalCounts.viewed + proposalCounts.accepted) / proposalCounts.sent) * 100)
      : 0;

    // ── 14-day daily trend ───────────────────────────────────────────────────
    const dailyTrend: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d  = new Date(now.getTime() - i * msDay);
      const ds = d.toISOString().split('T')[0];
      dailyTrend.push({
        date:  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: submissions.filter(s => s.submittedAt?.split('T')[0] === ds).length,
      });
    }

    console.log(`✅ /analytics/overview: ${total} subs, ${propTotal} proposals`);

    return c.json({
      success: true,
      analytics: {
        // ── core AnalyticsData shape (component interface) ──
        total,
        byStatus,
        byPriority,
        avgQuality,
        industryBreakdown,

        // ── enhanced ──
        avgCompletion,
        avgAiScore,
        conversionRate,
        avgTimeToReviewHours,
        weeklyTrend: {
          thisWeek:      thisWeekSubs.length,
          lastWeek:      lastWeekSubs.length,
          changePercent: weeklyChangeRaw,
        },
        proposalStats: {
          total: propTotal,
          ...proposalCounts,
          conversionRate: propConversionRate,
          viewRate:       propViewRate,
        },
        highPriorityThisWeek: thisWeekSubs.filter(s => s.priority === 'high').length,
        dailyTrend,
        generatedAt: now.toISOString(),
      },
    });
  } catch (err) {
    console.log('Analytics overview error:', err);
    return c.json({ error: `Failed to compute analytics: ${err}` }, 500);
  }
});

// ============================================================================
// ANALYTICS — REVENUE INTELLIGENCE SNAPSHOTS (team auth required)
// Deterministic deal-snapshot derivation from authoritative persisted KV data.
// No LLM. Powers the Revenue Intelligence Dashboard's aggregators.
// ============================================================================

app.get("/make-server-324f4fbe/analytics/revenue-snapshots", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const [rawSubs, rawProposals, rawOutcomes, rawEscalations] = await Promise.all([
      kv.getByPrefix('sub:'),
      kv.getByPrefix('proposal:'),
      kv.getByPrefix('outcome:'),
      kv.getByPrefix('escalation:'),
    ]);

    const submissions = parseSubmissions(Array.isArray(rawSubs) ? rawSubs : []) as RawSubmission[];
    const parseAll = <T,>(arr: unknown): T[] =>
      (Array.isArray(arr) ? arr : [])
        .map((r: unknown) => { try { return safeJsonParse(r) as T; } catch { return null; } })
        .filter((r): r is T => r != null && typeof r === 'object');

    const proposals   = parseAll<RawProposal>(rawProposals);
    const outcomes    = parseAll<RawOutcome>(rawOutcomes);
    const escalations = parseAll<RawEscalation>(rawEscalations);

    const snapshots = deriveDealSnapshots({ submissions, proposals, outcomes, escalations });
    const summary   = summarizeSnapshots(snapshots);

    console.log(`✅ /analytics/revenue-snapshots: ${snapshots.length} snapshots from ${submissions.length} subs`);

    return c.json({
      success: true,
      snapshots,
      summary,
      source_counts: {
        submissions: submissions.length,
        proposals:   proposals.length,
        outcomes:    outcomes.length,
        escalations: escalations.length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log('Revenue snapshots error:', err);
    return c.json({ error: `Failed to compute revenue snapshots: ${err}` }, 500);
  }
});

// ============================================================================
// ANALYTICS — ENGAGEMENT INTELLIGENCE (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/analytics/engagement", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    // ── Fetch all submissions & notes in parallel ──
    const [rawSubs, rawNotes] = await Promise.all([
      kv.getByPrefix('sub:'),
      kv.getByPrefix('note:'),
    ]);

    // Safety check: ensure we have arrays
    const subsArray = Array.isArray(rawSubs) ? rawSubs : [];
    const notesArray = Array.isArray(rawNotes) ? rawNotes : [];

    const submissions = parseSubmissions(subsArray);

    const notes = notesArray
      .map(n => {
        try {
          return safeJsonParse(n);
        } catch (err) {
          console.log('Failed to parse note in engagement analytics:', err);
          return null;
        }
      })
      .filter(n => n && typeof n === 'object' && n.id);

    // ── Report delivery metrics ──
    const reportAvailable = submissions.filter(
      (s: any) => s.status === 'completed' || s.status === 'approved'
    ).length;

    const withEngagement = submissions.filter((s: any) => s.engagement?.firstViewedAt);
    const withCTA        = submissions.filter((s: any) => s.engagement?.ctaClickedAt);
    const withPDF        = submissions.filter((s: any) => s.engagement?.pdfPrintedAt);

    const totalViews = submissions.reduce(
      (sum: number, s: any) => sum + (s.engagement?.reportViewCount || 0), 0
    );
    const avgViewsPerViewed = withEngagement.length > 0
      ? Math.round((totalViews / withEngagement.length) * 10) / 10
      : 0;

    const viewRate     = reportAvailable > 0 ? Math.round((withEngagement.length / reportAvailable) * 100) : 0;
    const ctaRate      = withEngagement.length > 0 ? Math.round((withCTA.length / withEngagement.length) * 100) : 0;
    const pdfRate      = withEngagement.length > 0 ? Math.round((withPDF.length / withEngagement.length) * 100) : 0;

    // ── Notes activity ──
    const notesByType = { note: 0, action: 0, flag: 0, insight: 0 } as Record<string, number>;
    const notesBySubmission: Record<string, number> = {};

    notes.forEach((n: any) => {
      if (n.type && notesByType[n.type] !== undefined) notesByType[n.type]++;
      if (n.submissionId) {
        notesBySubmission[n.submissionId] = (notesBySubmission[n.submissionId] || 0) + 1;
      }
    });

    const submissionsWithNotes = Object.keys(notesBySubmission).length;

    // ── Top engaged leads (by view count + CTA bonus) ──
    const engagedLeads = submissions
      .filter((s: any) => s.engagement?.firstViewedAt)
      .map((s: any) => ({
        id:           s.id,
        company:      s.company,
        industry:     s.industry,
        status:       s.status,
        viewCount:    s.engagement?.reportViewCount || 0,
        lastViewedAt: s.engagement?.lastViewedAt,
        ctaClicked:   !!s.engagement?.ctaClickedAt,
        pdfSaved:     !!s.engagement?.pdfPrintedAt,
        noteCount:    notesBySubmission[s.id] || 0,
        engagementScore:
          (s.engagement?.reportViewCount || 0) * 10
          + (s.engagement?.ctaClickedAt ? 30 : 0)
          + (s.engagement?.pdfPrintedAt ? 15 : 0)
          + (notesBySubmission[s.id] || 0) * 5,
      }))
      .sort((a: any, b: any) => b.engagementScore - a.engagementScore)
      .slice(0, 10);

    // ── Top commented submissions ──
    const topCommented = Object.entries(notesBySubmission)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([subId, count]) => {
        const sub = submissions.find((s: any) => s.id === subId);
        return { id: subId, company: sub?.company || subId, count };
      });

    // ── Recent activity feed (last 25 events across views + notes) ──
    type ActivityEvent = {
      type: string; company: string; detail: string; timestamp: string; submissionId: string;
    };
    const recentActivity: ActivityEvent[] = [];

    submissions.forEach((s: any) => {
      if (s.engagement?.lastViewedAt) {
        recentActivity.push({
          type: 'report_viewed',
          company: s.company,
          detail: `Viewed ${s.engagement.reportViewCount}x`,
          timestamp: s.engagement.lastViewedAt,
          submissionId: s.id,
        });
      }
      if (s.engagement?.ctaClickedAt) {
        recentActivity.push({
          type: 'cta_clicked',
          company: s.company,
          detail: 'Clicked Schedule Call',
          timestamp: s.engagement.ctaClickedAt,
          submissionId: s.id,
        });
      }
      if (s.engagement?.pdfPrintedAt) {
        recentActivity.push({
          type: 'pdf_printed',
          company: s.company,
          detail: 'Saved report as PDF',
          timestamp: s.engagement.pdfPrintedAt,
          submissionId: s.id,
        });
      }
    });

    notes.forEach((n: any) => {
      recentActivity.push({
        type: 'note_added',
        company: n.submissionId,   // will be enriched client-side
        detail: `${n.authorName}: ${n.content.substring(0, 60)}${n.content.length > 60 ? '…' : ''}`,
        timestamp: n.createdAt,
        submissionId: n.submissionId,
      });
    });

    recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return c.json({
      success: true,
      engagement: {
        reportDelivery: {
          reportAvailable,
          totalViewed: withEngagement.length,
          totalCTAClicked: withCTA.length,
          totalPDFSaved: withPDF.length,
          totalViews,
          avgViewsPerViewed,
          viewRate,
          ctaRate,
          pdfRate,
        },
        notes: {
          total: notes.length,
          submissionsWithNotes,
          byType: notesByType,
          topCommented,
        },
        topEngagedLeads: engagedLeads,
        recentActivity: recentActivity.slice(0, 25),
      },
    });
  } catch (err) {
    console.log('Engagement analytics error:', err);
    return c.json({ error: `Failed to compute engagement analytics: ${err}` }, 500);
  }
});

// ============================================================================
// NOTIFICATIONS — LIST (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/notifications", async (c) => {
  console.log('🔍 GET /notifications endpoint hit');
  try {
    const authHeader = c.req.header('Authorization');
    console.log('🔐 Auth header present:', !!authHeader);
    
    const userId = await verifyTeamToken(authHeader);
    console.log('🔐 User ID from token:', userId ? 'valid' : 'invalid');
    if (!userId) {
      console.log('❌ Unauthorized request');
      return c.json({ error: "Unauthorized" }, 401);
    }

    console.log('📂 Fetching notifications from KV store...');
    let raw;
    try {
      raw = await kv.getByPrefix('notif:');
      console.log(`📦 Raw notifications fetched successfully: ${raw?.length || 0}`);
    } catch (kvError) {
      console.error('❌ KV store error while fetching notifications:', kvError);
      console.error('KV error stack:', kvError?.stack);
      return c.json({ 
        error: `Database error: ${kvError?.message || String(kvError)}`,
        details: 'Failed to connect to database. Please check Supabase connection.',
      }, 500);
    }
    
    console.log(`📦 Raw notifications count from KV: ${raw?.length || 0}`);
    
    // Safety check: ensure we have an array
    if (!Array.isArray(raw)) {
      console.log('⚠️ getByPrefix returned non-array:', typeof raw);
      return c.json({ success: true, notifications: [], unreadCount: 0 });
    }
    
    const notifications = raw
      .map((n, idx) => {
        try {
          const result = safeJsonParse(n);
          if (!result || typeof result !== 'object') {
            console.log(`⚠️ Notification ${idx} parsed to non-object:`, typeof result);
            return null;
          }
          if (!result.id || !result.createdAt) {
            console.log(`⚠️ Notification ${idx} missing required fields (id or createdAt)`);
            return null;
          }
          return result;
        } catch (err) {
          console.log(`❌ Failed to parse notification ${idx}:`, err);
          return null;
        }
      })
      .filter(n => n !== null)
      .sort((a, b) => {
        try {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          // Handle invalid dates (NaN)
          const aValid = !isNaN(aTime) ? aTime : 0;
          const bValid = !isNaN(bTime) ? bTime : 0;
          return bValid - aValid;
        } catch (err) {
          console.log('Sort error for notifications:', err);
          return 0;
        }
      })
      .slice(0, 50); // cap at 50 most recent

    // Fetch last-read timestamp
    const lastReadRaw = await kv.get('notifs_last_read_at');
    // Handle both string and parsed object cases
    let lastReadAt: Date;
    if (!lastReadRaw) {
      lastReadAt = new Date(0);
    } else if (typeof lastReadRaw === 'string') {
      lastReadAt = new Date(lastReadRaw);
    } else {
      lastReadAt = new Date(0);
    }

    const withReadState = notifications.map(n => ({
      ...n,
      read: new Date(n.createdAt) <= lastReadAt,
    }));

    const unreadCount = withReadState.filter(n => !n.read).length;

    console.log(`✅ Fetched ${notifications.length} notifications (${unreadCount} unread, filtered from ${raw?.length || 0} raw entries)`);
    return c.json({ success: true, notifications: withReadState, unreadCount });
  } catch (err) {
    console.error('❌ Notifications list error:', err);
    console.error('   Error type:', typeof err);
    console.error('   Error name:', err?.name);
    console.error('   Error message:', err?.message);
    console.error('   Error stack:', err?.stack);
    console.error('   Error stringified:', String(err));
    return c.json({ 
      error: `Failed to fetch notifications: ${err?.message || String(err)}`,
      errorType: err?.name || 'Unknown',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

// ============================================================================
// NOTIFICATIONS — MARK ALL READ (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/notifications/read", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await kv.set('notifs_last_read_at', new Date().toISOString());
    return c.json({ success: true });
  } catch (err) {
    console.log('Mark notifications read error:', err);
    return c.json({ error: `Failed to mark notifications: ${err}` }, 500);
  }
});

// ============================================================================
// NOTES — LIST (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/submissions/:id/notes", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const raw = await kv.getByPrefix(`note:${submissionId}:`);
    const rawArray = Array.isArray(raw) ? raw : [];
    const notes = rawArray
      .map(n => {
        try {
          return safeJsonParse(n);
        } catch (err) {
          console.log('Failed to parse note:', err);
          return null;
        }
      })
      .filter(n => n && typeof n === 'object' && n.id)
      .sort((a, b) => {
        try {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return (!isNaN(aTime) ? aTime : 0) - (!isNaN(bTime) ? bTime : 0);
        } catch {
          return 0;
        }
      });

    return c.json({ success: true, notes });
  } catch (err) {
    console.log('List notes error:', err);
    return c.json({ error: `Failed to fetch notes: ${err}` }, 500);
  }
});

// ============================================================================
// NOTES — ADD (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/submissions/:id/notes", async (c) => {
  try {
    const token = c.req.header('Authorization');
    const userId = await verifyTeamToken(token);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const { content, type } = await c.req.json();

    if (!content?.trim()) return c.json({ error: "Note content is required" }, 400);

    // Get author info from token
    const rawToken = token?.split(' ')[1];
    const { data: { user } } = await supabaseAdmin.auth.getUser(rawToken!);
    const authorName  = user?.user_metadata?.name  || user?.email?.split('@')[0] || 'Team Member';
    const authorEmail = user?.email || '';

    const noteId = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const kvKey  = `note:${submissionId}:${noteId}`;

    const note = {
      id:           noteId,
      kvKey,
      submissionId,
      content:      content.trim(),
      type:         type || 'note',
      authorName,
      authorEmail,
      createdAt:    new Date().toISOString(),
    };

    await kv.set(kvKey, JSON.stringify(note));
    console.log(`✅ Note added to ${submissionId} by ${authorEmail}`);

    return c.json({ success: true, note });
  } catch (err) {
    console.log('Add note error:', err);
    return c.json({ error: `Failed to add note: ${err}` }, 500);
  }
});

// ============================================================================
// NOTES — DELETE (team auth required)
// ============================================================================

app.delete("/make-server-324f4fbe/submissions/:id/notes/:noteId", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const noteId       = c.req.param('noteId');
    const kvKey        = `note:${submissionId}:${noteId}`;

    await kv.del(kvKey);
    console.log(`✅ Note ${noteId} deleted from ${submissionId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Delete note error:', err);
    return c.json({ error: `Failed to delete note: ${err}` }, 500);
  }
});

// ============================================================================
// REVIEWER CHECKLIST — persist CortexReviewerModule quality-gate reviews
// KV key pattern: review:{submissionId}:{reviewType}  →  JSON ReviewerChecklist
// reviewType ∈ { report, call-prep, proposal }
// Team auth required — reviews are internal quality-control artifacts.
// ============================================================================

const REVIEW_TYPES = new Set(['report', 'call-prep', 'proposal']);

// GET /submissions/:id/review/:reviewType — fetch stored review (or null)
app.get("/make-server-324f4fbe/submissions/:id/review/:reviewType", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const reviewType   = c.req.param('reviewType');
    if (!REVIEW_TYPES.has(reviewType)) {
      return c.json({ error: `Invalid reviewType: ${reviewType}` }, 400);
    }

    const raw = await kv.get(`review:${submissionId}:${reviewType}`);
    const review = raw ? safeJsonParse(raw) : null;
    return c.json({ success: true, review });
  } catch (err) {
    console.log('Get review error:', err);
    return c.json({ error: `Failed to fetch review: ${err}` }, 500);
  }
});

// PUT /submissions/:id/review/:reviewType — save/replace the review checklist
app.put("/make-server-324f4fbe/submissions/:id/review/:reviewType", async (c) => {
  try {
    const token  = c.req.header('Authorization');
    const userId = await verifyTeamToken(token);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const reviewType   = c.req.param('reviewType');
    if (!REVIEW_TYPES.has(reviewType)) {
      return c.json({ error: `Invalid reviewType: ${reviewType}` }, 400);
    }

    const body = await c.req.json();
    const checklist = body?.checklist;
    if (!checklist || typeof checklist !== 'object') {
      return c.json({ error: "Missing checklist payload" }, 400);
    }

    // Resolve reviewer identity from the auth token (authoritative over client)
    const rawToken = token?.split(' ')[1];
    let reviewerName = 'Team Member';
    let reviewerEmail = '';
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(rawToken!);
      reviewerName  = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Team Member';
      reviewerEmail = user?.email || '';
    } catch { /* demo/service tokens — keep defaults */ }

    const record = {
      ...checklist,
      lead_id:       submissionId,
      review_type:   reviewType,
      reviewer_name: reviewerName,
      reviewer_email: reviewerEmail,
      updated_at:    new Date().toISOString(),
    };

    await kv.set(`review:${submissionId}:${reviewType}`, JSON.stringify(record));
    console.log(`✅ Review saved for ${submissionId} (${reviewType}) by ${reviewerEmail || userId}`);
    return c.json({ success: true, review: record });
  } catch (err) {
    console.log('Save review error:', err);
    return c.json({ error: `Failed to save review: ${err}` }, 500);
  }
});

// ============================================================================
// OBJECTION ESCALATIONS — persist ObjectionHandlerPanel escalation protocol
// KV key pattern: escalation:{submissionId}:{escalationId}  →  JSON record
// Team auth required — escalations are internal revenue-control artifacts.
// ============================================================================

const OBJECTION_TYPES = new Set(['price', 'risk', 'timing', 'trust', 'internal_alignment']);

// GET /submissions/:id/escalations — list escalations for a submission (newest first)
app.get("/make-server-324f4fbe/submissions/:id/escalations", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const raw = await kv.getByPrefix(`escalation:${submissionId}:`);
    const rawArray = Array.isArray(raw) ? raw : [];
    const escalations = rawArray
      .map(e => { try { return safeJsonParse(e); } catch { return null; } })
      .filter(e => e && typeof e === 'object' && e.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ success: true, escalations });
  } catch (err) {
    console.log('List escalations error:', err);
    return c.json({ error: `Failed to fetch escalations: ${err}` }, 500);
  }
});

// POST /submissions/:id/escalations — record a new escalation
app.post("/make-server-324f4fbe/submissions/:id/escalations", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const body = await c.req.json();
    const {
      proposalId, objectionType, confidence, atRisk,
      inputExcerpt, companyName, contactName,
    } = body;

    if (!OBJECTION_TYPES.has(objectionType)) {
      return c.json({ error: `Invalid objectionType: ${objectionType}` }, 400);
    }

    // Server computes recurrence from previously stored, still-active escalations
    // of the same objection type — this is the authoritative detection count.
    const raw = await kv.getByPrefix(`escalation:${submissionId}:`);
    const prior = (Array.isArray(raw) ? raw : [])
      .map(e => { try { return safeJsonParse(e); } catch { return null; } })
      .filter(e => e && e.objectionType === objectionType && e.status !== 'resolved');
    const detectionCount = prior.length + 1;
    const status = detectionCount >= 2 ? 'persistent' : 'active';

    const id = `esc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const escalation = {
      id,
      submissionId,
      proposalId:   proposalId ?? null,
      objectionType,
      confidence:   typeof confidence === 'number' ? confidence : 0,
      atRisk:       Boolean(atRisk),
      detectionCount,
      status,
      inputExcerpt: typeof inputExcerpt === 'string' ? inputExcerpt.slice(0, 500) : '',
      companyName:  companyName ?? '',
      contactName:  contactName ?? '',
      createdBy:    userId,
      createdAt:    new Date().toISOString(),
      resolvedAt:   null as string | null,
    };

    await kv.set(`escalation:${submissionId}:${id}`, JSON.stringify(escalation));
    console.log(`⚑ Escalation recorded for ${submissionId}: ${objectionType} ×${detectionCount} (${status})`);
    return c.json({ success: true, escalation, detectionCount });
  } catch (err) {
    console.log('Create escalation error:', err);
    return c.json({ error: `Failed to record escalation: ${err}` }, 500);
  }
});

// PATCH /submissions/:id/escalations/:escalationId — resolve an escalation
app.patch("/make-server-324f4fbe/submissions/:id/escalations/:escalationId", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const escalationId = c.req.param('escalationId');
    const body = await c.req.json().catch(() => ({}));
    const status = body?.status === 'resolved' ? 'resolved' : null;
    if (!status) return c.json({ error: "Only { status: 'resolved' } is supported" }, 400);

    const kvKey = `escalation:${submissionId}:${escalationId}`;
    const existing = safeJsonParse(await kv.get(kvKey));
    if (!existing) return c.json({ error: "Escalation not found" }, 404);

    const updated = { ...existing, status: 'resolved', resolvedAt: new Date().toISOString() };
    await kv.set(kvKey, JSON.stringify(updated));
    console.log(`✅ Escalation ${escalationId} resolved on ${submissionId}`);
    return c.json({ success: true, escalation: updated });
  } catch (err) {
    console.log('Resolve escalation error:', err);
    return c.json({ error: `Failed to resolve escalation: ${err}` }, 500);
  }
});

// ============================================================================
// INSTANT BOOKING — persist priority-call bookings from the score page / portal
// KV key pattern: booking:{bookingId}  →  JSON BookingRecord (schemaVersion 2)
// Email index:    booking_email:{email} → latest bookingId
// POST is public (booking happens pre-auth on the score page). GET is team-only.
// ============================================================================

// POST /bookings — create a booking (public — anon key)
app.post("/make-server-324f4fbe/bookings", async (c) => {
  try {
    const body = await c.req.json();
    const id = `bk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const result = normalizeBooking(body, id, new Date().toISOString());

    if (!result.ok) {
      const message = result.reason === 'INVALID_EMAIL'
        ? 'A valid contact email is required'
        : 'A valid scheduled time is required';
      return c.json({ error: message, reason: result.reason }, 400);
    }

    const booking = result.record;
    await kv.set(`booking:${booking.id}`, JSON.stringify(booking));
    await kv.set(`booking_email:${booking.contactEmail}`, booking.id);
    console.log(`📅 Booking ${booking.id} stored for ${booking.contactEmail} @ ${booking.scheduledAt} (priority=${booking.priority})`);

    return c.json({ success: true, booking });
  } catch (err) {
    console.log('Create booking error:', err);
    return c.json({ error: `Failed to create booking: ${err}` }, 500);
  }
});

// GET /bookings — list all bookings, newest first (team auth)
app.get("/make-server-324f4fbe/bookings", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const raw = await kv.getByPrefix('booking:');
    const rawArray = Array.isArray(raw) ? raw : [];
    // migrateBookingRecord upgrades any legacy/stub record to the v2 shape on read.
    const bookings: BookingRecord[] = rawArray
      .map(b => { try { return migrateBookingRecord(safeJsonParse(b)); } catch { return null; } })
      .filter((b): b is BookingRecord => Boolean(b && b.contactEmail))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return c.json({ success: true, bookings, count: bookings.length });
  } catch (err) {
    console.log('List bookings error:', err);
    return c.json({ error: `Failed to fetch bookings: ${err}` }, 500);
  }
});

// ============================================================================
// BLOCK REGISTRY — persist BlockRegistryPanel blocks/revisions/locks per proposal
// KV key: blockreg:{proposalId} → { proposalId, blocks, revisions, locks, rev, updatedAt }
// `rev` is a monotonically-increasing document revision used for optimistic
// locking: a PUT that carries a stale baseRev is rejected with 409 so concurrent
// editors never silently clobber each other. Team auth required.
// ============================================================================

// GET /proposals/:proposalId/blocks — fetch the stored registry snapshot (or null)
app.get("/make-server-324f4fbe/proposals/:proposalId/blocks", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const proposalId = c.req.param('proposalId');
    const raw = await kv.get(`blockreg:${proposalId}`);
    const registry = raw ? safeJsonParse(raw) : null;
    return c.json({ success: true, registry });
  } catch (err) {
    console.log('Get block registry error:', err);
    return c.json({ error: `Failed to fetch block registry: ${err}` }, 500);
  }
});

// PUT /proposals/:proposalId/blocks — save snapshot (optimistic-locked by baseRev)
app.put("/make-server-324f4fbe/proposals/:proposalId/blocks", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const proposalId = c.req.param('proposalId');
    const body = await c.req.json();
    const { blocks, revisions, locks, baseRev } = body;

    if (!Array.isArray(blocks) || !Array.isArray(revisions) || !Array.isArray(locks)) {
      return c.json({ error: "blocks, revisions and locks must be arrays" }, 400);
    }

    const existing = safeJsonParse(await kv.get(`blockreg:${proposalId}`));
    const currentRev: number = existing?.rev ?? 0;

    // Optimistic concurrency: reject stale writes when a baseRev is supplied.
    if (typeof baseRev === 'number' && existing && baseRev !== currentRev) {
      return c.json({
        error: "Registry was modified by another session",
        conflict: true,
        currentRev,
      }, 409);
    }

    const registry = {
      proposalId,
      blocks,
      revisions,
      locks,
      rev: currentRev + 1,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`blockreg:${proposalId}`, JSON.stringify(registry));
    console.log(`🧱 Block registry ${proposalId} saved — rev ${registry.rev} (${blocks.length} blocks, ${revisions.length} revs, ${locks.length} locks)`);
    return c.json({ success: true, registry });
  } catch (err) {
    console.log('Save block registry error:', err);
    return c.json({ error: `Failed to save block registry: ${err}` }, 500);
  }
});

// ============================================================================
// MESSAGING — TEAM (auth required) — defined BEFORE client routes to avoid clash
// ============================================================================

// GET /submissions/:id/messages/team  — fetch thread + mark read
app.get("/make-server-324f4fbe/submissions/:id/messages/team", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');

    // Fetch all messages for this submission
    const raw = await kv.getByPrefix(`msg:${submissionId}:`);
    const rawArray = Array.isArray(raw) ? raw : [];
    const messages = rawArray
      .map(m => { try { return typeof m === 'string' ? JSON.parse(m) : m; } catch { return null; } })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        try {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return (!isNaN(aTime) ? aTime : 0) - (!isNaN(bTime) ? bTime : 0);
        } catch {
          return 0;
        }
      });

    // Compute unread client messages (client msgs since last team read)
    const lastReadRaw = await kv.get(`msg_read:${submissionId}`);
    const lastReadAt  = lastReadRaw ? new Date(lastReadRaw).getTime() : 0;
    const unreadFromClient = messages.filter(
      (m: any) => m.author === 'client' && new Date(m.createdAt).getTime() > lastReadAt
    ).length;

    // Mark as read — update timestamp to now
    await kv.set(`msg_read:${submissionId}`, new Date().toISOString());

    console.log(`✅ Team fetched messages for ${submissionId}: ${messages.length} msgs, ${unreadFromClient} unread`);
    return c.json({ success: true, messages, unreadFromClient });
  } catch (err) {
    console.log('Team get messages error:', err);
    return c.json({ error: `Failed to fetch messages: ${err}` }, 500);
  }
});

// POST /submissions/:id/messages/team  — team sends a reply
app.post("/make-server-324f4fbe/submissions/:id/messages/team", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const { content, authorName } = await c.req.json();
    if (!content?.trim()) return c.json({ error: "content is required" }, 400);

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id:           msgId,
      submissionId,
      author:       'team',
      authorName:   authorName || 'Team',
      content:      content.trim(),
      createdAt:    new Date().toISOString(),
    };

    await kv.set(`msg:${submissionId}:${msgId}`, JSON.stringify(message));

    // Email client — always transactional (no gate needed; it's a reply they're waiting for)
    const subRawReply = await kv.get(`sub:${submissionId}`);
    if (subRawReply) {
      const subReply = JSON.parse(subRawReply);
      sendTeamReplyEmail(subReply, content.trim(), authorName || 'Team').catch(err =>
        console.log('Team-reply email error (non-fatal):', err)
      );
    }

    console.log(`✅ Team reply stored for ${submissionId} by ${authorName}`);
    return c.json({ success: true, message });
  } catch (err) {
    console.log('Team post message error:', err);
    return c.json({ error: `Failed to send reply: ${err}` }, 500);
  }
});

// ============================================================================
// MESSAGING — CLIENT (public — submissionId is the implicit credential)
// ============================================================================

// GET /submissions/:id/messages  — client reads thread
app.get("/make-server-324f4fbe/submissions/:id/messages", async (c) => {
  try {
    const submissionId = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), submissionId, c.req.query('email'));
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const raw = await kv.getByPrefix(`msg:${submissionId}:`);
    const rawArray = Array.isArray(raw) ? raw : [];
    const messages = rawArray
      .map(m => { try { return typeof m === 'string' ? JSON.parse(m) : m; } catch { return null; } })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        try {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return (!isNaN(aTime) ? aTime : 0) - (!isNaN(bTime) ? bTime : 0);
        } catch {
          return 0;
        }
      });

    return c.json({ success: true, messages });
  } catch (err) {
    console.log('Client get messages error:', err);
    return c.json({ error: `Failed to fetch messages: ${err}` }, 500);
  }
});

// POST /submissions/:id/messages  — client sends a message
app.post("/make-server-324f4fbe/submissions/:id/messages", async (c) => {
  try {
    const submissionId = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), submissionId);
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const { content, clientName } = await c.req.json();
    if (!content?.trim()) return c.json({ error: "content is required" }, 400);

    // Verify the submission exists before allowing a message
    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);
    const sub = JSON.parse(subRaw);

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id:           msgId,
      submissionId,
      author:       'client',
      authorName:   clientName || sub.contact || 'Client',
      content:      content.trim(),
      createdAt:    new Date().toISOString(),
    };

    await kv.set(`msg:${submissionId}:${msgId}`, JSON.stringify(message));

    // Notify the team of the new client message
    await storeNotification({
      type:         'new_submission',
      title:        'New Client Message',
      message:      `${sub.company}: "${content.trim().slice(0, 80)}${content.length > 80 ? '…' : ''}"`,
      submissionId,
      meta:         { company: sub.company, clientName: message.authorName },
    });

    // Email team — gated by messageReceived pref
    const notifPrefsMsg = await getNotifPrefs();
    const teamEmailMsg  = await getTeamEmail();
    fireEmail(
      notifPrefsMsg.messageReceived !== false,
      () => sendNewClientMessageEmail(sub, content.trim(), teamEmailMsg),
      'messageReceived',
    );

    console.log(`✅ Client message stored for ${submissionId} from ${message.authorName}`);
    return c.json({ success: true, message });
  } catch (err) {
    console.log('Client post message error:', err);
    return c.json({ error: `Failed to send message: ${err}` }, 500);
  }
});

// ============================================================================
// PROPOSALS — TEAM (auth required)
// ============================================================================

// GET /submissions/:id/proposal  — fetch stored proposal (or null)
app.get("/make-server-324f4fbe/submissions/:id/proposal", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const raw = await kv.get(`proposal:${submissionId}`);
    const proposal = raw ? JSON.parse(raw) : null;

    return c.json({ success: true, proposal });
  } catch (err) {
    console.log('Get proposal error:', err);
    return c.json({ error: `Failed to fetch proposal: ${err}` }, 500);
  }
});

// POST /submissions/:id/proposal  — save/update draft
app.post("/make-server-324f4fbe/submissions/:id/proposal", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const proposal = await c.req.json();

    if (!proposal || !proposal.proposal_id) {
      return c.json({ error: "Valid proposal object required" }, 400);
    }

    // Preserve sent/viewed/accepted/rejected status — only allow saving 'draft'
    const stored = await kv.get(`proposal:${submissionId}`);
    const existing = stored ? JSON.parse(stored) : null;
    const preserveStatus = existing?.status && existing.status !== 'draft';
    const toSave = {
      ...proposal,
      status: preserveStatus ? existing.status : (proposal.status || 'draft'),
      submissionId,
      savedAt: new Date().toISOString(),
    };

    await kv.set(`proposal:${submissionId}`, JSON.stringify(toSave));

    console.log(`✅ Proposal saved (draft) for ${submissionId}`);
    return c.json({ success: true, proposal: toSave });
  } catch (err) {
    console.log('Save proposal error:', err);
    return c.json({ error: `Failed to save proposal: ${err}` }, 500);
  }
});

// POST /submissions/:id/proposal/send  — send proposal to client
app.post("/make-server-324f4fbe/submissions/:id/proposal/send", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const raw = await kv.get(`proposal:${submissionId}`);
    if (!raw) return c.json({ error: "No proposal found — save a draft first" }, 404);

    const proposal = JSON.parse(raw);

    if (proposal.status === 'accepted' || proposal.status === 'rejected') {
      return c.json({ error: "Proposal has already been responded to" }, 400);
    }

    const updated = {
      ...proposal,
      status: 'sent',
      sent_date: new Date().toISOString(),
    };

    await kv.set(`proposal:${submissionId}`, JSON.stringify(updated));

    // Fetch submission for notification
    const subRaw = await kv.get(`sub:${submissionId}`);
    const sub = subRaw ? JSON.parse(subRaw) : null;
    const company = sub?.company || submissionId;

    // Fire team notification
    await storeNotification({
      type:         'status_change',
      title:        'Proposal Sent',
      message:      `Proposal sent to ${company} — awaiting client response`,
      submissionId,
      meta:         { company, action: 'proposal_sent' },
    });

    // Email client — proposal sent (always transactional)
    if (sub) {
      sendProposalSentEmail(sub, updated).catch(err =>
        console.log('Proposal-sent email error (non-fatal):', err)
      );
    }

    console.log(`✅ Proposal sent to client for ${submissionId} (${company})`);
    return c.json({ success: true, proposal: updated });
  } catch (err) {
    console.log('Send proposal error:', err);
    return c.json({ error: `Failed to send proposal: ${err}` }, 500);
  }
});

// ============================================================================
// PROPOSALS — CLIENT (public)
// ============================================================================

// GET /client/submission/:id/proposal  — client views proposal
app.get("/make-server-324f4fbe/client/submission/:id/proposal", async (c) => {
  try {
    const submissionId = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), submissionId, c.req.query('email'));
    if (!access.ok) return c.json({ error: access.error }, access.status);

    // Verify submission exists
    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);

    const raw = await kv.get(`proposal:${submissionId}`);
    if (!raw) return c.json({ success: true, proposal: null });

    const proposal = JSON.parse(raw);

    // Only expose sent/viewed/accepted/rejected proposals to client
    if (proposal.status === 'draft') {
      return c.json({ success: true, proposal: null });
    }

    // Auto-advance 'sent' → 'viewed' on first client open
    if (proposal.status === 'sent') {
      const viewed = {
        ...proposal,
        status: 'viewed',
        viewed_at: new Date().toISOString(),
      };
      await kv.set(`proposal:${submissionId}`, JSON.stringify(viewed));

      const sub = JSON.parse(subRaw);
      await storeNotification({
        type:    'status_change',
        title:   'Proposal Viewed',
        message: `${sub.company} opened the proposal`,
        submissionId,
        meta:    { company: sub.company, action: 'proposal_viewed' },
      });

      // Email team — gated by proposalViewed pref
      const notifPrefsView = await getNotifPrefs();
      const teamEmailView  = await getTeamEmail();
      fireEmail(
        notifPrefsView.proposalViewed !== false,
        () => sendTeamProposalViewedEmail(sub, teamEmailView),
        'proposalViewed',
      );

      return c.json({ success: true, proposal: viewed });
    }

    return c.json({ success: true, proposal });
  } catch (err) {
    console.log('Client get proposal error:', err);
    return c.json({ error: `Failed to fetch proposal: ${err}` }, 500);
  }
});

// POST /client/submission/:id/proposal/respond  — client accepts or declines
app.post("/make-server-324f4fbe/client/submission/:id/proposal/respond", async (c) => {
  try {
    const submissionId = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), submissionId);
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const { response, clientName } = await c.req.json();

    if (response !== 'accepted' && response !== 'rejected') {
      return c.json({ error: "response must be 'accepted' or 'rejected'" }, 400);
    }

    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);
    const sub = JSON.parse(subRaw);

    const raw = await kv.get(`proposal:${submissionId}`);
    if (!raw) return c.json({ error: "No proposal found" }, 404);

    const proposal = JSON.parse(raw);
    if (proposal.status === 'draft') return c.json({ error: "Proposal has not been sent yet" }, 400);
    if (proposal.status === 'accepted' || proposal.status === 'rejected') {
      return c.json({ success: true, proposal }); // Idempotent
    }

    const updated = {
      ...proposal,
      status: response,
      accepted_at: response === 'accepted' ? new Date().toISOString() : undefined,
      rejected_at: response === 'rejected' ? new Date().toISOString() : undefined,
      accepted_by: clientName || sub.contact,
    };

    await kv.set(`proposal:${submissionId}`, JSON.stringify(updated));

    // If accepted, update submission to 'approved'
    if (response === 'accepted') {
      const updatedSub = { ...sub, status: 'approved', updatedAt: new Date().toISOString() };
      await kv.set(`sub:${submissionId}`, JSON.stringify(updatedSub));
    }

    await storeNotification({
      type:    response === 'accepted' ? 'status_change' : 'status_change',
      title:   response === 'accepted' ? '🎉 Proposal Accepted!' : 'Proposal Declined',
      message: response === 'accepted'
        ? `${sub.company} accepted the proposal — ready to start!`
        : `${sub.company} declined the proposal`,
      submissionId,
      meta: { company: sub.company, response, clientName: clientName || sub.contact },
    });

    // Email team — gated by proposalAccepted pref (also fires for rejected)
    const notifPrefsResp = await getNotifPrefs();
    const teamEmailResp  = await getTeamEmail();
    fireEmail(
      notifPrefsResp.proposalAccepted !== false,
      () => sendProposalRespondedEmail(sub, response, teamEmailResp),
      'proposalAccepted',
    );

    console.log(`✅ Proposal ${response} by client for ${submissionId}`);
    return c.json({ success: true, proposal: updated });
  } catch (err) {
    console.log('Client respond to proposal error:', err);
    return c.json({ error: `Failed to respond to proposal: ${err}` }, 500);
  }
});

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

// GET /team/members  — list all team members
app.get("/make-server-324f4fbe/team/members", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    // All users with role:'team' in Supabase auth
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;

    const teamUsers = (users || []).filter(u => u.user_metadata?.role === 'team');

    const members = teamUsers.map(u => {
      const meta = u.user_metadata || {};
      return {
        id:          u.id,
        email:       u.email || '',
        name:        meta.name || u.email?.split('@')[0] || 'Unknown',
        teamRole:    meta.teamRole || 'admin',
        status:      'active',
        joinedDate:  u.created_at,
        lastActive:  u.last_sign_in_at || null,
        isSelf:      u.id === userId,
      };
    });

    return c.json({ success: true, members });
  } catch (err) {
    console.log('Get team members error:', err);
    return c.json({ error: `Failed to fetch team members: ${err}` }, 500);
  }
});

// POST /team/invite  — create a new team member
app.post("/make-server-324f4fbe/team/invite", async (c) => {
  try {
    const auth = await requireTeamAdmin(c);
    if (!auth.ok) return auth.res;
    const callerId = auth.userId;

    const { name, email, teamRole = 'viewer', tempPassword } = await c.req.json();
    if (!name || !email) return c.json({ error: "name and email are required" }, 400);

    const password = tempPassword || `Cortex${Math.random().toString(36).slice(2, 8).toUpperCase()}!`;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, role: 'team', teamRole },
      email_confirm: true,
    });

    if (error) {
      if (error.message?.includes('already')) {
        return c.json({ error: `A user with email ${email} already exists` }, 409);
      }
      throw error;
    }

    // Get caller info for audit trail
    const { data: { user: caller } } = await supabaseAdmin.auth.admin.getUserById(callerId);

    const member = {
      id:          data.user.id,
      email:       data.user.email,
      name,
      teamRole,
      status:      'active',
      joinedDate:  new Date().toISOString(),
      invitedBy:   caller?.email || 'admin',
      tempPassword: password,
    };

    await kv.set(`team:member:${data.user.id}`, JSON.stringify(member));

    console.log(`✅ Team member invited: ${email} as ${teamRole}`);
    return c.json({ success: true, member, tempPassword: password });
  } catch (err) {
    console.log('Invite team member error:', err);
    return c.json({ error: `Failed to invite team member: ${err}` }, 500);
  }
});

// PATCH /team/members/:id  — update role or name
app.patch("/make-server-324f4fbe/team/members/:id", async (c) => {
  try {
    const auth = await requireTeamAdmin(c);
    if (!auth.ok) return auth.res;

    const memberId = c.req.param('id');
    const updates = await c.req.json();   // { name?, teamRole? }

    // Update Supabase user metadata
    const meta: Record<string, any> = { role: 'team' };
    if (updates.name) meta.name = updates.name;
    if (updates.teamRole) meta.teamRole = updates.teamRole;

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(memberId, {
      user_metadata: meta,
    });
    if (error) throw error;

    console.log(`✅ Team member ${memberId} updated:`, updates);
    return c.json({ success: true, member: {
      id:       data.user.id,
      email:    data.user.email,
      name:     data.user.user_metadata?.name,
      teamRole: data.user.user_metadata?.teamRole,
    }});
  } catch (err) {
    console.log('Update team member error:', err);
    return c.json({ error: `Failed to update team member: ${err}` }, 500);
  }
});

// DELETE /team/members/:id  — remove a team member
app.delete("/make-server-324f4fbe/team/members/:id", async (c) => {
  try {
    const auth = await requireTeamAdmin(c);
    if (!auth.ok) return auth.res;
    const callerId = auth.userId;

    const memberId = c.req.param('id');
    if (memberId === callerId) return c.json({ error: "Cannot remove yourself" }, 400);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(memberId);
    if (error) throw error;

    await kv.del(`team:member:${memberId}`);

    console.log(`✅ Team member ${memberId} removed`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Remove team member error:', err);
    return c.json({ error: `Failed to remove team member: ${err}` }, 500);
  }
});

// ============================================================================
// SETTINGS
// ============================================================================

// GET /settings  — platform settings + current user info + health stats
app.get("/make-server-324f4fbe/settings", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);

    const rawSettings = await kv.get('settings:platform');
    const platformSettings = rawSettings ? JSON.parse(rawSettings) : {
      brandingName:      'CORTEX Intelligence',
      defaultAssignee:   'auto',
      autoAssign:        true,
      notificationPrefs: {
        newSubmission:   true,
        reportReady:     true,
        teamActivity:    false,
        weeklyDigest:    true,
        proposalViewed:  true,
        proposalAccepted:true,
        messageReceived: true,
      },
    };

    // Health: count submissions by status
    const allSubs = await kv.getByPrefix('sub:');
    const parsedSubs = parseSubmissions(Array.isArray(allSubs) ? allSubs : []);
    const subCounts = { new: 0, 'in-review': 0, completed: 0, approved: 0, total: 0 };
    for (const sub of parsedSubs) {
      if (sub?.status) {
        subCounts[sub.status as keyof typeof subCounts] = (subCounts[sub.status as keyof typeof subCounts] || 0) + 1;
        subCounts.total++;
      }
    }

    const recentNotifications = await kv.getByPrefix('notification:');
    const notifsArray = Array.isArray(recentNotifications) ? recentNotifications : [];
    const sortedNotifs = notifsArray
      .map((r: any) => typeof r === 'string' ? JSON.parse(r) : r)
      .sort((a: any, b: any) => {
        try {
          const aTime = new Date(b.createdAt).getTime();
          const bTime = new Date(a.createdAt).getTime();
          return (!isNaN(aTime) ? aTime : 0) - (!isNaN(bTime) ? bTime : 0);
        } catch {
          return 0;
        }
      })
      .slice(0, 8);

    return c.json({
      success: true,
      currentUser: {
        id:       user?.id,
        email:    user?.email,
        name:     user?.user_metadata?.name || 'Team Member',
        teamRole: user?.user_metadata?.teamRole || 'admin',
      },
      platformSettings,
      health: {
        submissionCounts: subCounts,
        serverTime:       new Date().toISOString(),
        recentActivity:   sortedNotifs,
      },
    });
  } catch (err) {
    console.log('Get settings error:', err);
    return c.json({ error: `Failed to load settings: ${err}` }, 500);
  }
});

// PATCH /settings  — save platform settings
app.patch("/make-server-324f4fbe/settings", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { platformSettings, profileName } = await c.req.json();

    if (platformSettings) {
      const toSave = { ...platformSettings, updatedAt: new Date().toISOString() };
      await kv.set('settings:platform', JSON.stringify(toSave));
    }

    if (profileName) {
      const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
      const meta = { ...(user?.user_metadata || {}), name: profileName, role: 'team' };
      await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: meta });
    }

    console.log(`✅ Settings updated by ${userId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Save settings error:', err);
    return c.json({ error: `Failed to save settings: ${err}` }, 500);
  }
});

// ============================================================================
// TEST EMAIL (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/test-email", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    const toEmail    = user?.email || await getTeamEmail();
    const senderName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Team Member';

    const resendConfigured = isResendConfigured();

    await sendTestEmail(toEmail, senderName);

    console.log(`✅ Test email sent to ${toEmail} (resend configured: ${resendConfigured})`);
    return c.json({
      success: true,
      sent: resendConfigured,
      resendKeyConfigured: resendConfigured,
      to: toEmail,
    });
  } catch (err) {
    console.log('Test email error:', err);
    return c.json({ error: `Failed to send test email: ${err}` }, 500);
  }
});

// ============================================================================
// WEEKLY DIGEST — manual trigger (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/email/weekly-digest", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const notifPrefs = await getNotifPrefs();
    if (!notifPrefs.weeklyDigest) {
      return c.json({ success: false, reason: 'weeklyDigest is disabled in notification preferences' });
    }

    // Aggregate stats
    const [rawSubs, rawProposals] = await Promise.all([
      kv.getByPrefix('sub:'),
      kv.getByPrefix('proposal:'),
    ]);

    const submissions = parseSubmissions(Array.isArray(rawSubs) ? rawSubs : []);

    const proposals = (Array.isArray(rawProposals) ? rawProposals : [])
      .map((p: any) => { try { return safeJsonParse(p); } catch { return null; } })
      .filter((p: any) => p && typeof p === 'object' && p.id);

    const now       = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86_400_000);
    const newThisWeek = submissions.filter((s: any) => new Date(s.submittedAt) >= weekStart).length;

    const byStatus  = { completed: 0, approved: 0 } as Record<string, number>;
    const industryCount: Record<string, number> = {};
    let totalQuality = 0;
    for (const s of submissions) {
      if (s.status === 'completed') byStatus.completed++;
      if (s.status === 'approved')  byStatus.approved++;
      totalQuality += Number(s.qualityScore) || 0;
      const ind = s.industry || 'Other';
      industryCount[ind] = (industryCount[ind] || 0) + 1;
    }

    const proposalsSent     = proposals.filter((p: any) => ['sent','viewed','accepted','rejected'].includes(p.status)).length;
    const proposalsAccepted = proposals.filter((p: any) => p.status === 'accepted').length;
    const topIndustry       = Object.entries(industryCount).sort(([,a],[,b]) => b - a)[0]?.[0] || 'N/A';
    const avgQuality        = submissions.length > 0 ? Math.round(totalQuality / submissions.length) : 0;

    const teamEmail = await getTeamEmail();
    await sendWeeklyDigestEmail({
      totalSubmissions: submissions.length,
      newThisWeek,
      completed: byStatus.completed,
      approved:  byStatus.approved,
      avgQuality,
      proposalsSent,
      proposalsAccepted,
      topIndustry,
    }, teamEmail);

    console.log(`✅ Weekly digest sent to ${teamEmail}`);
    return c.json({ success: true, to: teamEmail });
  } catch (err) {
    console.log('Weekly digest error:', err);
    return c.json({ error: `Failed to send weekly digest: ${err}` }, 500);
  }
});

// ============================================================================
// CLIENT REPORT — AI-enriched public endpoint
// ============================================================================

app.get("/make-server-324f4fbe/client/submission/:id/report", async (c) => {
  try {
    const submissionId = c.req.param('id');
    const access = await requireClientAccess(c.req.header('Authorization'), submissionId, c.req.query('email'));
    if (!access.ok) return c.json({ error: access.error }, access.status);

    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);
    const sub = JSON.parse(subRaw);

    const aiRaw = await kv.get(`cortex:${submissionId}`);
    const ai = aiRaw ? JSON.parse(aiRaw) : null;

    if (ai && ai.status === 'complete') {
      const report = buildAIClientReport(sub, ai);
      console.log(`📄 Client report served (AI-powered) for ${submissionId}`);
      return c.json({ success: true, report, aiPowered: true });
    }

    console.log(`📄 Client report: no AI analysis yet for ${submissionId}`);
    return c.json({ success: true, report: null, aiPowered: false });
  } catch (err) {
    console.log('Client report error:', err);
    return c.json({ error: `Failed to build client report: ${err}` }, 500);
  }
});

function buildAIClientReport(sub: Record<string, any>, ai: Record<string, any>): Record<string, any> {
  const readinessLevel: 'Low' | 'Medium' | 'High' =
    ['Low', 'Medium', 'High'].includes(ai.readinessScore) ? ai.readinessScore : 'Medium';

  const coreIssues = (ai.coreProblems || []).slice(0, 3).map((p: any) => ({
    title: String(p.title || 'Operational Issue'),
    problem: String(p.whatsbroken || ''),
    whyItExists: String(p.whyBreaking || ''),
    businessImpact: [String(p.whatBreaksNext || '')].filter(Boolean),
  }));

  const hm = ai.pillarHeatmap || {};
  const toColor = (s: number): 'red' | 'yellow' | 'green' =>
    s >= 4 ? 'green' : s >= 2 ? 'yellow' : 'red';
  const toLabel = (s: number): string =>
    s >= 4 ? 'Stable' : s >= 2 ? 'Needs Attention' : 'Critical Gap';

  const heatExplain: Record<string, Record<string, string>> = {
    ops: {
      green: 'Core operations run reliably with defined, consistently followed processes.',
      yellow: 'Processes exist but are inconsistently applied — creating daily variance.',
      red: 'Critical operational gaps are generating daily friction and capping throughput.',
    },
    rev: {
      green: 'Revenue systems are generating and capturing value efficiently.',
      yellow: 'Revenue processes are functional but leaking potential through manual steps.',
      red: 'Significant revenue is being left on the table through process and data gaps.',
    },
    sys: {
      green: 'Your tech stack is largely integrated with minimal manual data handling.',
      yellow: "Systems exist but don't communicate well — creating manual bridge work.",
      red: 'Tool fragmentation is creating rework, errors, and persistent data gaps.',
    },
    ai: {
      green: 'Your data and process foundations are ready for AI implementation.',
      yellow: 'Some AI-readiness foundations are in place but gaps need addressing first.',
      red: 'Foundational work is needed before AI can be applied effectively.',
    },
  };

  const operationalHeatmap = {
    operationsExecution: { score: toColor(hm.operationsExecution ?? 2), label: toLabel(hm.operationsExecution ?? 2), explanation: heatExplain.ops[toColor(hm.operationsExecution ?? 2)] },
    revenueGrowth:        { score: toColor(hm.revenueGrowth ?? 2),        label: toLabel(hm.revenueGrowth ?? 2),        explanation: heatExplain.rev[toColor(hm.revenueGrowth ?? 2)] },
    systemsAutomation:    { score: toColor(hm.systemsAutomation ?? 2),    label: toLabel(hm.systemsAutomation ?? 2),    explanation: heatExplain.sys[toColor(hm.systemsAutomation ?? 2)] },
    aiReadiness:          { score: toColor(hm.aiReadinessGovernance ?? 2), label: toLabel(hm.aiReadinessGovernance ?? 2), explanation: heatExplain.ai[toColor(hm.aiReadinessGovernance ?? 2)] },
  };

  const rec = ai.recommendation || {};
  const highImpactAI: string[] = Array.isArray(rec.focusAreas) ? rec.focusAreas.slice(0, 4) : ['Process automation', 'Data integration', 'Reporting automation'];
  const shouldNotAutomate: string[] = Array.isArray(rec.notRecommended) ? rec.notRecommended.slice(0, 2).map((nr: any) => String(nr.service || '')) : [];

  const riskFlags: any[] = ai.riskFlags || [];
  const topRisk = riskFlags.find((f: any) => f.severity === 'critical') ?? riskFlags.find((f: any) => f.severity === 'high') ?? riskFlags[0];
  const immediateRisk = topRisk?.description || 'Current operational model shows early signs of scale stress.';

  const whatThisMeansMap: Record<string, string[]> = {
    High: [
      'Your operations are structured well enough to begin meaningful AI and automation work.',
      'You have the foundational clarity to see results within 60–90 days of engagement.',
      "The risk: moving slowly while competitors automate what you're still doing manually.",
    ],
    Medium: [
      'Your operations have real foundations, but several systems are starting to create friction.',
      "You're in the zone where growth accelerates problems faster than the team can solve them.",
      'Addressing core bottlenecks now prevents a costlier restructuring in 12–18 months.',
    ],
    Low: [
      'Several foundational processes are underdefined, creating daily operational drag.',
      'Without structural changes, adding revenue increases chaos rather than capacity.',
      'The good news: these are solvable problems with a clear, sequenced plan.',
    ],
  };

  const readinessInterpMap: Record<string, string> = {
    High: `${sub.industry} businesses at this readiness level typically see 30–50% efficiency gains within 90 days of structured intervention. You have the foundations — what's needed is a focused implementation plan.`,
    Medium: `This is the most critical readiness zone. ${sub.industry} businesses here are mature enough to benefit significantly from systems work, but complex enough that doing it wrong is expensive. The window for high-ROI intervention is now.`,
    Low: `${sub.industry} businesses at this stage benefit most from foundational systems work before automation. The diagnostic identified specific gaps that, when addressed in sequence, create the conditions for rapid improvement.`,
  };

  const roi = ai.roiEstimate || {};
  const hrs = roi.hoursSavedPerMonth || {};
  const cost = roi.costAvoidedPerMonth || {};
  const rev = roi.revenueLeakageReduced || {};
  const fmt = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;

  const unlockMap: Record<string, string> = {
    'operations-audit': 'Complete visibility into your operational gaps — with a prioritised fix plan your team can execute.',
    'ai-implementation': 'AI-powered workflows that handle what your team currently does manually, at 10× the speed.',
    'automation-sprint': 'The 3–5 highest-ROI automations deployed and live within 4–6 weeks.',
    'systems-integration': 'All your key platforms communicating — no more manual data transfer, no more gaps.',
    'strategic-roadmap': 'A 90-day transformation plan sequenced for maximum ROI with minimum disruption.',
    'founder-leverage': 'A structure where your team can operate, decide, and deliver without you in every loop.',
  };

  return {
    companyName: sub.company,
    industry: sub.industry,
    generatedDate: ai.analyzedAt || new Date().toISOString(),
    contactName: sub.contact || sub.email?.split('@')[0] || 'Team',
    contactEmail: sub.email || '',
    readinessLevel,
    readinessInterpretation: readinessInterpMap[readinessLevel],
    whatThisMeans: whatThisMeansMap[readinessLevel] || whatThisMeansMap.Medium,
    immediateRisk,
    coreIssues,
    operationalHeatmap,
    highImpactAI,
    shouldNotAutomate,
    recommendedService: rec.primaryServiceLabel || rec.primaryService || 'Operations Audit',
    whyFirst: rec.reasoning || '',
    whatItUnlocks: unlockMap[rec.primaryService] || 'A clear path from current-state to a systems-driven operation.',
    impactRange: {
      hoursSavedPerMonth: `${hrs.conservative ?? 0}–${hrs.aggressive ?? 0} hours/month`,
      costLeakageReduced: `${fmt(cost.conservative ?? 0)}–${fmt(cost.aggressive ?? 0)}/month`,
      revenueAcceleration: `${fmt(rev.conservative ?? 0)}–${fmt(rev.aggressive ?? 0)}`,
      disclaimer: 'AI-generated estimates based on your diagnostic responses. Validate on discovery call.',
    },
    callSchedulingUrl: '',
  };
}

// ============================================================================
// CORTEX STATUS — all analyzed submission IDs (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/cortex/status", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const raw = await kv.getByPrefix('cortex:');
    const rawArray = Array.isArray(raw) ? raw : [];
    const analyzed: Record<string, { analyzedAt: string; aiScore: number; model: string; priority: string }> = {};

    for (const item of rawArray) {
      try {
        const ai = JSON.parse(item);
        if (ai?.submissionId && ai?.status === 'complete') {
          analyzed[ai.submissionId] = {
            analyzedAt: ai.analyzedAt,
            aiScore: ai.aiScore ?? 0,
            model: ai.model ?? 'gpt-4o-mini',
            priority: ai.priority ?? 'medium',
          };
        }
      } catch { /* skip */ }
    }

    return c.json({ success: true, analyzed, count: Object.keys(analyzed).length });
  } catch (err) {
    console.log('Cortex status error:', err);
    return c.json({ error: `Failed to fetch cortex status: ${err}` }, 500);
  }
});

// ============================================================================
// BATCH ANALYZE — run AI on multiple submissions (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/submissions/analyze-batch", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { ids } = await c.req.json();
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "ids array is required" }, 400);

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    const capped = ids.slice(0, 10);
    const results: { id: string; success: boolean; aiScore?: number; error?: string }[] = [];

    for (const submissionId of capped) {
      try {
        const subRaw = await kv.get(`sub:${submissionId}`);
        if (!subRaw) { results.push({ id: submissionId, success: false, error: 'Not found' }); continue; }
        const submission = JSON.parse(subRaw);
        const analysis = await runCortexAnalysis(submission);
        await kv.set(`cortex:${submissionId}`, JSON.stringify(analysis));
        await kv.set(`sub:${submissionId}`, JSON.stringify({
          ...submission,
          aiScore: analysis.aiScore ?? submission.aiScore,
          qualityScore: analysis.qualityScore ?? submission.qualityScore,
          priority: analysis.priority ?? submission.priority,
          updatedAt: new Date().toISOString(),
        }));
        results.push({ id: submissionId, success: true, aiScore: analysis.aiScore });
        console.log(`✅ CORTEX batch: analyzed ${submissionId} (aiScore=${analysis.aiScore})`);
      } catch (err: any) {
        console.log(`❌ CORTEX batch failed ${submissionId}:`, err);
        results.push({ id: submissionId, success: false, error: err?.message || String(err) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return c.json({ success: true, results, analyzed: successCount, total: capped.length });
  } catch (err: any) {
    console.log('Batch analyze error:', err);
    return c.json({ error: `Batch analysis failed: ${err?.message || err}`, keyMissing: String(err?.message || '').includes('OPENAI_API_KEY') }, 500);
  }
});

// ============================================================================
// CORTEX AI ANALYSIS — run OpenAI on a submission (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/submissions/:id/analyze", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');

    // Load the submission
    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);
    const submission = JSON.parse(subRaw);

    console.log(`🧠 CORTEX: Starting AI analysis for ${submissionId} (${submission.company})`);

    // Check if OPENAI_API_KEY is present
    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({
        error: 'OPENAI_API_KEY is not configured',
        hint: 'Add OPENAI_API_KEY in Supabase dashboard → Edge Functions → Secrets, then redeploy.',
        keyMissing: true,
      }, 503);
    }

    // Run the AI analysis
    const analysis = await runCortexAnalysis(submission);

    // Persist to KV
    await kv.set(`cortex:${submissionId}`, JSON.stringify(analysis));

    // Back-fill submission scores from AI
    const updatedSub = {
      ...submission,
      aiScore: analysis.aiScore ?? submission.aiScore,
      qualityScore: analysis.qualityScore ?? submission.qualityScore,
      priority: analysis.priority ?? submission.priority,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`sub:${submissionId}`, JSON.stringify(updatedSub));

    console.log(`✅ CORTEX: Analysis complete for ${submissionId} — aiScore=${analysis.aiScore}, priority=${analysis.priority}`);
    return c.json({ success: true, analysis });
  } catch (err: any) {
    console.log('CORTEX analyze error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error: `CORTEX analysis failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

// ============================================================================
// CORTEX AI ANALYSIS — retrieve stored analysis (team auth required)
// ============================================================================

app.get("/make-server-324f4fbe/submissions/:id/cortex", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const raw = await kv.get(`cortex:${submissionId}`);
    const analysis = raw ? JSON.parse(raw) : null;

    return c.json({ success: true, analysis });
  } catch (err) {
    console.log('Get cortex analysis error:', err);
    return c.json({ error: `Failed to fetch cortex analysis: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX AI ANALYSIS — delete / reset stored analysis (team auth required)
// ============================================================================

app.delete("/make-server-324f4fbe/submissions/:id/cortex", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    await kv.del(`cortex:${submissionId}`);

    console.log(`✅ CORTEX: Analysis cleared for ${submissionId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Delete cortex analysis error:', err);
    return c.json({ error: `Failed to clear cortex analysis: ${err}` }, 500);
  }
});

// ============================================================================
// HELPER — industry ID to label
// ============================================================================

function industryLabel(id: string): string {
  const map: Record<string, string> = {
    ecommerce: 'E-commerce / DTC',
    saas: 'SaaS / Software',
    agency: 'Agency / Services',
    healthcare: 'Healthcare / Medical',
    manufacturing: 'Non-Profit / Education',
    other: 'Creators / Training',
    government: 'Government / Public',
    industrial: 'Manufacturing',
    generic: 'Other Business',
  };
  return map[id] || id;
}

// ============================================================================
// OUTCOME LOGGING — log deal outcome per submission (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/submissions/:id/outcome", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const submissionId = c.req.param('id');
    const subRaw = await kv.get(`sub:${submissionId}`);
    if (!subRaw) return c.json({ error: "Submission not found" }, 404);
    const sub = JSON.parse(subRaw);

    const aiRaw = await kv.get(`cortex:${submissionId}`);
    const ai = aiRaw ? JSON.parse(aiRaw) : null;

    const body = await c.req.json();
    const { didConvert, conversionValue, lostReason, recommendationWorked, whatWeLearned, improvementAreas } = body;

    if (typeof didConvert !== 'boolean') {
      return c.json({ error: "didConvert (boolean) is required" }, 400);
    }

    const outcome = {
      submissionId,
      loggedAt: new Date().toISOString(),
      loggedBy: userId,
      didConvert,
      conversionValue: didConvert ? (parseFloat(conversionValue) || null) : null,
      lostReason: !didConvert ? (lostReason || null) : null,
      recommendationWorked: recommendationWorked ?? null,
      whatWeLearned: whatWeLearned || '',
      improvementAreas: Array.isArray(improvementAreas) ? improvementAreas : [],
      industry: sub.industry || 'Unknown',
      company: sub.company || 'Unknown',
      aiScore: sub.aiScore || 0,
      recommendedService: ai?.recommendation?.primaryServiceLabel || ai?.recommendation?.primaryService || 'Unknown',
      submittedAt: sub.submittedAt,
    };

    await kv.set(`outcome:${submissionId}`, JSON.stringify(outcome));

    if (didConvert && sub.status !== 'approved') {
      const updatedSub = { ...sub, status: 'approved', updatedAt: new Date().toISOString() };
      await kv.set(`sub:${submissionId}`, JSON.stringify(updatedSub));
    }

    console.log(`✅ Outcome logged for ${submissionId}: ${didConvert ? 'CONVERTED ($' + (outcome.conversionValue ?? 0) + ')' : 'LOST'}`);
    return c.json({ success: true, outcome });
  } catch (err) {
    console.log('Log outcome error:', err);
    return c.json({ error: `Failed to log outcome: ${err}` }, 500);
  }
});

app.get("/make-server-324f4fbe/submissions/:id/outcome", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const submissionId = c.req.param('id');
    const raw = await kv.get(`outcome:${submissionId}`);
    const outcome = raw ? JSON.parse(raw) : null;
    return c.json({ success: true, outcome });
  } catch (err) {
    console.log('Get outcome error:', err);
    return c.json({ error: `Failed to fetch outcome: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX OUTCOMES MAP — submissionId→summary map for lead cards (team auth)
// ============================================================================

app.get("/make-server-324f4fbe/cortex/outcomes", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const raw = await kv.getByPrefix('outcome:');
    const outcomes: Record<string, { didConvert: boolean; conversionValue: number | null; loggedAt: string }> = {};

    for (const item of raw) {
      try {
        const o = JSON.parse(item);
        if (o?.submissionId) {
          outcomes[o.submissionId] = {
            didConvert: o.didConvert,
            conversionValue: o.conversionValue ?? null,
            loggedAt: o.loggedAt,
          };
        }
      } catch { /* skip */ }
    }

    return c.json({ success: true, outcomes, count: Object.keys(outcomes).length });
  } catch (err) {
    console.log('Cortex outcomes error:', err);
    return c.json({ error: `Failed to fetch outcomes: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX LEARNING LOOP — aggregate all outcomes into intelligence insights
// ============================================================================

app.get("/make-server-324f4fbe/cortex/learning-loop", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const rawOutcomes = await kv.getByPrefix('outcome:');
    const outcomes = rawOutcomes
      .map((r: any) => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
      .filter(Boolean);

    if (outcomes.length === 0) {
      return c.json({ success: true, data: null, isEmpty: true });
    }

    const converted = outcomes.filter((o: any) => o.didConvert);
    const lost = outcomes.filter((o: any) => !o.didConvert);
    const total = outcomes.length;

    const conversionRate = Math.round((converted.length / total) * 100);
    const totalRevenue = converted.reduce((sum: number, o: any) => sum + (o.conversionValue || 0), 0);
    const avgDealSize = converted.length > 0 ? Math.round(totalRevenue / converted.length) : 0;

    const recRated = outcomes.filter((o: any) => o.recommendationWorked !== null);
    const recWorked = recRated.filter((o: any) => o.recommendationWorked === true);
    const recommendationAccuracy = recRated.length > 0 ? Math.round((recWorked.length / recRated.length) * 100) : null;

    const industryMap: Record<string, { total: number; converted: number; revenue: number }> = {};
    for (const o of outcomes) {
      const ind = (o as any).industry || 'Unknown';
      if (!industryMap[ind]) industryMap[ind] = { total: 0, converted: 0, revenue: 0 };
      industryMap[ind].total++;
      if ((o as any).didConvert) {
        industryMap[ind].converted++;
        industryMap[ind].revenue += (o as any).conversionValue || 0;
      }
    }
    const byIndustry = Object.entries(industryMap)
      .map(([industry, d]) => ({
        industry, total: d.total, converted: d.converted,
        conversionRate: Math.round((d.converted / d.total) * 100),
        avgDealSize: d.converted > 0 ? Math.round(d.revenue / d.converted) : 0,
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate);

    const toRate = (arr: any[]) =>
      arr.length > 0 ? Math.round((arr.filter((o: any) => o.didConvert).length / arr.length) * 100) : null;
    const highScoreArr = outcomes.filter((o: any) => o.aiScore >= 80);
    const midScoreArr  = outcomes.filter((o: any) => o.aiScore >= 60 && o.aiScore < 80);
    const lowScoreArr  = outcomes.filter((o: any) => o.aiScore < 60);
    const scoreCorrelation = {
      highScore: { range: '80+',   total: highScoreArr.length, converted: highScoreArr.filter((o: any) => o.didConvert).length, rate: toRate(highScoreArr) },
      midScore:  { range: '60–79', total: midScoreArr.length,  converted: midScoreArr.filter((o: any) => o.didConvert).length,  rate: toRate(midScoreArr) },
      lowScore:  { range: '<60',   total: lowScoreArr.length,  converted: lowScoreArr.filter((o: any) => o.didConvert).length,  rate: toRate(lowScoreArr) },
    };

    const reasonKeywords = ['budget', 'timing', 'competitor', 'wrong fit', 'no decision', 'price', 'scope', 'size'];
    const reasonMap: Record<string, number> = {};
    for (const o of lost) {
      const text = ((o as any).lostReason || '').toLowerCase();
      let matched = false;
      for (const kw of reasonKeywords) {
        if (text.includes(kw)) { reasonMap[kw] = (reasonMap[kw] || 0) + 1; matched = true; break; }
      }
      if (!matched && (o as any).lostReason) reasonMap['other'] = (reasonMap['other'] || 0) + 1;
    }
    const topLostReasons = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);

    const allAreas: string[] = [];
    for (const o of outcomes) {
      if (Array.isArray((o as any).improvementAreas)) allAreas.push(...(o as any).improvementAreas);
    }
    const areaMap: Record<string, number> = {};
    for (const area of allAreas) areaMap[area] = (areaMap[area] || 0) + 1;
    const improvementAreas = Object.entries(areaMap)
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count);

    const recentOutcomes = [...outcomes]
      .sort((a: any, b: any) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
      .slice(0, 10)
      .map((o: any) => ({
        submissionId: o.submissionId, company: o.company, industry: o.industry,
        didConvert: o.didConvert, conversionValue: o.conversionValue,
        recommendedService: o.recommendedService, recommendationWorked: o.recommendationWorked,
        aiScore: o.aiScore, loggedAt: o.loggedAt,
      }));

    let totalDays = 0; let daysCount = 0;
    for (const o of outcomes) {
      if ((o as any).submittedAt && (o as any).loggedAt) {
        const days = (new Date((o as any).loggedAt).getTime() - new Date((o as any).submittedAt).getTime()) / 86_400_000;
        if (days >= 0) { totalDays += days; daysCount++; }
      }
    }
    const avgDaysToClose = daysCount > 0 ? Math.round(totalDays / daysCount) : null;

    console.log(`✅ /cortex/learning-loop: ${total} outcomes, ${converted.length} won, ${lost.length} lost`);
    return c.json({
      success: true, isEmpty: false,
      data: {
        totalOutcomes: total, totalConverted: converted.length, totalLost: lost.length,
        conversionRate, totalRevenue, avgDealSize, recommendationAccuracy,
        byIndustry, scoreCorrelation, topLostReasons, recentOutcomes, improvementAreas, avgDaysToClose,
      },
    });
  } catch (err) {
    console.log('Learning loop error:', err);
    return c.json({ error: `Failed to compute learning loop: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX PIPELINE POSITIONS — persist kanban board positions (team auth)
// KV key: cortex:pipeline:positions  →  JSON Record<submissionId, columnId>
// ============================================================================

/** GET — fetch the stored positions map */
app.get("/make-server-324f4fbe/cortex/pipeline-positions", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const raw = await kv.get('cortex:pipeline:positions');
    const positions: Record<string, string> = raw ? JSON.parse(raw) : {};
    return c.json({ success: true, positions, count: Object.keys(positions).length });
  } catch (err) {
    console.log('Get pipeline positions error:', err);
    return c.json({ error: `Failed to fetch pipeline positions: ${err}` }, 500);
  }
});

/** POST — update one card ({ submissionId, columnId }) or bulk-merge ({ positions: {...} }) */
app.post("/make-server-324f4fbe/cortex/pipeline-positions", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const { submissionId, columnId, positions: bulkPositions } = body;

    // Read current stored map
    const raw = await kv.get('cortex:pipeline:positions');
    const current: Record<string, string> = raw ? JSON.parse(raw) : {};

    if (bulkPositions && typeof bulkPositions === 'object') {
      // Bulk merge — called when board first loads to record initial positions
      Object.assign(current, bulkPositions);
    } else if (submissionId && columnId) {
      // Single-card update — called after every drag-and-drop
      current[submissionId] = columnId;
    } else {
      return c.json({ error: "Provide { submissionId, columnId } or { positions: {...} }" }, 400);
    }

    await kv.set('cortex:pipeline:positions', JSON.stringify(current));
    console.log(`✅ Pipeline positions saved — ${Object.keys(current).length} entries`);
    return c.json({ success: true, positions: current, count: Object.keys(current).length });
  } catch (err) {
    console.log('Save pipeline positions error:', err);
    return c.json({ error: `Failed to save pipeline positions: ${err}` }, 500);
  }
});

/** DELETE — reset all saved positions (useful for debugging / full board reset) */
app.delete("/make-server-324f4fbe/cortex/pipeline-positions", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    await kv.del('cortex:pipeline:positions');
    return c.json({ success: true });
  } catch (err) {
    console.log('Reset pipeline positions error:', err);
    return c.json({ error: `Failed to reset pipeline positions: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX COLUMN CAPACITIES — persist WIP limits per kanban column (team auth)
// KV key: cortex:column:capacities  →  JSON Record<columnId, number>
// ============================================================================

/** GET — fetch stored column capacity map */
app.get("/make-server-324f4fbe/cortex/column-capacities", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const raw = await kv.get('cortex:column:capacities');
    const capacities: Record<string, number> = raw ? JSON.parse(raw) : {};
    return c.json({ success: true, capacities });
  } catch (err) {
    console.log('Get column capacities error:', err);
    return c.json({ error: `Failed to fetch column capacities: ${err}` }, 500);
  }
});

/** PUT — save the full column capacity map */
app.put("/make-server-324f4fbe/cortex/column-capacities", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const { capacities } = body;
    if (!capacities || typeof capacities !== 'object') {
      return c.json({ error: "Invalid capacities payload" }, 400);
    }
    await kv.set('cortex:column:capacities', JSON.stringify(capacities));
    console.log(`✅ Column capacities saved — ${Object.keys(capacities).length} columns`);
    return c.json({ success: true, capacities });
  } catch (err) {
    console.log('Save column capacities error:', err);
    return c.json({ error: `Failed to save column capacities: ${err}` }, 500);
  }
});

// ============================================================================
// PROPOSAL ANNOTATIONS — 13B
// KV key pattern: annotation:{submissionId}:{annotationId}
// Public — both clients and team members may annotate; no auth gate required
// ============================================================================

// GET /proposal/annotations/:submissionId — list all annotations
app.get('/make-server-324f4fbe/proposal/annotations/:submissionId', async (c) => {
  const { submissionId } = c.req.param();
  try {
    const prefix  = `annotation:${submissionId}:`;
    const records = await kv.getByPrefix(prefix);
    const annotations = records
      .map((r: any) => {
        try { return typeof r === 'string' ? JSON.parse(r) : r; }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    console.log(`✅ Fetched ${annotations.length} annotations for submission ${submissionId}`);
    return c.json({ success: true, annotations });
  } catch (err) {
    console.log('Get annotations error:', err);
    return c.json({ error: `Failed to fetch annotations: ${err}` }, 500);
  }
});

// POST /proposal/annotations/:submissionId — create annotation
app.post('/make-server-324f4fbe/proposal/annotations/:submissionId', async (c) => {
  const { submissionId } = c.req.param();
  try {
    const body = await c.req.json();
    const { selectedText, comment, author, color, sectionKey } = body;
    if (!selectedText || !author || !sectionKey) {
      return c.json({ error: 'selectedText, author and sectionKey are required' }, 400);
    }
    const id  = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const annotation = {
      id,
      submissionId,
      sectionKey,
      selectedText,
      comment:   comment || '',
      author,
      color:     color || '#FBBF24',
      createdAt: new Date().toISOString(),
    };
    await kv.set(`annotation:${submissionId}:${id}`, JSON.stringify(annotation));
    console.log(`✅ Annotation created for submission ${submissionId} by ${author}`);
    return c.json({ success: true, annotation });
  } catch (err) {
    console.log('Create annotation error:', err);
    return c.json({ error: `Failed to create annotation: ${err}` }, 500);
  }
});

// DELETE /proposal/annotations/:submissionId/:annotationId — remove annotation
app.delete('/make-server-324f4fbe/proposal/annotations/:submissionId/:annotationId', async (c) => {
  const { submissionId, annotationId } = c.req.param();
  try {
    await kv.del(`annotation:${submissionId}:${annotationId}`);
    console.log(`✅ Annotation ${annotationId} deleted for submission ${submissionId}`);
    return c.json({ success: true });
  } catch (err) {
    console.log('Delete annotation error:', err);
    return c.json({ error: `Failed to delete annotation: ${err}` }, 500);
  }
});

// ============================================================================
// EMAIL NURTURE QUEUE
// ============================================================================

// POST /email-queue — enqueue nurture emails for a submission
app.post('/make-server-324f4fbe/email-queue', async (c) => {
  try {
    const body = await c.req.json();
    const { submissionId, contactName, contactEmail, companyName, industry, readinessScore, bottleneckTheme, emails } = body;

    if (!submissionId || !contactEmail || !emails?.length) {
      return c.json({ error: 'submissionId, contactEmail and emails[] are required' }, 400);
    }

    for (const email of emails) {
      await kv.set(`emailq:${submissionId}:${email.id}`, JSON.stringify({
        ...email,
        submissionId,
        contactName,
        contactEmail,
        companyName,
        industry,
        readinessScore,
        bottleneckTheme,
      }));
    }

    const prefs = await getNotifPrefs();
    fireEmail(prefs['email_submission_received'] !== false, async () => {
      await sendClientUnderReviewEmail({
        company: companyName,
        contact: contactName,
        email: contactEmail,
        completionScore: 100,
      });
    }, 'diagnostic-received');

    console.log(`✅ Queued ${emails.length} nurture emails for ${contactEmail} (submission ${submissionId})`);
    return c.json({ success: true, queued: emails.length });
  } catch (err) {
    console.log('Email queue enqueue error:', err);
    return c.json({ error: `Failed to enqueue emails: ${err}` }, 500);
  }
});

// GET /email-queue — fetch all queued emails (team auth)
app.get('/make-server-324f4fbe/email-queue', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabaseAdmin.auth.getUser(accessToken);
    if (!user?.id) return c.json({ error: 'Unauthorized' }, 401);

    const entries = await kv.getByPrefix('emailq:');
    const emails = entries
      .map((e: any) => {
        try { return JSON.parse(e.value); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    console.log(`✅ Fetched ${emails.length} queued emails`);
    return c.json({ success: true, emails, total: emails.length });
  } catch (err) {
    console.log('Email queue fetch error:', err);
    return c.json({ error: `Failed to fetch email queue: ${err}` }, 500);
  }
});

// PATCH /email-queue/:emailId — update email status
app.patch('/make-server-324f4fbe/email-queue/:emailId', async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user } } = await supabaseAdmin.auth.getUser(accessToken);
    if (!user?.id) return c.json({ error: 'Unauthorized' }, 401);

    const { emailId } = c.req.param();
    const body = await c.req.json();
    const { status } = body;

    if (!['sent', 'skipped', 'failed'].includes(status)) {
      return c.json({ error: 'status must be sent, skipped, or failed' }, 400);
    }

    const entries = await kv.getByPrefix('emailq:');
    let found = false;
    for (const entry of entries) {
      try {
        const email = JSON.parse(entry.value);
        if (email.id === emailId) {
          email.status = status;
          if (status === 'sent') email.sentAt = new Date().toISOString();
          await kv.set(entry.key, JSON.stringify(email));
          found = true;

          // Send the actual email through Resend for ALL nurture templates
          if (status === 'sent' && email.contactEmail) {
            const prefs = await getNotifPrefs();
            const prefKey = `email_${email.templateId}`;
            fireEmail(prefs[prefKey] !== false, async () => {
              await sendNurtureEmail({
                contactEmail: email.contactEmail,
                contactName: email.contactName || 'there',
                companyName: email.companyName || 'Your Company',
                subject: email.subject || 'Update from MARQ Cortex',
                previewText: email.previewText || '',
                templateId: email.templateId,
                readinessScore: email.readinessScore,
                industry: email.industry,
                bottleneckTheme: email.bottleneckTheme,
              });
            }, `nurture-${email.templateId}`);
          }

          console.log(`✅ Email ${emailId} marked as ${status}`);
          return c.json({ success: true, email });
        }
      } catch { /* skip unparseable */ }
    }

    if (!found) return c.json({ error: 'Email not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.log('Email queue update error:', err);
    return c.json({ error: `Failed to update email: ${err}` }, 500);
  }
});

// ============================================================================
// EMAIL STATUS — check if Resend is configured (team auth required)
// ============================================================================

app.get('/make-server-324f4fbe/email/status', async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const configured = isResendConfigured();
    return c.json({
      success: true,
      resendConfigured: configured,
      fromAddress: 'MARQ Cortex <onboarding@resend.dev>',
      note: configured
        ? 'Resend API key is set. Emails will be delivered.'
        : 'No RESEND_API_KEY found. Emails are being logged but not delivered. Add the key in Supabase Dashboard → Edge Functions → Secrets.',
    });
  } catch (err) {
    console.log('Email status check error:', err);
    return c.json({ error: `Failed to check email status: ${err}` }, 500);
  }
});

// ============================================================================
// EMAIL SEND — direct send via Resend (team auth required)
// ============================================================================

app.post('/make-server-324f4fbe/email/send', async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { to, subject, html, text } = body;

    if (!to || !subject) {
      return c.json({ error: 'Missing required fields: to, subject' }, 400);
    }

    const configured = isResendConfigured();
    if (!configured) {
      console.log(`📧 [EMAIL SEND SKIPPED — no RESEND_API_KEY] to=${to} subject="${subject}"`);
      return c.json({
        success: true,
        sent: false,
        resendKeyConfigured: false,
        messageId: `skipped_${Date.now()}`,
        note: 'RESEND_API_KEY not configured — email was logged but not delivered.',
      });
    }

    // Use Resend to send
    const resendKey = Deno.env.get('RESEND_API_KEY')!;
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'MARQ Cortex <onboarding@resend.dev>',
        to: [to],
        subject,
        html: html || '',
        text: text || undefined,
      }),
    });
    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      console.log('Resend API error:', resendData);
      return c.json({ error: `Resend error: ${JSON.stringify(resendData)}` }, 502);
    }

    console.log(`✅ Email sent via Resend to ${to}: ${resendData.id}`);
    return c.json({
      success: true,
      sent: true,
      resendKeyConfigured: true,
      messageId: resendData.id,
    });
  } catch (err) {
    console.log('Email send error:', err);
    return c.json({ error: `Failed to send email: ${err}` }, 500);
  }
});

// ============================================================================
// CORTEX NARRATIVE GENERATION — GPT-4o-mini explanation layers (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/cortex/narrative", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized — valid team token required" }, 401);

    const body = await c.req.json() as NarrativeRequest;
    if (!body.type || !body.context) {
      return c.json({ error: "Missing required fields: type, context" }, 400);
    }

    const validTypes = ['why_now', 'confidence_reasoning', 'strategic_decision'];
    if (!validTypes.includes(body.type)) {
      return c.json({ error: `Invalid narrative type: ${body.type}. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    console.log(`🧠 CORTEX Narrative: Generating "${body.type}" for ${body.context.company}...`);
    const result = await generateNarrative(body);
    console.log(`✅ CORTEX Narrative: "${body.type}" generated (${result.narrative.length} chars)`);

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.log('CORTEX narrative generation error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error: `Narrative generation failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

// ============================================================================
// BLOCK AI ASSIST — ai-assist-per-block.md (anonKey is sufficient — no PII)
// ============================================================================

app.post("/make-server-324f4fbe/blocks/ai-assist", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized — valid team token required" }, 401);

    const body = await c.req.json() as BlockAIAssistRequest;

    const required = ['block_id', 'block_type', 'title', 'current_content', 'action', 'context'];
    const missing  = required.filter(k => !(k in body));
    if (missing.length > 0) {
      return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
    }

    const validActions = ['ai_improve', 'ai_expand', 'ai_simplify', 'fix_issues'];
    if (!validActions.includes(body.action)) {
      return c.json({ error: `Invalid action: ${body.action}. Must be one of: ${validActions.join(', ')}` }, 400);
    }

    if (body.block_type === 'roi_financial_snapshot') {
      return c.json({ error: 'roi_financial_snapshot is a reference block — AI editing is disabled. Edit the roi_summary_narrative block instead.' }, 422);
    }

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    console.log(`🤖 Block AI Assist: action="${body.action}" block="${body.block_id}" type="${body.block_type}"`);
    const result = await handleBlockAIAssist(body);
    console.log(`✅ Block AI Assist: completed for ${body.block_id} (diff: "${result.diff_summary}")`);

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ Block AI Assist error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error:      `Block AI assist failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

// ============================================================================
// CORTEX COPILOT — INTERPRET REQUEST (copilot-patch-plan.md)
// ============================================================================

app.post("/make-server-324f4fbe/blocks/copilot-interpret", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized — valid team token required" }, 401);

    const body = await c.req.json() as CopilotInterpretRequest;

    if (!body.user_input?.trim()) {
      return c.json({ error: 'Missing required field: user_input' }, 400);
    }
    if (!Array.isArray(body.block_summaries)) {
      return c.json({ error: 'Missing required field: block_summaries (array)' }, 400);
    }

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    console.log(`🤖 Copilot Interpret: "${body.user_input.slice(0, 60)}" scope=${body.scope} blocks=${body.block_summaries.length}`);
    const result = await handleCopilotInterpret(body);
    console.log(`✅ Copilot Interpret: intent="${result.intent}" targets=${result.targets.length} skipped=${result.skipped.length}`);

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ Copilot interpret error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error:      `Copilot interpret failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

// ============================================================================
// PROPOSAL SECTION COPILOT — section-level AI rewrite/explain (team auth required)
// Routes through the Intelligence Gateway. LLM rewrites narrative ONLY;
// authoritative fields (price, currency, duration, severity, confidence,
// evidence) are re-injected server-side and can never be altered by AI.
// ============================================================================

app.post("/make-server-324f4fbe/proposal/section-copilot", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized — valid team token required" }, 401);

    const body = await c.req.json() as ProposalSectionCopilotRequest;

    const required = ['section', 'section_label', 'action', 'current_content', 'context'];
    const missing  = required.filter(k => !(k in body));
    if (missing.length > 0) {
      return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
    }
    if (!VALID_SECTIONS.includes(body.section)) {
      return c.json({ error: `Invalid section: ${body.section}. Must be one of: ${VALID_SECTIONS.join(', ')}` }, 400);
    }
    if (!VALID_ACTIONS.includes(body.action)) {
      return c.json({ error: `Invalid action: ${body.action}. Must be one of: ${VALID_ACTIONS.join(', ')}` }, 400);
    }
    if (!body.current_content || typeof body.current_content !== 'object') {
      return c.json({ error: 'current_content must be an object' }, 400);
    }
    if (body.action === 'custom' && !body.custom_prompt?.trim()) {
      return c.json({ error: 'custom_prompt is required when action is "custom"' }, 400);
    }
    if (!body.context?.company) {
      return c.json({ error: 'context.company is required' }, 400);
    }

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    console.log(`🤖 Section Copilot: action="${body.action}" section="${body.section}" company="${body.context.company}"`);
    const result = await handleProposalSectionCopilot(body);
    console.log(`✅ Section Copilot: done (diff: "${result.diff_summary}", fact-locked: ${result.fact_lock_enforced.join(',') || 'none'})`);

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ Section Copilot error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error:      `Section copilot failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

// ============================================================================
// CORTEX GLOBAL AI CHAT — conversational AI for any section (team auth required)
// ============================================================================

app.post("/make-server-324f4fbe/ai/chat", async (c) => {
  try {
    const userId = await verifyTeamToken(c.req.header('Authorization'));
    if (!userId) return c.json({ error: "Unauthorized — valid team token required" }, 401);

    if (!Deno.env.get('OPENAI_API_KEY')) {
      return c.json({ error: 'OPENAI_API_KEY is not configured', keyMissing: true }, 503);
    }

    const body = await c.req.json() as ChatRequest;
    if (!body.message?.trim()) {
      return c.json({ error: 'Missing required field: message' }, 400);
    }

    console.log(`💬 AI Chat: section="${body.section}" message="${body.message.substring(0, 60)}..."`);
    const result = await handleCortexChat(body);
    console.log(`✅ AI Chat: reply generated (${result.reply.length} chars${result.applyContent ? ', apply block present' : ''})`);

    return c.json({ success: true, ...result });
  } catch (err: any) {
    console.error('❌ AI Chat error:', err);
    const isKeyMissing = String(err?.message || '').includes('OPENAI_API_KEY');
    return c.json({
      error:      `AI chat failed: ${err?.message || err}`,
      keyMissing: isKeyMissing,
    }, 500);
  }
});

Deno.serve(app.fetch);