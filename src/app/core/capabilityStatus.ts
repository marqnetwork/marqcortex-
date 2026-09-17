/**
 * WHAT A USER CAN ACTUALLY DO HERE.
 *
 * ── THE PROBLEM THIS EXISTS TO FIX ──────────────────────────────────────────
 *
 * `registryAudit.ts` classified 133 of 185 interactions as LIVE, and defined
 * LIVE as *"works right now with zero backend (pure UI / client-side engine)"*.
 * That is a real and useful measurement — is the handler wired? — but it is a
 * measurement of WIRING, and it was named after CAPABILITY. Under it, a button
 * that opens a panel rendering invented companies is LIVE, and so the registry
 * reported a demo as a product. Product Reality §9 named this directly.
 *
 * The registry keeps measuring wiring, under a name that says so (`WIRED`).
 * This module measures the other thing, at the level a user actually
 * experiences: the destination.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A destination is `LIVE` when a person signed into a real workspace can
 * perform the capability its label promises, against their own data.
 *
 * It is NOT LIVE because:
 *   - the component renders;
 *   - a route resolves;
 *   - the handlers are wired;
 *   - it works without a backend;
 *   - it has content to show.
 *
 * The last is the one that caused the trouble: content is the easiest thing to
 * fake and the most convincing evidence of a product that is not there.
 *
 * ── WHY IT LIVES BESIDE THE NAVIGATION MODEL ────────────────────────────────
 *
 * Because the honest answer to "what can I do here?" and the decision "should
 * this be in the sidebar?" are the same fact, and holding them apart is how
 * they drifted. `navigationModel.ts` reads `CAPABILITY` to decide what a
 * destination's entry looks like, and `tests/features/capabilityTruth.test.ts`
 * fails the build when a claim here is contradicted by the source.
 *
 * This file is deliberately small. It is a status per destination and the
 * evidence for it — not a governance framework.
 */

import type { DestinationId } from './navigationModel.ts';

export type CapabilityStatus =
  /** A person can do the thing this destination promises, with their own data. */
  | 'LIVE'
  /** Some of the promise works; a named part does not. */
  | 'PARTIAL'
  /** Wired correctly to a real source that has nothing to produce yet. */
  | 'EMPTY'
  /** Implemented and correct, waiting on an external input nobody here controls. */
  | 'BLOCKED'
  /** Renders only fabricated data. Not a product surface. */
  | 'DEMO-ONLY'
  /** Declared but a person cannot get to it. */
  | 'UNREACHABLE';

export interface Capability {
  status: CapabilityStatus;
  /**
   * What a person can actually do, in one sentence, in their words.
   * Empty for anything that is not LIVE or PARTIAL — because there is nothing.
   */
  userCan: string;
  /** Why the status is what it is. Source-checkable, not an opinion. */
  evidence: string;
  /**
   * What would move it to LIVE. Required for everything except LIVE, because a
   * status with no route out of it is a complaint rather than a plan.
   */
  needs?: string;
  /**
   * Keep it out of the sidebar and the command palette.
   *
   * Not the same question as the status. A BLOCKED destination stays visible —
   * it works, and the operator should see that their platform has it. A
   * DEMO-ONLY or EMPTY one with no producer does not: a sidebar entry is a
   * promise, and an entry that leads to a screen explaining it cannot do
   * anything yet is a promise the product is not keeping.
   */
  hidden?: true;
}

/**
 * Every destination, and what a person can do there.
 *
 * `Record<DestinationId, …>` is load-bearing: adding a destination to
 * `NAV_GROUPS` without saying what it does is a compile error, which is the
 * cheapest possible enforcement of "declare a capability or do not declare a
 * destination".
 */
export const CAPABILITY: Record<DestinationId, Capability> = {
  dashboard: {
    status: 'LIVE',
    userCan: 'See their workspace: submissions, priorities, pipeline and the team roster.',
    evidence: 'TeamHomeDashboard reads GET /submissions and GET /team/members through dataService; CP-1 removed every fabricated fallback.',
  },

  cortex: {
    status: 'LIVE',
    userCan: 'Open a submission and read the diagnostic intelligence derived from it.',
    evidence: 'CortexDashboard reads GET /submissions and GET /submissions/:id/cortex; an unknown id renders NOT FOUND rather than a fixture.',
  },

  analytics: {
    status: 'LIVE',
    userCan: 'Read funnel, conversion and quality figures computed from their own submissions.',
    evidence: 'AnalyticsDashboard reads GET /analytics/overview and GET /submissions; an incomplete response is a failed load.',
  },

  revenue: {
    status: 'LIVE',
    userCan: 'Read pipeline value and revenue signals from their own deals.',
    evidence: 'RevenueIntelligenceDashboard reads GET /analytics/revenue-snapshots; the aggregators are deterministic and the fixtures moved behind the demo boundary.',
  },

  strategy: {
    status: 'LIVE',
    userCan:
      'Read the organization\u2019s goals, decisions and risks \u2014 and, with '
      + '`strategy.manage`, record and change them.',
    evidence:
      'StrategySurface reads GET /strategy and writes through the create, update and archive '
      + 'routes. Reads are scoped server-side to the organization the authenticated membership '
      + 'resolves; writes run under the caller\u2019s own JWT so the RLS policies on goals, '
      + 'decisions and risks are the authorization. Fourteen tenancy, RBAC and integrity '
      + 'properties are proven against real PostgreSQL by '
      + 'scripts/organizational-spine-scenarios.mjs.',
    needs:
      'Objective and Initiative (ONT 13.3, 13.1) do not exist, so a goal has no parent. '
      + 'Opportunity and Value are deferred \u2014 see MARQ_CORTEX_CP4_PREPARATION.md.',
  },

  team: {
    status: 'LIVE',
    userCan:
      'See the organization — its people, departments, teams and reporting lines — '
      + 'and manage who can sign into the console.',
    evidence:
      'OrganizationSpine reads GET /organization/structure, scoped server-side to the organization '
      + 'the authenticated membership resolves; TeamManagement reads GET /team/members and writes '
      + 'through the invite, update and remove routes. The spine is read-only in CP-3 and offers no '
      + 'control that implies otherwise.',
    needs: 'Writing to the spine — hiring, moving a person, re-pointing a reporting line — is CP-4.',
  },

  settings: {
    status: 'LIVE',
    userCan: 'Read and change their profile and the platform configuration.',
    evidence: 'SettingsPage reads GET /settings and writes through the save route; CP-1 removed the fixture it used to pre-fill the form with.',
  },

  operations: {
    status: 'BLOCKED',
    userCan: 'Read enterprise health and KPI roll-ups once a backend is reachable.',
    evidence: 'OperationsPanel reads /health/enterprise and /kpis through operationalAwarenessService, which throws BACKEND_DISABLED without one. The surface renders an honest unavailable state; the backend is real and tested.',
    needs: 'A reachable Supabase project. Nothing in the product is missing.',
  },

  'control-plane': {
    status: 'BLOCKED',
    userCan: 'Administer AI providers, routing, budget, agents and workflows once a backend is reachable.',
    evidence: 'AIAdministrationConsole reads /ai/admin/* through aiAdminService. AI-01 built the whole console and its runtime; it renders "Unavailable" without a backend.',
    needs: 'A reachable Supabase project.',
  },

  emails: {
    status: 'PARTIAL',
    userCan: 'See the nurture queue this browser holds, preview each email, and mark one sent or skipped.',
    evidence: 'EmailNurturePanel reads emailNurtureQueue, which is localStorage. Nothing is sent, nothing is shared between browsers or colleagues, and no delivery webhook is consumed — CP-1 made the engagement figures report as unmeasured rather than estimated. GET /email-queue exists and this panel does not read it.',
    needs: 'Wire the panel to GET /email-queue and a send path; consume a delivery webhook for the engagement half.',
  },

  reviewer: {
    status: 'DEMO-ONLY',
    hidden: true,
    userCan: '',
    evidence: 'ReviewerDashboard calls generateMockSubmissions() for its initial state and generateRandomSubmission() on a 30-second interval, so the queue invents a new company every half minute — with a browser notification. It takes no accessToken and makes no request. Eighteen Math.random() calls decide the scores it displays. CP-1 missed it: the invented names are not the ones the audit listed, and the generator is in the component rather than a file named mock*.',
    needs: 'A real review queue: GET /submissions filtered by review state, and the existing GET/POST /submissions/:id/review/:type routes, which the reviewer checklist type already describes.',
  },

  mapping: {
    status: 'EMPTY',
    hidden: true,
    userCan: '',
    evidence: 'MappingEnginePanel maps a ProposalSnapshot into an execution plan. The pipeline is real and deterministic; nothing produces or persists a snapshot where this panel can read one. CP-1 removed DEMO_SNAPSHOT, which had been its only input in every configuration, and the panel now correctly says it has nothing to map.',
    needs: 'A producer: accepting a proposal must persist a snapshot, and this panel must read it.',
  },

  execution: {
    status: 'EMPTY',
    hidden: true,
    userCan: '',
    evidence: 'ExecutionRoute reads EXECUTION_STORE, an in-memory array that only runMappingPipeline writes to — and the Mapping Engine has no snapshot to run against. The store is not persisted, so it is empty on every page load regardless. CP-1 removed MOCK_EXECUTION, which is what filled it before.',
    needs: 'The Mapping Engine producer above, plus persistence for the execution project it emits.',
  },

  architecture: {
    status: 'LIVE',
    userCan: 'Read the system architecture reference.',
    evidence: 'SystemArchitecture renders a static description of this codebase. It is documentation, it is accurate, and it needs no backend — which is exactly why it is tier "system" and sits in a folded group rather than beside the business surfaces.',
  },
};

/** Destinations a person should see in the sidebar and the command palette. */
export function isDestinationVisible(id: DestinationId): boolean {
  return CAPABILITY[id].hidden !== true;
}

/** True when the destination promises a capability it can actually deliver. */
export function isDestinationUsable(id: DestinationId): boolean {
  const { status } = CAPABILITY[id];
  return status === 'LIVE' || status === 'PARTIAL';
}

export const CAPABILITY_LABEL: Record<CapabilityStatus, string> = {
  LIVE: 'Working',
  PARTIAL: 'Partly working',
  EMPTY: 'Nothing to show yet',
  BLOCKED: 'Needs a backend',
  'DEMO-ONLY': 'Demo only',
  UNREACHABLE: 'Not reachable',
};
