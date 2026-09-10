/**
 * Outcome read authority, wired — MCV2-S8.1.
 *
 * The deployment half of the cutover: the switches, the relational read, and
 * the single call a route makes. It mirrors `outcomeShadowRead.ts` deliberately
 * — same lazy client, same deadline, same "read the switch at the point of use"
 * — because the two are the same rollout at two stages, and an operator should
 * not have to learn a second set of habits to run the second one.
 *
 * ── THE SWITCHES ───────────────────────────────────────────────────────────
 *
 *   MCV2_SQL_AUTHORITY_OUTCOMES   off by default. On, an outcome read is
 *                                 ANSWERED BY the relational row where one
 *                                 exists, falling back to KV where it does not.
 *                                 This is the only switch in the repository
 *                                 that changes which store answers a customer.
 *
 *   MCV2_SHADOW_READ_DEADLINE_MS  shared with the shadow read, and shared on
 *                                 purpose: it is the same question — how long a
 *                                 caller may be made to wait on the relational
 *                                 store — and two knobs would eventually
 *                                 disagree.
 *
 * ── THE ORDER OF OPERATIONS MATTERS ────────────────────────────────────────
 *
 * A route resolves authority FIRST and shadow-observes SECOND, with the record
 * it actually served. Observing first would compare the KV record against SQL
 * and then serve SQL — recording an agreement check for an answer nobody
 * received.
 *
 * ── ROLLBACK ───────────────────────────────────────────────────────────────
 *
 * Set the switch to anything but `true`/`1`. The next read is KV again. No
 * deploy, no migration, no data movement — which is the property that makes
 * this safe to switch on at all.
 */

import { createOutcomeRepository } from '../repositories/outcomeRepository.ts';
import { createServiceClient } from '../repositories/repositoryClient.ts';
import { createReadAuthority, type AuthorityDomain, type ReadAuthority } from './readAuthority.ts';
import { OUTCOME_FIELDS, outcomeKvKey, projectKvOutcome, projectSqlOutcome } from './outcomeProjection.ts';

const DEADLINE_DEFAULT_MS = 250;
const DEADLINE_MIN_MS = 10;
const DEADLINE_MAX_MS = 2_000;

function readBool(key: string): boolean {
  const raw = Deno.env.get(key);
  return raw === 'true' || raw === '1';
}

function readDeadlineMs(): number {
  const raw = Deno.env.get('MCV2_SHADOW_READ_DEADLINE_MS');
  if (raw === undefined || raw.trim() === '') return DEADLINE_DEFAULT_MS;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return DEADLINE_DEFAULT_MS;
  return Math.min(DEADLINE_MAX_MS, Math.max(DEADLINE_MIN_MS, parsed));
}

/** The switch, per domain. Only outcomes can be switched on so far. */
function authoritative(domain: AuthorityDomain): boolean {
  return domain === 'outcome' && readBool('MCV2_SQL_AUTHORITY_OUTCOMES');
}

export const readAuthority: ReadAuthority = createReadAuthority({
  authoritative,
  deadlineMs: readDeadlineMs,
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
  onNotice: (record) => {
    // A fallback, or a divergence on an answer SQL actually served. Field names
    // and a source, never a value from either store.
    console.log(
      `⚠️ read-authority [${record.domain}] ${record.key}: ${record.source}` +
        (record.divergentFields ? ` diverged=${record.divergentFields.join(',')}` : ''),
    );
  },
});

let client: ReturnType<typeof createServiceClient> | undefined;
function serviceClient(): ReturnType<typeof createServiceClient> {
  if (!client) client = createServiceClient();
  return client;
}

/**
 * Which store answers this outcome read.
 *
 * `kvRecord` is what KV holds. The return value is what the caller should be
 * served — the same object when the switch is off, which is what makes an
 * un-opted-in deployment identical to one without this module.
 */
export async function resolveOutcomeRead(
  submissionId: string,
  kvRecord: unknown,
): Promise<{ record: unknown; source: string }> {
  const key = outcomeKvKey(submissionId);
  const resolution = await readAuthority.resolve<unknown>({
    domain: 'outcome',
    key,
    kv: kvRecord,
    fields: OUTCOME_FIELDS,
    loadSql: () => createOutcomeRepository(serviceClient()).getOutcomeByLegacyKey(key),
    // The relational row, in the shape this route's body already uses. The KV
    // record is the contract; a cutover that changed the response shape would
    // be a breaking API change wearing a feature flag.
    toRecord: (row) => outcomeRowToKvShape(row),
    projectKv: (record) => projectKvOutcome(record),
    projectSql: (row) => projectSqlOutcome(row),
  });
  return { record: resolution.record, source: resolution.source };
}

/**
 * A relational outcome row, in the KV record's shape.
 *
 * The denormalised submission fields KV carried — industry, company, aiScore,
 * submittedAt — are NOT reconstructed. They were a snapshot taken when the
 * outcome was logged; the relational model answers those live from the
 * submission, and inventing them here would put a stale copy back into the
 * response the cutover was meant to modernise. `outcomeProjection.ts` excludes
 * them from comparison for the same reason.
 */
function outcomeRowToKvShape(row: unknown): Record<string, unknown> {
  const record = (row ?? {}) as Record<string, unknown>;
  const value = (record.value ?? {}) as Record<string, unknown>;
  return {
    submissionId: String(record.legacy_kv_key ?? '').replace(/^outcome:/, ''),
    didConvert: record.outcome_type === 'won',
    conversionValue: value.conversionValue ?? null,
    lostReason: value.lostReason ?? null,
    recommendationWorked: value.recommendationWorked ?? null,
    whatWeLearned: value.whatWeLearned ?? null,
    improvementAreas: value.improvementAreas ?? [],
    recommendedService: value.recommendedService ?? null,
    loggedBy: value.loggedBy ?? null,
    loggedAt: record.recorded_at ?? null,
  };
}

/** Whether the outcome domain is currently served by SQL. */
export function outcomeSqlAuthorityEnabled(): boolean {
  return authoritative('outcome');
}
