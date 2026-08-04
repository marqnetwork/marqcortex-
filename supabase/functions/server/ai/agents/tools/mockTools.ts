/**
 * Deterministic tools for AI-01 Batch 3A.
 *
 * These are real tools by every rule the gateway enforces — declared schemas,
 * risk class, tenant scope, idempotency, timeout, approval requirement — and
 * they compute their answers from their input and nothing else. No clock beyond
 * the injected one, no randomness, no network, no storage.
 *
 * WHY THEY EXIST AND WHY THEY ARE NOT REGISTERED BY DEFAULT.
 *
 * The batch's scope is the tool CONTRACT and the gateway that enforces it;
 * integrating unrestricted external tools is explicitly out of scope. But a
 * gateway with nothing behind it is untestable, and "we built the enforcement,
 * trust us" is not a claim a review should accept. These three exercise the
 * three cases that matter: a pure read, a tenant-scoped read, and a
 * side-effecting call that cannot run without a human approving it.
 *
 * Production registers them only when a deployment explicitly asks
 * (`AGENT_MOCK_TOOLS_ENABLED`), so a real deployment's tool registry is empty
 * until real tools exist. Tests and the runtime verification script register
 * them directly, against the same gateway production would use.
 */

import type { ToolDefinition } from '../contracts/tools.ts';
import {
  arrayOf,
  int,
  literal,
  object,
  optional,
  str,
  withDefault,
} from '../../security/validation.ts';
import { digestValue } from '../runtime/digest.ts';

const OWNER = 'MARQ Platform Engineering';

/**
 * A pure transformation. Read-only, idempotent, no approval.
 *
 * Summarises a bounded list of statements into counts and a digest. It exists
 * to prove the happy path end to end: schema in, schema out, digest recorded,
 * replay on a repeated key.
 */
export const summarizeTool: ToolDefinition = {
  toolId: 'tool.text.summarize_counts',
  version: '1.0.0',
  owner: OWNER,
  purpose: 'Reduce a bounded list of statements to deterministic counts and a digest.',
  inputSchema: object({
    statements: arrayOf(str({ minLength: 1, maxLength: 2_000 }), { minItems: 1, maxItems: 50 }),
  }),
  outputSchema: object({
    count: int({ min: 0, max: 50 }),
    totalCharacters: int({ min: 0, max: 200_000 }),
    longest: str({ maxLength: 2_000 }),
    digest: str({ maxLength: 64 }),
  }),
  risk: 'read_only',
  requiredCapabilities: [],
  tenantScope: 'run_organization',
  idempotency: 'idempotent',
  timeoutMs: 2_000,
  sideEffect: 'none',
  requiresApproval: false,
  enabled: true,
  certification: 'certified',
  execute: (invocation) => {
    const input = invocation.input as { statements: readonly string[] };
    const longest = input.statements.reduce(
      (best, statement) => (statement.length > best.length ? statement : best),
      '',
    );
    return {
      count: input.statements.length,
      totalCharacters: input.statements.reduce((sum, statement) => sum + statement.length, 0),
      longest,
      digest: digestValue(input.statements),
    };
  },
};

/**
 * A tenant-scoped read against a fixed fixture.
 *
 * Answers only for the organization the run belongs to — the invocation carries
 * the resolved organization, and the tool keys its lookup by it rather than by
 * anything in the input. That is the shape every real tenant-scoped tool must
 * take: the scope comes from the runtime, never from the agent's payload.
 */
export const lookupTool: ToolDefinition = {
  toolId: 'tool.registry.lookup_profile',
  version: '1.0.0',
  owner: OWNER,
  purpose: 'Read a bounded, tenant-scoped record for the organization the run belongs to.',
  inputSchema: object({
    recordKey: str({ minLength: 1, maxLength: 64, pattern: /^[a-z0-9_.-]+$/i }),
  }),
  outputSchema: object({
    organizationId: str({ maxLength: 64 }),
    recordKey: str({ maxLength: 64 }),
    found: literal(['yes', 'no']),
    value: optional(str({ maxLength: 500 })),
  }),
  risk: 'low',
  requiredCapabilities: [],
  tenantScope: 'run_organization',
  idempotency: 'idempotent',
  timeoutMs: 2_000,
  sideEffect: 'none',
  requiresApproval: false,
  enabled: true,
  certification: 'certified',
  execute: (invocation) => {
    const input = invocation.input as { recordKey: string };
    // The fixture is keyed by organization AND record, so a run in one tenant
    // cannot read another's row even by guessing the key.
    const fixture: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      acme: { readiness: 'stage-3', segment: 'manufacturing' },
      globex: { readiness: 'stage-1', segment: 'logistics' },
    };
    const value = fixture[invocation.organizationId]?.[input.recordKey];
    return {
      organizationId: invocation.organizationId,
      recordKey: input.recordKey,
      found: value === undefined ? 'no' : 'yes',
      ...(value === undefined ? {} : { value }),
    };
  },
};

/**
 * A side-effecting call that cannot run without an approval.
 *
 * It writes nothing real — it returns a receipt describing what it would have
 * written — but it is declared `internal_write`, `non_idempotent`, `moderate`
 * risk and `requiresApproval`, so the gateway and the orchestrator treat it
 * exactly as they will treat the first real one. The approval gate, the
 * single-use consumption and the duplicate-key refusal are all exercised
 * through it.
 */
export const recordNoteTool: ToolDefinition = {
  toolId: 'tool.workspace.record_note',
  version: '1.0.0',
  owner: OWNER,
  purpose: 'Record a bounded note against the run. Requires human approval.',
  inputSchema: object({
    subject: str({ minLength: 1, maxLength: 120 }),
    body: str({ minLength: 1, maxLength: 2_000 }),
    visibility: withDefault(literal(['internal', 'shared']), 'internal'),
  }),
  outputSchema: object({
    receiptId: str({ maxLength: 64 }),
    organizationId: str({ maxLength: 64 }),
    recordedAt: str({ maxLength: 40 }),
    subject: str({ maxLength: 120 }),
    visibility: literal(['internal', 'shared']),
  }),
  risk: 'moderate',
  requiredCapabilities: [],
  tenantScope: 'run_organization',
  idempotency: 'non_idempotent',
  timeoutMs: 3_000,
  sideEffect: 'internal_write',
  requiresApproval: true,
  enabled: true,
  certification: 'certified',
  execute: (invocation) => {
    const input = invocation.input as {
      subject: string;
      body: string;
      visibility: 'internal' | 'shared';
    };
    return {
      // Derived from the idempotency key rather than minted, so the receipt is
      // reproducible in a test without a random source.
      receiptId: digestValue(`${invocation.runId}|${invocation.idempotencyKey}`),
      organizationId: invocation.organizationId,
      recordedAt: invocation.nowIso,
      subject: input.subject,
      visibility: input.visibility,
    };
  },
};

/** Every deterministic tool this batch ships, in registration order. */
export const DETERMINISTIC_TOOLS: readonly ToolDefinition[] = [
  summarizeTool,
  lookupTool,
  recordNoteTool,
];

export const DETERMINISTIC_TOOL_IDS = {
  summarize: summarizeTool.toolId,
  lookup: lookupTool.toolId,
  recordNote: recordNoteTool.toolId,
} as const;
