/**
 * LOGGER — Centralized logging that respects VERBOSE_LOGGING feature flag
 *
 * Usage:
 *   import { log } from '@/app/utils/logger';
 *   log.info('Message');      // Only logs when VERBOSE_LOGGING is true
 *   log.warn('Warning');      // Only logs when VERBOSE_LOGGING is true
 *   log.error('Error', err);  // Always logs (errors should never be silenced)
 *   log.debug('Debug info');  // Only logs when VERBOSE_LOGGING is true
 */

import { FEATURES } from '@/config/features';

function noop(..._args: unknown[]) {}

export const log = {
  info: FEATURES.VERBOSE_LOGGING
    ? (...args: unknown[]) => console.log(...args)
    : noop,
  warn: FEATURES.VERBOSE_LOGGING
    ? (...args: unknown[]) => console.warn(...args)
    : noop,
  debug: FEATURES.VERBOSE_LOGGING
    ? (...args: unknown[]) => console.log('[debug]', ...args)
    : noop,
  /** Errors always log regardless of VERBOSE_LOGGING */
  error: (...args: unknown[]) => console.error(...args),
};
