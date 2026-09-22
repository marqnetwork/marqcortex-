/**
 * The preflight, and the verdict it is allowed to reach (BP-004 / A2).
 *
 * ── WHAT "GO" MEANS HERE, EXACTLY ──────────────────────────────────────────
 *
 * `GO_FOR_LATER_BACKFILL_PACKET`. Not "cut over", not "ready for production",
 * not "safe to deploy". The strongest statement this evidence supports is that
 * a SEPARATELY REVIEWED backfill packet may now be written, and the vocabulary
 * has no value that says more — because a verdict that could say more would
 * eventually be quoted as though it had.
 *
 * ── EVERY GATE IS AN AND ───────────────────────────────────────────────────
 *
 * One corrupt row, one unresolved tenant, one invalid chain, one pointer that
 * does not match its tip, one unexplained domain difference, one unverified
 * local backfill — any of them is NO-GO, for the whole manifest, with the
 * reason attached rather than summarised. A preflight that reported a
 * percentage would be a preflight somebody shipped at ninety-eight.
 *
 * ── THE MODULE HAS NO CLOCK ────────────────────────────────────────────────
 *
 * `generatedAt` is supplied. Everything in this folder is a pure function of
 * its inputs, so the same snapshot produces the same manifest — which is what
 * makes a manifest re-checkable by somebody who did not run it.
 *
 * ── AND IT CARRIES NO BUSINESS CONTENT ─────────────────────────────────────
 *
 * Counts, classifications, identifiers, digests and structured reasons. No
 * workflow input, no node output, no approval evidence, no organization name.
 * A readiness report is passed around, pasted into reviews and kept; it must
 * not become a copy of customer data with a verdict on top.
 */

import type {
  CanonicalOrganization,
  ReadinessManifest,
  ReadinessVerdict,
  TenantReadiness,
  TenantResolution,
  WorkflowSourceRow,
  WorkflowTenantMappingEntry,
} from './contracts.ts';
import { PREFLIGHT_TOOL, PREFLIGHT_TOOL_VERSION, isResolvedTenant } from './contracts.ts';
import type { WorkflowSourceInventory, WorkflowTenantInventory } from './inventory.ts';
import { inventoryWorkflowSource } from './inventory.ts';
import { resolveTenantMappings } from './tenantMapping.ts';
import type { TransformedBundle } from './transform.ts';
import { transformTenant } from './transform.ts';
import { compareFingerprints, fingerprintBundles } from './fingerprint.ts';

export interface PreflightInput {
  readonly rows: readonly WorkflowSourceRow[];
  readonly catalog: readonly CanonicalOrganization[];
  readonly mappings: readonly WorkflowTenantMappingEntry[];
  /** Supplied. This folder holds no clock. */
  readonly generatedAt: string;
  /**
   * Whether a LOCAL dry-run backfill has been proven for this snapshot.
   *
   * An input rather than something this module can conclude, because it is a
   * statement about what a database did and this module has never spoken to
   * one. `scripts/workflow-cutover-readiness-scenarios.ts` sets it by running
   * the simulation; a unit test setting it is declaring the simulation, which
   * is why there is a case asserting the same fixture is NO-GO without it.
   */
  readonly localBackfillVerified: boolean;
}

/** One tenant's transformed records, ready for a later, authorised backfill. */
export interface TransformedTenantPlan {
  readonly sourceTenantId: string;
  readonly targetOrganizationId: string;
  readonly bundles: readonly TransformedBundle[];
}

export interface PreflightResult {
  readonly manifest: ReadinessManifest;
  readonly inventory: WorkflowSourceInventory;
  /** Only tenants whose readiness is GO. Nothing else may be written anywhere. */
  readonly plans: readonly TransformedTenantPlan[];
}

function blockedTenant(
  tenant: WorkflowTenantInventory,
  resolution: TenantResolution,
  reasons: readonly string[],
): TenantReadiness {
  return {
    sourceTenantId: tenant.sourceTenantId,
    classification: resolution.classification,
    ...(resolution.targetOrganizationId === undefined
      ? {}
      : { targetOrganizationId: resolution.targetOrganizationId }),
    ...(resolution.targetSlug === undefined ? {} : { targetSlug: resolution.targetSlug }),
    runCount: tenant.runCount,
    checkpointCount: tenant.checkpointCount,
    approvalCount: tenant.approvalCount,
    activeRunCount: tenant.census.active,
    terminalRunCount: tenant.census.terminal,
    pendingApprovalCount: tenant.pendingApprovalCount,
    corruptRowCount: tenant.corruptRowCount,
    orphanCheckpointCount: tenant.orphanCheckpointCount,
    orphanApprovalCount: tenant.orphanApprovalCount,
    invalidChainCount: tenant.invalidChainCount,
    pointerMismatchCount: tenant.pointerMismatchCount,
    mappingRequired: resolution.mappingRequired,
    digestRewriteRequired: resolution.digestRewriteRequired,
    census: tenant.census,
    readiness: 'NO_GO',
    reasons,
  };
}

export function runWorkflowCutoverPreflight(input: PreflightInput): PreflightResult {
  const inventory = inventoryWorkflowSource(input.rows);

  const mapping = resolveTenantMappings({
    sourceTenantIds: inventory.tenants.map((tenant) => tenant.sourceTenantId),
    catalog: input.catalog,
    mappings: input.mappings,
  });
  const resolutionBySource = new Map<string, TenantResolution>();
  for (const resolution of mapping.resolutions) {
    resolutionBySource.set(resolution.sourceTenantId, resolution);
  }

  const tenants: TenantReadiness[] = [];
  const plans: TransformedTenantPlan[] = [];

  for (const tenant of inventory.tenants) {
    const resolution = resolutionBySource.get(tenant.sourceTenantId);
    // Unreachable while the mapping is fed from the inventory, and still
    // handled: a tenant with no verdict must never fall through as ready.
    if (!resolution) {
      tenants.push(
        blockedTenant(
          tenant,
          {
            sourceTenantId: tenant.sourceTenantId,
            classification: 'EXPLICIT_MAPPING_REQUIRED',
            digestRewriteRequired: false,
            mappingRequired: true,
            reasons: [],
          },
          ['no tenant resolution was produced for this source tenant'],
        ),
      );
      continue;
    }

    const reasons: string[] = [...resolution.reasons];

    // THE DATA COMES FIRST. A tenant with a corrupt row is refused whatever its
    // mapping says, because a clean mapping over broken data is still broken
    // data — and reporting the mapping problem alone would send somebody to fix
    // the wrong thing.
    if (tenant.problems.length > 0) reasons.push(...tenant.problems);

    if (!isResolvedTenant(resolution.classification) || reasons.length > 0) {
      if (!isResolvedTenant(resolution.classification) && resolution.reasons.length === 0) {
        reasons.push(`tenant classification ${resolution.classification} does not authorise a transformation`);
      }
      tenants.push(blockedTenant(tenant, resolution, reasons));
      continue;
    }

    const targetOrganizationId = resolution.targetOrganizationId as string;
    const verdict = transformTenant(tenant.sourceTenantId, targetOrganizationId, tenant.bundles);
    if (!verdict.ok) {
      tenants.push(blockedTenant(tenant, resolution, [...reasons, ...verdict.problems]));
      continue;
    }

    // The mode is chosen by whether the identifier moved, never by preference.
    const mode = resolution.digestRewriteRequired ? 'migration-semantic' : 'exact';
    const sourceFingerprint = fingerprintBundles(tenant.bundles, mode);
    const transformedFingerprint = fingerprintBundles(verdict.bundles, mode);
    const parity = compareFingerprints(sourceFingerprint, transformedFingerprint);
    if (!parity.ok) {
      tenants.push(
        blockedTenant(tenant, resolution, [...reasons, `semantic_fingerprint: ${parity.problem}`]),
      );
      continue;
    }

    tenants.push({
      sourceTenantId: tenant.sourceTenantId,
      classification: resolution.classification,
      targetOrganizationId,
      ...(resolution.targetSlug === undefined ? {} : { targetSlug: resolution.targetSlug }),
      runCount: tenant.runCount,
      checkpointCount: tenant.checkpointCount,
      approvalCount: tenant.approvalCount,
      activeRunCount: tenant.census.active,
      terminalRunCount: tenant.census.terminal,
      pendingApprovalCount: tenant.pendingApprovalCount,
      corruptRowCount: tenant.corruptRowCount,
      orphanCheckpointCount: tenant.orphanCheckpointCount,
      orphanApprovalCount: tenant.orphanApprovalCount,
      invalidChainCount: tenant.invalidChainCount,
      pointerMismatchCount: tenant.pointerMismatchCount,
      mappingRequired: resolution.mappingRequired,
      digestRewriteRequired: resolution.digestRewriteRequired,
      census: tenant.census,
      sourceFingerprint,
      transformedFingerprint,
      readiness: 'GO_FOR_LATER_BACKFILL_PACKET',
      reasons: [],
    });
    plans.push({
      sourceTenantId: tenant.sourceTenantId,
      targetOrganizationId,
      bundles: verdict.bundles,
    });
  }

  const ready = tenants.filter((tenant) => tenant.readiness === 'GO_FOR_LATER_BACKFILL_PACKET');
  const blocked = tenants.filter((tenant) => tenant.readiness === 'NO_GO');

  const globalReasons: string[] = [];
  for (const tenant of blocked) {
    for (const reason of tenant.reasons) globalReasons.push(`${tenant.sourceTenantId}: ${reason}`);
  }
  for (const unused of mapping.unusedMappings) {
    globalReasons.push(`mapping entry for ${unused} matches no source tenant in this snapshot`);
  }
  if (!input.localBackfillVerified) {
    globalReasons.push('local dry-run backfill has not been verified for this snapshot');
  }

  const allSourceChainsValid = inventory.tenants.every(
    (tenant) => tenant.invalidChainCount === 0 && tenant.pointerMismatchCount === 0,
  );
  const allMappingsExplicit = mapping.resolutions.every((resolution) =>
    isResolvedTenant(resolution.classification),
  );
  const eligibleIds = new Set(
    input.catalog.filter((org) => org.status === 'active' && !org.deleted).map((org) => org.id),
  );
  const allTargetsCanonical = mapping.resolutions.every(
    (resolution) =>
      resolution.targetOrganizationId !== undefined &&
      eligibleIds.has(resolution.targetOrganizationId),
  );

  const goNoGo: ReadinessVerdict =
    blocked.length === 0 &&
    allSourceChainsValid &&
    allMappingsExplicit &&
    allTargetsCanonical &&
    input.localBackfillVerified
      ? 'GO_FOR_LATER_BACKFILL_PACKET'
      : 'NO_GO';

  const manifest: ReadinessManifest = {
    sourceRowCount: inventory.sourceRowCount,
    recognizedWorkflowRowCount: inventory.recognizedWorkflowRowCount,
    unknownWorkflowRowCount: inventory.unknownWorkflowRowCount,
    tenantCount: inventory.tenants.length,
    readyTenantCount: ready.length,
    blockedTenantCount: blocked.length,
    allSourceChainsValid,
    allMappingsExplicit,
    allTargetsCanonical,
    localBackfillVerified: input.localBackfillVerified,
    goNoGo,
    generatedAt: input.generatedAt,
    tool: PREFLIGHT_TOOL,
    toolVersion: PREFLIGHT_TOOL_VERSION,
    tenants,
    reasons: globalReasons,
  };

  return {
    manifest,
    inventory,
    // NOTHING BUT A READY TENANT'S RECORDS LEAVES HERE. A blocked tenant has no
    // plan at all, so there is no transformed record set for a later step to
    // pick up "just to see".
    plans: goNoGo === 'GO_FOR_LATER_BACKFILL_PACKET' ? plans : [],
  };
}
