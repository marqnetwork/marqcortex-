/**
 * A2-P06 — WHICH STORE IS THE AUTHORITY, AND HOW IT IS ALLOWED TO CHANGE.
 *
 * The transition control for the workflow and agent runtime persistence
 * cutover, and nothing else. Pure: it reads no environment, no clock and no
 * database. The composition hands it the configured values and the evidence;
 * it answers which store is authoritative, whether writes are allowed, and
 * whether a proposed transition is permitted.
 *
 * ── THE STRATEGY THIS ENCODES (A2-P05, from the real hosted estate) ────────
 *
 * The hosted estate holds ZERO workflow and ZERO agent runtime rows. So the
 * transition is not backfill, catch-up or shadowing — each of those would add
 * a second writer to protect data that does not exist. It is:
 *
 *   SHORT MUTATION FREEZE → FINAL ZERO-ESTATE RECHECK → APPROVED MIGRATIONS
 *   AND DEPLOYMENT → SQL AUTHORITY
 *
 * and the zero-estate recheck is a precondition the controller REFUSES to
 * skip. If any runtime row exists at the recheck, the transition is refused
 * with `ABORT_ZERO_BACKFILL_STRATEGY`: the rows are never dropped, never
 * ignored and never silently copied — strategy selection is re-entered.
 *
 * ── FOUR MODES PER DOMAIN, ONE AUTHORITY IN EACH ──────────────────────────
 *
 *   kv          KV is the authority; writes allowed.   (production today)
 *   kv_frozen   KV is the authority; every write refused.
 *   sql_frozen  SQL is the authority; every write refused.
 *   sql         SQL is the authority; writes allowed.
 *
 * There is no mode with two authorities, no mode that writes both stores and
 * no mode that reads one and writes the other. Frozen modes are the only
 * places an authority may change, so the store that is authoritative is never
 * being written while it changes.
 *
 * ── THE EDGES, AND THE EVIDENCE EACH ONE REQUIRES ─────────────────────────
 *
 *   kv         → kv_frozen    none: freezing is always safe
 *   kv_frozen  → kv           none: abandoning a freeze is always safe
 *   kv_frozen  → sql_frozen   KV estate of this domain is ZERO (the recheck),
 *                             SQL estate is ZERO, SQL schema is present, and
 *                             the tenant configuration can name every tenant
 *   sql_frozen → sql          the post-cutover verification passed
 *   sql        → sql_frozen   none: re-freezing is always safe
 *   sql_frozen → kv_frozen    ROLLBACK: allowed only while the SQL estate is
 *                             ZERO — once SQL holds a row it is the only copy,
 *                             and handing authority back to KV would orphan it
 *
 * Every other edge is refused, including kv → sql (skips the freeze and the
 * recheck) and sql → kv (skips the freeze and the rollback check). A
 * transition to the mode already in force is a no-op, which is what makes a
 * repeated controller step idempotent after a crash.
 *
 * ── WORKFLOW AND AGENT ARE SEPARATE DOMAINS ───────────────────────────────
 *
 * Each has its own mode. Nothing here forces them to move together, and no
 * foreign key joins their tables; the dossier moves them in one freeze window,
 * workflow first, because a workflow node drives an agent run.
 */

export const RUNTIME_PERSISTENCE_DOMAINS = ['workflow', 'agent'] as const;
export type RuntimePersistenceDomain = (typeof RUNTIME_PERSISTENCE_DOMAINS)[number];

export const RUNTIME_PERSISTENCE_MODES = ['kv', 'kv_frozen', 'sql_frozen', 'sql'] as const;
export type RuntimePersistenceMode = (typeof RUNTIME_PERSISTENCE_MODES)[number];

export type RuntimePersistenceAuthority = 'kv' | 'sql';

/**
 * The deployment variable for each domain. Unset means `kv` — the production
 * truth today — and ANY other unrecognised value is refused, never read as a
 * default: a mistyped `sqll` must not quietly leave a deployment on KV while
 * its operator believes it moved, nor quietly move it.
 */
export const RUNTIME_PERSISTENCE_ENV: Readonly<Record<RuntimePersistenceDomain, string>> = {
  workflow: 'AI_WORKFLOW_PERSISTENCE',
  agent: 'AI_AGENT_PERSISTENCE',
};

export type ModeVerdict =
  | { readonly ok: true; readonly mode: RuntimePersistenceMode }
  | { readonly ok: false; readonly problem: string };

export function parseRuntimePersistenceMode(
  domain: RuntimePersistenceDomain,
  raw: string | undefined,
): ModeVerdict {
  if (raw === undefined || raw.trim() === '') return { ok: true, mode: 'kv' };
  const value = raw.trim();
  if ((RUNTIME_PERSISTENCE_MODES as readonly string[]).includes(value)) {
    return { ok: true, mode: value as RuntimePersistenceMode };
  }
  return {
    ok: false,
    problem:
      `${RUNTIME_PERSISTENCE_ENV[domain]}=${JSON.stringify(value)} is not one of ` +
      `${RUNTIME_PERSISTENCE_MODES.join(', ')}; ${domain} persistence is refused rather than guessed`,
  };
}

export function authorityOf(mode: RuntimePersistenceMode): RuntimePersistenceAuthority {
  return mode === 'kv' || mode === 'kv_frozen' ? 'kv' : 'sql';
}

export function writesAllowed(mode: RuntimePersistenceMode): boolean {
  return mode === 'kv' || mode === 'sql';
}

// ── Tenant configuration ────────────────────────────────────────────────────

const ORGANIZATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Can the SQL authority name every tenant this configuration can produce?
 *
 * Verified memberships resolve to canonical `organizations.id` UUIDs. The one
 * other route to a tenant is the default organization, and it is safe for SQL
 * only if it is OFF or is itself a UUID. The hosted deployment today has the
 * default `marq-cortex` with the fallback OFF — safe — and this check is what
 * keeps a later change of one of those two values from quietly re-opening a
 * route to a tenant the relational authority cannot store.
 */
export function tenantConfigurationProblem(config: {
  readonly defaultOrganizationId: string;
  readonly allowDefaultOrganization: boolean;
}): string | undefined {
  if (!config.allowDefaultOrganization) return undefined;
  if (ORGANIZATION_UUID.test(config.defaultOrganizationId)) return undefined;
  return (
    `the default organization ${JSON.stringify(config.defaultOrganizationId)} is enabled and is not ` +
    'a canonical organizations.id UUID; SQL authority would refuse every run it produces'
  );
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** Row counts for one domain, from one store. Counts only — never payloads. */
export interface RuntimeEstateCount {
  readonly runs: number;
  readonly checkpoints: number;
  readonly approvals: number;
}

export function isZeroEstate(count: RuntimeEstateCount): boolean {
  return count.runs === 0 && count.checkpoints === 0 && count.approvals === 0;
}

export interface TransitionEvidence {
  /** The final recheck of the KV source for this domain. */
  readonly kvEstate?: RuntimeEstateCount;
  /** The SQL tables for this domain. */
  readonly sqlEstate?: RuntimeEstateCount;
  /** The domain's SQL tables and functions exist (migrations applied). */
  readonly sqlSchemaPresent?: boolean;
  readonly tenantConfiguration?: {
    readonly defaultOrganizationId: string;
    readonly allowDefaultOrganization: boolean;
  };
  /** The post-cutover verification for this domain passed. */
  readonly postCutoverVerified?: boolean;
}

export type TransitionVerdict =
  | { readonly allowed: true; readonly noop: boolean; readonly authorityAfter: RuntimePersistenceAuthority }
  | {
      readonly allowed: false;
      /** ABORT_ZERO_BACKFILL_STRATEGY is the one refusal that re-opens strategy selection. */
      readonly code: 'EDGE_NOT_PERMITTED' | 'EVIDENCE_MISSING' | 'ABORT_ZERO_BACKFILL_STRATEGY' | 'ROLLBACK_WINDOW_CLOSED' | 'TENANT_CONFIGURATION_UNSAFE' | 'SCHEMA_ABSENT' | 'NOT_VERIFIED';
      readonly reasons: readonly string[];
    };

function describe(count: RuntimeEstateCount): string {
  return `${count.runs} run(s), ${count.checkpoints} checkpoint(s), ${count.approvals} approval(s)`;
}

export function planTransition(
  domain: RuntimePersistenceDomain,
  from: RuntimePersistenceMode,
  to: RuntimePersistenceMode,
  evidence: TransitionEvidence = {},
): TransitionVerdict {
  if (from === to) return { allowed: true, noop: true, authorityAfter: authorityOf(to) };
  const ok = (): TransitionVerdict => ({ allowed: true, noop: false, authorityAfter: authorityOf(to) });
  const edge = `${from} -> ${to}`;

  // Always-safe edges: they change whether writes happen, never who owns them.
  if (edge === 'kv -> kv_frozen' || edge === 'kv_frozen -> kv' || edge === 'sql -> sql_frozen') return ok();

  if (edge === 'kv_frozen -> sql_frozen') {
    if (evidence.kvEstate === undefined || evidence.sqlEstate === undefined) {
      return { allowed: false, code: 'EVIDENCE_MISSING', reasons: [`${domain}: the final zero-estate recheck of KV and SQL is required`] };
    }
    if (!isZeroEstate(evidence.kvEstate)) {
      return {
        allowed: false,
        code: 'ABORT_ZERO_BACKFILL_STRATEGY',
        reasons: [
          `${domain}: the KV source holds ${describe(evidence.kvEstate)}; the zero-backfill strategy does not ` +
            'apply — nothing is dropped or copied, strategy selection must be re-entered',
        ],
      };
    }
    if (!isZeroEstate(evidence.sqlEstate)) {
      return {
        allowed: false,
        code: 'ABORT_ZERO_BACKFILL_STRATEGY',
        reasons: [`${domain}: the SQL tables already hold ${describe(evidence.sqlEstate)} before any authority was granted to them`],
      };
    }
    if (evidence.sqlSchemaPresent !== true) {
      return { allowed: false, code: 'SCHEMA_ABSENT', reasons: [`${domain}: the SQL persistence migrations are not applied`] };
    }
    if (evidence.tenantConfiguration === undefined) {
      return { allowed: false, code: 'EVIDENCE_MISSING', reasons: [`${domain}: the tenant configuration was not supplied`] };
    }
    const tenant = tenantConfigurationProblem(evidence.tenantConfiguration);
    if (tenant !== undefined) return { allowed: false, code: 'TENANT_CONFIGURATION_UNSAFE', reasons: [`${domain}: ${tenant}`] };
    return ok();
  }

  if (edge === 'sql_frozen -> sql') {
    if (evidence.postCutoverVerified !== true) {
      return { allowed: false, code: 'NOT_VERIFIED', reasons: [`${domain}: the post-cutover verification has not passed`] };
    }
    return ok();
  }

  if (edge === 'sql_frozen -> kv_frozen') {
    if (evidence.sqlEstate === undefined) {
      return { allowed: false, code: 'EVIDENCE_MISSING', reasons: [`${domain}: a rollback needs the SQL estate count`] };
    }
    if (!isZeroEstate(evidence.sqlEstate)) {
      return {
        allowed: false,
        code: 'ROLLBACK_WINDOW_CLOSED',
        reasons: [
          `${domain}: SQL already holds ${describe(evidence.sqlEstate)} written under its authority; ` +
            'handing authority back to KV would orphan them',
        ],
      };
    }
    return ok();
  }

  return {
    allowed: false,
    code: 'EDGE_NOT_PERMITTED',
    reasons: [`${domain}: ${edge} is not a permitted transition; every authority change passes through a frozen mode`],
  };
}
