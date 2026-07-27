/**
 * Runtime Outcome SQL port — Deno-only (MCV2-S7.4-IMPLEMENT-009)
 *
 * Adapts the concrete `OutcomeRepository` (which imports `jsr:@supabase/...`)
 * to the pure `OutcomeSqlPort` used by the gateway shadow path. This file is
 * imported ONLY by the edge entrypoint at runtime — never by the storage
 * barrel or by tests — so the pure/tested core stays free of Supabase imports.
 *
 * Construction is LAZY and FAIL-SAFE: the service client/repository is built on
 * first use inside a try/catch. If service-role credentials are unavailable
 * (e.g. offline), the port throws on read; the gateway records an error
 * comparison and returns the KV value. SQL is never returned to users.
 *
 * READ-ONLY: only `getOutcomeByLegacyKey` is exposed. No writes.
 *
 * JOIN AXIS (MCV2-S7.4-REMEDIATION-2 · D1): correlation is by
 * `legacy_kv_key = 'outcome:{submissionId}'`. The previous wiring passed the raw
 * KV submission id to `getOutcomeBySubmission`, but KV ids are TEXT
 * (`SUB-<ts>-<rand>`) while `outcomes.submission_id` is a generated UUID — every
 * such query failed with Postgres 22P02 (invalid input syntax for type uuid), so
 * the shadow could never produce a comparison. `legacy_kv_key` is TEXT and has a
 * dedicated unique index (`outcomes_legacy_kv_key_uidx`) for exactly this join.
 *
 * The legacy-key lookup is globally unique and NOT tenant-scoped, so tenancy is
 * enforced downstream by `compareOutcome`, which fails closed on any
 * `organization_id` that does not match the requesting org.
 */

import type { OutcomeSqlPort } from './contracts.ts';
import type { OutcomeRepository } from '../repositories/diagnosticTypes.ts';
import { createOutcomeRepository } from '../repositories/outcomeRepository.ts';

export function createRuntimeOutcomeSqlPort(): OutcomeSqlPort {
  let repo: OutcomeRepository | null = null;

  function getRepo(): OutcomeRepository {
    if (!repo) {
      // Throws here if service-role creds are missing — caught by the gateway.
      repo = createOutcomeRepository();
    }
    return repo;
  }

  return {
    async getOutcomeByLegacyKey(legacyKvKey: string): Promise<unknown> {
      return getRepo().getOutcomeByLegacyKey(legacyKvKey);
    },
  };
}
