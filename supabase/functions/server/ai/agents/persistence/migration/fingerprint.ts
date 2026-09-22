/**
 * A2-P08-C02 — exact and migration-semantic fingerprints of an agent bundle.
 *
 *   exact               every field, canonical form. Used when the tenant does
 *                       not move, and to prove a SQL read-back is the record
 *                       that was written.
 *   migration-semantic  the same, with exactly the three fields a tenant
 *                       translation is FORCED to change elided:
 *                       `run.context.organizationId`,
 *                       `checkpoint.organizationId`,
 *                       `approval.organizationId`.
 *
 * Fewer elisions than BP-004's workflow fingerprint, and that is the finding,
 * not a shortcut: no agent digest binds the tenant, so no digest field is
 * elided. If a transform changed anything else — a digest, a version, a
 * state, a byte of progress — the semantic fingerprints differ and the
 * comparison says so.
 */

import { canonicalJson, digestText } from '../../runtime/digest.ts';
import type { TransformedAgentBundle } from './transform.ts';

export type AgentFingerprintMode = 'exact' | 'migration-semantic';

const ELIDED = '<elided:tenant>';

function project(bundle: TransformedAgentBundle, mode: AgentFingerprintMode): unknown {
  if (mode === 'exact') return bundle;
  return {
    run: { ...bundle.run, context: { ...bundle.run.context, organizationId: ELIDED } },
    checkpoints: bundle.checkpoints.map((checkpoint) => ({ ...checkpoint, organizationId: ELIDED })),
    approvals: bundle.approvals.map((approval) => ({ ...approval, organizationId: ELIDED })),
  };
}

/**
 * One digest over a set of bundles, order-independent: bundles are keyed by
 * run id and every inner list is put in its domain order first, so two stores
 * that return the same facts in different orders fingerprint equal.
 */
export function fingerprintAgentBundles(
  bundles: readonly TransformedAgentBundle[],
  mode: AgentFingerprintMode,
): string {
  const normalized = [...bundles]
    .map((bundle) => ({
      run: bundle.run,
      checkpoints: [...bundle.checkpoints].sort((a, b) => a.version - b.version),
      approvals: [...bundle.approvals].sort((a, b) => a.approvalId.localeCompare(b.approvalId)),
    }))
    .sort((a, b) => a.run.context.runId.localeCompare(b.run.context.runId))
    .map((bundle) => project(bundle, mode));
  const canonical = canonicalJson(normalized);
  // Unserializable input is refused loudly rather than fingerprinted as "null",
  // which would make two different broken estates compare equal.
  if (canonical === undefined) throw new Error('agent bundle set is not canonically serializable');
  return digestText(canonical);
}

export type AgentFingerprintVerdict =
  | { readonly equivalent: true; readonly mode: AgentFingerprintMode }
  | { readonly equivalent: false; readonly mode: AgentFingerprintMode; readonly source: string; readonly target: string };

/**
 * Compare a source and a target set. When the tenant did not move, only exact
 * equality counts; when it did, migration-semantic equality is the claim.
 */
export function compareAgentFingerprints(
  source: readonly TransformedAgentBundle[],
  target: readonly TransformedAgentBundle[],
  tenantChanged: boolean,
): AgentFingerprintVerdict {
  const mode: AgentFingerprintMode = tenantChanged ? 'migration-semantic' : 'exact';
  const a = fingerprintAgentBundles(source, mode);
  const b = fingerprintAgentBundles(target, mode);
  return a === b ? { equivalent: true, mode } : { equivalent: false, mode, source: a, target: b };
}
