/**
 * Runtime mode helpers — single gate for demo vs live behavior in UI.
 * Components should use these instead of importing FEATURES directly.
 */
import { FEATURES } from '@/config/features';

export function isBackendEnabled(): boolean {
  return FEATURES.BACKEND_INTEGRATION;
}

export function isDemoMode(): boolean {
  return !FEATURES.BACKEND_INTEGRATION;
}

/**
 * DEMO-FALLBACK POLICY (Batch 6 — Workstream 6)
 *
 * Demo / seed data may be substituted ONLY when the app is intentionally in
 * demo mode (BACKEND_INTEGRATION=false). In live/production mode a failed or
 * empty backend response MUST surface an honest error/empty state — it must
 * NEVER be papered over with fabricated demo data.
 *
 * Every former "fall back to demo data on error" path funnels through this
 * predicate. Because live-mode load functions early-return their demo data
 * before the network call, their catch blocks only ever run in live mode,
 * where this returns false — so production can never show fabricated data even
 * if a fallback branch is reached. This is the single, greppable gate for that
 * rule (defence-in-depth).
 */
export function canUseDemoFallback(): boolean {
  return isDemoMode();
}

export function isVerboseLogging(): boolean {
  return FEATURES.VERBOSE_LOGGING;
}

export function shouldShowApiErrors(): boolean {
  return FEATURES.SHOW_API_ERRORS;
}
