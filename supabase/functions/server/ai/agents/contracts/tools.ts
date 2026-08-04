/**
 * Tool contracts (AI-01 Batch 3A).
 *
 * A tool is the only way an agent can affect anything outside a model call, so
 * a tool definition is a security document before it is a capability document.
 * Every field below exists because a reviewer asked a question about it:
 *
 *   risk / sideEffect   What happens if this runs when it should not have?
 *   tenantScope         Can this reach data belonging to somebody else?
 *   idempotency         Is running it twice the same as running it once?
 *   approval            Does a human decide before it runs?
 *   certification       Has anyone actually reviewed it?
 *
 * BATCH 3A SCOPE. Deterministic, in-process tools only. There is no HTTP
 * client, no shell, no filesystem and no third-party SDK anywhere behind this
 * interface, and the boundary scan asserts that. The contract is shaped for the
 * external tools that come later; the implementations that exist today cannot
 * leave the isolate.
 */

import type { Validator } from '../../security/validation.ts';
import type { ToolRiskClass } from './agent.ts';

export type ToolSideEffect =
  /** Reads only. Running it twice changes nothing. */
  | 'none'
  /** Writes inside the platform, for this tenant. */
  | 'internal_write'
  /** Causes something to happen outside the platform. */
  | 'external_write';

export type ToolTenantScope =
  /** Operates only on the run's own organization. The default and the safe one. */
  | 'run_organization'
  /** Operates on platform-wide, non-tenant data. */
  | 'platform';

export type ToolIdempotency =
  /** Safe to repeat. The gateway may replay a cached result. */
  | 'idempotent'
  /** Not safe to repeat. The gateway refuses a duplicate idempotency key. */
  | 'non_idempotent';

export type ToolCertificationStatus = 'certified' | 'testing' | 'uncertified' | 'revoked';

/** What the executor receives. Everything in it has already been authorised. */
export interface ToolInvocation {
  readonly toolId: string;
  readonly runId: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** Input already validated against the tool's declared schema. */
  readonly input: unknown;
  /** Milliseconds remaining. An executor that ignores it is stopped anyway. */
  readonly timeoutMs: number;
  /** Deterministic clock reading, so a tool cannot introduce non-determinism. */
  readonly nowIso: string;
}

export type ToolExecutor = (invocation: ToolInvocation) => unknown | Promise<unknown>;

export interface ToolDefinition {
  readonly toolId: string;
  readonly version: string;
  readonly owner: string;
  readonly purpose: string;
  readonly inputSchema: Validator<unknown>;
  readonly outputSchema: Validator<unknown>;
  readonly risk: ToolRiskClass;
  /** Agent capabilities required to call it, beyond `agent.tool.invoke`. */
  readonly requiredCapabilities: readonly string[];
  readonly tenantScope: ToolTenantScope;
  readonly idempotency: ToolIdempotency;
  readonly timeoutMs: number;
  readonly sideEffect: ToolSideEffect;
  /** True when a human must approve each call, regardless of agent policy. */
  readonly requiresApproval: boolean;
  readonly enabled: boolean;
  readonly certification: ToolCertificationStatus;
  readonly execute: ToolExecutor;
}

/** The tool as an API or console may see it. Carries no executor. */
export interface ToolDescriptor {
  readonly toolId: string;
  readonly version: string;
  readonly owner: string;
  readonly purpose: string;
  readonly risk: ToolRiskClass;
  readonly requiredCapabilities: readonly string[];
  readonly tenantScope: ToolTenantScope;
  readonly idempotency: ToolIdempotency;
  readonly timeoutMs: number;
  readonly sideEffect: ToolSideEffect;
  readonly requiresApproval: boolean;
  readonly enabled: boolean;
  readonly certification: ToolCertificationStatus;
}

export function describeTool(definition: ToolDefinition): ToolDescriptor {
  return {
    toolId: definition.toolId,
    version: definition.version,
    owner: definition.owner,
    purpose: definition.purpose,
    risk: definition.risk,
    requiredCapabilities: definition.requiredCapabilities,
    tenantScope: definition.tenantScope,
    idempotency: definition.idempotency,
    timeoutMs: definition.timeoutMs,
    sideEffect: definition.sideEffect,
    requiresApproval: definition.requiresApproval,
    enabled: definition.enabled,
    certification: definition.certification,
  };
}

/** What the gateway returns. The digest is what the audit trail keeps. */
export interface ToolExecutionResult {
  readonly toolId: string;
  readonly toolVersion: string;
  /** Validated output. Bounded by the tool's declared schema. */
  readonly output: unknown;
  readonly outputDigest: string;
  readonly latencyMs: number;
  /** True when the gateway replayed a stored result for a repeated key. */
  readonly replayed: boolean;
}

export const TOOL_TIMEOUT_BOUNDS = { min: 100, max: 60_000 } as const;
