/**
 * Edge bootstrap for the AI Control Plane.
 *
 * The one place that reads the runtime environment and assembles the production
 * dependency graph. Everything under `ai/` above this file is pure, injectable
 * and runnable under a plain Node test runner; the platform-specific pieces
 * (auth verification, durable storage) arrive here as injected functions, so
 * this module takes no Supabase or Deno import of its own.
 *
 * The plane is created once per isolate and memoised. Creating it per request
 * would reset the circuit breakers, rate limit windows and budget ledgers on
 * every call, which would quietly disable three of the platform's protections.
 */

import type { AIControlPlane, ControlPlaneOptions } from './controlPlane.ts';
import type { MembershipLookup, UserLookup } from './adapters/supabaseAuthenticator.ts';
import type { KvWriter } from './adapters/kvAuditStore.ts';
import type { KvSpendReader } from './adapters/kvSpendStore.ts';
import type { AuditStore } from './observability/audit.ts';
import type { SpendStore } from './policy/spendLedger.ts';
import type { EnvSource } from './runtime/env.ts';
import type { AIAdministration } from './admin/administration.ts';
import type { AdminAuditStore } from './admin/adminAudit.ts';
import type { AgentRuntime } from './agents/agentRuntime.ts';
import type { AgentAuditStore } from './agents/observability/agentAudit.ts';
import type {
  KvAgentConditionalWriter,
  KvAgentPrefixReader,
} from './agents/persistence/kvAgentStores.ts';
import type { WorkflowRuntime } from './workflows/workflowRuntime.ts';
import type { FinancialEventStore } from './financial/persistence/ports.ts';
import type { ReusableResultStore } from './reuse/persistence/ports.ts';
import { createAgentRuntime } from './agents/agentRuntime.ts';
import { createWorkflowRuntime } from './workflows/workflowRuntime.ts';
import { createKvFinancialEventStore } from './financial/persistence/kvFinancialEventStore.ts';
import { createKvReusableResultStore } from './reuse/persistence/kvReusableResultStore.ts';
import {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
} from './workflows/persistence/kvWorkflowStores.ts';
import {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
} from './agents/persistence/kvAgentStores.ts';
import { createKvAgentAuditStore } from './agents/observability/agentAudit.ts';
import { DETERMINISTIC_TOOLS } from './agents/tools/mockTools.ts';
import { createControlPlane } from './controlPlane.ts';
import { loadControlPlaneConfig } from './runtime/config.ts';
import { readBool, runtimeEnv } from './runtime/env.ts';
import { systemClock } from './runtime/clock.ts';
import { systemIdFactory } from './contracts/ids.ts';
import { createSupabaseAuthenticator, denyAllAuthenticator } from './adapters/supabaseAuthenticator.ts';
import { createKvAuditStore } from './adapters/kvAuditStore.ts';
import { createKvSpendStore } from './adapters/kvSpendStore.ts';
import type { KvAdminConditionalWriter } from './adapters/kvAdminStores.ts';
import { createKvAdminAuditStore, createKvAdminSettingsStore } from './adapters/kvAdminStores.ts';
import { createAIAdministration } from './admin/administration.ts';
import { createMemorySettingsStore } from './admin/settingsStore.ts';
import { createOpenAIProvider } from './providers/openaiProvider.ts';
import { createAnthropicProvider } from './providers/anthropicProvider.ts';
import { createMockProvider } from './providers/mockProvider.ts';

export interface BootstrapDependencies {
  /** Verify a bearer token and return the auth subject. */
  readonly getUser?: UserLookup;
  /** Resolve the organizations a subject belongs to. */
  readonly listMemberships?: MembershipLookup;
  /** Durable key-value write, used for the audit store and the spend ledger. */
  readonly kvWrite?: KvWriter;
  /** Durable key-value read. Required for the spend ledger to be durable. */
  readonly kvRead?: KvSpendReader;
  /**
   * Atomic conditional write, required for durable AI settings.
   *
   * Without it the settings store falls back to isolate-local memory rather
   * than to a weaker durable write: a settings record two isolates can both
   * claim the same version for is worse than one that plainly does not survive
   * a restart, because the first failure is silent.
   */
  readonly kvCompareAndSwap?: KvAdminConditionalWriter;
  /**
   * Atomic conditional write keyed by a caller-named version field, required
   * for durable agent runs, approvals and checkpoints (migration
   * 20260804120000). Without it the agent runtime is isolate-local: runs still
   * execute, they simply do not survive a restart and cannot be advanced from
   * another isolate. That is reported rather than silently accepted.
   */
  readonly kvCompareAndSwapField?: KvAgentConditionalWriter;
  /** Durable prefix scan, required for listing runs and approvals. */
  readonly kvReadByPrefix?: KvAgentPrefixReader;
  /** Override the environment source. Production reads the runtime. */
  readonly env?: EnvSource;
}

let plane: AIControlPlane | undefined;
let administration: AIAdministration | undefined;
let agentRuntime: AgentRuntime | undefined;
let workflowRuntime: WorkflowRuntime | undefined;

/**
 * Build the production control plane. Idempotent per isolate: repeated calls
 * return the same instance so circuit, rate limit and budget state survive
 * across requests.
 */
export function initializeControlPlane(deps: BootstrapDependencies = {}): AIControlPlane {
  if (plane) return plane;

  const env = deps.env ?? runtimeEnv();
  const config = loadControlPlaneConfig(env);

  const authenticator = deps.getUser
    ? createSupabaseAuthenticator({
        getUser: deps.getUser,
        listMemberships: deps.listMemberships,
        clock: systemClock,
        onError: (stage, error) =>
          console.error(
            `[ai] authenticator ${stage} lookup failed:`,
            error instanceof Error ? error.message : String(error),
          ),
      })
    : // Fail closed. Without a way to verify credentials the plane rejects
      // every request rather than admitting unauthenticated traffic.
      denyAllAuthenticator;

  const auditStores: AuditStore[] = [];
  if (config.audit.durable && deps.kvWrite) {
    auditStores.push(
      createKvAuditStore({
        write: deps.kvWrite,
        retentionDays: config.audit.retentionDays,
        onError: (error) =>
          console.error(
            '[ai] durable audit write failed:',
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
  }

  const providers: ControlPlaneOptions['providers'][number][] = [
    { adapter: createOpenAIProvider({ env }), certification: 'certified' },
    { adapter: createAnthropicProvider({ env }), certification: 'certified' },
  ];

  // The mock provider is registered BY DEFAULT.
  //
  // Registering it is not the same as using it: it is declared non-production
  // and non-billable, so the health endpoint reports a deployment serving on it
  // as `degraded` rather than `healthy`, and it is never preferred over a real
  // provider once `AI_ALLOW_REAL_REQUESTS=true`. What its presence guarantees is
  // that a deployment which has NOT authorised real spending still has
  // something to serve — the alternative is a platform that either fails every
  // AI request or quietly starts spending because a key happened to be set.
  if (readBool(env, 'AI_ENABLE_MOCK_PROVIDER', true)) {
    providers.push({ adapter: createMockProvider(), certification: 'testing' });
  }

  // Durable spend ledger. Without it the MARQ ceiling is isolate-local and a
  // recycled isolate rediscovers a $0 balance, which is precisely the failure
  // the ceiling exists to prevent — so its absence is reported loudly.
  let spendStore: SpendStore | undefined;
  if (config.spend.durable && deps.kvRead && deps.kvWrite) {
    spendStore = createKvSpendStore({
      read: deps.kvRead,
      write: deps.kvWrite,
      onCorrupt: (scope, detail) =>
        console.error(`[ai] spend ledger ${scope} is unreadable: ${detail}`),
    });
  } else if (config.spend.durable) {
    console.error(
      '[ai] AI_SPEND_DURABLE is on but no key-value port was injected — ' +
        'the MARQ spend ceiling is isolate-local and will not survive a restart.',
    );
  }

  // The settings store has to exist before the plane, because the plane
  // re-reads settings THROUGH it: that read is what carries an administrator's
  // change to an isolate that did not serve the console request.
  const settingsStore =
    deps.kvRead && deps.kvWrite && deps.kvCompareAndSwap
      ? createKvAdminSettingsStore({
          read: deps.kvRead,
          write: deps.kvWrite,
          compareAndSwap: deps.kvCompareAndSwap,
          config,
          now: () => systemClock.isoNow(),
          onCorrupt: (detail) => console.error(`[ai] admin settings unreadable: ${detail}`),
        })
      : createMemorySettingsStore();
  if (!deps.kvRead || !deps.kvWrite || !deps.kvCompareAndSwap) {
    console.error(
      '[ai] no durable key-value port with conditional writes was injected — AI administration ' +
        'settings are isolate-local, will not survive a restart, and will not reach another isolate.',
    );
  }

  plane = createControlPlane({
    config,
    authenticator,
    providers,
    auditStores,
    spendStore,
    settingsSource: settingsStore,
  });

  // ── Administration (AI-01 Batch 2) ────────────────────────────────────────
  //
  // Assembled from the SAME authenticator the guard uses. A second credential
  // path for the administration surface would be a second thing to get wrong,
  // and the one that governs the platform is the wrong place to have one.
  //
  // Without a key-value port the settings store is isolate-local: settings
  // still apply, they simply do not survive a restart. That is reported rather
  // than silently accepted, because "the kill switch we engaged is off again"
  // is not a discovery to make during an incident.
  const adminAuditStores: AdminAuditStore[] = [];
  if (config.audit.durable && deps.kvWrite) {
    adminAuditStores.push(
      createKvAdminAuditStore({
        write: deps.kvWrite,
        retentionDays: config.audit.retentionDays,
        onError: (error) =>
          console.error(
            '[ai] durable admin audit write failed:',
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
  }

  administration = createAIAdministration({
    plane,
    authenticator,
    settingsStore,
    adminAuditStores,
    clock: systemClock,
    ids: systemIdFactory,
    logger: plane.logger,
    auditBufferSize: config.audit.bufferSize,
  });

  // Hydration is asynchronous and bootstrap is not. Stored settings therefore
  // arrive shortly AFTER the first request may be served, and the window is
  // safe by construction: until they land the plane runs on the deployment
  // baseline, which cannot spend money the environment did not authorise. A
  // failure here leaves the baseline in place and is loud.
  administration.hydrate().catch((error: unknown) => {
    console.error(
      '[ai] AI administration settings hydration failed:',
      error instanceof Error ? error.message : String(error),
    );
  });

  // ── Agent runtime (AI-01 Batch 3A) ────────────────────────────────────────
  //
  // Assembled over the SAME plane and the SAME authenticator. It is not a
  // second execution path: every model step it takes goes through
  // `controlPlane.execute`, so it inherits the guard, the policy engine, the
  // governance layer, the spend ceiling and the audit trail rather than
  // reimplementing any of them.
  //
  // NO AGENTS ARE REGISTERED HERE. Business agents are out of Batch 3A's
  // scope, and inventing one to populate the console would be exactly the
  // "inline production agent" the batch forbids. The registry starts empty and
  // a deployment registers definitions explicitly.
  const durableAgentStorage =
    deps.kvRead !== undefined &&
    deps.kvReadByPrefix !== undefined &&
    deps.kvCompareAndSwapField !== undefined;

  if (!durableAgentStorage) {
    console.error(
      '[ai] no durable key-value port with field-keyed conditional writes was injected — ' +
        'agent runs, approvals and checkpoints are isolate-local, will not survive a restart, ' +
        'and cannot be advanced from another isolate.',
    );
  }

  const agentAuditStores: AgentAuditStore[] = [];
  if (config.audit.durable && deps.kvWrite) {
    agentAuditStores.push(
      createKvAgentAuditStore({
        write: deps.kvWrite,
        retentionDays: config.audit.retentionDays,
        onError: (error) =>
          console.error(
            '[ai] durable agent audit write failed:',
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
  }

  const agentStorageOptions =
    deps.kvRead !== undefined &&
    deps.kvReadByPrefix !== undefined &&
    deps.kvCompareAndSwapField !== undefined
      ? {
          read: deps.kvRead,
          readByPrefix: deps.kvReadByPrefix,
          compareAndSwap: deps.kvCompareAndSwapField,
          onCorrupt: (key: string, detail: string) =>
            console.error(`[ai] agent record at ${key} is unreadable: ${detail}`),
        }
      : undefined;

  agentRuntime = createAgentRuntime({
    plane,
    authenticator,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
    // The deterministic tools are contracts with governance attached, not
    // business integrations. A deployment opts into them explicitly; the
    // default is an empty tool registry, because a tool nobody asked for is a
    // capability nobody reviewed.
    tools: readBool(env, 'AGENT_MOCK_TOOLS_ENABLED', false) ? DETERMINISTIC_TOOLS : [],
    ...(agentStorageOptions === undefined
      ? {}
      : {
          runStore: createKvAgentRunStore(agentStorageOptions),
          checkpointStore: createKvAgentCheckpointStore(agentStorageOptions),
          approvalStore: createKvAgentApprovalStore(agentStorageOptions),
        }),
    auditStores: agentAuditStores,
    auditBufferSize: config.audit.bufferSize,
    clock: systemClock,
    ids: systemIdFactory,
  });

  // ── Workflow runtime and production optimization wiring (AI-01 Batch 3B) ──
  //
  // Assembled over the SAME agent runtime and the SAME authenticator, for the
  // same reason the agent runtime is assembled over the same plane: there is one
  // path from a workflow to an agent, and one path from an agent to a model.
  //
  // NO WORKFLOWS ARE REGISTERED HERE. Business workflows are out of this batch's
  // scope and inventing one to populate a console would be exactly the inline
  // production definition the batch forbids. The registry starts empty.

  // DURABLE FINANCIAL EVIDENCE, WHERE THE INFRASTRUCTURE EXISTS.
  //
  // The Part 6C key-value store over the same `kv_compare_and_swap_field`
  // contract the agent, workflow and reuse stores already use — no new database
  // technology, no second ledger, no new migration. Without a port the recorder
  // falls back to the isolate-local store, and THAT FACT IS NEVER SILENT: it is
  // logged as an error, it is reported by `optimizationHealth()`, and a
  // deployment that cannot tolerate it sets `AI_FINANCIAL_REQUIRED`.
  const financialStorageOptions =
    deps.kvRead !== undefined &&
    deps.kvReadByPrefix !== undefined &&
    deps.kvCompareAndSwapField !== undefined
      ? {
          read: deps.kvRead,
          readByPrefix: deps.kvReadByPrefix,
          compareAndSwap: deps.kvCompareAndSwapField,
          onCorrupt: (key: string, detail: string) =>
            console.error(`[ai] financial event at ${key} is unreadable: ${detail}`),
        }
      : undefined;

  let financialEventStore: FinancialEventStore | undefined;
  if (config.optimization.financialDurable && financialStorageOptions !== undefined) {
    financialEventStore = createKvFinancialEventStore(financialStorageOptions);
  } else if (config.optimization.financialDurable) {
    console.error(
      '[ai] AI_FINANCIAL_DURABLE is on but no key-value port with field-keyed conditional ' +
        'writes was injected — financial events are isolate-local, will not survive a restart, ' +
        'and no coverage or savings figure computed from them describes the platform.',
    );
    if (config.optimization.financialRequired) {
      // The deployment asked for finance-or-nothing and did not get finance.
      // Refusing at BOOTSTRAP rather than at the first advance is the only place
      // this can fail without a reporting layer holding a veto over a run that
      // already has a child agent spending real money.
      throw new Error(
        '[ai] AI_FINANCIAL_REQUIRED is on and durable financial storage could not be initialised.',
      );
    }
  }

  // THE PART 6B REUSABLE-RESULT STORE, on the same primitives.
  //
  // Assembled only when reuse is switched on AND the ports exist. Supplying it
  // is not the same as permitting reuse: the Part 6B eligibility gate decides
  // every candidate, the kill switch is posture evidence it reads, and a
  // deployment that seals no results gets truthful misses.
  let reusableResultStore: ReusableResultStore | undefined;
  if (config.optimization.exactReuseEnabled && financialStorageOptions !== undefined) {
    reusableResultStore = createKvReusableResultStore(financialStorageOptions);
  } else if (config.optimization.exactReuseEnabled) {
    console.error(
      '[ai] AI_REUSE_EXACT_ENABLED is on but no durable key-value port was injected — ' +
        'reuse is unavailable and every node will execute and pay.',
    );
  }

  const workflowStorageOptions = financialStorageOptions;

  workflowRuntime = createWorkflowRuntime({
    agentRuntime,
    authenticator,
    organizationOptions: {
      defaultOrganizationId: config.defaultOrganizationId,
      allowList: config.organizationAllowList,
      allowDefaultOrganization: config.allowDefaultOrganization,
    },
    ...(workflowStorageOptions === undefined
      ? {}
      : {
          runStore: createKvWorkflowRunStore(workflowStorageOptions),
          checkpointStore: createKvWorkflowCheckpointStore(workflowStorageOptions),
          approvalStore: createKvWorkflowApprovalStore(workflowStorageOptions),
        }),
    ...(financialEventStore === undefined ? {} : { financialEventStore }),
    financialDurableConfigured: config.optimization.financialDurable,
    ...(reusableResultStore === undefined ? {} : { reusableResultStore }),
    reuseEnabled: () => config.optimization.exactReuseEnabled,
    // NO SEMANTIC DISCOVERY PORT. This repository ships no certified embedding
    // or retrieval path, and adding one to decide whether a model call can be
    // avoided would create a second, ungoverned AI execution path. The switch is
    // passed through as a DECLARED INTENT so the health read can report the
    // difference between "asked for" and "available" truthfully.
    semanticReuseConfigured: config.optimization.semanticReuseEnabled,
    reuseMaxAgeMs: config.optimization.reuseMaxAgeMs,
    reuseMinimumSimilarity: config.optimization.reuseMinimumSimilarity,
    reuseMaximumCandidates: config.optimization.reuseMaximumCandidates,
    clock: systemClock,
    ids: systemIdFactory,
    logger: plane.logger,
  });

  return plane;
}

/** The initialised agent runtime, or `undefined` before bootstrap. */
export function getAgentRuntime(): AgentRuntime | undefined {
  return agentRuntime;
}

/** The initialised workflow runtime, or `undefined` before bootstrap. */
export function getWorkflowRuntime(): WorkflowRuntime | undefined {
  return workflowRuntime;
}

/** The initialised plane, or `undefined` before bootstrap. */
export function getControlPlane(): AIControlPlane | undefined {
  return plane;
}

/** The initialised administration service, or `undefined` before bootstrap. */
export function getAIAdministration(): AIAdministration | undefined {
  return administration;
}

/** Drop the memoised plane. Test and local-tooling use only. */
export function resetControlPlaneForTests(): void {
  plane = undefined;
  administration = undefined;
  agentRuntime = undefined;
  workflowRuntime = undefined;
}
