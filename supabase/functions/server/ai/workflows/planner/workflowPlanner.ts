/**
 * The Workflow Planner (AI-01 Batch 3B).
 *
 * WORKFLOWS PLAN — and this is the module that does it. Given a validated
 * definition, it produces the frozen execution order the orchestrator will
 * follow: a list of WAVES, each a set of nodes that may run at the same time.
 *
 * WHY WAVES RATHER THAN A WORK QUEUE. A queue with a concurrency limit is the
 * obvious design and it is the wrong one here, for a reason that only shows up
 * in production: the run has to survive an isolate that vanishes mid-flight, and
 * a queue's state is "which items are in flight", which is exactly the thing a
 * dead isolate takes with it. A wave is a durable, re-derivable position — the
 * record says "wave 3", the plan says which nodes wave 3 contains, and a fresh
 * isolate reading both knows precisely what to do without trusting anything that
 * was in memory.
 *
 * IT IS A LONGEST-PATH LAYERING, NOT A GREEDY ONE. A node's wave is one past the
 * highest wave of anything it depends on. That places a node as late as its
 * dependencies force and no later, which is what makes the parallelism real:
 * two independent branches land in the same wave whatever order they were
 * declared in.
 *
 * BOUNDED PARALLELISM IS APPLIED HERE, NOT AT EXECUTION TIME. A layer wider than
 * `maxParallel` is SPLIT into consecutive waves at planning time, so the plan
 * itself states the concurrency the run will use. The alternative — a wide plan
 * throttled by the executor — would mean the persisted plan and the actual
 * execution disagreed about what happens when, and the plan is the thing an
 * operator reads.
 *
 * DETERMINISTIC, AND THE DIGEST PROVES IT. Nodes within a layer are ordered by
 * id, splits are taken in that order, and the whole plan is digested. The same
 * definition always produces the same plan on every isolate, so a resumed run
 * can assert it is executing the plan it started.
 *
 * WHAT THE PLANNER NEVER DOES: evaluate a condition, read a fact, look at a run,
 * or decide whether a node should be skipped. Those are runtime questions with
 * runtime answers — the plan says what MAY run and in what order, and the
 * orchestrator decides what DOES.
 */

import type { WorkflowDefinition, WorkflowNode } from '../contracts/workflow.ts';
import type { WorkflowPlan } from '../contracts/runtime.ts';
import { workflowFailure } from '../contracts/failures.ts';
import { digestValue } from '../../agents/runtime/digest.ts';

/**
 * Build the execution plan.
 *
 * Throws `cycle_detected` when the graph cannot be ordered, and
 * `wave_limit_exceeded` when the layering is deeper than the definition permits.
 * Both are definition problems the registry has normally already refused; the
 * planner checks anyway, because it is the component whose output would be
 * silently wrong if either were true.
 */
export function planWorkflow(definition: WorkflowDefinition): WorkflowPlan {
  const nodes = new Map<string, WorkflowNode>(
    definition.nodes.map((node) => [node.nodeId, node]),
  );

  const waveOf = new Map<string, number>();
  const remaining = new Set<string>(nodes.keys());

  /**
   * Kahn-style layering. Each pass takes every node whose dependencies have all
   * been placed. A pass that places nothing means the remainder contains a
   * cycle — there is no order for those nodes, and no amount of further passes
   * will find one.
   */
  let layer = 0;
  const layers: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((nodeId) =>
        (nodes.get(nodeId)?.dependsOn ?? []).every((dependency) => waveOf.has(dependency)),
      )
      .sort();

    if (ready.length === 0) {
      throw workflowFailure('cycle_detected', 'This workflow cannot be ordered.', {
        workflowId: definition.workflowId,
        diagnostics: `unorderable nodes: ${[...remaining].sort().join(', ')}`,
      });
    }

    for (const nodeId of ready) {
      waveOf.set(nodeId, layer);
      remaining.delete(nodeId);
    }
    layers.push(ready);
    layer += 1;
  }

  // Split any layer wider than the concurrency ceiling. The split preserves the
  // layer's own order, so which nodes land together is reproducible.
  const maxParallel = Math.max(1, Math.floor(definition.limits.maxParallel));
  const waves: string[][] = [];
  for (const wide of layers) {
    for (let index = 0; index < wide.length; index += maxParallel) {
      waves.push(wide.slice(index, index + maxParallel));
    }
  }

  if (waves.length > definition.limits.maxWaves) {
    throw workflowFailure('wave_limit_exceeded', 'This workflow plan is too deep to run.', {
      workflowId: definition.workflowId,
      diagnostics: `plan needs ${waves.length} waves; limits.maxWaves is ${definition.limits.maxWaves}`,
    });
  }

  return {
    waves,
    maxParallel,
    nodeCount: nodes.size,
    // Digested over the WAVES and the concurrency, which together are the whole
    // of the execution order. Two definitions that produce the same order are
    // the same plan, and a resumed run comparing digests is asking exactly that.
    digest: digestValue({ waves, maxParallel, workflowId: definition.workflowId, version: definition.version }),
  };
}

/** The wave a node was placed in, or `undefined` when the plan omits it. */
export function waveOfNode(plan: WorkflowPlan, nodeId: string): number | undefined {
  for (let index = 0; index < plan.waves.length; index += 1) {
    if (plan.waves[index].includes(nodeId)) return index;
  }
  return undefined;
}

/** Every node id the plan contains, in execution order. */
export function plannedNodeIds(plan: WorkflowPlan): readonly string[] {
  return plan.waves.flat();
}
