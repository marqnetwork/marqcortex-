/**
 * A2-P08-C01 — agent tenant mapping and the readiness manifest.
 *
 * TENANT RESOLUTION IS BP-004'S, REUSED, NOT RESTATED. "Which canonical
 * organization does this source tenant identifier mean" has one answer for
 * every runtime, and two resolvers would be two chances for a workflow run and
 * the agent run it spawned to land in different organizations. So the same
 * rules apply unchanged: a canonical UUID resolves, an explicit manifest entry
 * resolves, an exact active slug is EVIDENCE and blocks, nothing is inferred
 * by name, prefix or similarity, and many sources to one target is refused.
 *
 * WHAT DIFFERS IS WHAT A RESOLVED REMAP COSTS. BP-004 reports
 * `digestRewriteRequired` because a workflow checkpoint digest binds the
 * organization. No agent integrity value does (see `contracts.ts`), so this
 * manifest reports `tenantChanges` and a constant `integrityRewriteRequired:
 * false`, and `transform.ts` rewrites identity fields only.
 *
 * THE MANIFEST CARRIES NO BUSINESS CONTENT. Counts, classifications, tenant
 * and record identifiers and structural reasons — never an objective, an
 * input, a progress snapshot, an output, an impact summary or a reason. It is
 * the thing that may be written down; the inventory it summarises is not.
 */

import type {
  CanonicalOrganization,
  TenantClassification,
  TenantResolution,
  WorkflowTenantMappingEntry,
} from '../../../workflows/persistence/migration/contracts.ts';
import { isResolvedTenant } from '../../../workflows/persistence/migration/contracts.ts';
import { resolveTenantMappings } from '../../../workflows/persistence/migration/tenantMapping.ts';
import type {
  AgentActiveRunCensus,
  AgentPointerClassification,
  AgentReadinessVerdict,
  AgentSourceInventory,
  AgentSourceRow,
} from './contracts.ts';
import { AGENT_PREFLIGHT_TOOL, AGENT_PREFLIGHT_TOOL_VERSION } from './contracts.ts';
import { agentTenantBlockers, inventoryAgentSource } from './inventory.ts';

/** The manifest entry shape is BP-004's: source tenant → canonical organization. */
export type AgentTenantMappingEntry = WorkflowTenantMappingEntry;

export interface AgentPreflightInput {
  readonly rows: readonly AgentSourceRow[];
  readonly catalog: readonly CanonicalOrganization[];
  readonly mappings: readonly AgentTenantMappingEntry[];
  /** Supplied, never read from a clock: the manifest is a function of its input. */
  readonly generatedAt: string;
}

export interface AgentTenantReadiness {
  readonly sourceTenantId: string;
  readonly verdict: AgentReadinessVerdict;
  readonly tenantClassification: TenantClassification;
  readonly targetOrganizationId?: string;
  readonly targetSlug?: string;
  /** The tenant identifier changes under the mapping. */
  readonly tenantChanges: boolean;
  /** Always false for agents: no agent integrity value binds the tenant. */
  readonly integrityRewriteRequired: false;
  readonly mappingRequired: boolean;
  readonly runCount: number;
  readonly checkpointCount: number;
  readonly approvalCount: number;
  readonly pendingApprovalCount: number;
  readonly pointerCounts: Readonly<Record<AgentPointerClassification, number>>;
  readonly irregularChainCount: number;
  readonly danglingPendingApprovalCount: number;
  readonly progressDigestMismatchCount: number;
  readonly census: AgentActiveRunCensus;
  /** Non-business reasons. Non-empty exactly when the verdict is NO_GO. */
  readonly blockers: readonly string[];
  /** Non-blocking evidence worth a reviewer's attention. */
  readonly evidence: readonly string[];
}

export interface AgentReadinessManifest {
  readonly tool: typeof AGENT_PREFLIGHT_TOOL;
  readonly toolVersion: typeof AGENT_PREFLIGHT_TOOL_VERSION;
  readonly generatedAt: string;
  readonly sourceRowCount: number;
  readonly recognizedAgentRowCount: number;
  readonly unknownAgentRowCount: number;
  readonly tenants: readonly AgentTenantReadiness[];
  readonly unusedMappings: readonly string[];
  /** GO only when every tenant is GO. */
  readonly verdict: AgentReadinessVerdict;
}

export interface AgentPreflightResult {
  /** IN MEMORY ONLY. Holds domain records; never write it down. */
  readonly inventory: AgentSourceInventory;
  readonly resolutions: readonly TenantResolution[];
  readonly manifest: AgentReadinessManifest;
}

export function runAgentMigrationPreflight(input: AgentPreflightInput): AgentPreflightResult {
  const inventory = inventoryAgentSource(input.rows);
  const { resolutions, unusedMappings } = resolveTenantMappings({
    sourceTenantIds: inventory.tenants.map((tenant) => tenant.sourceTenantId),
    catalog: input.catalog,
    mappings: input.mappings,
  });
  const bySource = new Map(resolutions.map((resolution) => [resolution.sourceTenantId, resolution]));

  const tenants: AgentTenantReadiness[] = inventory.tenants.map((tenant) => {
    const resolution = bySource.get(tenant.sourceTenantId);
    const blockers: string[] = [];
    if (!resolution) {
      blockers.push('tenant was not resolved');
    } else if (!isResolvedTenant(resolution.classification)) {
      blockers.push(`tenant ${resolution.classification}`, ...resolution.reasons);
    }
    blockers.push(...agentTenantBlockers(tenant));

    const evidence: string[] = [];
    if (tenant.pointerCounts.RECOVERABLE_ONE_AHEAD_CANDIDATE > 0) {
      evidence.push(
        `${tenant.pointerCounts.RECOVERABLE_ONE_AHEAD_CANDIDATE} run(s) in the checkpoint-before-pointer ` +
          'crash window; copied faithfully, never repaired',
      );
    }
    if (tenant.irregularChainCount > 0) evidence.push(`${tenant.irregularChainCount} run(s) with an irregular chain`);
    if (tenant.danglingPendingApprovalCount > 0) {
      evidence.push(`${tenant.danglingPendingApprovalCount} run(s) naming an approval that is not stored`);
    }
    if (tenant.census.workflowLinked > 0) {
      evidence.push(`${tenant.census.workflowLinked} run(s) started by a workflow node — cut over with the workflow estate in view`);
    }

    const resolved = resolution !== undefined && isResolvedTenant(resolution.classification);
    return {
      sourceTenantId: tenant.sourceTenantId,
      verdict: blockers.length === 0 ? 'GO_FOR_LATER_BACKFILL_PACKET' : 'NO_GO',
      tenantClassification: resolution?.classification ?? 'EXPLICIT_MAPPING_REQUIRED',
      ...(resolved && resolution.targetOrganizationId !== undefined
        ? { targetOrganizationId: resolution.targetOrganizationId }
        : {}),
      ...(resolved && resolution.targetSlug !== undefined ? { targetSlug: resolution.targetSlug } : {}),
      tenantChanges: resolved && resolution.targetOrganizationId !== tenant.sourceTenantId,
      integrityRewriteRequired: false,
      mappingRequired: resolution?.mappingRequired ?? true,
      runCount: tenant.runCount,
      checkpointCount: tenant.checkpointCount,
      approvalCount: tenant.approvalCount,
      pendingApprovalCount: tenant.pendingApprovalCount,
      pointerCounts: tenant.pointerCounts,
      irregularChainCount: tenant.irregularChainCount,
      danglingPendingApprovalCount: tenant.danglingPendingApprovalCount,
      progressDigestMismatchCount: tenant.progressDigestMismatchCount,
      census: tenant.census,
      blockers,
      evidence,
    };
  });

  return {
    inventory,
    resolutions,
    manifest: {
      tool: AGENT_PREFLIGHT_TOOL,
      toolVersion: AGENT_PREFLIGHT_TOOL_VERSION,
      generatedAt: input.generatedAt,
      sourceRowCount: inventory.sourceRowCount,
      recognizedAgentRowCount: inventory.recognizedAgentRowCount,
      unknownAgentRowCount: inventory.unknownAgentRowCount,
      tenants,
      unusedMappings,
      verdict: tenants.every((tenant) => tenant.verdict === 'GO_FOR_LATER_BACKFILL_PACKET')
        ? 'GO_FOR_LATER_BACKFILL_PACKET'
        : 'NO_GO',
    },
  };
}
