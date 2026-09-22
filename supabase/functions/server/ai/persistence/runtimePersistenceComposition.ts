/**
 * A2-P06-C03 — the ONE place the workflow and agent runtime stores are built.
 *
 * Given the configured mode per domain, the ports the server supplies and the
 * tenant configuration, this returns exactly one store set per domain: the key-
 * value stores or the SQL stores, frozen or not. It is the whole of the
 * cutover's runtime mechanism, and it is deliberately small enough to read in
 * one sitting.
 *
 * ── WHAT "ONE AUTHORITY" MEANS HERE, CONCRETELY ───────────────────────────
 *
 * A domain's three stores always come from the same backend. There is no mode
 * that writes both, reads one and writes the other, or falls through from one
 * to the other on error: a SQL outage is a SQL failure, surfaced as the
 * domain's typed persistence failure, never a quiet write to KV that SQL will
 * later not contain.
 *
 * ── THE FREEZE IS AT THE STORE SEAM ───────────────────────────────────────
 *
 * Every mutation the engines perform — a run created, advanced, cancelled or
 * expired, a checkpoint appended, an approval requested, decided, consumed,
 * expired or withdrawn, whether it arrives from an HTTP route, a workflow node
 * driving a child agent, or the durable approval-expiry sweep — goes through
 * `create`, `save` or `write` on one of these three stores. So a frozen mode
 * wraps those methods and refuses, and "every mutation entry point is frozen"
 * is a property of the construction, not a list someone has to keep complete.
 * Reads pass, so an operator can still see what exists.
 *
 * ── REFUSING, NOT FALLING BACK ────────────────────────────────────────────
 *
 * A mode that cannot be honoured — unrecognised, SQL without a gateway, SQL
 * with a tenant configuration it cannot store, a frozen KV mode without KV
 * ports — produces REFUSING stores: every call, reads included, fails with the
 * domain's typed persistence failure naming the problem. It never produces the
 * in-memory stores the runtimes would otherwise default to, because a runtime
 * that silently kept its state in an isolate is the opposite of a cutover.
 *
 * The one preserved behaviour is `kv` with no key-value ports at all: that is
 * how a deployment without durable storage runs today (the runtimes use their
 * own in-memory stores, loudly), and A2 does not change it.
 */

import type {
  WorkflowApprovalStore,
  WorkflowCheckpointStore,
  WorkflowRunStore,
} from '../workflows/persistence/ports.ts';
import type {
  AgentApprovalStore,
  AgentCheckpointStore,
  AgentRunStore,
} from '../agents/persistence/ports.ts';
import {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from '../workflows/persistence/kvWorkflowStores.ts';
import { createSqlWorkflowStores } from '../workflows/persistence/sqlWorkflowStores.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
  type KvAgentConditionalWriter,
  type KvAgentPrefixReader,
  type KvAgentReader,
} from '../agents/persistence/kvAgentStores.ts';
import { createSqlAgentStores } from '../agents/persistence/sqlAgentStores.ts';
import { workflowFailure } from '../workflows/contracts/failures.ts';
import { agentFailure } from '../agents/contracts/failures.ts';
import {
  RUNTIME_PERSISTENCE_ENV,
  authorityOf,
  parseRuntimePersistenceMode,
  tenantConfigurationProblem,
  writesAllowed,
  type RuntimePersistenceAuthority,
  type RuntimePersistenceDomain,
  type RuntimePersistenceMode,
} from './runtimePersistenceAuthority.ts';
import { runtimePersistencePairProblem } from './runtimeCutoverPlan.ts';
import type { EnvSource } from '../runtime/env.ts';

export interface WorkflowStoreSet {
  readonly runStore: WorkflowRunStore;
  readonly checkpointStore: WorkflowCheckpointStore;
  readonly approvalStore: WorkflowApprovalStore;
}

export interface AgentStoreSet {
  readonly runStore: AgentRunStore;
  readonly checkpointStore: AgentCheckpointStore;
  readonly approvalStore: AgentApprovalStore;
}

/** The key-value ports, exactly as the bootstrap already assembles them. */
export interface RuntimeKvPorts {
  readonly read: KvAgentReader;
  readonly readByPrefix: KvAgentPrefixReader;
  readonly compareAndSwap: KvAgentConditionalWriter;
  readonly onCorrupt?: (key: string, detail: string) => void;
}

/** One verb. The server hands in `supabase.rpc`; this module holds no client. */
export interface RuntimeSqlGateway {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface RuntimePersistenceInput {
  /**
   * The runtime environment, as `runtime/env.ts` supplies it everywhere else:
   * a `get(key)` source, NOT a record. (The first draft took a record; the
   * bootstrap's `EnvSource` would have been indexed as one and every mode would
   * have read as unset — a deployment that set `sql` would have silently stayed
   * on KV. The type checker caught it; `runtimePersistenceComposition.test.ts`
   * now drives the real `EnvSource`.)
   */
  readonly env: EnvSource;
  /** Per domain, because each logs its own corrupt records under its own name. */
  readonly kv?: { readonly workflow?: RuntimeKvPorts; readonly agent?: RuntimeKvPorts };
  readonly sqlGateway?: RuntimeSqlGateway;
  readonly tenant: { readonly defaultOrganizationId: string; readonly allowDefaultOrganization: boolean };
  readonly onSqlCorrupt?: (location: string, detail: string) => void;
}

export interface DomainComposition<S> {
  /** Undefined when the configured value was not a mode at all. */
  readonly mode?: RuntimePersistenceMode;
  /** Undefined when the stores refuse everything. */
  readonly authority?: RuntimePersistenceAuthority;
  /** Undefined only for `kv` with no KV ports — today's in-memory behaviour. */
  readonly stores?: S;
  readonly refusing: boolean;
  readonly frozen: boolean;
  /** The (workflow, agent) pair is off the reviewed corridor; mutation refused. */
  readonly pairUnsafe?: boolean;
  readonly problems: readonly string[];
}

export interface RuntimePersistenceComposition {
  readonly workflow: DomainComposition<WorkflowStoreSet>;
  readonly agent: DomainComposition<AgentStoreSet>;
}

// ── Freeze and refusal, per domain vocabulary ───────────────────────────────

const FROZEN_MESSAGE = 'Changes are paused for scheduled maintenance.';
const REFUSED_MESSAGE = 'Runtime persistence is unavailable.';

function workflowRefusal(message: string, diagnostics: string): never {
  throw workflowFailure('workflow_persistence_failed', message, { diagnostics });
}

function agentRefusal(message: string, diagnostics: string): never {
  throw agentFailure('persistence_failed', message, { diagnostics });
}

function frozenWorkflow(stores: WorkflowStoreSet, mode: RuntimePersistenceMode, reason?: string): WorkflowStoreSet {
  const why = reason ?? `runtime persistence is frozen for cutover (${RUNTIME_PERSISTENCE_ENV.workflow}=${mode})`;
  return {
    runStore: {
      load: (o, id) => stores.runStore.load(o, id),
      list: (q) => stores.runStore.list(q),
      create: async () => workflowRefusal(FROZEN_MESSAGE, why),
      save: async () => workflowRefusal(FROZEN_MESSAGE, why),
    },
    checkpointStore: {
      latest: (o, id) => stores.checkpointStore.latest(o, id),
      read: (o, id, v) => stores.checkpointStore.read(o, id, v),
      history: (o, id) => stores.checkpointStore.history(o, id),
      write: async () => workflowRefusal(FROZEN_MESSAGE, why),
    },
    approvalStore: {
      load: (o, id) => stores.approvalStore.load(o, id),
      list: (q) => stores.approvalStore.list(q),
      create: async () => workflowRefusal(FROZEN_MESSAGE, why),
      save: async () => workflowRefusal(FROZEN_MESSAGE, why),
    },
  };
}

function frozenAgent(stores: AgentStoreSet, mode: RuntimePersistenceMode, reason?: string): AgentStoreSet {
  const why = reason ?? `runtime persistence is frozen for cutover (${RUNTIME_PERSISTENCE_ENV.agent}=${mode})`;
  return {
    runStore: {
      load: (o, id) => stores.runStore.load(o, id),
      list: (q) => stores.runStore.list(q),
      create: async () => agentRefusal(FROZEN_MESSAGE, why),
      save: async () => agentRefusal(FROZEN_MESSAGE, why),
    },
    checkpointStore: {
      latest: (o, id) => stores.checkpointStore.latest(o, id),
      read: (o, id, v) => stores.checkpointStore.read(o, id, v),
      history: (o, id) => stores.checkpointStore.history(o, id),
      write: async () => agentRefusal(FROZEN_MESSAGE, why),
    },
    approvalStore: {
      load: (o, id) => stores.approvalStore.load(o, id),
      list: (q) => stores.approvalStore.list(q),
      create: async () => agentRefusal(FROZEN_MESSAGE, why),
      save: async () => agentRefusal(FROZEN_MESSAGE, why),
    },
  };
}

function refusingWorkflow(problem: string): WorkflowStoreSet {
  const refuse = async (): Promise<never> => workflowRefusal(REFUSED_MESSAGE, problem);
  return {
    runStore: { load: refuse, list: refuse, create: refuse, save: refuse },
    checkpointStore: { latest: refuse, read: refuse, history: refuse, write: refuse },
    approvalStore: { load: refuse, list: refuse, create: refuse, save: refuse },
  };
}

function refusingAgent(problem: string): AgentStoreSet {
  const refuse = async (): Promise<never> => agentRefusal(REFUSED_MESSAGE, problem);
  return {
    runStore: { load: refuse, list: refuse, create: refuse, save: refuse },
    checkpointStore: { latest: refuse, read: refuse, history: refuse, write: refuse },
    approvalStore: { load: refuse, list: refuse, create: refuse, save: refuse },
  };
}

// ── One domain ──────────────────────────────────────────────────────────────

function composeDomain<S>(
  domain: RuntimePersistenceDomain,
  input: RuntimePersistenceInput,
  build: { kv: (ports: RuntimeKvPorts) => S; sql: (gateway: RuntimeSqlGateway) => S },
  freeze: (stores: S, mode: RuntimePersistenceMode, reason?: string) => S,
  refuse: (problem: string) => S,
): DomainComposition<S> {
  const parsed = parseRuntimePersistenceMode(domain, input.env.get(RUNTIME_PERSISTENCE_ENV[domain]));
  if (!parsed.ok) {
    return { stores: refuse(parsed.problem), refusing: true, frozen: false, problems: [parsed.problem] };
  }
  const mode = parsed.mode;
  const authority = authorityOf(mode);
  const refused = (problem: string): DomainComposition<S> => ({
    mode,
    stores: refuse(problem),
    refusing: true,
    frozen: false,
    problems: [problem],
  });

  let stores: S | undefined;
  if (authority === 'kv') {
    const ports = input.kv?.[domain];
    if (ports === undefined) {
      // Today's behaviour for a deployment with no durable key-value port:
      // the runtimes keep isolate-local state and say so. Only `kv` keeps it;
      // a FROZEN mode without the store it freezes is not a mode.
      if (mode === 'kv') return { mode, authority, refusing: false, frozen: false, problems: [] };
      return refused(`${domain}: ${mode} requires the key-value ports and none were supplied`);
    }
    stores = build.kv(ports);
  } else {
    if (input.sqlGateway === undefined) {
      return refused(`${domain}: ${mode} requires the runtime SQL gateway and none was supplied`);
    }
    const tenant = tenantConfigurationProblem(input.tenant);
    if (tenant !== undefined) return refused(`${domain}: ${tenant}`);
    stores = build.sql(input.sqlGateway);
  }

  const frozen = !writesAllowed(mode);
  return { mode, authority, stores: frozen ? freeze(stores, mode) : stores, refusing: false, frozen, problems: [] };
}

export function composeRuntimePersistence(input: RuntimePersistenceInput): RuntimePersistenceComposition {
  const workflow = composeDomain<WorkflowStoreSet>(
    'workflow',
    input,
    {
      kv: (ports) => ({
        runStore: createKvWorkflowRunStore(ports),
        checkpointStore: createKvWorkflowCheckpointStore(ports),
        approvalStore: createKvWorkflowApprovalStore(ports),
      }),
      sql: (gateway) => createSqlWorkflowStores({ gateway, onCorrupt: input.onSqlCorrupt }),
    },
    frozenWorkflow,
    refusingWorkflow,
  );
  const agent = composeDomain<AgentStoreSet>(
    'agent',
    input,
    {
      kv: (ports) => ({
        runStore: createKvAgentRunStore(ports),
        checkpointStore: createKvAgentCheckpointStore(ports),
        approvalStore: createKvAgentApprovalStore(ports),
      }),
      sql: (gateway) => createSqlAgentStores({ gateway, onCorrupt: input.onSqlCorrupt }),
    },
    frozenAgent,
    refusingAgent,
  );

  // ── THE CROSS-DOMAIN INVARIANT, BEFORE ANY STORE IS HANDED OUT ─────────
  //
  // A workflow drives agent runs, so the two modes are judged as a PAIR
  // against the one reviewed corridor (`runtimeCutoverPlan.ts`). A domain
  // whose own mode could not be honoured counts as unsafe too: a refusing
  // agent domain under a writing workflow is the same hazard as a frozen one.
  // An unsafe pair closes MUTATION in both domains; neither mode is
  // downgraded, nothing falls back to KV, and the reason is returned.
  const pairProblem =
    workflow.refusing || agent.refusing || workflow.mode === undefined || agent.mode === undefined
      ? 'a runtime persistence domain could not be composed; mutation is refused in both domains until both modes are valid and on the corridor'
      : runtimePersistencePairProblem(workflow.mode, agent.mode);
  if (pairProblem === undefined) return { workflow, agent };

  return {
    workflow: closeMutation(workflow, pairProblem, frozenWorkflow, refusingWorkflow),
    agent: closeMutation(agent, pairProblem, frozenAgent, refusingAgent),
  };
}

function closeMutation<S>(
  composed: DomainComposition<S>,
  problem: string,
  freeze: (stores: S, mode: RuntimePersistenceMode, reason?: string) => S,
  refuse: (problem: string) => S,
): DomainComposition<S> {
  if (composed.refusing) return { ...composed, problems: [...composed.problems, problem] };
  // `kv` with no key-value ports has no stores to freeze; in an unsafe pair it
  // may not fall back to the runtimes' in-memory stores either, so it refuses.
  if (composed.stores === undefined || composed.mode === undefined) {
    return { ...composed, stores: refuse(problem), refusing: true, problems: [...composed.problems, problem] };
  }
  return {
    ...composed,
    stores: freeze(composed.stores, composed.mode, problem),
    frozen: true,
    pairUnsafe: true,
    problems: [...composed.problems, problem],
  };
}
