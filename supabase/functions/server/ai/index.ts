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
  getAIAdministration,
  getAgentRuntime,
  getWorkflowRuntime,
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

// ── Administration (AI-01 Batch 2) ──────────────────────────────────────────
//
// The operational layer over the plane: RBAC, settings, provider and budget
// management, usage analytics, diagnostics and the administrative change trail.
// It administers the plane through the plane's own surfaces — it is not a
// second way to execute AI, and nothing here can reach a provider.
export {
  createAIAdministration,
  MAX_ADMIN_SPEND_CAP_MICRO_USD,
  type AIAdministration,
  type AdminBudgetView,
  type AdminDiagnostics,
  type AdminOverview,
  type AdminProviderView,
  type AdminRequestMeta,
  type AdministrationDependencies,
} from './admin/administration.ts';
export {
  ADMIN_ROLE_CAPABILITIES,
  resolveAdminActor,
  resolveAdminRole,
  hasCapability,
  // Re-exported under an unambiguous name for the AI observability routes,
  // which authorise against the administration capability model (AI-01 Batch
  // 4C security follow-up). `hasCapability` alone reads as a generic in a route
  // file that also handles workflow and agent authority.
  hasCapability as hasAIAdminCapability,
  type AIAdminActor,
  type AIAdminCapability,
  type AIAdminRole,
} from './admin/rbac.ts';
// ── Provider administration (AI-01 Batch 4C) ────────────────────────────────
//
// The read models only. `createProviderAdministration` is deliberately NOT
// exported: the service is assembled inside `createAIAdministration`, over the
// same audited-mutation runner and the same trail, and a second construction
// site would be a second place for those to be forgotten.
export type {
  CredentialManagement,
  ProviderAdministrationSummary,
  ProviderAdministrationView,
  ProviderCredentialView,
  ProviderModelView,
} from './admin/providerAdministration.ts';
export {
  createMemoryProviderAdministrationStore,
  type AIProviderConfigurationRecord,
  type AIProviderModelRecord,
  type AIProviderScope,
  type ProviderAdministrationStore,
  type ProviderCredentialMetadata,
  type StoredProviderCredential,
} from './providers/credentials/credentialStore.ts';
export {
  createSecretCipher,
  parseRootKey,
  safeLastFour,
  unavailableSecretCipher,
  CREDENTIAL_ROOT_KEY_ENV,
  type SealedSecret,
  type SecretCipher,
} from './providers/credentials/secretCipher.ts';
export {
  createProviderCredentialResolver,
  createEnvironmentCredentialResolver,
  DEFAULT_CREDENTIAL_SNAPSHOT_TTL_MS,
  type CredentialProviderProfile,
} from './providers/credentials/resolver.ts';
export type {
  AICredentialSource,
  ProviderCredentialAvailability,
  ProviderCredentialResolver,
} from './providers/credentials/contracts.ts';
export {
  exposureReport,
  featureExposure,
  judgeExposureChange,
  type ExposureCatalogueEntry,
  type ExposureReport,
  type ExposureVerdict,
} from './policy/exposure.ts';
export {
  ADMIN_OPERATION,
  executeAdminHttpRequest,
  type AdminHttpRequest,
  type AdminHttpResponse,
  type AdminOperation,
} from './admin/httpAdapter.ts';
export {
  ADMIN_ACTION,
  type AdminAction,
  type AdminAuditRecord,
  type AdminAuditStore,
} from './admin/adminAudit.ts';
export {
  createMemorySettingsStore,
  parseStoredSettings,
  type AdminSettingsStore,
} from './admin/settingsStore.ts';
export { buildUsageReport, type UsageReport } from './admin/usage.ts';
export {
  baselineSettings,
  effectivePreference,
  effectiveRealRequestsEnabled,
  normalizeOperationalSettings,
  SETTINGS_BOUNDS,
  type AIOperationalSettings,
  type AIOperationalSettingsPatch,
} from './runtime/operationalSettings.ts';
export {
  ADMIN_SETTINGS_KEY,
  adminAuditKeyFor,
  createKvAdminAuditStore,
  createKvAdminSettingsStore,
} from './adapters/kvAdminStores.ts';

// ── Agent Runtime (AI-01 Batch 3A) ──────────────────────────────────────────
//
// The controlled execution foundation for agents, multi-agent handoffs, tools,
// approvals and workflows. It is NOT a second AI execution path: every model
// step it takes goes through `controlPlane.execute`, with the same guard,
// policy engine, governance, spend ceiling and audit trail every other
// feature gets. What it adds is the layer above — registry, state machine,
// orchestrator, limits, ledgers, approvals and durable runs.
//
//   AGENTS PROPOSE. THE ORCHESTRATOR DECIDES. THE CONTROL PLANE EXECUTES.
export {
  createAgentRuntime,
  AGENT_SPEND_SCOPE,
  type AgentRuntime,
  type AgentRuntimeOptions,
} from './agents/agentRuntime.ts';
export {
  createAgentRegistry,
  validateDefinition,
  type AgentRegistry,
} from './agents/registry/agentRegistry.ts';
export {
  AGENT_CAPABILITIES,
  AGENT_LIMIT_BOUNDS,
  describeAgent,
  type AgentCapability,
  type AgentDefinition,
  type AgentDescriptor,
  type AgentLimits,
  type AgentObservation,
  type AgentProposalInput,
  type AgentSafetyClass,
} from './agents/contracts/agent.ts';
export {
  ACTION_BOUNDS,
  AGENT_ACTION_TYPES,
  CAPABILITY_FOR_ACTION,
  isAgentActionType,
  type AgentAction,
  type AgentActionProposal,
  type AgentActionType,
  type AgentContextContribution,
} from './agents/contracts/actions.ts';
export {
  AGENT_RUN_STATES,
  APPROVAL_BOUNDS,
  CHECKPOINT_BOUNDS,
  TERMINAL_RUN_STATES,
  isTerminalState,
  type AgentApprovalRequest,
  type AgentCheckpoint,
  type AgentRunContext,
  type AgentRunRecord,
  type AgentRunState,
} from './agents/contracts/runtime.ts';
export {
  AgentRuntimeError,
  agentFailure,
  isAgentRuntimeError,
  isStepRetryable,
  terminalStateFor,
  type AgentFailureCode,
} from './agents/contracts/failures.ts';
export {
  ACTIVE_STATES,
  OPERATION_TARGETS,
  PAUSABLE_STATES,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from './agents/runtime/stateMachine.ts';
export {
  createModelProfileRegistry,
  routeModelProfile,
  indicativeCostMicroUsd,
  type ModelProfile,
  type ModelProfileRegistry,
  type RoutingOutcome,
} from './agents/runtime/modelRouting.ts';
export {
  AGENT_MODEL_PROFILE,
  DEFAULT_MODEL_PROFILES,
} from './agents/runtime/defaultProfiles.ts';
export { buildContext, compressContext, type BuiltContext } from './agents/runtime/contextBuilder.ts';
export {
  decideCost,
  projectStepCost,
  type CostDecision,
  type CostProjection,
} from './agents/runtime/costPolicy.ts';
export {
  estimateModelStep,
  estimatePromptTokens,
  reconcileUsage,
  tokenPreflight,
} from './agents/runtime/tokenIntelligence.ts';
export {
  checkPreStepLimits,
  checkProposalLimits,
  fingerprintAction,
  recordLoopStep,
} from './agents/runtime/limits.ts';
export { canonicalJson, digestValue } from './agents/runtime/digest.ts';
export {
  createToolGateway,
  createToolRegistry,
  createMemoryToolIdempotencyStore,
  type ToolGateway,
  type ToolRegistry,
} from './agents/tools/toolRegistry.ts';
export {
  DETERMINISTIC_TOOLS,
  DETERMINISTIC_TOOL_IDS,
} from './agents/tools/mockTools.ts';
export type {
  ToolDefinition,
  ToolDescriptor,
  ToolExecutionResult,
} from './agents/contracts/tools.ts';
export type { ToolRiskClass } from './agents/contracts/agent.ts';
export { createApprovalGate, type ApprovalGate } from './agents/approvals/approvalGate.ts';
export {
  createMemoryAgentRunStore,
  createMemoryApprovalStore,
  createMemoryCheckpointStore,
  type AgentApprovalStore,
  type AgentCheckpointStore,
  type AgentRunStore,
} from './agents/persistence/ports.ts';
export {
  createKvAgentApprovalStore,
  createKvAgentCheckpointStore,
  createKvAgentRunStore,
  approvalKeyFor,
  checkpointKeyFor,
  runKeyFor,
  type KvAgentConditionalWriter,
  type KvAgentPrefixReader,
  type KvAgentReader,
} from './agents/persistence/kvAgentStores.ts';
export {
  AGENT_AUDIT_EVENT,
  createKvAgentAuditStore,
  createMemoryAgentAuditStore,
  type AgentAuditRecord,
  type AgentAuditStore,
} from './agents/observability/agentAudit.ts';
export {
  createAgentOrchestrator,
  type AgentOrchestrator,
  type AgentRunActor,
  type AgentRuntimeState,
} from './agents/orchestrator/agentOrchestrator.ts';
export {
  createControlPlaneModelPort,
  type ModelExecutionPort,
  type ModelStepRequest,
  type ModelStepResult,
} from './agents/orchestrator/controlPlaneBridge.ts';
export {
  createAgentRuntimeService,
  toRunDetail,
  toRunSummary,
  type AgentRunDetail,
  type AgentRunSummary,
  type AgentRuntimeOverview,
  type AgentRuntimeService,
} from './agents/service/agentRuntimeService.ts';
export {
  AGENT_ROLE_CAPABILITIES,
  hasAgentCapability,
  resolveAgentActor,
  type AgentRuntimeActor,
  type AgentRuntimeCapability,
} from './agents/service/agentRbac.ts';
export {
  AGENT_OPERATION,
  executeAgentHttpRequest,
  type AgentHttpRequest,
  type AgentHttpResponse,
  type AgentOperation,
} from './agents/http/agentHttpAdapter.ts';

// ── Workflow Runtime (AI-01 Batch 3B) ───────────────────────────────────────
//
// The layer above the agent runtime: a registered, validated graph of agent,
// condition, parallel and approval nodes, driven by a durable state machine.
//
// It is NOT a third execution path. Every node executes as a CHILD AGENT RUN
// through the Agent Orchestrator, on behalf of the same authenticated subject —
// so the agent runtime applies its own RBAC, limits, loop protection, tool
// permissions, spend ceiling and audit trail at every node, and each of those
// model steps still goes through `controlPlane.execute`. What the workflow
// runtime adds is orchestration, data flow, checkpoints, retries and the one
// thing an agent run cannot express: a barrier that waits for a person.
//
// WHAT IS EXPORTED IS THE SERVICE AND ITS HTTP ADAPTER, never the engine. A
// caller that could reach the orchestrator directly would be a caller that
// resolved its own actor — see `service/workflowRbac.ts` for why a workflow
// permission is not an agent permission and cannot become one.
export {
  createWorkflowRuntime,
  type WorkflowRuntime,
  type WorkflowRuntimeOptions,
} from './workflows/workflowRuntime.ts';
export {
  createWorkflowRuntimeService,
  toWorkflowApprovalView,
  toWorkflowRunDetail,
  toWorkflowRunSummary,
  type WorkflowApprovalView,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowRuntimeOverview,
  type WorkflowRuntimeService,
} from './workflows/service/workflowRuntimeService.ts';
export {
  WORKFLOW_ROLE_CAPABILITIES,
  hasWorkflowCapability,
  resolveWorkflowActor,
  type WorkflowRuntimeActor,
  type WorkflowRuntimeCapability,
} from './workflows/service/workflowRbac.ts';
export {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
  type WorkflowHttpResponse,
  type WorkflowOperation,
} from './workflows/http/workflowHttpAdapter.ts';
export {
  WORKFLOW_RUN_STATES,
  TERMINAL_WORKFLOW_STATES,
  isTerminalWorkflowState,
  type WorkflowRunState,
  type WorkflowStepRecord,
} from './workflows/contracts/run.ts';
export { ACTIVE_WORKFLOW_STATES } from './workflows/runtime/workflowStateMachine.ts';
export {
  isWorkflowError,
  workflowFailure,
  WorkflowError,
  type WorkflowFailureCode,
} from './workflows/contracts/failures.ts';
export type { WorkflowDescriptor } from './workflows/contracts/workflow.ts';
export type {
  WorkflowApprovalDecision,
  WorkflowApprovalSubjectEvidence,
  WorkflowPendingApproval,
} from './workflows/contracts/approval.ts';

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
