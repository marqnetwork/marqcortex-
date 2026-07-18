/**
 * Runtime Storage Gateway — configuration (MCV2-S7.4 → S7.8)
 *
 * Reads shadow-read feature flags from the edge-function environment. This is
 * the ONLY module in the runtime package that touches Deno globals, so the
 * gateway/drift primitives stay unit-testable under node.
 *
 * Authority remains KV until Phase 5 (SQL cutover). Shadow reads default OFF
 * for every domain — enabling them changes nothing the caller observes; it
 * only turns on backend comparison + drift telemetry.
 *
 * Env flags (all default `false`):
 *   SHADOW_READ_ENABLED       — master switch; must be on for any shadow read
 *   SHADOW_READ_OUTCOMES      — S7.4 Outcome shadow read
 *   SHADOW_READ_LEADS         — S7.6 Lead shadow read
 *   SHADOW_READ_SUBMISSIONS   — S7.7 Submission shadow read
 */
import type { ShadowDomain, StorageAuthority } from './types.ts';

/** Reads are authoritative from KV until the Phase 5 SQL cutover. */
export const RUNTIME_STORAGE_AUTHORITY: StorageAuthority = 'kv';

function envFlag(key: string): boolean {
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    return env?.get(key) === 'true';
  } catch {
    return false;
  }
}

const DOMAIN_FLAG: Record<ShadowDomain, string> = {
  outcome: 'SHADOW_READ_OUTCOMES',
  lead: 'SHADOW_READ_LEADS',
  submission: 'SHADOW_READ_SUBMISSIONS',
};

/**
 * True only when the master switch AND the per-domain switch are both set.
 * Two gates keep an accidental single flag from turning shadow reads on
 * everywhere at once.
 */
export function isShadowReadEnabled(domain: ShadowDomain): boolean {
  if (!envFlag('SHADOW_READ_ENABLED')) return false;
  return envFlag(DOMAIN_FLAG[domain]);
}
