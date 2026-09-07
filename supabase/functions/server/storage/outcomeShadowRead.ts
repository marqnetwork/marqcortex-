/**
 * Outcome shadow read, wired — MCV2-S7.4.
 *
 * The one place the generic reader meets this deployment: the switches, the
 * relational read, and the single call a route makes.
 *
 * ── THE SWITCHES ───────────────────────────────────────────────────────────
 *
 *   MCV2_SHADOW_READ_OUTCOMES     off by default. On, an outcome read also
 *                                 reads the relational row and records whether
 *                                 the two stores agree. It changes nothing that
 *                                 is served — KV remains authoritative, which
 *                                 is the golden rule for the whole migration.
 *
 *   MCV2_SHADOW_READ_DEADLINE_MS  250 by default, bounded 10–2000. What the
 *                                 CALLER may be made to wait for the relational
 *                                 read before it is abandoned.
 *
 * Both are read at the point of use rather than captured at module load, so an
 * operator turning the switch off stops the next read rather than the next
 * deploy. There is no setting here that makes the relational store
 * authoritative, and there is deliberately no code path that could: the reader
 * returns nothing, so there is nothing for a route to serve even by mistake.
 *
 * ── WHY THE CLIENT IS BUILT LAZILY AND ITS FAILURE IS A RECORD ─────────────
 *
 * `createServiceClient` throws when the service credentials are absent, which
 * is a perfectly ordinary state for a deployment that has not configured the
 * relational plane yet. Constructing it at module load would make that state a
 * startup failure for the whole edge function — an instrument taking down the
 * thing it was meant to measure. So it is built on first use, inside the
 * reader's own error absorption, and a deployment without credentials simply
 * records `error` on every shadow read and serves every request exactly as it
 * always did.
 */

import { createOutcomeRepository } from '../repositories/outcomeRepository.ts';
import { createServiceClient } from '../repositories/repositoryClient.ts';
import { createShadowReader, type ShadowReader } from './shadowReader.ts';
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
  // A malformed deadline falls back to the default rather than to zero or to
  // infinity: a typo in an observability knob must not remove the bound that
  // keeps this module off the critical path.
  if (!Number.isFinite(parsed)) return DEADLINE_DEFAULT_MS;
  return Math.min(DEADLINE_MAX_MS, Math.max(DEADLINE_MIN_MS, parsed));
}

/** The reader this deployment uses. One instance, so the report accumulates. */
export const outcomeShadowReader: ShadowReader = createShadowReader({
  enabled: () => readBool('MCV2_SHADOW_READ_OUTCOMES'),
  deadlineMs: readDeadlineMs,
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
  onDivergence: (record) => {
    // Field names and a kind. No value from either store — see invariant 4.
    console.log(
      `⚠️ shadow-read divergence [${record.domain}] ${record.key}: ` +
        record.divergences.map((entry) => `${entry.field}=${entry.kind}`).join(', '),
    );
  },
});

// Inferred rather than annotated, so this module names no vendor SDK type. It
// is the repositories' client and their business what it is; this file only has
// to hold one and hand it over.
let client: ReturnType<typeof createServiceClient> | undefined;

/** The service client, built on first use. Throws into the reader's absorber. */
function serviceClient(): ReturnType<typeof createServiceClient> {
  if (!client) client = createServiceClient();
  return client;
}

/**
 * Observe one outcome read.
 *
 * `kvRecord` is the record the caller WAS ACTUALLY SERVED, passed in rather
 * than re-fetched: the point of a shadow read is to compare the answer somebody
 * received against what the other store holds, and a second KV read would
 * compare two answers nobody received.
 *
 * Never throws, never delays a caller past the deadline, and returns nothing.
 * A route calls it after its response body is decided.
 */
export function observeOutcomeRead(submissionId: string, kvRecord: unknown): Promise<void> {
  const key = outcomeKvKey(submissionId);
  return outcomeShadowReader.observe({
    domain: 'outcome',
    key,
    fields: OUTCOME_FIELDS,
    kv: projectKvOutcome(kvRecord),
    loadSql: () => createOutcomeRepository(serviceClient()).getOutcomeByLegacyKey(key),
    project: projectSqlOutcome,
  });
}

/** Whether outcome shadow reads are currently switched on. */
export function outcomeShadowReadEnabled(): boolean {
  return readBool('MCV2_SHADOW_READ_OUTCOMES');
}
