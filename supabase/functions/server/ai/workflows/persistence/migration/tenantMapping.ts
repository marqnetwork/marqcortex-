/**
 * Source tenant → canonical organization, and the refusal to guess (BP-004/A2).
 *
 * ── THE ONE RULE THIS FILE EXISTS TO HOLD ──────────────────────────────────
 *
 * A SLUG MATCH IS EVIDENCE. IT IS NOT AUTHORITY.
 *
 * `AI_DEFAULT_ORGANIZATION_ID` ships with `marq-cortex`, and the membership
 * bootstrap looks for an active organization with slug `marq`. Those two facts
 * sitting near each other is exactly the shape of an inference that feels
 * obvious, is undocumented, and moves one customer's workflow history into
 * another customer's tenant if it is wrong. It is not made here, and there is
 * no code path in this file that could make it: nothing compares a source
 * identifier to a slug for the purpose of RESOLVING it. The comparison happens
 * only to RAISE `SLUG_EXACT_CANDIDATE`, which is a blocker.
 *
 * Exactly two things may authorise a transformation:
 *
 *   1. the source identifier already IS the canonical `organizations.id`;
 *   2. a declared mapping manifest names the source identifier and the target
 *      organization UUID, and every check below passes.
 *
 * No fuzzy match, no name match, no prefix match, no normalisation, no
 * case-folding shortcut, and no creation of a replacement organization.
 *
 * ── MANY SOURCES TO ONE TARGET IS TENANT CONSOLIDATION ─────────────────────
 *
 * It is refused by default, on both sides of the collision, because merging two
 * tenants' workflow histories into one is a product decision with legal and
 * privacy consequences and it must not be reachable by writing two manifest
 * lines. A future packet may authorise it explicitly; this one cannot.
 */

import type {
  CanonicalOrganization,
  TenantClassification,
  TenantResolution,
  WorkflowTenantMappingEntry,
} from './contracts.ts';
import { isEligibleOrganization } from './contracts.ts';

/**
 * The shape `organizations.id` has.
 *
 * The SAME pattern `sqlWorkflowStores.ts` uses to decide whether the relational
 * authority can name a tenant, so "this preflight says it is canonical" and
 * "the SQL store will accept it" cannot disagree. Pinned equal by a test.
 */
const ORGANIZATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalOrganizationId(value: string): boolean {
  return ORGANIZATION_UUID.test(value);
}

export interface TenantMappingInput {
  /** Every source tenant identifier the inventory found. */
  readonly sourceTenantIds: readonly string[];
  /** The canonical catalog, supplied. This module never reads a database. */
  readonly catalog: readonly CanonicalOrganization[];
  /** The declared manifest. An empty manifest is a valid, restrictive input. */
  readonly mappings: readonly WorkflowTenantMappingEntry[];
}

export interface TenantMappingResult {
  readonly resolutions: readonly TenantResolution[];
  /**
   * Manifest entries naming a source tenant that holds no workflow rows.
   *
   * Reported rather than refused: a manifest legitimately covers a tenant whose
   * rows have already drained. It is surfaced because a manifest entry that
   * matches nothing is also what a typo looks like, and a reviewer should see
   * it rather than have it silently succeed.
   */
  readonly unusedMappings: readonly string[];
}

function blocked(
  sourceTenantId: string,
  classification: TenantClassification,
  reasons: readonly string[],
): TenantResolution {
  return {
    sourceTenantId,
    classification,
    digestRewriteRequired: false,
    mappingRequired:
      classification === 'EXPLICIT_MAPPING_REQUIRED' || classification === 'SLUG_EXACT_CANDIDATE',
    reasons,
  };
}

export function resolveTenantMappings(input: TenantMappingInput): TenantMappingResult {
  const byId = new Map<string, CanonicalOrganization>();
  for (const organization of input.catalog) byId.set(organization.id, organization);

  // Slugs are indexed from the ELIGIBLE catalog only, because the candidate
  // state the packet defines is about an ACTIVE organization's slug, and
  // `organizations_slug_active_uidx` is unique only among rows that are not
  // deleted. A suspended organization's slug is not a candidate for anything.
  const eligibleBySlug = new Map<string, CanonicalOrganization[]>();
  for (const organization of input.catalog) {
    if (!isEligibleOrganization(organization)) continue;
    const bucket = eligibleBySlug.get(organization.slug) ?? [];
    bucket.push(organization);
    eligibleBySlug.set(organization.slug, bucket);
  }

  // Manifest entries, indexed and checked for internal contradictions FIRST.
  // A manifest that names one source twice is ambiguous before any tenant is
  // looked at, and resolving one of the two would be the guess this file exists
  // to refuse.
  const mappingBySource = new Map<string, WorkflowTenantMappingEntry[]>();
  for (const entry of input.mappings) {
    const bucket = mappingBySource.get(entry.sourceTenantId) ?? [];
    bucket.push(entry);
    mappingBySource.set(entry.sourceTenantId, bucket);
  }

  // Many sources to one target, decided over the whole manifest rather than
  // per entry — a collision is a property of the pair, so neither half may be
  // resolved while the other exists.
  const targetUse = new Map<string, Set<string>>();
  for (const entry of input.mappings) {
    const bucket = targetUse.get(entry.targetOrganizationId) ?? new Set<string>();
    bucket.add(entry.sourceTenantId);
    targetUse.set(entry.targetOrganizationId, bucket);
  }
  // A source that is already canonical also occupies its own target, so a
  // manifest pointing a second tenant at it is the same collision.
  for (const sourceTenantId of input.sourceTenantIds) {
    if (!isCanonicalOrganizationId(sourceTenantId)) continue;
    const bucket = targetUse.get(sourceTenantId) ?? new Set<string>();
    bucket.add(sourceTenantId);
    targetUse.set(sourceTenantId, bucket);
  }

  const resolutions: TenantResolution[] = [];

  for (const sourceTenantId of [...input.sourceTenantIds].sort()) {
    const entries = mappingBySource.get(sourceTenantId) ?? [];
    if (entries.length > 1) {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          `the manifest names this source tenant ${entries.length} times`,
        ]),
      );
      continue;
    }
    const entry = entries[0];

    // ── The source identifier is already canonical ────────────────────────
    if (isCanonicalOrganizationId(sourceTenantId)) {
      const organization = byId.get(sourceTenantId);
      if (!organization) {
        resolutions.push(
          blocked(sourceTenantId, 'UUID_NOT_FOUND', [
            'the source tenant is a UUID with no row in the canonical catalog',
          ]),
        );
        continue;
      }
      if (!isEligibleOrganization(organization)) {
        resolutions.push(
          blocked(sourceTenantId, 'TARGET_INACTIVE_OR_DELETED', [
            `the canonical organization is ${organization.deleted ? 'deleted' : organization.status}`,
          ]),
        );
        continue;
      }
      // A manifest may CONFIRM a canonical tenant by naming itself. Pointing it
      // somewhere else is a tenant move, which this packet does not authorise.
      if (entry && entry.targetOrganizationId !== sourceTenantId) {
        resolutions.push(
          blocked(sourceTenantId, 'MAPPING_CONFLICT', [
            'the manifest moves an already-canonical tenant to a different organization',
          ]),
        );
        continue;
      }
      const sharers = targetUse.get(sourceTenantId);
      if (sharers && sharers.size > 1) {
        resolutions.push(
          blocked(sourceTenantId, 'MAPPING_CONFLICT', [
            `${sharers.size} source tenants resolve to organization ${sourceTenantId}`,
          ]),
        );
        continue;
      }
      resolutions.push({
        sourceTenantId,
        classification: 'CANONICAL_UUID',
        targetOrganizationId: organization.id,
        targetSlug: organization.slug,
        // THE IDENTITY CASE. Nothing moves, so nothing may be re-chained.
        digestRewriteRequired: false,
        mappingRequired: false,
        reasons: [],
      });
      continue;
    }

    // ── The source identifier is not canonical ────────────────────────────
    if (!entry) {
      const candidates = eligibleBySlug.get(sourceTenantId) ?? [];
      if (candidates.length === 1) {
        resolutions.push(
          blocked(sourceTenantId, 'SLUG_EXACT_CANDIDATE', [
            `an active organization has slug ${sourceTenantId} (${candidates[0].id}) — ` +
              'this is evidence and not authority; supply an explicit mapping entry',
          ]),
        );
        continue;
      }
      resolutions.push(
        blocked(sourceTenantId, 'EXPLICIT_MAPPING_REQUIRED', [
          'the source tenant is not a canonical organization id and no mapping entry names it',
        ]),
      );
      continue;
    }

    if (!isCanonicalOrganizationId(entry.targetOrganizationId)) {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          'the mapping target is not a canonical organization id',
        ]),
      );
      continue;
    }

    const target = byId.get(entry.targetOrganizationId);
    if (!target) {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          `the mapping target ${entry.targetOrganizationId} has no row in the canonical catalog`,
        ]),
      );
      continue;
    }
    if (!isEligibleOrganization(target)) {
      resolutions.push(
        blocked(sourceTenantId, 'TARGET_INACTIVE_OR_DELETED', [
          `the mapping target is ${target.deleted ? 'deleted' : target.status}`,
        ]),
      );
      continue;
    }
    if (entry.expectedTargetSlug !== undefined && entry.expectedTargetSlug !== target.slug) {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          `the mapping expected slug ${entry.expectedTargetSlug} and the target's slug is ${target.slug}`,
        ]),
      );
      continue;
    }
    const sharers = targetUse.get(entry.targetOrganizationId);
    if (sharers && sharers.size > 1) {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          `${sharers.size} source tenants resolve to organization ${entry.targetOrganizationId}; ` +
            'tenant consolidation is not authorised by this packet',
        ]),
      );
      continue;
    }
    if (entry.reason.trim() === '') {
      resolutions.push(
        blocked(sourceTenantId, 'MAPPING_CONFLICT', [
          'the mapping entry carries no recorded evidence',
        ]),
      );
      continue;
    }

    resolutions.push({
      sourceTenantId,
      classification: 'EXPLICIT_MAPPING_RESOLVED',
      targetOrganizationId: target.id,
      targetSlug: target.slug,
      // THE TENANT MOVES, SO EVERY CHECKPOINT DIGEST MOVES. See `transform.ts`.
      digestRewriteRequired: true,
      mappingRequired: true,
      reasons: [],
    });
  }

  const present = new Set(input.sourceTenantIds);
  return {
    resolutions,
    unusedMappings: [...new Set(input.mappings.map((entry) => entry.sourceTenantId))]
      .filter((sourceTenantId) => !present.has(sourceTenantId))
      .sort(),
  };
}
