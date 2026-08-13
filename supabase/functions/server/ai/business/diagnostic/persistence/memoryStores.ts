/**
 * TEST AND TOOLING ONLY. Not part of the production assembly (Part 7D, F2).
 *
 * One store lives here: a read-only dossier source, seeded from fixtures. It is
 * separated from `ports.ts` — where it used to sit beside three record-of-record
 * stores that defaulted into production assembly — so that "is anything in this
 * capability backed by isolate-local memory" is answerable by reading the import
 * graph rather than by reading every assembly call.
 *
 * ── WHY THIS ONE IS NOT THE DEFECT F2 IS ABOUT ─────────────────────────────
 *
 * A dossier store is a READ of a submission a diagnostic already produced. It
 * decides nothing, records no decision, and has no replay window to reopen — so
 * a fixture implementation of it is a fixture, not a durability posture. The
 * three stores that DO carry decisions — the sealed draft, the escalation and
 * the committed review — have no memory implementation at all any more: they are
 * durable in `kvDiagnosticStores.ts` or they are not assembled.
 *
 * There is deliberately no eviction here. A bounded fixture that dropped rows
 * would make a test's outcome depend on how many submissions it seeded, and the
 * seed is fixed and small.
 *
 * `createDiagnosticCapability` never imports this file. The boundary scan
 * asserts it, and the certification suite drives the durable stores instead —
 * over a key-value double with real compare-and-swap semantics, which is what
 * makes the restart and concurrency cases provable rather than asserted.
 */

import type { DiagnosticSubmissionDossier } from '../contracts/dossier.ts';
import type { DiagnosticDossierStore } from './ports.ts';

export function createMemoryDossierStore(
  seed: readonly DiagnosticSubmissionDossier[] = [],
): DiagnosticDossierStore & { put(record: DiagnosticSubmissionDossier): void; size(): number } {
  const rows = new Map<string, DiagnosticSubmissionDossier>();
  const keyOf = (organizationId: string, submissionId: string) =>
    `${organizationId}:${submissionId}`;
  for (const record of seed) rows.set(keyOf(record.organizationId, record.submissionId), record);

  return {
    load: (organizationId, submissionId) =>
      Promise.resolve(rows.get(keyOf(organizationId, submissionId))),
    put: (record) => {
      rows.set(keyOf(record.organizationId, record.submissionId), record);
    },
    size: () => rows.size,
  };
}
