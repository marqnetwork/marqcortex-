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
 * READ-ONLY: only `getOutcomeBySubmission` is exposed. No writes.
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
    async getOutcomeBySubmission(submissionId: string, organizationId: string): Promise<unknown> {
      return getRepo().getOutcomeBySubmission(submissionId, organizationId);
    },
  };
}
