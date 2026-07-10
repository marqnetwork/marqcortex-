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

// ── Session expiry ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const TEAM_SESSION_EXPIRY_KEY = 'marq_cortex_team_session_expiry';

// ── Session Types ────────────────────────────────────────────────────────────

export interface ClientSession {
  submissionId: string;
  email: string;
  companyName: string;
  /** Server-issued session token — required for protected client API calls in live mode */
  sessionToken: string | null;
}

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
      if (raw) setClientSession(JSON.parse(raw));
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

  const loginTeam = useCallback((token: string) => {
    setTeamAccessToken(token);
    setIsSessionExpired(false);
    localStorage.setItem(TEAM_SESSION_KEY, token);
    localStorage.setItem(TEAM_SESSION_EXPIRY_KEY, (Date.now() + SESSION_TTL_MS).toString());
  }, []);

  const loginClient = useCallback((submissionId: string, email: string, companyName: string, sessionToken: string | null = null) => {
    const session: ClientSession = { submissionId, email, companyName, sessionToken };
    setClientSession(session);
    localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(session));
  }, []);

  const logout = useCallback(() => {
    setTeamAccessToken(null);
    setClientSession(null);
    setIsSessionExpired(false);
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
        logout,
      }), [
        contactInfo, scoreResult, lastIndustry, isSubmitting,
        teamAccessToken, loginTeam, isSessionExpired,
        clientSession, loginClient, logout,
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