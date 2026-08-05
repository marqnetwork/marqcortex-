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
  type AIAdminActor,
  type AIAdminCapability,
  type AIAdminRole,
} from './admin/rbac.ts';
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

// ── Workflow engine (AI-01 Batch 3B) ────────────────────────────────────────
//
// Durable, deterministic, cost-aware plan execution over the certified Batch 3A
// agent runtime. It is NOT a third AI execution path: every model node goes
// through `controlPlane.execute`, every agent node through the Batch 3A
// orchestrator, and every tool node through the Batch 3A gateway — with the same
// guard, policy engine, governance, spend ceiling, tool claims and audit trail.
// What it adds is the layer above: registry, planner, state machine,
// orchestrator, joins, token optimization, model-profile routing, cost
// optimization, a safe cache, avoided-call accounting and financial attribution.
//
//   WORKFLOWS PLAN. AGENTS PROPOSE. THE ORCHESTRATOR DECIDES.
//   THE AI CONTROL PLANE EXECUTES.
export {
  createWorkflowRuntime,
  WORKFLOW_SPEND_SCOPE,
  type WorkflowRuntime,
  type WorkflowRuntimeOptions,
} from './workflows/workflowRuntime.ts';
export {
  createWorkflowRegistry,
  validateWorkflowDefinition,
  type WorkflowRegistry,
} from './workflows/registry/workflowRegistry.ts';
export {
  PLATFORM_PLAN_BOUNDS,
  SIDE_EFFECTING_NODE_TYPES,
  TERMINAL_NODE_TYPES,
  WORKFLOW_LIMIT_BOUNDS,
  WORKFLOW_NODE_TYPES,
  describeWorkflow,
  isWorkflowNodeType,
  type WorkflowDefinition,
  type WorkflowDescriptor,
  type WorkflowEdge,
  type WorkflowLimits,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowSafetyClass,
} from './workflows/contracts/workflow.ts';
export {
  TERMINAL_WORKFLOW_STATES,
  WORKFLOW_APPROVAL_BOUNDS,
  WORKFLOW_CHECKPOINT_BOUNDS,
  WORKFLOW_HISTORY_BOUNDS,
  WORKFLOW_RUN_STATES,
  isTerminalWorkflowState,
  type WorkflowApprovalRequest,
  type WorkflowCheckpoint,
  type WorkflowRunContext,
  type WorkflowRunRecord,
  type WorkflowRunState,
} from './workflows/contracts/runtime.ts';
export {
  WorkflowError,
  isNodeRetryable,
  isWorkflowError,
  terminalStateFor as workflowTerminalStateFor,
  workflowFailure,
  type WorkflowFailureCode,
} from './workflows/contracts/failures.ts';
export {
  ACTIVE_WORKFLOW_STATES,
  FAILED_WORKFLOW_STATES,
  OPERATION_SOURCES as WORKFLOW_OPERATION_SOURCES,
  OPERATION_TARGETS as WORKFLOW_OPERATION_TARGETS,
  PAUSABLE_STATES as WORKFLOW_PAUSABLE_STATES,
  TRANSITIONS as WORKFLOW_TRANSITIONS,
  assertWorkflowTransition,
  canTransition as canWorkflowTransition,
} from './workflows/runtime/stateMachine.ts';
export {
  buildGraph,
  findCycle,
  reachableFrom,
  reachesTerminal,
  type WorkflowGraph,
} from './workflows/runtime/graph.ts';
export {
  nextNodeId,
  planWorkflow,
  type WorkflowPlan,
  type WorkflowPlanManifest,
} from './workflows/planner/workflowPlanner.ts';
export {
  MAPPING_BOUNDS,
  VALUE_SPACE_ROOTS,
  applyOutputMapping,
  resolveMapping,
  resolvePath,
  type WorkflowValueSpace,
} from './workflows/runtime/mapping.ts';
export {
  PREDICATE,
  createPredicateRegistry,
  evaluatePredicate,
  registerDefaultPredicates,
  type Predicate,
  type PredicateRegistry,
} from './workflows/runtime/predicates.ts';
export {
  TRANSFORM,
  createTransformRegistry,
  registerDefaultTransforms,
  runTransform,
  type Transform,
  type TransformRegistry,
} from './workflows/runtime/transforms.ts';
export {
  OPTIMIZER_VERSION,
  decideTokenAction,
  optimizeWorkflowContext,
  type OptimizationDecision,
  type WorkflowContextManifest,
} from './workflows/runtime/tokenOptimizer.ts';
export {
  COMPLEXITY_FORMULA_VERSION,
  TASK_COMPLEXITY_CLASSES,
  classifyTaskComplexity,
  impliedQualityFor,
  routingComplexityFor,
  type TaskComplexityClass,
} from './workflows/runtime/complexity.ts';
export {
  isWorkflowRoutingRefused,
  isWorkflowRoutingSelected,
  routeWorkflowProfile,
  type WorkflowRoutingOutcome,
} from './workflows/runtime/profileRouter.ts';
export {
  decideWorkflowCost,
  emptyWorkflowCostLedger,
  projectWorkflowStepCost,
  releaseWorkflowCost,
  reserveWorkflowCost,
  settleWorkflowCost,
  type WorkflowCostDecision,
  type WorkflowCostProjection,
} from './workflows/runtime/costOptimizer.ts';
export {
  CACHE_KEY_VERSION,
  buildCacheKey,
  cacheEligibilityFor,
  createMemoryWorkflowCache,
  createSafeWorkflowCache,
  isEntryUsable,
  type CacheEntry,
  type WorkflowCachePort,
} from './workflows/runtime/cache.ts';
export {
  AVOIDED_ESTIMATE_VERSION,
  buildAvoidedCallRecord,
  emptyWorkflowTokenLedger,
  reconcileWorkflowUsage,
  summarizeAvoidedCalls,
} from './workflows/runtime/ledgers.ts';
export {
  branchesToCancel,
  evaluateJoin,
  initialJoinRecord,
  mergeBranchOutputs,
  recordBranchArrival,
} from './workflows/runtime/joins.ts';
export {
  OPTIMIZATION_SCORE_VERSION,
  computeOptimizationScore,
  type OptimizationScore,
} from './workflows/runtime/optimizationScore.ts';
export {
  attributeBy,
  buildFinancialSummary,
  buildOptimizationSavingsSummary,
  projectMonthlyBurn,
  type AttributionDimension,
  type OptimizationSavingsSummary,
  type WorkflowFinancialSummary,
} from './workflows/analytics/financials.ts';
export {
  createMemoryWorkflowApprovalStore,
  createMemoryWorkflowCheckpointStore,
  createMemoryWorkflowRunStore,
  type WorkflowApprovalStore,
  type WorkflowCheckpointStore,
  type WorkflowRunStore,
} from './workflows/persistence/ports.ts';
export {
  createKvWorkflowApprovalStore,
  createKvWorkflowCheckpointStore,
  createKvWorkflowRunStore,
  workflowApprovalKeyFor,
  workflowCheckpointKeyFor,
  workflowRunKeyFor,
  type KvWorkflowConditionalWriter,
  type KvWorkflowPrefixReader,
  type KvWorkflowReader,
} from './workflows/persistence/kvWorkflowStores.ts';
export {
  createWorkflowApprovalGate,
  type WorkflowApprovalGate,
} from './workflows/approvals/workflowApprovalGate.ts';
export {
  WORKFLOW_AUDIT_EVENT,
  createKvWorkflowAuditStore,
  createMemoryWorkflowAuditStore,
  type WorkflowAuditRecord,
  type WorkflowAuditStore,
} from './workflows/observability/workflowAudit.ts';
export {
  createWorkflowOrchestrator,
  type WorkflowOrchestrator,
  type WorkflowRuntimeState,
} from './workflows/orchestrator/workflowOrchestrator.ts';
export {
  createAgentRuntimeBridge,
  type AgentExecutionPort,
} from './workflows/orchestrator/agentBridge.ts';
export {
  createToolGatewayBridge,
  workflowToolPrincipal,
  type ToolExecutionPort,
} from './workflows/orchestrator/toolBridge.ts';
export {
  createWorkflowService,
  scoreRun,
  toWorkflowRunDetail,
  toWorkflowRunSummary,
  type WorkflowOverview,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowService,
} from './workflows/service/workflowService.ts';
export {
  WORKFLOW_ROLE_CAPABILITIES,
  financeScopeFor,
  hasWorkflowCapability,
  resolveWorkflowActor,
  type WorkflowActor,
  type WorkflowCapability,
} from './workflows/service/workflowRbac.ts';
export {
  WORKFLOW_OPERATION,
  executeWorkflowHttpRequest,
  type WorkflowHttpRequest,
  type WorkflowHttpResponse,
  type WorkflowOperation,
} from './workflows/http/workflowHttpAdapter.ts';

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
