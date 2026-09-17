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

// The organizational spine (CP-3). Structurally complete and deliberately
// small: two departments, two teams, and a person with NO console login, so
// browser QA can see that an organizational person is not an auth account.
const SPINE = {
  businessUnits: [
    { id: 'fix-bu-1', key: 'delivery', name: 'Fixture Delivery', description: 'Client work.' },
  ],
  departments: [
    { id: 'fix-dep-1', key: 'consulting', name: 'Fixture Consulting', description: 'Diagnostics.', businessUnitId: 'fix-bu-1', leadPersonId: 'fix-p-1' },
    { id: 'fix-dep-2', key: 'engineering', name: 'Fixture Engineering', description: 'The product.', businessUnitId: 'fix-bu-1', leadPersonId: null },
  ],
  people: [
    { id: 'fix-p-1', fullName: 'Fixture Admin', email: 'admin@fixture.invalid', positionTitle: 'Partner', departmentId: 'fix-dep-1', reportsToPersonId: null, status: 'active', hasConsoleAccess: true },
    { id: 'fix-p-2', fullName: 'Fixture Reviewer', email: 'review@fixture.invalid', positionTitle: 'Consultant', departmentId: 'fix-dep-1', reportsToPersonId: 'fix-p-1', status: 'active', hasConsoleAccess: true },
    { id: 'fix-p-3', fullName: 'Fixture Contractor', email: null, positionTitle: 'Contract Engineer', departmentId: 'fix-dep-2', reportsToPersonId: 'fix-p-1', status: 'active', hasConsoleAccess: false },
  ],
  teams: [
    { id: 'fix-t-1', key: 'pod', name: 'Fixture Pod', description: 'Runs engagements.', departmentId: 'fix-dep-1', leadPersonId: 'fix-p-2' },
    { id: 'fix-t-2', key: 'core', name: 'Fixture Core', description: 'Builds the product.', departmentId: 'fix-dep-2', leadPersonId: null },
  ],
  teamMemberships: [
    { teamId: 'fix-t-1', personId: 'fix-p-2', isLead: true },
    { teamId: 'fix-t-2', personId: 'fix-p-3', isLead: false },
  ],
};

const EMPTY_SPINE = {
  businessUnits: [], departments: [], people: [], teams: [], teamMemberships: [],
};

// The organization's strategy (CP-4). One goal with a risk against it and a
// decision serving it, plus a decision with NO RATIONALE — the state ONT 14.8
// calls an incomplete record and the surface is required to flag.
const STRATEGY = {
  goals: [
    { id: 'fix-g-1', statement: 'Ship the fixture rewrite', measure: 'Milestones completed',
      targetValue: '8 of 8', currentValue: '3 of 8', dueOn: '2026-12-31',
      status: 'in_progress', ownerPersonId: 'fix-p-1' },
    // No owner. The summary counts it, and the count is the point.
    { id: 'fix-g-2', statement: 'Halve the fixture build time', measure: 'p95 build duration',
      targetValue: 'under 5 min', currentValue: null, dueOn: null,
      status: 'planned', ownerPersonId: null },
  ],
  decisions: [
    { id: 'fix-d-1', statement: 'Rewrite in place rather than migrating',
      alternatives: 'Migrate; rewrite in place; do nothing',
      rationale: 'Migrating would cost two quarters the rewrite does not have.',
      goalId: 'fix-g-1', decidedByPersonId: 'fix-p-1', decidedOn: '2026-08-01',
      reviewOn: null, status: 'decided' },
    { id: 'fix-d-2', statement: 'Defer the contractor onboarding',
      alternatives: null, rationale: null, goalId: null,
      decidedByPersonId: null, decidedOn: null, reviewOn: null, status: 'proposed' },
  ],
  risks: [
    { id: 'fix-r-1', statement: 'The rewrite slips past December',
      likelihood: 'high', impact: 'high', tolerance: 'outside',
      mitigation: 'Cut scope at the November checkpoint.',
      goalId: 'fix-g-1', ownerPersonId: 'fix-p-1', status: 'mitigating' },
    // Tolerance unset: not yet assessed, and the surface says so.
    { id: 'fix-r-2', statement: 'Nobody has looked at the dependency licences',
      likelihood: 'medium', impact: 'medium', tolerance: 'unset',
      mitigation: null, goalId: null, ownerPersonId: null, status: 'open' },
  ],
};

const EMPTY_STRATEGY = { goals: [], decisions: [], risks: [] };

function strategySummary(s) {
  return {
    goals: s.goals.length,
    goalsInProgress: s.goals.filter(g => g.status === 'in_progress').length,
    goalsWithoutOwner: s.goals.filter(g => g.ownerPersonId === null).length,
    decisions: s.decisions.length,
    decisionsWithoutRationale: s.decisions.filter(d => d.rationale === null).length,
    risks: s.risks.length,
    risksOutsideTolerance: s.risks.filter(r => r.tolerance === 'outside').length,
    risksUnassessed: s.risks.filter(r => r.tolerance === 'unset').length,
  };
}

/**
 * WHAT THE WRITE PATH NEEDS FROM A FIXTURE.
 *
 * CP-4 opened writes, and a browser QA that could only read would prove half
 * the sprint. So this backend keeps a MUTABLE copy of the populated spine and
 * strategy, and the write routes change it — which is what lets a test create a
 * person and then find them in the next read, end to end, through the real
 * client code.
 *
 * Reset between tests by `POST /__mode`, so one spec's new person cannot
 * appear in another's count. Deep-cloned from the constants above, never
 * aliased: a test that mutated the template would make every later run depend
 * on the order the specs happened to run in.
 */
function freshState() {
  return {
    spine: JSON.parse(JSON.stringify(SPINE)),
    strategy: JSON.parse(JSON.stringify(STRATEGY)),
  };
}

/** Where each writable collection lives, by its URL segment. */
const WRITE_COLLECTIONS = {
  'business-units': ['spine', 'businessUnits'],
  departments: ['spine', 'departments'],
  teams: ['spine', 'teams'],
  people: ['spine', 'people'],
  goals: ['strategy', 'goals'],
  decisions: ['strategy', 'decisions'],
  risks: ['strategy', 'risks'],
};

let writeSequence = 0;

/** A create, an update or an archive against the mutable state. */
function applyWrite(state, collection, id, method, body) {
  const target = WRITE_COLLECTIONS[collection];
  if (!target) return { __status: 404, error: 'Unknown record type' };
  const list = state[target[0]][target[1]];

  if (method === 'POST') {
    // The same refusal the server gives, so a QA that drives a blank name sees
    // the real message rather than a fixture's improvisation.
    const name = body?.fullName ?? body?.name ?? body?.statement;
    if (typeof name !== 'string' || name.trim() === '') {
      return { __status: 400, error: 'A name is required.' };
    }
    const record = {
      id: `fix-new-${++writeSequence}`,
      ...defaultsFor(collection),
      ...body,
      fullName: body?.fullName ?? undefined,
    };
    // Drop the undefined the spread may have introduced.
    for (const key of Object.keys(record)) {
      if (record[key] === undefined) delete record[key];
    }
    list.push(record);
    return { success: true, record };
  }

  const index = list.findIndex(row => row.id === id);
  if (index === -1) return { __status: 404, error: 'That record is not in this organization.' };

  if (method === 'DELETE') {
    list.splice(index, 1);
    return { success: true, archived: id };
  }

  list[index] = { ...list[index], ...body };
  return { success: true, record: list[index] };
}

/** The columns a real create would default, so a new row renders like the rest. */
function defaultsFor(collection) {
  switch (collection) {
    case 'people':
      return { email: null, positionTitle: null, departmentId: null,
               reportsToPersonId: null, status: 'active', hasConsoleAccess: false };
    case 'departments':
      return { key: 'new', description: null, businessUnitId: null, leadPersonId: null };
    case 'teams':
      return { key: 'new', description: null, departmentId: null, leadPersonId: null };
    case 'business-units':
      return { key: 'new', description: null };
    case 'goals':
      return { measure: null, targetValue: null, currentValue: null, dueOn: null,
               status: 'planned', ownerPersonId: null };
    case 'decisions':
      return { alternatives: null, rationale: null, goalId: null,
               decidedByPersonId: null, decidedOn: null, reviewOn: null, status: 'proposed' };
    case 'risks':
      return { likelihood: 'medium', impact: 'medium', tolerance: 'unset', mitigation: null,
               goalId: null, ownerPersonId: null, status: 'open' };
    default:
      return {};
  }
}

function spineSummary(structure) {
  return {
    people: structure.people.length,
    peopleWithoutConsoleAccess: structure.people.filter(p => !p.hasConsoleAccess).length,
    departments: structure.departments.length,
    teams: structure.teams.length,
    businessUnits: structure.businessUnits.length,
    unassignedPeople: structure.people.filter(p => p.departmentId === null).length,
  };
}

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

function dataRoutes(empty, state, canManage) {
  const list = (full) => (empty ? [] : full);
  return {
    'GET /submissions': () => ({ success: true, submissions: list(SUBMISSIONS), total: list(SUBMISSIONS).length }),
    'GET /team/members': () => ({ success: true, members: list(MEMBERS) }),
    'GET /organization/context': () => ({
      success: true,
      ...WORKSPACE_BY_MODE.populated,
    }),
    'GET /organization/structure': () => {
      const structure = empty ? EMPTY_SPINE : state.spine;
      return {
        success: true,
        ...WORKSPACE_BY_MODE.populated,
        structure,
        summary: spineSummary(structure),
        // What the SERVER says about this account's authority, which is what
        // decides whether the console offers the controls at all. `readonly`
        // mode is a member who may read and not write — the state a team
        // viewer is actually in.
        canManageStructure: canManage,
      };
    },
    'GET /strategy': () => {
      const records = empty ? EMPTY_STRATEGY : state.strategy;
      return {
        success: true,
        ...WORKSPACE_BY_MODE.populated,
        strategy: records,
        summary: strategySummary(records),
        people: (empty ? EMPTY_SPINE : state.spine).people
          .map(person => ({ id: person.id, fullName: person.fullName })),
        canManageStrategy: canManage,
      };
    },
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
  'POST /auth/team/login': (body, mode) => {
    if (body?.email !== 'admin@fixture.invalid' || body?.password !== 'fixture-password') {
      return { __status: 401, error: 'Invalid credentials.' };
    }
    return {
      success: true,
      accessToken: ACCESS_TOKEN,
      user: { id: 'fix-m-1', email: body.email, name: 'Fixture Admin', teamRole: 'admin' },
      // CP-3 workspace context. Login keeps SUCCEEDING in every mode — a team
      // account with no organization still has console access — so each mode
      // drives a different one of the honest workspace states rather than a
      // different authentication outcome.
      ...WORKSPACE_BY_MODE[mode ?? 'populated'],
    };
  },
};

/**
 * What the workspace resolves to in each fixture mode.
 *
 * `empty` resolves the SAME organization as `populated`. That is deliberate and
 * it is the distinction the whole CP-1/CP-3 honesty model rests on: `empty`
 * means "you belong to an organization and it has nothing in it yet", which is
 * an EMPTY state, while a missing workspace means "there is no organization to
 * show you", which is not. Collapsing them here would make the fixture teach
 * the confusion the product exists to avoid.
 *
 * `error` and `forbidden` are the two that have no workspace, and they differ
 * from each other: a breakage and a refusal have different remedies. Login
 * still SUCCEEDS in both — a team account with no resolvable organization
 * still has console access — so the browser sees a signed-in session whose
 * header has to say honestly what went wrong.
 *
 * The name matches the rest of these fixtures, so a screenshot showing a real
 * tenant name can still never be mistaken for production data.
 */
const FIXTURE_WORKSPACE = {
  organizationId: 'fix-org-1',
  organizationName: 'Fixture Industries',
  organizationSlug: 'fixture-industries',
};

const WORKSPACE_BY_MODE = {
  populated: { organization: FIXTURE_WORKSPACE, organizationUnavailableReason: null, otherOrganizations: 0 },
  empty:     { organization: FIXTURE_WORKSPACE, organizationUnavailableReason: null, otherOrganizations: 0 },
  error:     { organization: null, organizationUnavailableReason: 'lookup-failed', otherOrganizations: 0 },
  forbidden: { organization: null, organizationUnavailableReason: 'permission-denied', otherOrganizations: 0 },
};

/**
 * Recognise a spine or strategy write from its path.
 *
 * `/organization/people`, `/organization/people/:id`, `/strategy/goals`,
 * `/strategy/goals/:id`. A regex rather than a route table because the id is
 * part of the path and the table is keyed on exact strings.
 */
function matchWrite(method, path) {
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') return null;
  const match = /^\/(organization|strategy)\/([a-z-]+)(?:\/([^/]+))?$/.exec(path);
  if (!match) return null;
  const collection = match[2];
  if (!(collection in WRITE_COLLECTIONS)) return null;
  return { collection, id: match[3] ?? null };
}

// ── Server ──────────────────────────────────────────────────────────────────

export function startFixtureBackend({ port = 0, mode = 'populated' } = {}) {
  let current = mode;
  // Reset with the mode, so one spec's newly created person cannot appear in
  // another spec's count.
  let state = freshState();

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
          state = freshState();
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
        // The mode reaches the ALWAYS routes too. They answer in every mode —
        // authentication has to keep working or nothing downstream can be
        // observed — but WHAT they answer may still depend on it.
        const answer = always(body, current);
        const { __status, ...rest } = answer;
        return send(__status ?? 200, rest);
      }

      // Everything below is a DATA route, and the mode decides how it answers.
      if (current === 'error') return send(500, { error: 'The fixture backend was told to fail.' });
      if (current === 'forbidden') return send(403, { error: 'Your account cannot read this workspace.' });

      // CP-4 writes. Matched BEFORE the read table, because the read table is
      // keyed on exact paths and these carry an id.
      const write = matchWrite(req.method, path);
      if (write) {
        // `readonly` is the mode for a caller the server would refuse. The
        // reads still answer, which is the point: a viewer sees the
        // organization and is refused when they try to change it.
        if (current === 'readonly') {
          return send(403, { error: 'Your account cannot change this organization\u2019s structure.', code: 'forbidden' });
        }
        const answer = applyWrite(state, write.collection, write.id, req.method, body);
        const { __status, ...rest } = answer;
        return send(__status ?? (req.method === 'POST' ? 201 : 200), rest);
      }

      const handler = dataRoutes(current === 'empty', state, current !== 'readonly')[key];
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
