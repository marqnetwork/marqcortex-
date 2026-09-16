/**
 * Runtime mode helpers — single gate for demo vs live behavior in UI.
 * Components should use these instead of importing FEATURES directly.
 */
import { FEATURES } from '@/config/features';

export function isBackendEnabled(): boolean {
  return FEATURES.BACKEND_INTEGRATION;
}

/**
 * Is this build an explicitly designated DEMO?
 *
 * This used to be `!BACKEND_INTEGRATION` — "the backend is off" — which is a
 * different question and gave a different answer. A disconnected product is not
 * a demo: it is a product that cannot reach its data, and it should say so
 * rather than show invented companies. Both login screens gate their credential
 * hints on this function, so under the old definition the shipped build
 * advertised a password that, until S-7, the deployed server accepted.
 *
 * It now matches `dataService.isDemoExperience()` exactly: demo asked for, and
 * no real backend to contradict it.
 */
export function isDemoMode(): boolean {
  return FEATURES.DEMO_EXPERIENCE && !FEATURES.BACKEND_INTEGRATION;
}

export function isVerboseLogging(): boolean {
  return FEATURES.VERBOSE_LOGGING;
}

export function shouldShowApiErrors(): boolean {
  return FEATURES.SHOW_API_ERRORS;
}
