/**
 * Startup secret validation (A1 — backend auth production-readiness).
 *
 * Pure, runtime-agnostic helper: it takes a plain env snapshot and reports
 * which required secrets are missing. It imports NOTHING from Deno or the
 * network so it is importable both by the Edge Function (Deno) and by the
 * Node test runner.
 *
 * The backend uses this to FAIL CLOSED: if any required secret is absent,
 * the admin seeder refuses to create a default account and the team-login
 * route refuses to authenticate. There are no hardcoded credential fallbacks.
 */

/** Secrets that must be present for backend auth to operate securely. */
export const REQUIRED_AUTH_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'TEAM_ADMIN_EMAIL',
  'TEAM_ADMIN_PASSWORD',
] as const;

export type RequiredSecret = (typeof REQUIRED_AUTH_SECRETS)[number];

export interface SecretValidationResult {
  /** True only when every required secret is present and non-empty. */
  valid: boolean;
  /** Names of the required secrets that are missing or blank. */
  missing: string[];
}

/** A value counts as "present" only if it is a non-empty, non-whitespace string. */
function isPresent(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that every required secret is present in the given env snapshot.
 *
 * @param env       Map of env var name → value (e.g. a snapshot of Deno.env).
 * @param required  Override the required list (defaults to REQUIRED_AUTH_SECRETS).
 */
export function validateStartupSecrets(
  env: Record<string, string | undefined | null>,
  required: readonly string[] = REQUIRED_AUTH_SECRETS,
): SecretValidationResult {
  const missing = required.filter((key) => !isPresent(env[key]));
  return { valid: missing.length === 0, missing };
}
