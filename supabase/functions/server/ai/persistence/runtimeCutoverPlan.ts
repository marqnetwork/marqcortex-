/**
 * A2-P08-C03 — the agent transition strategy, and the ONE corridor both
 * runtime persistence domains move through together.
 *
 * ── WHY THE AGENT STRATEGY IS NOT THE WORKFLOW STRATEGY COPIED ────────────
 *
 * The hosted agent estate is empty too (A2-P05: 0 runs, 0 checkpoints, 0
 * approvals), so the same freeze → recheck → switch shape applies: no backfill,
 * no shadow, no catch-up. What the agent runtime adds is a DEPENDENCY. A
 * workflow node creates child agent runs, records their ids in its own run
 * (`childAgentRunIds`, `pendingNode.agentRunId`) and drives them to completion.
 * So it is unsafe for workflow mutation to be live while agent persistence is
 * frozen, refusing, or under a different authority:
 *
 *   a workflow writing over a frozen agent domain records child-agent failures
 *   instead of pausing; a workflow and an agent domain writing under different
 *   authorities put one business process in two stores, and the next
 *   zero-estate recheck would ABORT on the stranded rows.
 *
 * A standalone agent run involves no workflow, so the agent domain may keep
 * writing briefly after the workflow freezes. That is exactly why the FINAL
 * zero-estate recheck happens only after BOTH domains are frozen: the snapshot
 * taken at the workflow freeze is not the final estate.
 *
 * ── THE CORRIDOR ──────────────────────────────────────────────────────────
 *
 *   workflow     agent
 *   kv           kv            production today
 *   kv_frozen    kv            workflow frozen first
 *   kv_frozen    kv_frozen     both frozen → FINAL zero-estate recheck,
 *                              schema readiness, approved migrations
 *   kv_frozen    sql_frozen    agent authority moves (while frozen)
 *   sql_frozen   sql_frozen    workflow authority moves (while frozen)
 *   sql_frozen   sql           agent live on SQL first
 *   sql          sql           workflow live last
 *
 * Rollback walks the same seven states in reverse, and each domain's
 * sql_frozen → kv_frozen edge still needs its SQL estate to be zero — the P06
 * controller's ROLLBACK_WINDOW_CLOSED rule, unchanged. Nothing is ever copied
 * back to KV.
 *
 * EVERY OTHER PAIR IS REFUSED — not "every theoretically safe pair allowed".
 * The objective is one reviewed corridor, and a pair nobody walked through is a
 * pair nobody reviewed. `runtimePersistenceComposition.ts` applies this before
 * it returns usable stores: an unsafe pair fails mutation closed in BOTH
 * domains, downgrades neither mode, and never falls back to KV.
 */

import type { RuntimePersistenceMode } from './runtimePersistenceAuthority.ts';
import { planTransition } from './runtimePersistenceAuthority.ts';

export interface RuntimePersistencePair {
  readonly workflow: RuntimePersistenceMode;
  readonly agent: RuntimePersistenceMode;
}

/** The corridor, in forward order. Rollback is this list reversed. */
export const RUNTIME_PERSISTENCE_CORRIDOR: readonly RuntimePersistencePair[] = [
  { workflow: 'kv', agent: 'kv' },
  { workflow: 'kv_frozen', agent: 'kv' },
  { workflow: 'kv_frozen', agent: 'kv_frozen' },
  { workflow: 'kv_frozen', agent: 'sql_frozen' },
  { workflow: 'sql_frozen', agent: 'sql_frozen' },
  { workflow: 'sql_frozen', agent: 'sql' },
  { workflow: 'sql', agent: 'sql' },
];

/** SAFE, or the precise reason a pair fails closed. */
export function runtimePersistencePairProblem(
  workflow: RuntimePersistenceMode,
  agent: RuntimePersistenceMode,
): string | undefined {
  if (RUNTIME_PERSISTENCE_CORRIDOR.some((pair) => pair.workflow === workflow && pair.agent === agent)) {
    return undefined;
  }
  return (
    `AI_WORKFLOW_PERSISTENCE=${workflow} with AI_AGENT_PERSISTENCE=${agent} is not on the reviewed A2 ` +
    'cutover corridor (kv/kv, kv_frozen/kv, kv_frozen/kv_frozen, kv_frozen/sql_frozen, ' +
    'sql_frozen/sql_frozen, sql_frozen/sql, sql/sql); runtime mutation is refused in both domains'
  );
}

export interface CutoverStep extends RuntimePersistencePair {
  readonly step: string;
  /** What must be true before this state is entered. */
  readonly requires: string;
}

/** The forward sequence, one freeze window, with what each state requires. */
export const COMBINED_CUTOVER_SEQUENCE: readonly CutoverStep[] = [
  { step: 'baseline', ...RUNTIME_PERSISTENCE_CORRIDOR[0], requires: 'production today' },
  { step: 'freeze workflow', ...RUNTIME_PERSISTENCE_CORRIDOR[1], requires: 'nothing: freezing is always safe' },
  { step: 'freeze agent', ...RUNTIME_PERSISTENCE_CORRIDOR[2],
    requires: 'workflow frozen and observed (standalone agent runs may finish in this interval)' },
  { step: 'move agent authority', ...RUNTIME_PERSISTENCE_CORRIDOR[3],
    requires: 'both freezes observed; FINAL zero-estate recheck ZERO_ESTATE; approved migrations applied; agent PRE GO' },
  { step: 'move workflow authority', ...RUNTIME_PERSISTENCE_CORRIDOR[4], requires: 'workflow PRE GO' },
  { step: 'agent live on SQL', ...RUNTIME_PERSISTENCE_CORRIDOR[5], requires: 'POST GO for both domains' },
  { step: 'workflow live on SQL', ...RUNTIME_PERSISTENCE_CORRIDOR[6], requires: 'agent writing on SQL; then LIVE GO for both domains' },
];

/** Rollback: the same corridor reversed; SQL→KV edges need that domain's SQL estate zero. */
export const COMBINED_ROLLBACK_SEQUENCE: readonly RuntimePersistencePair[] = [...RUNTIME_PERSISTENCE_CORRIDOR].reverse();

/**
 * Every state of a sequence is on the corridor, and every move between
 * consecutive states is a permitted per-domain edge that moves ONE domain.
 * (Evidence is supplied in full so the check is about the edges themselves.)
 */
export function sequenceProblems(sequence: readonly RuntimePersistencePair[]): readonly string[] {
  const problems: string[] = [];
  const evidence = {
    kvEstate: { runs: 0, checkpoints: 0, approvals: 0 },
    sqlEstate: { runs: 0, checkpoints: 0, approvals: 0 },
    sqlSchemaPresent: true,
    tenantConfiguration: { defaultOrganizationId: 'marq-cortex', allowDefaultOrganization: false },
    postCutoverVerified: true,
  };
  for (const [index, pair] of sequence.entries()) {
    const unsafe = runtimePersistencePairProblem(pair.workflow, pair.agent);
    if (unsafe !== undefined) problems.push(`state ${index}: ${unsafe}`);
    if (index === 0) continue;
    const previous = sequence[index - 1];
    const moved = (['workflow', 'agent'] as const).filter((domain) => previous[domain] !== pair[domain]);
    if (moved.length !== 1) problems.push(`state ${index}: ${moved.length} domains move at once`);
    for (const domain of moved) {
      if (!planTransition(domain, previous[domain], pair[domain], evidence).allowed) {
        problems.push(`state ${index}: ${domain} ${previous[domain]} -> ${pair[domain]} is not a permitted edge`);
      }
    }
  }
  return problems;
}
