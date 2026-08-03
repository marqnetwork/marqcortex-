/**
 * MARQ Cortex AI Control Plane — public surface.
 *
 * Server code imports from here, never from a module's internal path. That
 * keeps the plane's internals free to change and makes "is anything bypassing
 * the control plane?" answerable by grepping for imports that reach past this
 * file into `ai/providers/` or `ai/pipeline/`.
 *
 * ARCHITECTURE (Batch 1, AI-01)
 *
 *   HTTP route
 *     → httpAdapter          framework-agnostic request/response mapping
 *       → controlPlane.execute
 *         → AI Guard         contract version, feature, payload size,
 *                            authentication, organization, actor, body
 *                            validation, rate limiting
 *         → Policy Engine    feature enablement, actor type, channel,
 *                            capability, budget
 *         → Pipeline         prompt render → input guard → provider select →
 *                            invoke (timeout, retry, circuit, failover) →
 *                            output guard → parse → fact lock
 *         → Accounting       budget charge from measured token usage
 *         → Observability    audit record, metrics, structured log, events
 *
 * Every AI capability executes through exactly this path. There is no bypass
 * flag, no legacy route and no direct provider access outside `ai/providers/`.
 */

// ── Entry points ────────────────────────────────────────────────────────────
export { createControlPlane, type AIControlPlane, type ControlPlaneOptions } from './controlPlane.ts';
export {
  initializeControlPlane,
  getControlPlane,
  resetControlPlaneForTests,
  type BootstrapDependencies,
} from './bootstrap.ts';
export {
  executeAIHttpRequest,
  correlationIdFromHeaders,
  type AIHttpRequest,
  type AIHttpResponse,
} from './http/httpAdapter.ts';

// ── Contracts ───────────────────────────────────────────────────────────────
export {
  PLATFORM_VERSION,
  CONTRACT_VERSION,
  SUPPORTED_CONTRACT_VERSIONS,
  isSupportedContractVersion,
} from './contracts/versions.ts';
export { AIError, isAIError, toAIError, type AIErrorCode } from './contracts/errors.ts';
export type {
  AIActor,
  AIChannel,
  AIExecutionResult,
  AIOrganization,
  AIRequestContext,
  AIRequestEnvelope,
  AIRequestTransport,
} from './contracts/request.ts';
export type { AIEvent, AIEventBus, AIEventName } from './contracts/events.ts';
export type { AIFeatureDescriptor, AICapability } from './contracts/policy.ts';
export type { AIProviderAdapter, AIProviderHealth } from './contracts/provider.ts';

// ── Features ────────────────────────────────────────────────────────────────
export {
  FEATURE,
  registerCortexFeatures,
  sanitizeAnalysis,
  NARRATIVE_TYPES,
  BLOCK_ACTIONS,
  REFERENCE_BLOCK_TYPE,
  COPILOT_INTENTS,
  SECTION_KEYS,
  SECTION_ACTIONS,
  LOCKED_FIELDS_BY_SECTION,
  type CortexFeatureId,
  type NarrativeOutput,
  type AnalysisOutput,
  type ChatOutput,
  type BlockAssistOutput,
  type CopilotPlanOutput,
  type SectionCopilotOutput,
} from './features/index.ts';

// ── Governance primitives, reusable by future AI capabilities ───────────────
export { enforceFactLock } from './governance/factLock.ts';
export { redact, containsPII, type PIICategory } from './governance/redaction.ts';
export { sha256Hex, promptFingerprint } from './prompts/hash.ts';

// ── Adapters, for edge wiring ───────────────────────────────────────────────
export {
  createSupabaseAuthenticator,
  denyAllAuthenticator,
  type AuthUser,
  type MembershipLookup,
  type UserLookup,
} from './adapters/supabaseAuthenticator.ts';
export { createKvAuditStore, auditKeyFor, type KvWriter } from './adapters/kvAuditStore.ts';

// ── Observability contracts ─────────────────────────────────────────────────
export type { AIAuditRecord, AuditStore } from './observability/audit.ts';
export type { ControlPlaneHealth } from './observability/health.ts';
export type { MetricsSnapshot } from './observability/metrics.ts';

// ── Test seams ──────────────────────────────────────────────────────────────
export { createTestClock, systemClock, type Clock, type MutableClock } from './runtime/clock.ts';
export { recordEnv, runtimeEnv, type EnvSource } from './runtime/env.ts';
export { loadControlPlaneConfig, type AIControlPlaneConfig } from './runtime/config.ts';
export { createSequentialIdFactory, systemIdFactory, type IdFactory } from './contracts/ids.ts';
export {
  createMockProvider,
  type MockProviderHandle,
  type MockScenario,
} from './providers/mockProvider.ts';
export { createOpenAIProvider, type FetchLike } from './providers/openaiProvider.ts';
export { createAnthropicProvider } from './providers/anthropicProvider.ts';
export { createMemorySink, type LogSink } from './observability/logger.ts';
