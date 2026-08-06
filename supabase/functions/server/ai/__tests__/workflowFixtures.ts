/**
 * Deterministic workflow fixtures (AI-01 Batch 3B, Part 1).
 *
 * THESE ARE FIXTURES, NOT PRODUCTS. Part 1 ships no business workflows and the
 * production registry starts empty; these exist so the validator, the planner
 * and the registry can be exercised against real definitions rather than
 * against a copy of their own tables.
 *
 * Every fixture is a plain value. There is no clock, no id factory and no
 * randomness anywhere in the workflow foundation, so a fixture needs no harness
 * to be deterministic — which is itself the property the plan digest depends on.
 */

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '../workflows/contracts/workflow.ts';
import { object, str } from '../security/validation.ts';

export const WORKFLOW_AGENT_ID = {
  intake: 'agent.workflow.intake',
  draft: 'agent.workflow.draft',
  review: 'agent.workflow.review',
  /** Registered nowhere. For the `agentExists` port. */
  unknown: 'agent.workflow.ghost',
} as const;

export const KNOWN_AGENT_IDS: readonly string[] = [
  WORKFLOW_AGENT_ID.intake,
  WORKFLOW_AGENT_ID.draft,
  WORKFLOW_AGENT_ID.review,
];

export const agentExists = (agentId: string): boolean => KNOWN_AGENT_IDS.includes(agentId);

export const workflowContracts = {
  input: object({ brief: str({ minLength: 1, maxLength: 200 }) }),
  output: object({ summary: str({ minLength: 1, maxLength: 200 }) }),
};

export function node(overrides: Partial<WorkflowNode> & Pick<WorkflowNode, 'nodeId'>): WorkflowNode {
  return {
    kind: 'agent',
    agentId: WORKFLOW_AGENT_ID.draft,
    displayName: `Step ${overrides.nodeId}`,
    maxAttempts: 1,
    ...overrides,
  };
}

export function edge(from: string, to: string, label?: string): WorkflowEdge {
  return label === undefined ? { from, to } : { from, to, label };
}

/** A three-node chain: intake, draft, review. The happy path. */
export const linearWorkflow: WorkflowDefinition = {
  workflowId: 'workflow.fixture.linear',
  displayName: 'Linear fixture',
  purpose: 'Exercise the planner against a well-formed chain.',
  description: 'Intake, then draft, then review. One agent per node.',
  owner: 'platform-ai',
  version: '1.0.0',
  enabled: true,
  certification: 'certified',
  nodes: [
    node({ nodeId: 'intake', agentId: WORKFLOW_AGENT_ID.intake, displayName: 'Intake' }),
    node({ nodeId: 'draft', agentId: WORKFLOW_AGENT_ID.draft, displayName: 'Draft', maxAttempts: 3 }),
    node({ nodeId: 'review', agentId: WORKFLOW_AGENT_ID.review, displayName: 'Review', maxAttempts: 2 }),
  ],
  edges: [edge('intake', 'draft'), edge('draft', 'review', 'ready for review')],
  startNodeId: 'intake',
  inputContract: workflowContracts.input,
  outputContract: workflowContracts.output,
};

/** The same graph with no declared start. The planner has to resolve one. */
export const undeclaredStartWorkflow: WorkflowDefinition = {
  ...linearWorkflow,
  workflowId: 'workflow.fixture.undeclared_start',
  startNodeId: undefined,
};

/** One node, no edges. The smallest plannable workflow. */
export const singleNodeWorkflow: WorkflowDefinition = {
  ...linearWorkflow,
  workflowId: 'workflow.fixture.single',
  nodes: [node({ nodeId: 'only', agentId: WORKFLOW_AGENT_ID.intake, displayName: 'Only' })],
  edges: [],
  startNodeId: 'only',
};

export function variant(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  return { ...linearWorkflow, ...overrides } as WorkflowDefinition;
}
