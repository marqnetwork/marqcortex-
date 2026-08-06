/**
 * The mapper (AI-01 Batch 3B, Part 3).
 *
 * Builds one object from a list of declared assignments, then holds it to a
 * declared contract and a size bound before letting it travel.
 *
 * ── FOUR GATES, IN THIS ORDER, AND THE ORDER MATTERS ───────────────────────
 *
 *   1. RESOLVE      every source, through the same resolver an expression uses.
 *   2. REQUIRE      a required source that did not resolve fails here, before
 *                   a partial object exists to be validated or measured.
 *   3. VALIDATE     the assembled object against the declared target contract.
 *                   The contract drops undeclared keys, so this gate is also
 *                   the one that guarantees a field nobody named cannot flow.
 *   4. MEASURE      the VALIDATED value against the byte ceiling — after
 *                   validation, because validation is what removes anything the
 *                   contract did not want, and measuring before it would bound
 *                   a value that is not the one that travels.
 *
 * Running 3 before 4 also means the ceiling is never spent on data the contract
 * was going to discard, and running 2 before 3 means a missing required field
 * is reported as a missing required field rather than as a schema violation
 * three layers down.
 *
 * ── THE RESULT IS A NEW VALUE ──────────────────────────────────────────────
 *
 * Nothing the mapper reads is mutated. `writePath` rebuilds each level it
 * touches, so a mapping cannot alter the checkpoint outputs it drew from — the
 * checkpoint is append-only and immutable, and a mapper that mutated its
 * in-memory projection would make that immutability a statement about storage
 * rather than about the value.
 */

import type { Validator } from '../../security/validation.ts';
import type { WorkflowMapping } from '../contracts/mapping.ts';
import type { EvaluationScope } from './expressionEvaluator.ts';
import { MAPPING_BOUNDS } from '../contracts/mapping.ts';
import { resolveRef } from './expressionEvaluator.ts';
import { parsePath, writePath } from './paths.ts';
import { isFailure } from '../../security/validation.ts';
import { canonicalBytes } from '../../agents/runtime/digest.ts';

export type MappingOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: MappingFailure; readonly detail: string };

export type MappingFailure =
  /** A `required` assignment's source did not resolve. */
  | 'missing_required_source'
  /** The assembled object did not satisfy the declared target contract. */
  | 'contract_rejected'
  /** The validated result is larger than a mapped value may be. */
  | 'result_too_large';

/**
 * Apply a mapping, or say precisely which gate refused it.
 *
 * Returns an outcome rather than throwing so the engine decides what a refusal
 * does to the run — which for Part 3 is always "fail the node", but the
 * decision belongs to the engine's state machine, not to a helper.
 */
export function applyMapping(
  mapping: WorkflowMapping,
  scope: EvaluationScope,
  contract: Validator<unknown> | undefined,
): MappingOutcome {
  let assembled: Record<string, unknown> = {};

  for (const assignment of mapping.assignments) {
    const resolved = resolveRef(assignment.from, scope);

    if (!resolved.found) {
      if (assignment.required) {
        return {
          ok: false,
          failure: 'missing_required_source',
          detail: `required source for "${assignment.to}" did not resolve (${describeRef(assignment)})`,
        };
      }
      // An optional source that did not resolve writes NOTHING. Writing
      // `undefined` would make an absent field indistinguishable from one
      // explicitly set to nothing, which is the distinction the whole
      // missing-value rule rests on.
      continue;
    }

    const destination = parsePath(assignment.to);
    // Unreachable for a registered definition — destinations are parsed and
    // checked for writability at registration. Refusing here rather than
    // assuming keeps the mapper total.
    if (!destination.ok) {
      return {
        ok: false,
        failure: 'contract_rejected',
        detail: `destination "${assignment.to}" is not a valid path: ${destination.problem}`,
      };
    }

    assembled = writePath(assembled, destination.segments, resolved.value);
  }

  // No contract means the workflow declared no shape for this destination, and
  // the value travels as assembled. It is still bounded, and downstream the
  // agent's OWN input contract is enforced by the orchestrator — a workflow
  // that declares nothing is not a workflow that validates nothing.
  let value: unknown = assembled;
  if (contract) {
    const validated = contract.validate(assembled, 'mapped');
    if (isFailure(validated)) {
      return {
        ok: false,
        failure: 'contract_rejected',
        detail: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      };
    }
    value = validated.value;
  }

  const bytes = canonicalBytes(value);
  if (bytes === undefined) {
    return {
      ok: false,
      failure: 'result_too_large',
      detail: 'mapped value could not be canonically serialized',
    };
  }
  if (bytes > MAPPING_BOUNDS.maxMappedBytes) {
    return {
      ok: false,
      failure: 'result_too_large',
      detail: `mapped value is ${bytes} bytes, above the ceiling of ${MAPPING_BOUNDS.maxMappedBytes}`,
    };
  }

  return { ok: true, value };
}

/** A source description safe for a diagnostic: names locations, never values. */
function describeRef(assignment: { readonly from: { readonly source: string } }): string {
  const from = assignment.from as Record<string, unknown>;
  switch (from.source) {
    case 'input':
      return `input.${String(from.path)}`;
    case 'node':
      return `node ${String(from.nodeId)}.${String(from.path)}`;
    case 'metadata':
      return `metadata.${String(from.field)}`;
    case 'counter':
      return `counter ${String(from.counter)}`;
    default:
      return String(from.source);
  }
}
