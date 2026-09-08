/**
 * ══════════════════════════════════════════════════════════════════════════════
 * MARQ CORTEX — Orientation
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   The console's answer to four questions the Product Experience says every
 *   surface must answer (§4.9): what is happening, what requires my attention,
 *   what should happen next, and — for somebody who has just arrived — where do
 *   I begin.
 *
 *   It is a PURE module. No React, no browser storage, no timers, no fetching,
 *   and no data of its own. Everything it returns is a function of state the
 *   application already holds: who is signed in, what role the server resolved
 *   for them, and what is actually in their workspace. That is deliberate — the
 *   surest way to build an onboarding that lies is to give it its own store.
 *
 * WHY IT EXISTS
 *   The team console opened onto eleven flat navigation entries, a six-card KPI
 *   grid and four charts, identically for a workspace with two thousand
 *   submissions and one that had never received a single one. §4.8 asks for the
 *   opposite: "A first-time user should immediately understand how to begin …
 *   New users should never feel overwhelmed." Nothing in the console knew
 *   whether the user was new, so nothing could act on it.
 *
 * WHAT PROGRESSIVE DISCLOSURE MEANS HERE, AND WHAT IT DOES NOT
 *   It means grouping navigation by the work it serves and collapsing the
 *   system-level tools until asked for. It does NOT mean taking functionality
 *   away: every entry in this model is reachable, the collapsed group is one
 *   click from open, and the command palette already reaches all of it by name.
 *   §4.8 again: "Power users should never feel constrained."
 *
 * ROLE-APPROPRIATE, HONESTLY
 *   Role decides which orientation STEPS a person is shown and what their next
 *   action is — only somebody who may administer the team is told to invite
 *   anybody. Role does NOT hide a read surface that the server would happily
 *   serve them: pretending a page does not exist because of a role the server
 *   does not gate on is a lie about the product, not a simplification of it.
 *   And none of this is authorization; see `@/app/lib/teamRole`.
 */

// Relative with an explicit extension: this module is imported directly by the
// Node test suites under `--experimental-strip-types`, which resolves no Vite
// alias. See the same note in `@/app/lib/session`.
import { canAdministerTeam, type TeamRole } from '../lib/teamRole.ts';

// ── Navigation ────────────────────────────────────────────────────────────────
//
// THIS MODULE DECLARES NO NAVIGATION OF ITS OWN.
//
// UI Sprint 1 established `navigationModel.ts` as the one canonical description
// of where an operator can go, precisely because Ch. 21.4 forbids duplicate
// realities: "Navigation should never create duplicate realities." A second
// model here would be exactly that — and it was, briefly, describing eleven
// destinations while the canonical model described thirteen. The two it lacked
// were the AI Control Plane and Operations, so the orientation could not point
// anyone at either.
//
// What orientation needs from navigation is a projection: an entry's label, its
// one-line description, its group heading and its tier. All four come from the
// canonical model, so a destination added there is picked up here for free.

import {
  NAV_GROUPS,
  DESTINATIONS,
  isSystemGroup,
  type Destination,
  type NavTier,
} from './navigationModel.ts';

export type { NavTier };

export interface NavEntry {
  /** The page key the shell switches on. */
  id: string;
  /** What the business calls this, not what the codebase calls it. */
  label: string;
  /** One line, for the collapsed sidebar's tooltip and the orientation copy. */
  description: string;
  tier: NavTier;
  /** Section heading this entry sits under. */
  group: string;
}

function toEntry(destination: Destination, groupLabel: string): NavEntry {
  return {
    id: destination.id,
    label: destination.label,
    description: destination.description,
    tier: destination.tier,
    group: groupLabel,
  };
}

/**
 * THE navigation model, projected for orientation.
 *
 * Order is the canonical model's order — the shape of the work, not the shape
 * of the codebase.
 */
export const NAV_MODEL: readonly NavEntry[] = NAV_GROUPS.flatMap(group =>
  group.destinations.map(destination => toEntry(destination, group.label)),
);

export interface NavGroup {
  label: string;
  entries: readonly NavEntry[];
  /** True for the group that stays folded until the user opens it. */
  collapsible: boolean;
}

/**
 * Group the model for rendering, preserving declaration order within a group
 * and first-appearance order between groups.
 */
export function navigationGroups(): readonly NavGroup[] {
  return NAV_GROUPS.map(group => ({
    label: group.label,
    entries: group.destinations.map(destination => toEntry(destination, group.label)),
    // A group is folded only when every entry in it is system-tier. A group
    // holding any real work is never hidden behind a disclosure.
    collapsible: isSystemGroup(group),
  }));
}

/** Look up an entry by the page key the shell switches on. */
export function navEntry(id: string, model: readonly NavEntry[] = NAV_MODEL): NavEntry | null {
  return model.find(entry => entry.id === id) ?? null;
}

/** Every page key the shell may legitimately be showing. */
export function navigablePageIds(model: readonly NavEntry[] = NAV_MODEL): readonly string[] {
  return model.map(entry => entry.id);
}

// The destination is carried in the URL, not in session storage. `PAGE_PARAM`
// in `navigationModel.ts` names the query parameter; there is no storage key
// here to drift from it, and `TEAM_DASHBOARD_PAGE_KEY` — which named one — is
// gone with the side channel it served.

/**
 * Decide what page to show for a value that came from outside the application.
 *
 * The shell used to read a saved page out of session storage and DELETE it in
 * the same breath, so a browser refresh always dropped the user back on the
 * dashboard, mid-task and with no warning. The destination now lives in the
 * URL, which restores on refresh and survives a shared link — but a URL is
 * user-editable, so the value still has to be checked: one that names a page
 * the model knows is used, and anything else falls back to the dashboard
 * rather than leaving the shell on a page it cannot render.
 */
export function restorablePage(
  stored: string | null | undefined,
  fallback = 'dashboard',
  model: readonly NavEntry[] = NAV_MODEL,
): string {
  if (typeof stored !== 'string' || !stored) return fallback;
  return navEntry(stored, model) ? stored : fallback;
}

// `DESTINATIONS` is re-exported so a consumer needing the full canonical
// records (icons, keywords, accelerators) does not import a second model.
export { DESTINATIONS };

// ── Workspace state ───────────────────────────────────────────────────────────

/**
 * What the console actually knows about the workspace right now.
 *
 * `loading` is a distinct state, not zero. The home dashboard used to render a
 * complete KPI grid of zeros while the first fetch was still in flight, which
 * says "you have no work" to somebody who has plenty — the one thing a
 * loading state exists to prevent.
 */
export type WorkspaceState = 'loading' | 'empty' | 'active';

/** The real application state this module reasons over. Nothing invented. */
export interface WorkspaceFacts {
  /** True while the first load of submissions is still in flight. */
  isLoading: boolean;
  /** Every submission the workspace holds, as loaded. */
  submissions: readonly { status: string; isRead?: boolean }[];
  /**
   * How many people are in the workspace, or `null` when the console has not
   * loaded the roster on this surface. `null` means UNKNOWN, and an unknown
   * fact never resolves a step — it withholds it.
   */
  teamMemberCount: number | null;
}

export function workspaceState(facts: WorkspaceFacts): WorkspaceState {
  if (facts.isLoading) return 'loading';
  return facts.submissions.length === 0 ? 'empty' : 'active';
}

// ── Orientation steps ─────────────────────────────────────────────────────────

/**
 * `done`     — the workspace shows this has happened.
 * `next`     — the one step to do now.
 * `waiting`  — a real step, but a later one.
 * `unknown`  — the console cannot tell from what it has loaded. Never rendered
 *              as either done or outstanding, because both would be a guess.
 */
export type StepState = 'done' | 'next' | 'waiting' | 'unknown';

export interface OrientationStep {
  id: string;
  /** What the user achieves, in their words. */
  title: string;
  /** Why it matters, in one line. */
  detail: string;
  state: StepState;
  /** The page this step is completed on, when there is one. */
  target: string | null;
  /** The label for the button that goes there. */
  actionLabel: string | null;
}

export interface OrientationInput extends WorkspaceFacts {
  /** The signed-in member's role, as resolved by the server. */
  role: TeamRole;
}

/**
 * The orientation for the current workspace.
 *
 * Every step is answered from real state. There is no stored "onboarding
 * progress" anywhere — a step is done because the workspace shows it is done,
 * so it cannot fall out of step with reality, cannot be completed by dismissing
 * it, and re-reads correctly on any device the user signs in from.
 */
export function orientationSteps(input: OrientationInput): readonly OrientationStep[] {
  const { isLoading, submissions, teamMemberCount, role } = input;

  const hasSubmissions = submissions.length > 0;
  const hasMovedOne = submissions.some(s => s.status !== 'new');
  const hasFinishedOne = submissions.some(s => s.status === 'approved' || s.status === 'completed');

  // While the first load is in flight the console knows nothing about the
  // workspace, so every workspace-derived step is `unknown` rather than
  // "not done yet".
  const resolve = (done: boolean): StepState =>
    isLoading ? 'unknown' : done ? 'done' : 'waiting';

  const steps: OrientationStep[] = [
    {
      id: 'first-submission',
      title: 'Receive your first diagnostic',
      detail: 'A diagnostic submission is where every engagement starts.',
      state: resolve(hasSubmissions),
      target: 'cortex',
      actionLabel: 'Open CORTEX',
    },
    {
      id: 'first-review',
      title: 'Review what CORTEX found',
      detail: 'CORTEX analyses each submission. You decide what it means.',
      state: resolve(hasMovedOne),
      target: 'cortex',
      actionLabel: 'Review a submission',
    },
    {
      id: 'first-outcome',
      title: 'Take one engagement to an outcome',
      detail: 'Approving work is what turns analysis into an engagement.',
      state: resolve(hasFinishedOne),
      target: 'reviewer',
      actionLabel: 'Open the review queue',
    },
  ];

  // Only somebody who may actually administer the team is told to invite
  // anybody — the server refuses the invite from everybody else, and an
  // orientation step that ends in a 403 is worse than no step at all.
  if (canAdministerTeam(role)) {
    steps.push({
      id: 'invite-team',
      title: 'Bring your team in',
      detail: 'Cortex is shared work. Invite the people who do it with you.',
      // `null` is UNKNOWN, not zero: the roster has not been loaded on this
      // surface, and "you are alone here" is not a claim to make from absence.
      state: teamMemberCount === null ? 'unknown' : resolve(teamMemberCount > 1),
      target: 'team',
      actionLabel: 'Invite a colleague',
    });
  }

  // Exactly one step is `next`: the first that is neither done nor unknown.
  // A workspace with everything done has no next step, and that is a finished
  // orientation rather than a nagging one.
  const firstOutstanding = steps.find(step => step.state === 'waiting');
  if (firstOutstanding) firstOutstanding.state = 'next';

  return steps;
}

/** The single step to do now, or `null` when orientation is complete. */
export function nextOrientationStep(input: OrientationInput): OrientationStep | null {
  return orientationSteps(input).find(step => step.state === 'next') ?? null;
}

/** How far through orientation this workspace is. */
export interface OrientationProgress {
  done: number;
  /** Steps that are neither done nor unknown — the ones still to do. */
  outstanding: number;
  /** Steps the console cannot resolve from what it has loaded. */
  unknown: number;
  total: number;
  /** True when every resolvable step is done and none is unknown. */
  complete: boolean;
}

export function orientationProgress(input: OrientationInput): OrientationProgress {
  const steps = orientationSteps(input);
  const done = steps.filter(s => s.state === 'done').length;
  const unknown = steps.filter(s => s.state === 'unknown').length;
  const outstanding = steps.length - done - unknown;
  return {
    done,
    outstanding,
    unknown,
    total: steps.length,
    complete: outstanding === 0 && unknown === 0,
  };
}

/**
 * Whether the console should lead with orientation rather than with the full
 * command centre.
 *
 * True only for a workspace that is loaded and genuinely empty. A workspace
 * with work in it gets the dashboard it has earned, and a workspace still
 * loading gets neither — showing "you have nothing" to somebody whose data has
 * not arrived is the specific failure this guards against.
 */
export function shouldLeadWithOrientation(input: OrientationInput): boolean {
  return workspaceState(input) === 'empty';
}
