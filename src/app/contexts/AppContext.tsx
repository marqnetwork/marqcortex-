/**
 * APP CONTEXT — Shared state across all routes
 *
 * Manages:
 * - Contact info (from lead magnet)
 * - Score result (from diagnostic)
 * - Team session (access token)
 * - Client session (submission ID, email, company)
 * - Diagnostic submission state
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { ContactInfo } from '@/app/components/LeadMagnetCapture';
import type { InstantScoreResult } from '@/app/utils/instantScoring';
import {
  isClientSessionExpired as checkClientSessionExpired,
  parseTeamSession,
  serializeTeamSession,
  CLIENT_SESSION_TTL_MS,
  TEAM_SESSION_KEY,
  TEAM_SESSION_EXPIRY_KEY,
  CLIENT_SESSION_KEY,
  LEGACY_TEAM_SESSION_KEYS,
  normaliseTeamUser,
  normaliseWorkspace,
  normaliseWorkspaceReason,
  type TeamUser,
  type Workspace,
  type WorkspaceUnavailableReason,
  type ClientSession,
} from '@/app/lib/session';
import { DEFAULT_TEAM_ROLE, type TeamRole } from '@/app/lib/teamRole';

// ── Session expiry ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Session Types ────────────────────────────────────────────────────────────

/**
 * Canonical shapes live in `@/app/lib/session`. Re-exported here so existing
 * consumers keep importing them from AppContext unchanged.
 */
export type { ClientSession };
export type { TeamUser };
export type { Workspace, WorkspaceUnavailableReason };

interface AppState {
  // Lead capture
  contactInfo: ContactInfo | null;
  setContactInfo: (info: ContactInfo | null) => void;

  // Score page
  scoreResult: InstantScoreResult | null;
  setScoreResult: (result: InstantScoreResult | null) => void;
  lastIndustry: string;
  setLastIndustry: (industry: string) => void;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;

  // Team auth
  teamAccessToken: string | null;
  setTeamAccessToken: (token: string | null) => void;
  /** The signed-in team member, when the login response supplied one. */
  teamUser: TeamUser | null;
  /**
   * The signed-in member's role, for deciding what the console SHOWS.
   *
   * Never null: a session that carried no identity, or one whose role the
   * server no longer issues, reads as `viewer` — the least privileged role —
   * so a gap in the data can never widen what the console offers. This is not
   * authorization; see `@/app/lib/teamRole`.
   */
  teamRole: TeamRole;
  loginTeam: (token: string, user?: unknown, workspace?: unknown) => void;

  /**
   * The organization this session is working inside (CP-3).
   *
   * Resolved by the server from the authenticated membership relationship and
   * carried on the login response; the browser never constructs one. Null when
   * the server could not resolve one, and `workspaceReason` then says why.
   */
  workspace: Workspace | null;

  /**
   * Why there is no workspace. Null exactly when `workspace` is set.
   *
   * Every consumer must distinguish these rather than collapsing them into an
   * empty state: `lookup-failed` and `permission-denied` are failures, and a
   * failure answered with a plausible-looking blank is the defect CP-1 spent
   * its whole sprint removing.
   */
  workspaceReason: WorkspaceUnavailableReason | null;

  isSessionExpired: boolean;
  /**
   * True until the mount-time session restore has finished.
   *
   * Restore runs in an effect, so on the very first render `teamAccessToken`
   * is null even for a signed-in operator. A route guard that redirects on
   * that first render sends every cold load to the login screen and DISCARDS
   * the requested URL — which is why a refresh or a shared link to any
   * in-app destination used to land on the bare dashboard. Guards must wait
   * for this to be false before concluding anyone is signed out.
   */
  isRestoringSession: boolean;

  // Client auth
  clientSession: ClientSession | null;
  setClientSession: (session: ClientSession | null) => void;
  loginClient: (submissionId: string, email: string, companyName: string, sessionToken?: string | null) => void;
  isClientSessionExpired: boolean;

  // Logout
  logout: () => void;
}

const AppContext = createContext<AppState | null>(null);

/**
 * Erase every trace of a team session.
 *
 * The legacy keys are deleted here and nowhere else. A value one of them still
 * holds came from an older bundle, so its origin and expiry cannot be
 * established — it is destroyed rather than migrated or trusted.
 */
function clearTeamStorage() {
  localStorage.removeItem(TEAM_SESSION_KEY);
  localStorage.removeItem(TEAM_SESSION_EXPIRY_KEY);
  for (const key of LEGACY_TEAM_SESSION_KEYS) localStorage.removeItem(key);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [scoreResult, setScoreResult] = useState<InstantScoreResult | null>(null);
  const [lastIndustry, setLastIndustry] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamAccessToken, setTeamAccessToken] = useState<string | null>(null);
  const [teamUser, setTeamUser] = useState<TeamUser | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Null, not a reason, while nothing is known: `isRestoringSession` is what
  // says "still loading", and a reason set before the restore has run would be
  // a claim about the operator made before anything was read.
  const [workspaceReason, setWorkspaceReason] = useState<WorkspaceUnavailableReason | null>(null);
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isClientSessionExpired, setIsClientSessionExpired] = useState(false);
  // Starts true: nothing is known about the session until the effect below runs.
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // Restore sessions on mount.
  //
  // Authentication and identity are restored from the canonical team session
  // record ONLY. The legacy `team_access_token` / `team_user` keys are never
  // consulted: a value left behind by an older bundle has no establishable
  // origin or expiry, so it is cleared on logout rather than trusted here.
  useEffect(() => {
    // Wrapped so that EVERY exit path — including the early returns below —
    // clears the restoring flag. A guard waiting on it must never wait forever.
    try {
      restoreSessions();
    } finally {
      setIsRestoringSession(false);
    }
  }, []);

  function restoreSessions() {
    const restoredTeam = parseTeamSession(localStorage.getItem(TEAM_SESSION_KEY));
    if (restoredTeam) {
      const expiry = localStorage.getItem(TEAM_SESSION_EXPIRY_KEY);
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        // Clear at the point of detection, for the same reason the client
        // branch below does: on a cold load the route guard redirects while
        // teamAccessToken is still null, so its logout effect never runs and
        // the expired record — plus any stale legacy key — would survive.
        clearTeamStorage();
        setIsSessionExpired(true);
        return;
      }
      setTeamAccessToken(restoredTeam.accessToken);
      setTeamUser(restoredTeam.user);
      setWorkspace(restoredTeam.workspace);
      setWorkspaceReason(restoredTeam.workspaceReason);
      return;
    }
    try {
      const raw = localStorage.getItem(CLIENT_SESSION_KEY);
      if (raw) {
        const restored: ClientSession = JSON.parse(raw);
        // Expiry travels with the session, so a refresh cannot extend it.
        // Sessions stored before expiry existed have no expiresAt and are
        // rejected here (fail-closed).
        if (checkClientSessionExpired(restored)) {
          // Reject and clear at the point of detection. The route-level logout
          // effect cannot be relied on here: the guard redirects away before
          // the expired session ever reaches it, so the stale record would
          // otherwise survive in storage.
          localStorage.removeItem(CLIENT_SESSION_KEY);
          setIsClientSessionExpired(true);
        } else {
          setClientSession(restored);
        }
      }
    } catch { /* ignore */ }
  }

  // Periodic session-expiry check (every 60s while app is open)
  useEffect(() => {
    if (!teamAccessToken) return;
    const id = setInterval(() => {
      const expiry = localStorage.getItem(TEAM_SESSION_EXPIRY_KEY);
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        setIsSessionExpired(true);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [teamAccessToken]);

  // Periodic client session-expiry check (every 60s while a client is signed in)
  useEffect(() => {
    if (!clientSession) return;
    const id = setInterval(() => {
      if (checkClientSessionExpired(clientSession)) setIsClientSessionExpired(true);
    }, 60_000);
    return () => clearInterval(id);
  }, [clientSession]);

  // `user` and `workspace` are typed `unknown` because they come straight off
  // the login response — untrusted wire shapes. Both go through the narrowing
  // in `@/app/lib/session`, which is also what `parseTeamSession` uses on the
  // next cold load, so the value stored and the value restored can never be
  // narrowed two different ways.
  const loginTeam = useCallback((token: string, user: unknown = null, workspaceValue: unknown = null) => {
    const normalised = normaliseTeamUser(user);
    const resolvedWorkspace = normaliseWorkspace(
      (workspaceValue as { organization?: unknown } | null)?.organization ?? workspaceValue,
    );
    const reason = resolvedWorkspace
      ? null
      : normaliseWorkspaceReason(
          (workspaceValue as { organizationUnavailableReason?: unknown } | null)
            ?.organizationUnavailableReason,
        );

    setTeamAccessToken(token);
    setTeamUser(normalised);
    setWorkspace(resolvedWorkspace);
    setWorkspaceReason(reason);
    setIsSessionExpired(false);
    // Token, identity and workspace are one canonical record under one
    // canonical key.
    localStorage.setItem(TEAM_SESSION_KEY, serializeTeamSession({
      accessToken: token,
      user: normalised,
      workspace: resolvedWorkspace,
      workspaceReason: reason,
    }));
    localStorage.setItem(TEAM_SESSION_EXPIRY_KEY, (Date.now() + SESSION_TTL_MS).toString());
  }, []);

  const loginClient = useCallback((submissionId: string, email: string, companyName: string, sessionToken: string | null = null) => {
    const session: ClientSession = {
      submissionId,
      email,
      companyName,
      sessionToken,
      expiresAt: Date.now() + CLIENT_SESSION_TTL_MS,
    };
    setClientSession(session);
    setIsClientSessionExpired(false);
    localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(session));
  }, []);

  const logout = useCallback(() => {
    setTeamAccessToken(null);
    setTeamUser(null);
    setWorkspace(null);
    setWorkspaceReason(null);
    setClientSession(null);
    setIsSessionExpired(false);
    setIsClientSessionExpired(false);
    clearTeamStorage();
    localStorage.removeItem(CLIENT_SESSION_KEY);
  }, []);

  return (
    <AppContext.Provider
      value={useMemo(() => ({
        contactInfo, setContactInfo,
        scoreResult, setScoreResult,
        lastIndustry, setLastIndustry,
        isSubmitting, setIsSubmitting,
        teamAccessToken, setTeamAccessToken,
        teamUser,
        teamRole: teamUser?.teamRole ?? DEFAULT_TEAM_ROLE,
        loginTeam,
        workspace,
        workspaceReason,
        isSessionExpired,
        isRestoringSession,
        clientSession, setClientSession,
        loginClient,
        isClientSessionExpired,
        logout,
      }), [
        contactInfo, scoreResult, lastIndustry, isSubmitting,
        teamAccessToken, teamUser, workspace, workspaceReason,
        loginTeam, isSessionExpired, isRestoringSession,
        clientSession, loginClient, isClientSessionExpired, logout,
      ])}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}