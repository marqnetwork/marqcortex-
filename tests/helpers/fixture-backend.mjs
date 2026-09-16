/**
 * A CONTROLLED STAND-IN FOR THE EDGE FUNCTION.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * CP-1's whole claim is that the authenticated product now shows real data, or
 * says honestly why it cannot. Proving the first half needs a backend that
 * answers, and the second half needs one that refuses — on demand, in each of
 * the ways a real backend refuses.
 *
 * Supabase is not reachable from the environment this was built in: the
 * network policy answers 403 to a CONNECT for `*.supabase.co`, so no live
 * verification is possible here and none is claimed. This server is NOT that
 * verification and must never be reported as it. What it IS:
 *
 *   • proof that the wiring is real — the browser makes the same requests, to
 *     the same routes, with the same headers, and parses the same shapes;
 *   • the only way to drive EMPTY, ERROR and PERMISSION DENIED in a browser at
 *     all, since a live backend does not produce them to order;
 *   • deterministic, so a failure is a defect rather than a mood.
 *
 * ── THE MODES ───────────────────────────────────────────────────────────────
 *
 *   populated  a workspace with three submissions and two colleagues
 *   empty      a real workspace with nothing in it — 200s carrying []
 *   error      500 on every data route
 *   forbidden  403 on every data route
 *   down       the port answers nothing (the caller simply does not start it)
 *
 * Mode is switched at runtime by POSTing to `/__mode`, so one browser session
 * can walk a surface through all four without restarting anything.
 *
 * Every fixture here is OBVIOUSLY a fixture — "Fixture Industries", "Test
 * Contact" — precisely so that a screenshot from this harness can never be
 * mistaken for, or reported as, real customer data.
 */

import { createServer } from 'node:http';

const FN = '/functions/v1/make-server-324f4fbe';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN = 'fixture_access_token';

function submission(n, over = {}) {
  const at = new Date(Date.UTC(2026, 8, 10 - n)).toISOString();
  return {
    id: `fix-sub-${n}`,
    company: `Fixture Industries ${n}`,
    contact: `Test Contact ${n}`,
    email: `contact${n}@fixture.invalid`,
    phone: '+00 000 000 000',
    website: `fixture${n}.invalid`,
    industry: 'Fixture / Testing',
    industryId: 'fixture',
    employees: '11-50',
    revenue: '$1M-$5M',
    submittedAt: at,
    submittedDate: at.slice(0, 10),
    status: ['new', 'in-review', 'completed'][n % 3],
    priority: ['high', 'medium', 'low'][n % 3],
    completionScore: 70 + n,
    qualityScore: 75 + n,
    aiScore: 65 + n,
    roiPotential: 'High',
    answers: { 1: 'A fixture answer.' },
    isRead: n % 2 === 0,
    updatedAt: at,
    ...over,
  };
}

const SUBMISSIONS = [submission(1), submission(2), submission(3)];

const MEMBERS = [
  { id: 'fix-m-1', email: 'admin@fixture.invalid', name: 'Fixture Admin', teamRole: 'admin', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'fix-m-2', email: 'review@fixture.invalid', name: 'Fixture Reviewer', teamRole: 'reviewer', createdAt: '2026-01-02T00:00:00.000Z' },
];

const ANALYTICS = {
  total: SUBMISSIONS.length,
  byStatus: { new: 1, 'in-review': 1, completed: 1, approved: 0 },
  byPriority: { high: 1, medium: 1, low: 1 },
  avgQuality: 77,
  industryBreakdown: { 'Fixture / Testing': 3 },
};

const ENGAGEMENT = {
  reportDelivery: {
    reportAvailable: 3, totalViewed: 2, totalCTAClicked: 1, totalPDFSaved: 0,
    totalViews: 4, avgViewsPerViewed: 2, viewRate: 67, ctaRate: 50, pdfRate: 0,
  },
  notes: { total: 1, submissionsWithNotes: 1, byType: { note: 1, action: 0, flag: 0, insight: 0 }, topCommented: [] },
  topEngagedLeads: [],
  recentActivity: [],
};

const REVENUE_SNAPSHOTS = [
  {
    deal_id: 'FIX-D-001', client_name: 'Fixture Industries 1',
    industry: 'Fixture / Testing', region: 'NA', owner: 'Fixture Admin',
    stage: 'proposal_viewed', value: 50_000, deal_size_band: '$50K–100K', scenario: 'expected',
    created_at: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    proposal_sent_at: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    proposal_viewed_at: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    proposal_approved_at: null, contract_signed_at: null,
    objection_type: null, objection_resolved_days: null, is_expired: false,
    projected_roi_pct: 140, actual_roi_pct: null, projected_payback_month: 9, actual_payback_month: null,
  },
];

// ── Route table ─────────────────────────────────────────────────────────────
//
// `populated` and `empty` differ only in what the DATA routes carry. Both are
// 200s: an empty workspace is a working backend, and the product must render
// it as "nothing yet" rather than as a failure.

function dataRoutes(empty) {
  const list = (full) => (empty ? [] : full);
  return {
    'GET /submissions': () => ({ success: true, submissions: list(SUBMISSIONS), total: list(SUBMISSIONS).length }),
    'GET /team/members': () => ({ success: true, members: list(MEMBERS) }),
    'GET /analytics/overview': () => ({
      success: true,
      analytics: empty
        ? { total: 0, byStatus: {}, byPriority: {}, avgQuality: 0, industryBreakdown: {} }
        : ANALYTICS,
    }),
    'GET /analytics/engagement': () => ({
      success: true,
      engagement: empty
        ? { reportDelivery: { reportAvailable: 0, totalViewed: 0, totalCTAClicked: 0, totalPDFSaved: 0, totalViews: 0, avgViewsPerViewed: 0, viewRate: 0, ctaRate: 0, pdfRate: 0 }, notes: { total: 0, submissionsWithNotes: 0, byType: {}, topCommented: [] }, topEngagedLeads: [], recentActivity: [] }
        : ENGAGEMENT,
    }),
    'GET /analytics/revenue-snapshots': () => ({ success: true, snapshots: list(REVENUE_SNAPSHOTS) }),
    'GET /notifications': () => ({ success: true, notifications: [], unreadCount: 0 }),
    'GET /cortex/status': () => ({ success: true, statuses: {} }),
    'GET /cortex/outcomes': () => ({ success: true, outcomes: {} }),
    'GET /cortex/pipeline-positions': () => ({ success: true, positions: {} }),
    'GET /cortex/column-capacities': () => ({ success: true, capacities: {} }),
    'GET /cortex/learning-loop': () => ({ success: true, learningLoop: null }),
    'GET /cortex/engagement-summary': () => ({ success: true, summary: {} }),
    'GET /email-queue': () => ({ success: true, emails: [] }),
    'GET /email/status': () => ({ success: true, configured: false, provider: null }),
    // The real shape, from `SettingsResponse` in `api.ts`. An earlier version
    // of this fixture answered `{ success, platformSettings, profileName }` and
    // the Settings page crashed on `currentUser.name` — which is how that
    // defect was found. Keeping the shape honest here is what makes this
    // harness worth running.
    'GET /settings': () => ({
      success: true,
      currentUser: {
        id: 'fix-m-1', email: 'admin@fixture.invalid',
        name: 'Fixture Admin', teamRole: 'admin',
      },
      platformSettings: {
        brandingName: 'Fixture Workspace',
        defaultAssignee: 'auto',
        autoAssign: false,
        notificationPrefs: {
          newSubmission: true, reportReady: true, teamActivity: false,
          weeklyDigest: false, proposalViewed: true, proposalAccepted: true,
          messageReceived: true,
        },
      },
      health: {
        submissionCounts: empty
          ? { new: 0, 'in-review': 0, completed: 0, approved: 0, total: 0 }
          : { new: 1, 'in-review': 1, completed: 1, approved: 0, total: 3 },
        serverTime: new Date().toISOString(),
        recentActivity: [],
      },
    }),
    'GET /bookings': () => ({ success: true, bookings: [] }),
    'GET /diagnostic': () => ({ success: true, diagnostics: [] }),
    'GET /health/enterprise': () => ({ success: true, health: null }),
    'GET /kpis': () => ({ success: true, report: null }),
  };
}

// Routes that answer the same way in every mode. Auth must keep working even
// in `empty`, or nothing downstream can be observed at all.
const ALWAYS = {
  'GET /ping': () => ({ success: true, message: 'pong', timestamp: new Date().toISOString(), server: 'fixture' }),
  'GET /health': () => ({ status: 'ok', timestamp: new Date().toISOString(), kvStore: 'fixture' }),
  'GET /test-auth': () => ({ success: true, message: 'ok', userId: 'fix-m-1', timestamp: new Date().toISOString() }),
  'POST /auth/team/login': (body) => {
    if (body?.email !== 'admin@fixture.invalid' || body?.password !== 'fixture-password') {
      return { __status: 401, error: 'Invalid credentials.' };
    }
    return {
      success: true,
      accessToken: ACCESS_TOKEN,
      user: { id: 'fix-m-1', email: body.email, name: 'Fixture Admin', teamRole: 'admin' },
    };
  },
};

// ── Server ──────────────────────────────────────────────────────────────────

export function startFixtureBackend({ port = 0, mode = 'populated' } = {}) {
  let current = mode;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        // The browser calls this cross-origin from the Vite dev server.
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
    };

    if (req.method === 'OPTIONS') return send(204, {});

    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      // Runtime mode switch, so one browser session can walk a surface through
      // populated → empty → error → forbidden without a restart.
      if (url.pathname === '/__mode') {
        if (req.method === 'POST') {
          try { current = JSON.parse(raw).mode; } catch { /* keep the current one */ }
        }
        return send(200, { mode: current });
      }

      if (!url.pathname.startsWith(FN)) return send(404, { error: 'not found' });
      const path = url.pathname.slice(FN.length) || '/';
      const key = `${req.method} ${path}`;

      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch { body = null; } }

      const always = ALWAYS[key];
      if (always) {
        const answer = always(body);
        const { __status, ...rest } = answer;
        return send(__status ?? 200, rest);
      }

      // Everything below is a DATA route, and the mode decides how it answers.
      if (current === 'error') return send(500, { error: 'The fixture backend was told to fail.' });
      if (current === 'forbidden') return send(403, { error: 'Your account cannot read this workspace.' });

      const handler = dataRoutes(current === 'empty')[key];
      if (handler) return send(200, handler(body));

      // An unknown route answers 200 with an empty success rather than 404, so
      // a surface this suite is not driving cannot fail the page it is on.
      return send(200, { success: true });
    });
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address();
      resolve({
        port: bound,
        url: `http://127.0.0.1:${bound}`,
        setMode: (next) => { current = next; },
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

export const FIXTURE_LOGIN = { email: 'admin@fixture.invalid', password: 'fixture-password' };
export const FIXTURE_SUBMISSIONS = SUBMISSIONS;
export const FIXTURE_MEMBERS = MEMBERS;

// Allow `node tests/helpers/fixture-backend.mjs --port 5199` for manual QA.
if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf('--port');
  const port = at === -1 ? 5199 : Number(process.argv[at + 1]);
  const modeAt = process.argv.indexOf('--mode');
  const mode = modeAt === -1 ? 'populated' : process.argv[modeAt + 1];
  startFixtureBackend({ port, mode }).then(s => {
    console.log(`fixture backend listening on ${s.url} (mode: ${mode})`);
  });
}
