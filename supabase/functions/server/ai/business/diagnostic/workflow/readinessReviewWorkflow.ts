/**
 * workflow.diagnostic.readiness_review — the first business workflow
 * (AI-01 Batch 3B, Part 7B, Phase 7).
 *
 *   n_review
 *      ↓
 *   n_reviewable
 *      ├─ true  → n_publish_approval → n_commit → terminal
 *      └─ false → n_escalate → terminal
 *
 * FIVE NODES, THREE KINDS, AND NOTHING THIS BATCH DID NOT ALREADY SHIP. Agent,
 * condition and approval nodes are Parts 2, 3 and 5. There is no parallel node,
 * no join, no loop and no back edge — not because the graph could not be drawn
 * with them, but because none of them is needed to review one submission, and a
 * workflow that used a primitive it did not need would be the place the next
 * workflow learns to.
 *
 * ── HUMAN INITIATED, AND THERE IS NO OTHER WAY IN ──────────────────────────
 *
 * Nothing schedules this. It has no trigger, no timer and no entry point other
 * than `workflowRuntime.service.startRun`, which requires an authenticated
 * subject holding `workflow.run.create`. That is a property of the platform
 * rather than of this file — Batch 3B ships no scheduler — and it is stated here
 * because "human initiated" is a Part 7A requirement and a reader is entitled to
 * see where it is discharged.
 *
 * ── THE APPROVAL IS A BARRIER, NOT A FLAG ──────────────────────────────────
 *
 * `n_publish_approval` runs nothing. It parks the run, writes a durable
 * approval request, and releases only on a decision from a declared role. What
 * it does NOT do is authorise the commit by itself: the commit tool re-checks
 * the approval record from durable storage before it writes anything, because a
 * gate whose only enforcement is graph order is a gate that stops enforcing the
 * moment somebody calls the node's agent directly. See
 * `tools/diagnosticTools.ts`.
 *
 * ── WHAT EACH MAPPING IS FOR ───────────────────────────────────────────────
 *
 * Both agent nodes run the SAME agent — Part 7B ships one business agent — so
 * the mappings are what make them different nodes. `n_review` is handed the
 * submission and the literal stage `review`; `n_commit` is handed the same
 * submission, the literal stage `commit`, and the content digest the review node
 * produced. Every field is named in both directions: a field nobody named cannot
 * flow, which is what makes "can this workflow move a client's answers into the
 * commit node" answerable by reading the definition.
 */

import type {
  WorkflowAgentNode,
  WorkflowApprovalNode,
  WorkflowConditionNode,
  WorkflowDefinition,
  WorkflowEdge,
} from '../../../workflows/contracts/workflow.ts';
import type { WorkflowExpression } from '../../../workflows/contracts/expression.ts';
import { arrayOf, bool, int, literal, num, object, optional, str } from '../../../security/validation.ts';
import { SUBMISSION_ID_PATTERN } from '../contracts/dossier.ts';
import { ESCALATION_REASONS } from '../contracts/review.ts';
import { READINESS_MANAGER_AGENT_ID, REVIEW_STAGES } from '../agent/readinessManagerAgent.ts';

export const READINESS_REVIEW_WORKFLOW_ID = 'workflow.diagnostic.readiness_review';
export const READINESS_REVIEW_VERSION = '1.0.0';

/** The node the commit approval is asked at. Named once, used three times. */
export const REVIEW_APPROVAL_NODE_ID = 'n_publish_approval';

/**
 * Roles that may answer the commit approval.
 *
 * Declared here, frozen onto the approval record when the run parks, and
 * re-checked by the commit tool against this same list. Three readers, one
 * source — and the tool's check is what catches a record whose frozen list is
 * not the one this definition declares.
 */
export const REVIEW_APPROVER_ROLES: readonly string[] = ['owner', 'reviewer'];

// ── Contracts ───────────────────────────────────────────────────────────────

export const readinessReviewInput = object({
  submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
});

/**
 * The workflow's output contract.
 *
 * Satisfied by BOTH terminals — a committed review and an escalation — because
 * a workflow whose escalation path could not produce a valid output would be a
 * workflow that fails when it works correctly.
 */
export const readinessReviewOutput = object({
  stage: literal(REVIEW_STAGES),
  submissionId: str({ maxLength: 64 }),
  outcome: literal(['drafted', 'escalated', 'committed'] as const),
  reviewable: bool(),
  contentDigest: optional(str({ maxLength: 64 })),
  reviewId: optional(str({ maxLength: 96 })),
  escalationReason: optional(literal(ESCALATION_REASONS)),
  factLockRestored: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  factLockRemoved: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  authorityDigest: optional(str({ maxLength: 64 })),
  recommendationCount: optional(int({ min: 0, max: 7 })),
  confidence: optional(num({ min: 0, max: 1 })),
});

/** What `n_review` must produce before its output is TRUSTED and referenceable. */
const reviewNodeOutput = object({
  stage: literal(REVIEW_STAGES),
  submissionId: str({ maxLength: 64 }),
  outcome: literal(['drafted', 'escalated', 'committed'] as const),
  reviewable: bool(),
  contentDigest: optional(str({ maxLength: 64 })),
  escalationReason: optional(literal(ESCALATION_REASONS)),
  factLockRestored: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  factLockRemoved: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  authorityDigest: optional(str({ maxLength: 64 })),
  recommendationCount: optional(int({ min: 0, max: 7 })),
  confidence: optional(num({ min: 0, max: 1 })),
});

const commitNodeOutput = object({
  stage: literal(REVIEW_STAGES),
  submissionId: str({ maxLength: 64 }),
  outcome: literal(['drafted', 'escalated', 'committed'] as const),
  reviewable: bool(),
  reviewId: optional(str({ maxLength: 96 })),
  contentDigest: optional(str({ maxLength: 64 })),
  factLockRestored: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
  factLockRemoved: arrayOf(str({ maxLength: 120 }), { maxItems: 64 }),
});

/** What the workflow will hand each agent node, declared by the workflow. */
const reviewNodeInput = object({
  submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
  stage: literal(REVIEW_STAGES),
});

const commitNodeInput = object({
  submissionId: str({ minLength: 1, maxLength: 64, pattern: SUBMISSION_ID_PATTERN }),
  stage: literal(REVIEW_STAGES),
  contentDigest: str({ minLength: 8, maxLength: 64, pattern: /^[a-f0-9]+$/ }),
});

// ── The decision ────────────────────────────────────────────────────────────

/**
 * Is there a review to approve?
 *
 * A boolean the REVIEW NODE produced and its declared output contract accepted.
 * The condition reads one field of one trusted node output; it does not
 * re-derive reviewability, because a second opinion about it would be a second
 * place the rule lives.
 */
export const reviewableExpression: WorkflowExpression = {
  op: 'equals',
  left: { source: 'node', nodeId: 'n_review', path: 'reviewable' },
  right: { source: 'literal', value: true },
};

// ── Nodes ───────────────────────────────────────────────────────────────────

const reviewNode: WorkflowAgentNode = {
  kind: 'agent',
  nodeId: 'n_review',
  displayName: 'Review the diagnostic submission',
  agentId: READINESS_MANAGER_AGENT_ID,
  /**
   * Two attempts, with a backoff.
   *
   * The review stage calls a model, and a model call is the one step here that
   * can fail for a reason that is gone a second later. Two rather than more,
   * because every attempt spends tokens and the second one is either enough or
   * the failure is not transient.
   */
  maxAttempts: 2,
  retryPolicy: { backoff: 'fixed_delay', delayMs: 1_000 },
  inputMapping: {
    assignments: [
      {
        to: 'submissionId',
        from: { source: 'input', path: 'submissionId' },
        required: true,
      },
      { to: 'stage', from: { source: 'literal', value: 'review' }, required: true },
    ],
  },
  inputContract: reviewNodeInput,
  outputContract: reviewNodeOutput,
};

const reviewableCondition: WorkflowConditionNode = {
  kind: 'condition',
  nodeId: 'n_reviewable',
  displayName: 'Is there a review to approve?',
  expression: reviewableExpression,
};

const publishApproval: WorkflowApprovalNode = {
  kind: 'approval',
  nodeId: REVIEW_APPROVAL_NODE_ID,
  displayName: 'Approve the diagnostic review',
  approverRoles: REVIEW_APPROVER_ROLES,
  reason: 'A drafted diagnostic readiness review is waiting to be committed.',
  impactSummary:
    'Committing records the reviewed readiness result against this submission. The narrative ' +
    'is advisory; the scores, ranking and dependencies are the deterministic engines’.',
  expiresAfterMs: 3_600_000,
  /**
   * WHAT THE APPROVER IS ANSWERING ABOUT (Part 7D, F3).
   *
   * Both values are read from `n_review`'s TRUSTED OUTPUT — the projection that
   * passed `reviewNodeOutput` before it was stored — and both originate inside
   * the platform rather than in a model:
   *
   *   submissionId    the workflow's own validated input, echoed by the node
   *   contentDigest   the digest the DRAFT TOOL computed over the record it
   *                   sealed, returned from durable storage and passed through
   *                   the agent unchanged
   *
   * A model cannot author either. It cannot compute the digest — the tool
   * computes it over content the tool assembled, after the fact lock — and a
   * model that emitted a different one would be emitting a value the sealed
   * draft does not carry, which the commit tool refuses.
   *
   * The consequence is the one the barrier exists for: the approval record
   * itself says which submission and which sealed bytes are being approved, so
   * an approver reads the queue rather than reconstructing the subject, and the
   * commit proves the bytes it writes are the bytes this record named.
   */
  subjectEvidence: {
    subjectId: { source: 'node', nodeId: 'n_review', path: 'submissionId' },
    contentDigest: { source: 'node', nodeId: 'n_review', path: 'contentDigest' },
  },
  // FAIL, NOT CANCEL. A refused review is a decision somebody made about a
  // draft, and an operator reading the outcome later should see a run that was
  // stopped by a refusal rather than one that was called off.
  onRejection: 'fail',
  // The declared estimate for the commit node that follows. Placeholders, on
  // the terms `contracts/approval.ts` sets out: the commit stage makes no model
  // call, so the honest figure is small rather than absent.
  estimatedAdditionalTokens: 0,
  estimatedAdditionalCostMicroUsd: 0,
};

const commitNode: WorkflowAgentNode = {
  kind: 'agent',
  nodeId: 'n_commit',
  displayName: 'Commit the approved review',
  agentId: READINESS_MANAGER_AGENT_ID,
  /**
   * ONE ATTEMPT. The commit is non-idempotent and spends an approval; a second
   * attempt after a failure of unknown cause could be a second commit, and the
   * conservative direction for a side effect nobody can inspect is not to
   * repeat it. The tool refuses a replay anyway — two independent reasons,
   * because either alone is a single point.
   */
  maxAttempts: 1,
  inputMapping: {
    assignments: [
      {
        to: 'submissionId',
        from: { source: 'input', path: 'submissionId' },
        required: true,
      },
      { to: 'stage', from: { source: 'literal', value: 'commit' }, required: true },
      {
        to: 'contentDigest',
        // The digest the REVIEW node produced and its contract accepted. The
        // commit tool refuses it unless it is the digest the sealed draft
        // holds, so a mapping that carried the wrong one is a refusal rather
        // than a different commit.
        from: { source: 'node', nodeId: 'n_review', path: 'contentDigest' },
        required: true,
      },
    ],
  },
  inputContract: commitNodeInput,
  outputContract: commitNodeOutput,
};

const escalateNode: WorkflowAgentNode = {
  kind: 'agent',
  nodeId: 'n_escalate',
  displayName: 'Close the run as escalated',
  agentId: READINESS_MANAGER_AGENT_ID,
  maxAttempts: 1,
  /**
   * The escalation terminal.
   *
   * The escalation RECORD was already written by the review node — that is
   * where the decision to escalate was made and where the evidence for it was.
   * This node exists so the false branch has a terminal that produces the
   * workflow's declared output, rather than the condition node dangling.
   */
  inputMapping: {
    assignments: [
      {
        to: 'submissionId',
        from: { source: 'input', path: 'submissionId' },
        required: true,
      },
      { to: 'stage', from: { source: 'literal', value: 'review' }, required: true },
    ],
  },
  inputContract: reviewNodeInput,
  outputContract: reviewNodeOutput,
};

const edges: readonly WorkflowEdge[] = [
  { from: 'n_review', to: 'n_reviewable' },
  { from: 'n_reviewable', to: REVIEW_APPROVAL_NODE_ID, when: true, label: 'reviewable' },
  { from: 'n_reviewable', to: 'n_escalate', when: false, label: 'escalated' },
  { from: REVIEW_APPROVAL_NODE_ID, to: 'n_commit' },
];

export const readinessReviewWorkflow: WorkflowDefinition = {
  workflowId: READINESS_REVIEW_WORKFLOW_ID,
  displayName: 'Diagnostic readiness review',
  purpose: 'Review one diagnostic submission and commit the result a person approved.',
  description:
    'Human-initiated. The readiness manager reviews a submission against the deterministic ' +
    'engines and drafts an advisory review; a declared role approves it; the commit is written ' +
    'through a tool that re-checks that approval against durable storage. A submission that ' +
    'cannot be reviewed escalates instead, and never reaches the approval barrier.',
  owner: 'MARQ Diagnostic Assessment & Advisory (D07)',
  version: READINESS_REVIEW_VERSION,
  // Certified alongside the agent it names and the five tools that agent
  // declares, by the same human decision and for that chain only. See
  // `index.ts` for the posture and `agent/readinessManagerAgent.ts` for the
  // decision itself.
  enabled: true,
  certification: 'certified',
  nodes: [reviewNode, reviewableCondition, publishApproval, commitNode, escalateNode],
  edges,
  startNodeId: 'n_review',
  inputContract: readinessReviewInput,
  outputContract: readinessReviewOutput,
};
