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
  CLIENT_SESSION_TTL_MS,
  type ClientSession,
} from '@/app/lib/session';

// ── Session expiry ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const TEAM_SESSION_EXPIRY_KEY = 'marq_cortex_team_session_expiry';

// ── Session Types ────────────────────────────────────────────────────────────

/**
 * Canonical shape lives in `@/app/lib/session`. Re-exported here so existing
 * consumers keep importing `ClientSession` from AppContext unchanged.
 */
export type { ClientSession };

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
  loginTeam: (token: string) => void;
  isSessionExpired: boolean;

  // Client auth
  clientSession: ClientSession | null;
  setClientSession: (session: ClientSession | null) => void;
  loginClient: (submissionId: string, email: string, companyName: string, sessionToken?: string | null) => void;
  isClientSessionExpired: boolean;

  // Logout
  logout: () => void;
}

const AppContext = createContext<AppState | null>(null);

// ── Storage keys ─────────────────────────────────────────────────────────────

const TEAM_SESSION_KEY = 'marq_cortex_team_session';
const CLIENT_SESSION_KEY = 'marq_cortex_client_session';

// ── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [scoreResult, setScoreResult] = useState<InstantScoreResult | null>(null);
  const [lastIndustry, setLastIndustry] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamAccessToken, setTeamAccessToken] = useState<string | null>(null);
  const [clientSession, setClientSession] = useState<ClientSession | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [isClientSessionExpired, setIsClientSessionExpired] = useState(false);

  // Restore sessions on mount
  useEffect(() => {
    const savedToken = localStorage.getItem(TEAM_SESSION_KEY);
    if (savedToken) {
      setTeamAccessToken(savedToken);
      const expiry = localStorage.getItem(TEAM_SESSION_EXPIRY_KEY);
      if (expiry && Date.now() > parseInt(expiry, 10)) {
        setIsSessionExpired(true);
      }
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
  }, []);

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

  const loginTeam = useCallback((token: string) => {
    setTeamAccessToken(token);
    setIsSessionExpired(false);
    localStorage.setItem(TEAM_SESSION_KEY, token);
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
    setClientSession(null);
    setIsSessionExpired(false);
    setIsClientSessionExpired(false);
    localStorage.removeItem(TEAM_SESSION_KEY);
    localStorage.removeItem(CLIENT_SESSION_KEY);
    localStorage.removeItem(TEAM_SESSION_EXPIRY_KEY);
  }, []);

  return (
    <AppContext.Provider
      value={useMemo(() => ({
        contactInfo, setContactInfo,
        scoreResult, setScoreResult,
        lastIndustry, setLastIndustry,
        isSubmitting, setIsSubmitting,
        teamAccessToken, setTeamAccessToken,
        loginTeam,
        isSessionExpired,
        clientSession, setClientSession,
        loginClient,
        isClientSessionExpired,
        logout,
      }), [
        contactInfo, scoreResult, lastIndustry, isSubmitting,
        teamAccessToken, loginTeam, isSessionExpired,
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