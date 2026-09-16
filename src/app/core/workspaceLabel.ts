/**
 * WHAT THE SHELL SAYS ABOUT THE WORKSPACE.
 *
 * The sidebar header used to read "Internal Dashboard" under every session,
 * for every account, in every tenant. That is not a workspace name — it is a
 * description of the product, printed where the organization belongs — and a
 * console whose header cannot tell two tenants apart is a console that cannot
 * be trusted to show tenant-owned data.
 *
 * CP-3 replaces it with the real organization, and with the TRUTH when there
 * is no real organization to show. That second half is the point. There are
 * seven distinct ways a session can end up without a workspace, and they have
 * different remedies: one of them means "ask an administrator for an
 * invitation", one means "your access was suspended", two mean "the platform
 * is broken right now", and one means "nobody asked". Rendering all seven as
 * one grey placeholder would put the CP-1 defect — a failure answered with a
 * plausible empty state — back into the one element every screen shows.
 *
 * Pure and side-effect free, with relative `.ts` specifiers, so the Node test
 * suites can drive every state without a browser.
 */

import type { WorkspaceUnavailableReason } from '../lib/session.ts';

/** How the shell should read the workspace slot. */
export type WorkspaceDisplayTone = 'loading' | 'resolved' | 'empty' | 'error';

export interface WorkspaceDisplay {
  /** The line rendered where "Internal Dashboard" used to sit. */
  readonly label: string;
  /** The longer sentence, shown as the element's title/tooltip. */
  readonly detail: string;
  readonly tone: WorkspaceDisplayTone;
}

/**
 * Every unavailable reason, mapped once.
 *
 * `tone` separates the three that are the PLATFORM'S fault from the three that
 * are facts about the account, because they are not the same message: an
 * operator whose organization was erased needs to be told so, and an operator
 * whose lookup timed out must not be.
 */
const UNAVAILABLE: Record<WorkspaceUnavailableReason, Omit<WorkspaceDisplay, never>> = {
  'no-membership': {
    label: 'No organization',
    detail: 'This account is not a member of any organization yet. An administrator has to add it to one.',
    tone: 'empty',
  },
  'membership-inactive': {
    label: 'Membership inactive',
    detail: 'This account has an organization membership, but it is invited or suspended rather than active.',
    tone: 'empty',
  },
  'organization-removed': {
    label: 'Organization removed',
    detail: 'This account is an active member of an organization the platform has deleted.',
    tone: 'error',
  },
  'organization-unnamed': {
    label: 'Organization unnamed',
    detail: 'The organization resolved, but its record carries neither a name nor a slug to display.',
    tone: 'error',
  },
  'permission-denied': {
    label: 'Workspace access denied',
    detail: 'The server was not permitted to read this account’s organization membership.',
    tone: 'error',
  },
  'lookup-failed': {
    label: 'Workspace unavailable',
    detail: 'The organization could not be read. This is a failure, not an empty organization — reload, and report it if it persists.',
    tone: 'error',
  },
  'not-reported': {
    label: 'Workspace not reported',
    detail: 'This session was established without an organization. Sign out and back in to resolve one.',
    tone: 'empty',
  },
};

export interface WorkspaceDisplayInput {
  /** True while the mount-time session restore is still running. */
  readonly isRestoring: boolean;
  readonly organizationName?: string | null;
  readonly reason?: WorkspaceUnavailableReason | null;
}

/**
 * Decide what the shell renders for the workspace.
 *
 * Restoring wins over everything: before the session has been read, nothing is
 * known, and "No organization" printed during the read would be a claim about
 * the operator made before anything was looked at.
 *
 * A name with no reason is the only success. A session carrying NEITHER — no
 * name and no reason — is reported as `not-reported` rather than as an empty
 * organization, because that state means this build was told nothing, not that
 * the account belongs nowhere.
 */
export function workspaceDisplay(input: WorkspaceDisplayInput): WorkspaceDisplay {
  if (input.isRestoring) {
    return { label: 'Loading workspace…', detail: 'Reading the signed-in session.', tone: 'loading' };
  }

  const name = typeof input.organizationName === 'string' ? input.organizationName.trim() : '';
  if (name !== '') {
    return { label: name, detail: `Workspace: ${name}.`, tone: 'resolved' };
  }

  return UNAVAILABLE[input.reason ?? 'not-reported'];
}
