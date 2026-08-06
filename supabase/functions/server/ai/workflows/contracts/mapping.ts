/**
 * Workflow data mappings (AI-01 Batch 3B, Part 3).
 *
 * How a value gets from one place to another, declaratively and by name.
 *
 * ── EVERY FIELD IS NAMED IN BOTH DIRECTIONS ────────────────────────────────
 *
 * A mapping is a list of assignments, each of which says exactly where a value
 * comes from and exactly where it goes. There is no "copy the rest", no spread,
 * no rename-by-convention and no passthrough. That is what makes the answer to
 * "can this workflow move a customer's record into a node that emails it"
 * readable from the definition rather than inferable from behaviour.
 *
 * The consequence worth stating plainly: A FIELD NOBODY NAMED CANNOT FLOW.
 * Undeclared keys never reach a destination, because the destination is built
 * from the assignments and then validated against a declared contract that
 * drops anything else. Two independent mechanisms, and the second one is what
 * makes "never expose raw secrets" a property of the construction rather than a
 * promise about the inputs.
 *
 * ── FAIL CLOSED ON MISSING ─────────────────────────────────────────────────
 *
 * An assignment is `required` or it is not. A required source that does not
 * resolve FAILS the node — it does not write `undefined`, it does not fall back
 * to a default, and it does not silently omit the field for the contract to
 * complain about later. An optional source that does not resolve writes
 * nothing at all, which is different from writing null: a contract that accepts
 * an absent field and rejects a null one must see the difference.
 */

import type { WorkflowValueRef } from './expression.ts';

export interface WorkflowAssignment {
  /**
   * Destination path in the object being built. Object segments only — see
   * `runtime/paths.ts` for why array destinations are refused.
   */
  readonly to: string;
  readonly from: WorkflowValueRef;
  /** When true, a source that does not resolve fails the node. */
  readonly required: boolean;
}

export interface WorkflowMapping {
  readonly assignments: readonly WorkflowAssignment[];
}

/**
 * Ceilings on a mapping and on what it may produce.
 *
 * `maxMappedBytes` is the one that stops a mapping being an amplifier: a node
 * output can be tens of kilobytes, and a mapping that copied it into eight
 * fields of the next node's input would multiply it on every hop of a
 * sixty-four node plan. The bound is checked on the RESULT, after assembly,
 * because that is the value that travels.
 */
export const MAPPING_BOUNDS = {
  maxAssignments: 32,
  maxMappedBytes: 32 * 1024,
} as const;
