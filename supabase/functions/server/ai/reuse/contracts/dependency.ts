/**
 * The dependency model (AI-01 Batch 3B, Part 6B).
 *
 * ── A REUSABLE RESULT MUST DECLARE WHAT COULD MAKE IT WRONG ────────────────
 *
 * The dangerous cache entry is not the stale one. It is the one nobody can tell
 * is stale, because the thing it depended on was never written down. A result
 * produced from a pricing table, a policy revision and a customer record is
 * correct exactly as long as all three are what they were, and the only way a
 * later reader can establish that is if the producer said so at seal time.
 *
 * So a dependency is not optional metadata here; it is the freshness argument.
 * `dependency_bound` freshness is literally "this is valid while these are
 * unchanged", and a record making that claim with no dependencies is refused
 * rather than treated as permanently fresh.
 *
 * ── TYPED, NOT STRINGLY ────────────────────────────────────────────────────
 *
 * The batch is explicit that an unrestricted dependency string is a design
 * smell, and the reason is invalidation: an operator who has just changed a
 * workflow definition needs to invalidate everything that depended on it, and
 * "everything whose dependency string happens to mention the workflow" is a
 * substring search over tenant data. A KIND plus a bounded KEY plus a VERSION
 * makes that an equality match on two fields.
 *
 * `custom` exists because a platform cannot enumerate every tenant's own data
 * versions in advance — but its key is bounded by a charset and a length, so it
 * is a typed escape hatch rather than an unbounded one.
 *
 * ── EVIDENCE AND DATA ARE SPLIT, ON PURPOSE ────────────────────────────────
 *
 * `external_evidence` is the material the model was shown. Everything else is
 * the state the platform was in. They fail differently and they are audited by
 * different people: a changed evidence fingerprint means the answer was derived
 * from something that no longer exists, while a changed policy version means the
 * answer may be fine but is no longer sanctioned. Collapsing them would make
 * "why was this refused" one answer where there are two.
 */

import { reuseFailure } from './failures.ts';

export const REUSE_DEPENDENCY_KINDS = [
  /** The workflow definition and its version. */
  'workflow_definition',
  /** The compiled plan digest for a workflow version. */
  'workflow_plan',
  /** The agent definition, its version or its certification identity. */
  'agent_definition',
  /** A governance, safety or optimisation policy revision. */
  'policy',
  /** A tenant data version — the organization's own state. */
  'organization_data',
  /** Retrieved material the answer was derived from. */
  'external_evidence',
  /** A caller-declared dependency the platform cannot name in advance. */
  'custom',
] as const;

export type ReuseDependencyKind = (typeof REUSE_DEPENDENCY_KINDS)[number];

/** The one kind that describes material the model was shown. */
export const EVIDENCE_DEPENDENCY_KIND: ReuseDependencyKind = 'external_evidence';

export interface ReuseDependency {
  readonly kind: ReuseDependencyKind;
  /** Bounded identifier within the kind. Never free text. */
  readonly key: string;
  /**
   * The version, revision or fingerprint that must still hold.
   *
   * Compared for EQUALITY and never ordered. "Newer" is not "compatible" — a
   * later policy revision may forbid exactly what the cached answer did.
   */
  readonly version: string;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;

export const MAX_DEPENDENCIES = 64;

export function isValidDependency(value: ReuseDependency): boolean {
  return (
    REUSE_DEPENDENCY_KINDS.includes(value.kind) &&
    KEY_PATTERN.test(value.key) &&
    VERSION_PATTERN.test(value.version)
  );
}

/** `kind:key` — the identity a dependency is matched on, version excluded. */
export function dependencyId(dependency: ReuseDependency): string {
  return `${dependency.kind}:${dependency.key}`;
}

/** `kind:key@version` — the full form used in fingerprints and diagnostics. */
export function dependencyToken(dependency: ReuseDependency): string {
  return `${dependencyId(dependency)}@${dependency.version}`;
}

/**
 * Validate, deduplicate and sort.
 *
 * Sorted because dependencies participate in a fingerprint, and a fingerprint
 * that depended on declaration order would make two identical requests miss each
 * other for no reason. Deduplicated because a repeated `kind:key` at two
 * different versions is a contradiction the producer has to resolve, not
 * something the engine should pick a winner for — so it is refused.
 */
export function normalizeDependencies(
  dependencies: readonly ReuseDependency[],
): readonly ReuseDependency[] {
  if (dependencies.length > MAX_DEPENDENCIES) {
    throw reuseFailure(
      'reuse_input_invalid',
      'This reusable result declares more dependencies than the platform tracks.',
      { diagnostics: `${dependencies.length} dependencies exceeds ${MAX_DEPENDENCIES}` },
    );
  }

  const byId = new Map<string, ReuseDependency>();
  for (const dependency of dependencies) {
    if (!isValidDependency(dependency)) {
      throw reuseFailure('reuse_input_invalid', 'A declared dependency is malformed.', {
        diagnostics: `kind=${String(dependency.kind)} key=${String(dependency.key)}`,
      });
    }
    const id = dependencyId(dependency);
    const existing = byId.get(id);
    if (existing !== undefined && existing.version !== dependency.version) {
      throw reuseFailure(
        'reuse_input_invalid',
        'A dependency was declared twice at two different versions.',
        { diagnostics: `${id} declared at ${existing.version} and ${dependency.version}` },
      );
    }
    byId.set(id, dependency);
  }

  return [...byId.values()].sort((a, b) => {
    const left = dependencyId(a);
    const right = dependencyId(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Evidence dependencies must be evidence; data dependencies must not be. */
export function assertDependencySplit(
  evidenceDependencies: readonly ReuseDependency[],
  dataDependencies: readonly ReuseDependency[],
): void {
  for (const dependency of evidenceDependencies) {
    if (dependency.kind !== EVIDENCE_DEPENDENCY_KIND) {
      throw reuseFailure(
        'reuse_input_invalid',
        'A non-evidence dependency was declared as evidence.',
        { diagnostics: dependencyToken(dependency) },
      );
    }
  }
  for (const dependency of dataDependencies) {
    if (dependency.kind === EVIDENCE_DEPENDENCY_KIND) {
      throw reuseFailure(
        'reuse_input_invalid',
        'An evidence dependency was declared as data.',
        { diagnostics: dependencyToken(dependency) },
      );
    }
  }
}

export type DependencyComparison =
  /** Present in the current set at the same version. */
  | 'unchanged'
  /** Present in the current set at a different version. */
  | 'changed'
  /**
   * Absent from the current set.
   *
   * Treated as a MISS rather than as "unchanged", which is the fail-closed
   * choice: a caller that cannot tell the engine what version something is at
   * has not established that the cached answer is still valid, and reuse
   * requires establishing it rather than not disproving it.
   */
  | 'unknown';

export function compareDependency(
  declared: ReuseDependency,
  current: readonly ReuseDependency[],
): DependencyComparison {
  const id = dependencyId(declared);
  const match = current.find((candidate) => dependencyId(candidate) === id);
  if (match === undefined) return 'unknown';
  return match.version === declared.version ? 'unchanged' : 'changed';
}
