/**
 * ADMIN SEED POLICY (Batch 6 — Workstream 6)
 *
 * The edge function seeds a team admin user on startup. This decision MUST fail
 * CLOSED: an admin account is created only when BOTH TEAM_ADMIN_EMAIL and
 * TEAM_ADMIN_PASSWORD are explicitly configured. No default/hardcoded password
 * is ever used — a missing secret skips seeding rather than provisioning an
 * account with a publicly-known credential.
 *
 * Extracted as a pure, side-effect-free predicate so the fail-closed rule is
 * unit-testable without a Supabase runtime.
 */

export interface AdminSeedInput {
  email?: string | null;
  password?: string | null;
  name?: string | null;
}

export interface AdminSeedDecision {
  /** True only when it is safe to create the admin account. */
  seed: boolean;
  /** Human-readable explanation (logged on skip). */
  reason: string;
  /** Trimmed email, present only when seed === true. */
  email?: string;
  /** Resolved display name, present only when seed === true. */
  name?: string;
}

const DEFAULT_ADMIN_NAME = 'MARQ Admin';

export function resolveAdminSeed(input: AdminSeedInput): AdminSeedDecision {
  const email = input.email?.trim();
  const password = input.password?.trim();
  const name = input.name?.trim() || DEFAULT_ADMIN_NAME;

  if (!email || !password) {
    return {
      seed: false,
      reason:
        'TEAM_ADMIN_EMAIL and TEAM_ADMIN_PASSWORD must both be set to seed the admin user. ' +
        'No default credential is used — set both secrets in the edge function configuration to bootstrap the admin account.',
    };
  }

  return { seed: true, reason: 'Admin credentials configured.', email, name };
}
