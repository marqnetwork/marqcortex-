/**
 * A2-P06-C04 — the cutover verifier. GO or NO_GO, never a percentage.
 *
 * Three stages per domain, each answering one question with named checks:
 *
 *   PRE   (kv_frozen, before kv_frozen → sql_frozen)
 *         Is it true, right now, that there is nothing to move and somewhere
 *         correct to move it to? KV estate zero, SQL estate zero, the domain's
 *         three tables present with RLS enabled AND forced, all twelve functions
 *         present, the tenant configuration nameable by SQL.
 *
 *   POST  (sql_frozen, before sql_frozen → sql)
 *         Did the switch land where it was meant to, with nothing written
 *         anywhere since the freeze? Mode is sql_frozen, the runtime reached SQL
 *         through the gateway (a read succeeded), KV estate still zero, SQL
 *         estate still zero.
 *
 *   LIVE  (sql, after unfreezing)
 *         Does the authority behave? A scripted lifecycle through the composed
 *         stores — create, load, stale refusal, save, checkpoint append and
 *         duplicate refusal, approval request, decision, single-use spend,
 *         cross-tenant invisibility — every step passing.
 *
 * DIVERGENCE IS NEVER CLASSIFIED AWAY. When a caller supplies source and
 * target fingerprints (the re-entry path, should the zero-estate strategy ever
 * abort into a backfill), unequal fingerprints are NO_GO with no exceptions:
 * there is no "acceptable" divergence list here to grow.
 *
 * Pure. Observations are gathered by the caller — the read-only recheck SQL
 * against the hosted database, or a local rehearsal — and judged here.
 */

import type {
  RuntimeEstateCount,
  RuntimePersistenceDomain,
  RuntimePersistenceMode,
} from './runtimePersistenceAuthority.ts';
import { isZeroEstate, tenantConfigurationProblem } from './runtimePersistenceAuthority.ts';

export const REQUIRED_RUNTIME_SCHEMA: Readonly<
  Record<RuntimePersistenceDomain, { readonly tables: readonly string[]; readonly functions: number }>
> = {
  workflow: { tables: ['workflow_runs', 'workflow_checkpoints', 'workflow_approvals'], functions: 12 },
  agent: { tables: ['agent_runs', 'agent_checkpoints', 'agent_approvals'], functions: 12 },
};

export interface SchemaObservation {
  /** Runtime tables present with RLS enabled AND forced. */
  readonly tablesRlsForced: readonly string[];
  /** How many of the domain's twelve functions exist. */
  readonly functions: number;
}

export interface LivenessStep {
  readonly step: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface CutoverObservation {
  readonly domain: RuntimePersistenceDomain;
  readonly stage: 'pre' | 'post' | 'live';
  readonly mode: RuntimePersistenceMode;
  readonly kvEstate?: RuntimeEstateCount;
  readonly sqlEstate?: RuntimeEstateCount;
  readonly schema?: SchemaObservation;
  readonly tenantConfiguration?: { readonly defaultOrganizationId: string; readonly allowDefaultOrganization: boolean };
  /** A read through the composed runtime stores reached SQL and succeeded. */
  readonly sqlReadSucceeded?: boolean;
  readonly liveness?: readonly LivenessStep[];
  /** Only on a re-entry path with real rows; must be equal when present. */
  readonly fingerprints?: { readonly source: string; readonly target: string };
}

export interface CutoverCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface CutoverVerdict {
  readonly domain: RuntimePersistenceDomain;
  readonly stage: CutoverObservation['stage'];
  readonly verdict: 'GO' | 'NO_GO';
  readonly checks: readonly CutoverCheck[];
}

const count = (estate: RuntimeEstateCount | undefined) =>
  estate === undefined ? 'not observed' : `${estate.runs}/${estate.checkpoints}/${estate.approvals} (runs/checkpoints/approvals)`;

export function verifyCutover(observation: CutoverObservation): CutoverVerdict {
  const { domain, stage } = observation;
  const checks: CutoverCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const expectedMode: RuntimePersistenceMode = stage === 'pre' ? 'kv_frozen' : stage === 'post' ? 'sql_frozen' : 'sql';

  check('mode', observation.mode === expectedMode, `observed ${observation.mode}, ${stage} requires ${expectedMode}`);

  if (stage === 'pre' || stage === 'post') {
    check('kv_estate_zero', observation.kvEstate !== undefined && isZeroEstate(observation.kvEstate), `KV ${count(observation.kvEstate)}`);
    check('sql_estate_zero', observation.sqlEstate !== undefined && isZeroEstate(observation.sqlEstate), `SQL ${count(observation.sqlEstate)}`);
  }

  if (stage === 'pre') {
    const required = REQUIRED_RUNTIME_SCHEMA[domain];
    const forced = observation.schema?.tablesRlsForced ?? [];
    const missing = required.tables.filter((table) => !forced.includes(table));
    check('tables_rls_forced', observation.schema !== undefined && missing.length === 0,
      missing.length === 0 ? 'all three present, RLS enabled and forced' : `missing or not forced: ${missing.join(', ')}`);
    check('functions_present', observation.schema?.functions === required.functions,
      `${observation.schema?.functions ?? 'not observed'} of ${required.functions}`);
    const tenant = observation.tenantConfiguration === undefined
      ? 'not observed'
      : tenantConfigurationProblem(observation.tenantConfiguration);
    check('tenant_configuration', tenant === undefined, tenant ?? 'every producible tenant is a canonical UUID');
  }

  if (stage === 'post') {
    check('sql_reached', observation.sqlReadSucceeded === true, 'a read through the composed runtime stores succeeded against SQL');
  }

  if (stage === 'live') {
    const steps = observation.liveness ?? [];
    const failed = steps.filter((step) => !step.ok);
    check('liveness', steps.length > 0 && failed.length === 0,
      steps.length === 0 ? 'no liveness probe was run' : failed.length === 0 ? `${steps.length} steps passed` : `failed: ${failed.map((s) => s.step).join(', ')}`);
  }

  if (observation.fingerprints !== undefined) {
    check('fingerprints_equal', observation.fingerprints.source === observation.fingerprints.target,
      'source and target fingerprints must be identical; no divergence is classified away');
  }

  return { domain, stage, verdict: checks.every((c) => c.ok) ? 'GO' : 'NO_GO', checks };
}

// ── From the hosted recheck to observations ─────────────────────────────────

/**
 * The JSON `scripts/a2-zero-estate-recheck.sql` prints, turned into the
 * estate and schema half of an observation for one domain.
 *
 * FAIL CLOSED: if the recheck could not see every row
 * (`INCONCLUSIVE_ROW_SECURITY`), or a field is missing or not a number, the
 * estate is returned as UNOBSERVED — and `verifyCutover` fails an unobserved
 * estate. A SQL table the recheck reported absent counts as holding nothing,
 * which is true; whether it SHOULD be absent is the schema check's question.
 */
export function observationFromRecheck(
  recheck: unknown,
  domain: RuntimePersistenceDomain,
): Pick<CutoverObservation, 'kvEstate' | 'sqlEstate' | 'schema'> {
  const root = (typeof recheck === 'string' ? JSON.parse(recheck) : recheck) as Record<string, unknown> | null;
  if (!root || root.check !== 'a2-zero-estate-recheck' || root.verdict === 'INCONCLUSIVE_ROW_SECURITY') return {};
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  // ONLY a SQL table count may be null — the recheck's word for "table absent".
  // A null anywhere else is a malformed recheck, and is unobserved.
  const tableCount = (value: unknown): number | undefined => (value === null ? 0 : num(value));

  const kvDomain = ((root.kv as Record<string, unknown> | undefined)?.[domain] ?? {}) as Record<string, unknown>;
  const kv = { runs: num(kvDomain.runs), checkpoints: num(kvDomain.checkpoints), approvals: num(kvDomain.approvals) };
  const sqlRoot = (root.sql ?? {}) as Record<string, unknown>;
  const [runsTable, checkpointsTable, approvalsTable] = REQUIRED_RUNTIME_SCHEMA[domain].tables;
  const sql = { runs: tableCount(sqlRoot[runsTable]), checkpoints: tableCount(sqlRoot[checkpointsTable]), approvals: tableCount(sqlRoot[approvalsTable]) };
  const schemaRoot = (root.schema ?? {}) as Record<string, unknown>;
  const functions = num(schemaRoot[`${domain}_functions`]);
  const forced = Array.isArray(schemaRoot.tables_rls_forced) ? schemaRoot.tables_rls_forced.filter((t): t is string => typeof t === 'string') : undefined;

  const complete = (estate: { runs?: number; checkpoints?: number; approvals?: number }) =>
    estate.runs !== undefined && estate.checkpoints !== undefined && estate.approvals !== undefined
      ? (estate as RuntimeEstateCount)
      : undefined;
  return {
    ...(complete(kv) === undefined ? {} : { kvEstate: complete(kv) }),
    ...(complete(sql) === undefined ? {} : { sqlEstate: complete(sql) }),
    ...(forced === undefined || functions === undefined ? {} : { schema: { tablesRlsForced: forced, functions } }),
  };
}
