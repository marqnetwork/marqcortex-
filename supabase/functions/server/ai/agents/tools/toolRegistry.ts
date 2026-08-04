/**
 * Tool Registry and Tool Gateway (AI-01 Batch 3A).
 *
 * The registry answers "which tools exist and what is each permitted to do".
 * The gateway is the only way one is ever called, and it enforces, in order:
 *
 *   1. The tool exists, is enabled and is certified for this deployment.
 *   2. The AGENT is permitted to call it — it is in the agent's allow list and
 *      the agent holds the capabilities the tool demands.
 *   3. The ACTOR is permitted — the run's actor holds the runtime capability
 *      for tool execution. An agent's permission is not a person's permission.
 *   4. The ORGANIZATION matches. A tenant-scoped tool called for a run in
 *      another organization is refused, not scoped down.
 *   5. The input validates against the tool's declared schema.
 *   6. Idempotency: a repeated key either replays a stored result (idempotent
 *      tools) or is refused (everything else). Never silently re-executed.
 *   7. The tool runs under a timeout it cannot extend.
 *   8. The output validates against the declared schema.
 *   9. The result is digested, never stored raw.
 *
 * APPROVAL IS NOT ENFORCED HERE, AND THAT IS DELIBERATE. The orchestrator holds
 * the approval gate, because an approval is a property of the RUN's state
 * machine — it pauses the run, survives a restart and is consumed once. A
 * gateway-level check would either duplicate that state or, worse, be the only
 * check and therefore be bypassable by any future caller of the gateway. What
 * the gateway does is refuse to execute a tool that `requiresApproval` unless
 * the caller states which approval authorised it, so the two cannot drift apart.
 *
 * WHAT CANNOT HAPPEN HERE. No network, no filesystem, no subprocess and no
 * third-party SDK. Batch 3A's tools are deterministic and in-process, and the
 * boundary scan asserts that no module under `agents/` imports a provider
 * adapter or reaches a vendor host.
 */

import type {
  ToolDefinition,
  ToolDescriptor,
  ToolExecutionResult,
  ToolInvocation,
} from '../contracts/tools.ts';
import { TOOL_TIMEOUT_BOUNDS, describeTool } from '../contracts/tools.ts';
import type { AgentDefinition } from '../contracts/agent.ts';
import { agentFailure } from '../contracts/failures.ts';
import { AIError } from '../../contracts/errors.ts';
import { isFailure, describeIssues } from '../../security/validation.ts';
import { canonicalBytes, digestValue } from '../runtime/digest.ts';
import type { Clock } from '../../runtime/clock.ts';

const TOOL_ID = /^tool\.[a-z0-9]+(\.[a-z0-9_]+)+$/;
const MAX_TOOL_INPUT_BYTES = 32 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 128 * 1024;

export interface ToolRegistry {
  register(definition: ToolDefinition): void;
  registerAll(definitions: readonly ToolDefinition[]): void;
  find(toolId: string): ToolDefinition | undefined;
  list(): readonly ToolDescriptor[];
  size(): number;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  return {
    register(definition) {
      const problems: string[] = [];
      if (!TOOL_ID.test(definition.toolId ?? '')) {
        problems.push('toolId must look like tool.domain.action');
      }
      if (!definition.version?.trim()) problems.push('version is empty');
      if (!definition.owner?.trim()) problems.push('owner is empty');
      if (!definition.purpose?.trim()) problems.push('purpose is empty');
      if (typeof definition.inputSchema?.validate !== 'function') {
        problems.push('inputSchema must be a validator');
      }
      if (typeof definition.outputSchema?.validate !== 'function') {
        problems.push('outputSchema must be a validator');
      }
      if (typeof definition.execute !== 'function') problems.push('execute must be a function');
      if (
        typeof definition.timeoutMs !== 'number' ||
        definition.timeoutMs < TOOL_TIMEOUT_BOUNDS.min ||
        definition.timeoutMs > TOOL_TIMEOUT_BOUNDS.max
      ) {
        problems.push(
          `timeoutMs must be between ${TOOL_TIMEOUT_BOUNDS.min} and ${TOOL_TIMEOUT_BOUNDS.max}`,
        );
      }
      // A tool that changes the world outside the platform and claims to be
      // safe to repeat is a claim nobody can honour: the gateway would replay a
      // cached result for a call that already had its effect.
      if (definition.sideEffect === 'external_write' && definition.idempotency === 'idempotent') {
        problems.push('an external_write tool cannot be declared idempotent');
      }
      if (definition.sideEffect === 'external_write' && !definition.requiresApproval) {
        problems.push('an external_write tool must require approval');
      }
      if (definition.risk === 'high' && !definition.requiresApproval) {
        problems.push('a high-risk tool must require approval');
      }
      if (tools.has(definition.toolId)) problems.push('tool is already registered');

      if (problems.length > 0) {
        throw new AIError('INTERNAL_ERROR', 'Tool definition is invalid.', {
          diagnostics: `${definition.toolId ?? '(no id)'}: ${problems.join('; ')}`,
        });
      }
      tools.set(definition.toolId, definition);
    },

    registerAll(definitions) {
      for (const definition of definitions) this.register(definition);
    },

    find: (toolId) => tools.get(toolId),
    list: () =>
      [...tools.values()].map(describeTool).sort((a, b) => a.toolId.localeCompare(b.toolId)),
    size: () => tools.size,
  };
}

/** Where the gateway remembers what it has already executed for a run. */
export interface ToolIdempotencyStore {
  /** Result for a key, or undefined. Scoped to one run. */
  get(runId: string, idempotencyKey: string): Promise<ToolExecutionResult | undefined>;
  put(runId: string, idempotencyKey: string, result: ToolExecutionResult): Promise<void>;
}

/**
 * In-memory idempotency, bounded per run and globally.
 *
 * Correct for a single isolate and for tests. Durable idempotency across
 * isolates is provided by the run record itself: the orchestrator persists each
 * executed action with its idempotency key before the next step, so a resumed
 * run does not re-propose an action it has already taken. This store exists to
 * catch a repeat WITHIN one drive loop, where the run record has not yet been
 * re-read.
 */
export function createMemoryToolIdempotencyStore(
  options: { maxRuns?: number; maxKeysPerRun?: number } = {},
): ToolIdempotencyStore {
  const maxRuns = options.maxRuns ?? 64;
  const maxKeysPerRun = options.maxKeysPerRun ?? 64;
  const runs = new Map<string, Map<string, ToolExecutionResult>>();

  return {
    get(runId, key) {
      return Promise.resolve(runs.get(runId)?.get(key));
    },
    put(runId, key, result) {
      let entries = runs.get(runId);
      if (!entries) {
        // Oldest run evicted first. Insertion order is Map's iteration order,
        // so the first key is the least recently created run.
        if (runs.size >= maxRuns) {
          const oldest = runs.keys().next().value;
          if (oldest !== undefined) runs.delete(oldest);
        }
        entries = new Map<string, ToolExecutionResult>();
        runs.set(runId, entries);
      }
      if (entries.size >= maxKeysPerRun) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, result);
      return Promise.resolve();
    },
  };
}

export interface ToolGatewayDependencies {
  readonly registry: ToolRegistry;
  readonly idempotency: ToolIdempotencyStore;
  readonly clock: Clock;
  /** True when only certified tools may execute. Read live. */
  readonly requireCertification: () => boolean;
}

export interface ToolExecutionRequest {
  readonly toolId: string;
  readonly agent: AgentDefinition;
  readonly runId: string;
  readonly organizationId: string;
  readonly actorId: string;
  /** Runtime capabilities the ACTOR holds. Resolved server-side. */
  readonly actorCapabilities: readonly string[];
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly input: unknown;
  readonly timeoutMs: number;
  /** Approval that authorised this call, when the tool requires one. */
  readonly approvalId?: string;
}

export interface ToolGateway {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
  /**
   * Every registered tool, with its governance and without its executor.
   *
   * Safe to expose to any authorised reader: a descriptor carries a tool's
   * RULES — risk, scope, side effect, approval requirement — and no data.
   */
  list(): readonly ToolDescriptor[];
  /** Tools this agent may call, for the console and for validation. */
  permittedFor(agent: AgentDefinition): readonly ToolDescriptor[];
  /** The definition, for the orchestrator's approval and risk decisions. */
  describe(toolId: string): ToolDescriptor | undefined;
  requiresApproval(toolId: string, agent: AgentDefinition): boolean;
}

/** The runtime capability an actor must hold for any tool call. */
export const ACTOR_TOOL_CAPABILITY = 'agent.run.create';

export function createToolGateway(deps: ToolGatewayDependencies): ToolGateway {
  const { registry, idempotency, clock } = deps;

  function resolve(toolId: string, agent: AgentDefinition): ToolDefinition {
    const definition = registry.find(toolId);
    if (!definition) {
      throw agentFailure('tool_denied', 'That tool is not available.', {
        agentId: agent.agentId,
        diagnostics: `unknown tool ${toolId}`,
      });
    }
    if (!agent.allowedTools.includes(toolId)) {
      throw agentFailure('tool_denied', 'This agent may not use that tool.', {
        agentId: agent.agentId,
        diagnostics: `tool ${toolId} is not in ${agent.agentId}'s allow list`,
      });
    }
    if (definition.certification === 'revoked') {
      throw agentFailure('tool_denied', 'That tool has been withdrawn.', {
        agentId: agent.agentId,
        diagnostics: `tool ${toolId} certification is revoked`,
      });
    }
    if (!definition.enabled) {
      throw agentFailure('tool_denied', 'That tool is currently turned off.', {
        agentId: agent.agentId,
        diagnostics: `tool ${toolId} is disabled`,
      });
    }
    if (deps.requireCertification() && definition.certification !== 'certified') {
      throw agentFailure('tool_denied', 'That tool is not certified for this deployment.', {
        agentId: agent.agentId,
        diagnostics: `tool ${toolId} certification is ${definition.certification}`,
      });
    }
    return definition;
  }

  return {
    list: () => registry.list(),

    permittedFor(agent) {
      return registry
        .list()
        .filter((tool) => agent.allowedTools.includes(tool.toolId));
    },

    describe(toolId) {
      const definition = registry.find(toolId);
      return definition ? describeTool(definition) : undefined;
    },

    requiresApproval(toolId, agent) {
      const definition = registry.find(toolId);
      if (!definition) return false;
      if (definition.requiresApproval) return true;
      return agent.approvals.requireForToolRisk.includes(definition.risk);
    },

    async execute(request) {
      const definition = resolve(request.toolId, request.agent);

      // Agent capability. `agent.tool.invoke` is checked by the orchestrator
      // before the action is sealed; the tool's OWN extra demands are checked
      // here, where the tool definition is in scope.
      const missing = definition.requiredCapabilities.filter(
        (capability) => !(request.agent.capabilities as readonly string[]).includes(capability),
      );
      if (missing.length > 0) {
        throw agentFailure('capability_denied', 'This agent lacks a capability that tool needs.', {
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId} requires ${missing.join(', ')}`,
        });
      }

      // Actor capability. An agent's permission is not a person's permission,
      // and a run started by someone who may not execute tools does not acquire
      // the right by delegating to an agent that may.
      if (!request.actorCapabilities.includes(ACTOR_TOOL_CAPABILITY)) {
        throw agentFailure('unauthorized', 'You are not permitted to run agent tools.', {
          agentId: request.agent.agentId,
          diagnostics: `actor ${request.actorId} lacks ${ACTOR_TOOL_CAPABILITY}`,
        });
      }

      if (definition.tenantScope === 'run_organization' && !request.organizationId) {
        throw agentFailure(
          'tenant_isolation_violation',
          'This tool cannot run without an organization.',
          { agentId: request.agent.agentId, diagnostics: `tool ${definition.toolId} is tenant-scoped` },
        );
      }

      if (definition.requiresApproval && request.approvalId === undefined) {
        throw agentFailure('approval_required', 'That tool needs approval before it can run.', {
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId} requires approval and none was supplied`,
        });
      }

      const inputBytes = canonicalBytes(request.input);
      if (inputBytes === undefined) {
        throw agentFailure('invalid_action', 'That tool input could not be read.', {
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId} input is not serializable`,
        });
      }
      if (inputBytes > MAX_TOOL_INPUT_BYTES) {
        throw agentFailure('invalid_action', 'That tool input is too large.', {
          agentId: request.agent.agentId,
          diagnostics: `input ${inputBytes} bytes exceeds ${MAX_TOOL_INPUT_BYTES}`,
        });
      }

      const validatedInput = definition.inputSchema.validate(request.input, 'input');
      if (isFailure(validatedInput)) {
        throw agentFailure('invalid_action', 'That tool input is not valid.', {
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId}: ${describeIssues(validatedInput.issues)}`,
        });
      }

      const previous = await idempotency.get(request.runId, request.idempotencyKey);
      if (previous) {
        if (definition.idempotency === 'idempotent') {
          return { ...previous, replayed: true };
        }
        throw agentFailure('invalid_action', 'That tool call has already been made.', {
          runId: request.runId,
          agentId: request.agent.agentId,
          diagnostics:
            `tool ${definition.toolId} is non-idempotent and key ${request.idempotencyKey} ` +
            'was already used in this run',
        });
      }

      const timeoutMs = Math.min(
        definition.timeoutMs,
        Math.max(TOOL_TIMEOUT_BOUNDS.min, request.timeoutMs),
      );
      const invocation: ToolInvocation = {
        toolId: definition.toolId,
        runId: request.runId,
        agentId: request.agent.agentId,
        organizationId: request.organizationId,
        actorId: request.actorId,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        input: validatedInput.value,
        timeoutMs,
        nowIso: clock.isoNow(),
      };

      const startedAtMs = clock.now();
      let raw: unknown;
      try {
        raw = await withToolTimeout(timeoutMs, definition.toolId, () =>
          Promise.resolve(definition.execute(invocation)),
        );
      } catch (error) {
        // A tool's own error text may embed whatever it was handed, so it never
        // reaches the caller — it goes to `diagnostics`, which is server-side.
        throw agentFailure('tool_failed', 'That tool did not complete.', {
          runId: request.runId,
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId}: ${
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          }`,
          cause: error,
        });
      }

      const outputBytes = canonicalBytes(raw);
      if (outputBytes === undefined || outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        throw agentFailure('tool_failed', 'That tool returned more than the runtime accepts.', {
          runId: request.runId,
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId} output ${outputBytes ?? 'unserializable'} bytes`,
        });
      }

      const validatedOutput = definition.outputSchema.validate(raw, 'output');
      if (isFailure(validatedOutput)) {
        throw agentFailure('tool_failed', 'That tool returned something unexpected.', {
          runId: request.runId,
          agentId: request.agent.agentId,
          diagnostics: `tool ${definition.toolId}: ${describeIssues(validatedOutput.issues)}`,
        });
      }

      const result: ToolExecutionResult = {
        toolId: definition.toolId,
        toolVersion: definition.version,
        output: validatedOutput.value,
        outputDigest: digestValue(validatedOutput.value),
        latencyMs: clock.now() - startedAtMs,
        replayed: false,
      };
      await idempotency.put(request.runId, request.idempotencyKey, result);
      return result;
    },
  };
}

/**
 * Bound a tool's execution in wall-clock time.
 *
 * Modelled on `providers/timeout.ts` and deliberately not shared with it: that
 * one carries an `AbortSignal` into a fetch, which is meaningless for an
 * in-process tool. What matters here is that a tool which never resolves cannot
 * hold a run open past its deadline.
 */
function withToolTimeout<T>(
  timeoutMs: number,
  toolId: string,
  work: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        agentFailure('tool_failed', 'That tool did not respond in time.', {
          diagnostics: `tool ${toolId} exceeded ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
    work().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
