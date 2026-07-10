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

export function isVerboseLogging(): boolean {
  return FEATURES.VERBOSE_LOGGING;
}

export function shouldShowApiErrors(): boolean {
  return FEATURES.SHOW_API_ERRORS;
}
