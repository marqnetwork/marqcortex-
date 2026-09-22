/**
 * A2-P08-C02 — the agent tenant transformation. DETERMINISTIC, PURE, NO REPAIR.
 *
 * ── WHAT A TENANT TRANSLATION CHANGES, AND WHY IT IS SO LITTLE ─────────────
 *
 * BP-004's workflow transform had to RE-CHAIN every checkpoint, because a
 * workflow checkpoint digest binds the organization. The agent audit
 * (A2-P07-C01) established that no agent integrity value does:
 *
 *   progressDigest   digestValue(progress)                  — content only
 *   previousDigest   the predecessor's progressDigest       — content only
 *   step fingerprint agentId | actionType | target | payload — no tenant
 *   planDigest       { agentId, version, objective }        — no tenant
 *
 * So the ONLY fields a translation rewrites are the three that NAME the
 * tenant: `run.context.organizationId`, `checkpoint.organizationId` and
 * `approval.organizationId`. No integrity value is recomputed, because none is
 * mathematically required to change — and recomputing one that did not have to
 * change would be manufacturing a digest, which the packet forbids.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CHANGE ───────────────────────────────────
 *
 * Business content that happens to MENTION the old identifier — a tool
 * observation inside `progress`, say — is left exactly as written. It is a
 * historical fact, `progressDigest` vouches for it byte for byte, and editing
 * it would break the one integrity proof the checkpoint has. Such mentions are
 * COUNTED (`residualSourceTenantReferences`) so a reviewer sees them, and
 * nothing more.
 *
 * ── VERIFY FIRST ───────────────────────────────────────────────────────────
 *
 * A bundle is transformed only if its tenant resolved, it carries no blocking
 * pointer classification, and every checkpoint's progress still hashes to its
 * own digest — re-checked here rather than trusted from the inventory, so this
 * function is safe to call on its own. A bundle that fails is REFUSED, never
 * adjusted.
 */

import type {
  AgentApprovalRequest,
  AgentCheckpoint,
  AgentRunRecord,
} from '../../contracts/runtime.ts';
import { digestValue } from '../../runtime/digest.ts';
import type { AgentRunBundle } from './contracts.ts';
import { isTransformableAgentBundle } from './contracts.ts';

export interface TransformedAgentBundle {
  readonly run: AgentRunRecord;
  readonly checkpoints: readonly AgentCheckpoint[];
  readonly approvals: readonly AgentApprovalRequest[];
}

export type AgentTransformVerdict =
  | {
      readonly ok: true;
      readonly bundle: TransformedAgentBundle;
      /** Mentions of the source tenant id outside the identity fields. Never edited. */
      readonly residualSourceTenantReferences: number;
    }
  | { readonly ok: false; readonly problem: string };

/** Occurrences of `needle` as a whole string value anywhere inside `value`. */
function countStringValues(value: unknown, needle: string): number {
  if (typeof value === 'string') return value.includes(needle) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + countStringValues(entry, needle), 0);
  if (value !== null && typeof value === 'object') {
    let sum = 0;
    for (const entry of Object.values(value as Record<string, unknown>)) sum += countStringValues(entry, needle);
    return sum;
  }
  return 0;
}

export function transformAgentBundle(
  bundle: AgentRunBundle,
  sourceTenantId: string,
  targetOrganizationId: string,
): AgentTransformVerdict {
  // ── Verify the source, independently of whoever called ──────────────────
  if (!isTransformableAgentBundle(bundle)) {
    return { ok: false, problem: `run ${bundle.run.context.runId} is ${bundle.pointer}` };
  }
  if (bundle.run.context.organizationId !== sourceTenantId) {
    return { ok: false, problem: `run ${bundle.run.context.runId} does not belong to ${sourceTenantId}` };
  }
  for (const checkpoint of bundle.checkpoints) {
    if (checkpoint.organizationId !== sourceTenantId || checkpoint.runId !== bundle.run.context.runId) {
      return { ok: false, problem: `checkpoint ${checkpoint.version} does not belong to this run` };
    }
    if (checkpoint.progressDigest !== digestValue(checkpoint.progress)) {
      return { ok: false, problem: `checkpoint ${checkpoint.version} progress does not hash to its digest` };
    }
  }
  for (const approval of bundle.approvals) {
    if (approval.organizationId !== sourceTenantId || approval.runId !== bundle.run.context.runId) {
      return { ok: false, problem: `approval ${approval.approvalId} does not belong to this run` };
    }
  }

  // ── Transform: the three identity fields, nothing else ──────────────────
  const run: AgentRunRecord = {
    ...bundle.run,
    context: { ...bundle.run.context, organizationId: targetOrganizationId },
  };
  const checkpoints = bundle.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    organizationId: targetOrganizationId,
  }));
  const approvals = bundle.approvals.map((approval) => ({
    ...approval,
    organizationId: targetOrganizationId,
  }));

  // Residual mentions, counted over the SOURCE with the identity fields
  // removed — so the count is "places the old id appears that this transform
  // left alone", never including the three it rewrote.
  const residualSourceTenantReferences =
    sourceTenantId === targetOrganizationId
      ? 0
      : countStringValues({ ...bundle.run, context: { ...bundle.run.context, organizationId: '' } }, sourceTenantId) +
        bundle.checkpoints.reduce((sum, c) => sum + countStringValues({ ...c, organizationId: '' }, sourceTenantId), 0) +
        bundle.approvals.reduce((sum, a) => sum + countStringValues({ ...a, organizationId: '' }, sourceTenantId), 0);

  return { ok: true, bundle: { run, checkpoints, approvals }, residualSourceTenantReferences };
}

/**
 * Transform one tenant, all or nothing.
 *
 * Refused unless the readiness manifest said GO for it and named a target.
 * One refused bundle refuses the tenant: a partially translated tenant is a
 * tenant whose runs live in two organizations at once.
 */
export function transformAgentTenant(
  tenant: { readonly sourceTenantId: string; readonly bundles: readonly AgentRunBundle[] },
  readiness: { readonly verdict: string; readonly targetOrganizationId?: string },
):
  | { readonly ok: true; readonly bundles: readonly TransformedAgentBundle[]; readonly residualSourceTenantReferences: number }
  | { readonly ok: false; readonly problems: readonly string[] } {
  if (readiness.verdict !== 'GO_FOR_LATER_BACKFILL_PACKET' || readiness.targetOrganizationId === undefined) {
    return { ok: false, problems: [`tenant ${tenant.sourceTenantId} is not ready for translation`] };
  }
  const bundles: TransformedAgentBundle[] = [];
  const problems: string[] = [];
  let residual = 0;
  for (const bundle of tenant.bundles) {
    const verdict = transformAgentBundle(bundle, tenant.sourceTenantId, readiness.targetOrganizationId);
    if (verdict.ok) {
      bundles.push(verdict.bundle);
      residual += verdict.residualSourceTenantReferences;
    } else {
      problems.push(verdict.problem);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, bundles, residualSourceTenantReferences: residual };
}
