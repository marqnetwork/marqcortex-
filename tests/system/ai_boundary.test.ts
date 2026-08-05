/**
 * AI execution-path boundary scan.
 *
 * These tests are structural rather than behavioural, and that is deliberate:
 * every other guarantee in AI-01 — audit, budget, redaction, fact lock, tenant
 * scoping — holds only if there is exactly ONE way to reach a model provider.
 * A second path does not weaken those guarantees, it removes them for whatever
 * flows through it.
 *
 * Behavioural tests cannot catch that. A newly added `fetch('https://api.openai.com/...')`
 * in a feature module passes every existing test, because the tests exercise
 * the governed path and the new code simply is not on it. So this suite asserts
 * on the source tree itself:
 *
 *   - vendor hostnames appear only inside `ai/providers/`
 *   - nothing outside the provider boundary reads a provider credential
 *   - no gateway-bypass flag exists
 *   - no legacy handler has come back
 *   - server code enters the plane through `ai/index.ts`, not its internals
 *
 * A source scan is a weak form of proof for behaviour and a strong one for
 * absence, which is exactly the shape of the claim being made here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SERVER_ROOT = join('supabase', 'functions', 'server');
const PROVIDER_DIR = join(SERVER_ROOT, 'ai', 'providers') + sep;
const AI_DIR = join(SERVER_ROOT, 'ai') + sep;

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function collect(dir: string): SourceFile[] {
  if (!existsSync(dir)) return [];
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const serverSources = collect(SERVER_ROOT);
const isTest = (file: SourceFile) =>
  file.path.includes('__tests__') || file.path.endsWith('.test.ts');
const isProviderAdapter = (file: SourceFile) => file.path.startsWith(PROVIDER_DIR);

/** Report offending files with their names, so a failure names the culprit. */
function offenders(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(file.text))
    .map((file) => relative(SERVER_ROOT, file.path));
}

describe('AI provider boundary', () => {
  it('has server sources to scan', () => {
    // A scan over zero files passes vacuously, which would make every other
    // assertion here meaningless.
    assert.ok(serverSources.length > 20, `expected server sources, found ${serverSources.length}`);
  });

  it('confines vendor hostnames to the provider adapters', () => {
    const VENDOR_HOST = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    const candidates = serverSources.filter((file) => !isProviderAdapter(file) && !isTest(file));
    assert.deepEqual(
      offenders(candidates, VENDOR_HOST),
      [],
      'a model vendor URL appears outside supabase/functions/server/ai/providers/',
    );
  });

  it('confines provider credential reads to the provider adapters', () => {
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    const candidates = serverSources.filter((file) => !isProviderAdapter(file) && !isTest(file));
    assert.deepEqual(
      offenders(candidates, CREDENTIAL),
      [],
      'a provider credential is read outside supabase/functions/server/ai/providers/',
    );
  });

  it('has no gateway-bypass feature flag', () => {
    // The rollback mechanism for AI-01 is a deployment rollback or a provider
    // configuration change — never a second code path guarded by a flag.
    const BYPASS = /INTELLIGENCE_USE_GATEWAY|USE_LEGACY_AI|AI_BYPASS|SKIP_AI_GUARD|DISABLE_AI_GUARD/;
    assert.deepEqual(offenders(serverSources, BYPASS), []);
  });

  it('has no legacy direct-provider handler', () => {
    const LEGACY = [
      'blockAiAssist.ts',
      'copilotPatch.ts',
      'cortexAnalysis.ts',
      'cortexChat.ts',
      'cortexNarrative.ts',
      'proposalSectionCopilot.ts',
    ];
    for (const name of LEGACY) {
      assert.equal(
        existsSync(join(SERVER_ROOT, name)),
        false,
        `${name} is a pre-Batch-1 direct-provider handler and must not exist`,
      );
    }
    assert.equal(
      existsSync(join(SERVER_ROOT, 'intelligence')),
      false,
      'the intelligence/ gateway is superseded by ai/ and must not exist',
    );
  });

  it('routes server code into the plane through its public surface', () => {
    // Reaching past ai/index.ts into ai/pipeline/ or ai/providers/ is how a
    // caller skips the guard while still looking like it uses the plane.
    const DEEP_IMPORT = /from\s+['"]\.\/ai\/(pipeline|providers|policy|security|governance)\//;
    const candidates = serverSources.filter(
      (file) => !file.path.startsWith(AI_DIR) && !isTest(file),
    );
    assert.deepEqual(
      offenders(candidates, DEEP_IMPORT),
      [],
      'server code imports a control plane internal instead of ai/index.ts',
    );
  });

  it('invokes a provider adapter only from the execution pipeline', () => {
    const INVOKE = /\.\s*invoke\s*\(\s*\{/;
    const candidates = serverSources.filter(
      (file) =>
        !isTest(file) &&
        !isProviderAdapter(file) &&
        !file.path.endsWith(join('pipeline', 'executionPipeline.ts')),
    );
    assert.deepEqual(offenders(candidates, INVOKE), []);
  });
});

/**
 * AI-01 Batch 2 added an administration layer. It is the one part of the
 * platform whose entire job is to change how AI behaves, which makes it the
 * most attractive place to accidentally build a second execution path — a
 * "test this provider" button that calls an adapter directly, an audit store
 * that grew a delete method, a route that checks a role itself.
 *
 * These assertions are structural for the same reason the ones above are: a
 * behavioural test cannot prove the ABSENCE of a bypass, only the presence of
 * the path it exercises.
 */
describe('AI administration boundary', () => {
  const ADMIN_DIR = join(SERVER_ROOT, 'ai', 'admin') + sep;
  const adminSources = serverSources.filter(
    (file) => file.path.startsWith(ADMIN_DIR) && !isTest(file),
  );

  it('scans a non-empty administration tree', () => {
    assert.ok(adminSources.length >= 5, `expected the admin tree, found ${adminSources.length}`);
  });

  it('never reaches a provider adapter', () => {
    // The administration layer CONFIGURES providers. It must never invoke one:
    // a console that can make a model call has stepped outside the guard, the
    // policy engine, the spend ceiling and the audit trail in one move.
    const PROVIDER_IMPORT = /from\s+['"]\.\.\/providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(adminSources, PROVIDER_IMPORT), []);
    assert.deepEqual(offenders(adminSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('does not re-implement a Batch 1 guarantee', () => {
    // Budget enforcement, provider selection and request authorization each
    // have exactly one implementation. A second one in the admin layer would
    // not weaken the first — it would replace it for whatever flows through it.
    const DUPLICATED = /createSpendLedger|createProviderSelector|createAIGuard|createPolicyEngine/;
    assert.deepEqual(offenders(adminSources, DUPLICATED), []);
  });

  it('exposes no mutation of an audit record', () => {
    // Append and read. A trail an administrator can edit is a trail that proves
    // nothing about administrators, so the absence is asserted on the source.
    const MUTATION = /\b(deleteAudit|removeAudit|updateAudit|clearAudit|purgeAudit)\b/;
    assert.deepEqual(offenders(adminSources, MUTATION), []);
  });

  it('routes administration through its HTTP adapter, not its own role checks', () => {
    const routeFile = serverSources.find((file) => file.path.endsWith('aiAdminRoutes.ts'));
    assert.ok(routeFile, 'aiAdminRoutes.ts must exist');
    // A route file that compares roles is a route file that can forget to.
    assert.equal(/super_admin|organization_admin|team_admin/.test(routeFile.text), false);
    assert.equal(/requireCapability|resolveAdminActor/.test(routeFile.text), false);
    assert.ok(routeFile.text.includes('executeAdminHttpRequest'));
  });
});

/**
 * AI-01 Batch 3A added an agent runtime. It is the part of the platform most
 * likely to grow a second execution path, because an agent that "just needs to
 * call the model" is one import away from doing so — and everything the control
 * plane guarantees (guard, policy, governance, spend ceiling, audit) would then
 * simply not apply to whatever flows through it.
 *
 * These assertions are structural for the same reason the ones above are: a
 * behavioural test can prove the path it exercises is governed, and cannot
 * prove the ABSENCE of an ungoverned one.
 */
describe('agent runtime boundary', () => {
  const AGENTS_DIR = join(SERVER_ROOT, 'ai', 'agents') + sep;
  const BRIDGE = join('orchestrator', 'controlPlaneBridge.ts');
  const agentSources = serverSources.filter(
    (file) => file.path.startsWith(AGENTS_DIR) && !isTest(file),
  );

  it('scans a non-empty agent runtime tree', () => {
    assert.ok(agentSources.length >= 15, `expected the agent tree, found ${agentSources.length}`);
  });

  it('never imports a provider adapter or names a vendor', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(agentSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(agentSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(agentSources, CREDENTIAL), []);
  });

  it('reaches the control plane through exactly one module', () => {
    // `controlPlaneBridge.ts` is the only place that may hold an AIControlPlane
    // and call `execute` on it. Anything else importing the plane would be a
    // second way for an agent step to reach a model.
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    const offending = agentSources
      .filter((file) => !file.path.endsWith(BRIDGE) && !file.path.endsWith('agentRuntime.ts'))
      .filter((file) => PLANE_IMPORT.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(
      offending,
      [],
      'only the control plane bridge and the runtime assembly may import the plane',
    );

    const bridge = agentSources.find((file) => file.path.endsWith(BRIDGE));
    assert.ok(bridge, 'the control plane bridge must exist');
    assert.match(bridge.text, /plane\.execute</, 'the bridge executes through the plane');
  });

  it('never invokes a provider adapter directly', () => {
    assert.deepEqual(offenders(agentSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('does not re-implement a Batch 1 or Batch 2 guarantee', () => {
    // Spend enforcement, provider selection, request authorization, policy
    // evaluation and the administration surface each have exactly one
    // implementation. A second one inside the agent runtime would not weaken
    // the first — it would replace it for whatever flows through it.
    const DUPLICATED =
      /createSpendLedger|createProviderSelector|createAIGuard|createPolicyEngine|createExecutionPipeline|createAIAdministration/;
    assert.deepEqual(offenders(agentSources, DUPLICATED), []);
  });

  it('exposes no mutation of a run, a step, a checkpoint or an audit record', () => {
    // Terminal runs are evidence and checkpoints are immutable. The absence of
    // an edit path is asserted on the source, because a method that exists is a
    // method something will eventually call.
    const MUTATION =
      /\b(deleteRun|removeRun|editRun|purgeRun|deleteStep|rewriteCheckpoint|deleteCheckpoint|deleteAudit|clearAudit|purgeAudit|reopenRun)\b/;
    assert.deepEqual(offenders(agentSources, MUTATION), []);
  });

  it('routes the agent HTTP surface through its adapter, not its own role checks', () => {
    const routeFile = serverSources.find((file) => file.path.endsWith('agentRuntimeRoutes.ts'));
    assert.ok(routeFile, 'agentRuntimeRoutes.ts must exist');
    // A route file that resolves an actor or compares a role is a route file
    // that can forget to.
    assert.equal(/resolveAgentActor|requireAgentCapability/.test(routeFile.text), false);
    assert.equal(/super_admin|organization_admin|consultant/.test(routeFile.text), false);
    assert.ok(routeFile.text.includes('executeAgentHttpRequest'));
  });

  it('registers no production agent in the bootstrap', () => {
    // Business agents are out of AI-01 Batch 3A's scope. The production
    // registry starts empty, and an agent definition appearing in bootstrap
    // would be exactly the inline production agent the batch forbids.
    const bootstrap = serverSources.find((file) => file.path.endsWith(join('ai', 'bootstrap.ts')));
    assert.ok(bootstrap);
    assert.equal(
      /agents:\s*\[[^\]]*\w/.test(bootstrap.text),
      false,
      'bootstrap must not register agent definitions',
    );
  });

  it('keeps the agent step feature off every HTTP route', () => {
    // An agent step outside a run has no limits, no ledger and no audit trail
    // of its own, so the feature must be reachable only through the
    // orchestrator's model profiles.
    const routes = serverSources.filter(
      (file) => file.path.endsWith('aiRoutes.ts') || file.path.endsWith('aiAdminRoutes.ts'),
    );
    assert.deepEqual(offenders(routes, /FEATURE\.agentStep/), []);
  });
});

/**
 * AI-01 Batch 3B added a workflow engine. It is the part of the platform with the
 * most reasons to grow a shortcut: a workflow that "just needs to call the model"
 * is one import away from bypassing the control plane, a workflow that "just needs
 * a tool" is one import away from bypassing the gateway, and a workflow that "just
 * needs to know what the agent is doing" is one import away from reaching into the
 * agent runtime's own state.
 *
 * These assertions are structural for the same reason the ones above are: a
 * behavioural test can prove the path it exercises is governed, and cannot prove
 * the ABSENCE of an ungoverned one.
 */
describe('workflow engine boundary', () => {
  const WORKFLOWS_DIR = join(SERVER_ROOT, 'ai', 'workflows') + sep;
  const workflowSources = serverSources.filter(
    (file) => file.path.startsWith(WORKFLOWS_DIR) && !isTest(file),
  );

  it('scans a non-empty workflow tree', () => {
    assert.ok(
      workflowSources.length >= 20,
      `expected the workflow tree, found ${workflowSources.length}`,
    );
  });

  it('never imports a provider adapter or names a vendor', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(workflowSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(workflowSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(workflowSources, CREDENTIAL), []);
  });

  it('never invokes a provider adapter directly', () => {
    assert.deepEqual(offenders(workflowSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('holds the control plane only in its assembly, never in the engine', () => {
    // The engine takes a `ModelExecutionPort`. Only `workflowRuntime.ts` — the
    // assembly — may hold an `AIControlPlane`, and it derives the port from it.
    // Anything else importing the plane would be a second way for a workflow node
    // to reach a model.
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    const offending = workflowSources
      .filter((file) => !file.path.endsWith('workflowRuntime.ts'))
      .filter((file) => PLANE_IMPORT.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(
      offending,
      [],
      'only the workflow runtime assembly may import the control plane',
    );
  });

  it('reaches the agent runtime through exactly one bridge', () => {
    // `agentBridge.ts` is the only module that may hold an `AgentOrchestrator`, and
    // `workflowRuntime.ts` is the only one that may hold the whole `AgentRuntime` to
    // wire it. A third would be a second way to drive an agent run.
    const ORCHESTRATOR_IMPORT = /from\s+['"][^'"]*agents\/orchestrator\/agentOrchestrator\.ts['"]/;
    const permitted = ['agentBridge.ts', 'workflowRuntime.ts', 'workflowOrchestrator.ts'];
    const offending = workflowSources
      .filter((file) => !permitted.some((name) => file.path.endsWith(name)))
      .filter((file) => ORCHESTRATOR_IMPORT.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(offending, []);

    const bridge = workflowSources.find((file) => file.path.endsWith('agentBridge.ts'));
    assert.ok(bridge, 'the agent bridge must exist');
    assert.match(bridge.text, /orchestrator\.createRun/, 'the bridge creates agent runs');
    assert.match(bridge.text, /orchestrator\.advance/, 'the bridge advances agent runs');
  });

  it('reaches the tool gateway through exactly one bridge', () => {
    const GATEWAY_IMPORT = /from\s+['"][^'"]*agents\/tools\/toolRegistry\.ts['"]/;
    const permitted = ['toolBridge.ts', 'workflowRuntime.ts'];
    const offending = workflowSources
      .filter((file) => !permitted.some((name) => file.path.endsWith(name)))
      .filter((file) => GATEWAY_IMPORT.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(offending, []);

    const bridge = workflowSources.find((file) => file.path.endsWith('toolBridge.ts'));
    assert.ok(bridge, 'the tool bridge must exist');
    assert.match(bridge.text, /gateway\.execute/, 'the bridge executes through the gateway');
  });

  it('never writes to an agent run, checkpoint or ledger', () => {
    // The workflow engine may DRIVE an agent run through the bridge. It may not
    // mutate one: no store save, no checkpoint write, no ledger edit. The bridge's
    // own `loadRun` is a read, and it is the only agent-store call permitted.
    const AGENT_WRITE =
      /agentRuntime\.runs\.save|agentRuntime\.checkpoints\.write|agentRuntime\.approvals\.decide|\.runs\.create\(/;
    assert.deepEqual(offenders(workflowSources, AGENT_WRITE), []);
  });

  it('does not re-implement a Batch 1, 2 or 3A guarantee', () => {
    // Spend enforcement, provider selection, request authorization, policy
    // evaluation, the execution pipeline, the administration surface and the AGENT
    // runtime each have exactly one implementation. A second one inside the workflow
    // engine would not weaken the first — it would replace it for whatever flows
    // through it.
    const DUPLICATED =
      // Word boundaries matter here: `createToolGatewayBridge` is the permitted
      // bridge and `createToolGateway` is the thing it must not reimplement, and the
      // first contains the second as a substring.
      /\bcreateSpendLedger\b|\bcreateProviderSelector\b|\bcreateAIGuard\b|\bcreatePolicyEngine\b|\bcreateExecutionPipeline\b|\bcreateAIAdministration\b|\bcreateAgentOrchestrator\b|\bcreateToolGateway\b|\bcreateApprovalGate\b/;
    assert.deepEqual(offenders(workflowSources, DUPLICATED), []);
  });

  it('reuses the hardened context fence rather than writing a second one', () => {
    // A second fence implementation is a second thing to get wrong, and the first
    // has already survived an independent review that broke an earlier version of
    // it. The optimizer must delegate rendering.
    const optimizer = workflowSources.find((file) => file.path.endsWith('tokenOptimizer.ts'));
    assert.ok(optimizer, 'the token optimizer must exist');
    assert.match(optimizer.text, /from '\.\.\/\.\.\/agents\/runtime\/contextBuilder\.ts'/);
    // And it must not contain fence markers of its own.
    assert.equal(
      /<<<BEGIN|<<<END/.test(optimizer.text),
      false,
      'the optimizer must not render its own fence',
    );
  });

  it('exposes no mutation of a run, a node, a checkpoint or an audit record', () => {
    const MUTATION =
      /\b(deleteWorkflowRun|removeWorkflowRun|editWorkflowRun|purgeWorkflowRun|deleteNode|rewriteCheckpoint|deleteCheckpoint|deleteAudit|clearAudit|purgeAudit|reopenWorkflowRun)\b/;
    assert.deepEqual(offenders(workflowSources, MUTATION), []);
  });

  it('evaluates conditions and transforms from a registry, never from a string', () => {
    // An expression language in a definition needs a parser, the parser needs an
    // evaluator, and the evaluator is one convenience feature away from reaching
    // something it should not. Neither may exist.
    const DYNAMIC = /\bnew Function\b|\beval\s*\(|\bvm\.|node:vm/;
    assert.deepEqual(offenders(workflowSources, DYNAMIC), []);
  });

  it('routes the workflow HTTP surface through its adapter, not its own role checks', () => {
    const routeFile = serverSources.find((file) => file.path.endsWith('workflowRoutes.ts'));
    assert.ok(routeFile, 'workflowRoutes.ts must exist');
    // A route file that resolves an actor or compares a role is a route file that
    // can forget to.
    assert.equal(/resolveWorkflowActor|requireWorkflowCapability/.test(routeFile.text), false);
    assert.equal(/super_admin|organization_admin|consultant/.test(routeFile.text), false);
    assert.ok(routeFile.text.includes('executeWorkflowHttpRequest'));
  });

  it('exposes no route that creates or edits a workflow definition', () => {
    const routeFile = serverSources.find((file) => file.path.endsWith('workflowRoutes.ts'));
    assert.ok(routeFile);
    // Customer-created workflows are out of Batch 3B's scope, and a route file is
    // where that scope would quietly arrive.
    const MUTATION = /workflows\/registry['"`]\s*,\s*\(c\)\s*=>\s*run\(c,\s*WORKFLOW_OPERATION\.(create|update|delete)/;
    assert.equal(MUTATION.test(routeFile.text), false);
    assert.equal(
      /app\.(post|put|patch|delete)\(`\$\{prefix\}\/ai\/workflows\/registry/.test(routeFile.text),
      false,
      'the registry is read-only over HTTP',
    );
  });

  it('registers no production workflow in the bootstrap', () => {
    // Business workflows are out of AI-01 Batch 3B's scope. The production registry
    // starts empty, and a definition appearing in bootstrap would be exactly the
    // inline production workflow the batch forbids.
    const bootstrap = serverSources.find((file) => file.path.endsWith(join('ai', 'bootstrap.ts')));
    assert.ok(bootstrap);
    assert.equal(
      /workflows:\s*\[[^\]]*\w/.test(bootstrap.text),
      false,
      'bootstrap must not register workflow definitions',
    );
  });

  it('keys every cache entry and durable record by its tenant', () => {
    const cache = workflowSources.find((file) => file.path.endsWith(join('runtime', 'cache.ts')));
    assert.ok(cache, 'the cache module must exist');
    // The key builder REFUSES rather than defaulting, so a cross-tenant entry is
    // arithmetically unreachable rather than a call-site discipline.
    assert.match(cache.text, /organizationId/);
    assert.match(cache.text, /cache_policy_denied/);

    const stores = workflowSources.find((file) => file.path.endsWith('kvWorkflowStores.ts'));
    assert.ok(stores, 'the durable stores must exist');
    assert.match(stores.text, /tenantScopedKey/, 'every key is built by the tenant-scoped builder');
    assert.equal(
      /`org:\$\{/.test(stores.text),
      false,
      'a key must never be hand-assembled around the tenant builder',
    );
  });
});

describe('AI source hygiene', () => {
  const aiSources = serverSources.filter((file) => file.path.startsWith(AI_DIR));

  it('scans a non-empty AI tree', () => {
    assert.ok(aiSources.length > 30, `expected the AI tree, found ${aiSources.length} files`);
  });

  it('carries no type-checker suppressions', () => {
    const SUPPRESSION = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/;
    assert.deepEqual(offenders(aiSources, SUPPRESSION), []);
  });

  it('carries no unresolved work markers', () => {
    const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/;
    assert.deepEqual(offenders(aiSources, MARKER), []);
  });

  it('does not defeat the type system with `as any`', () => {
    const AS_ANY = /\bas\s+any\b/;
    assert.deepEqual(offenders(aiSources, AS_ANY), []);
  });

  it('logs no raw prompt or completion content', () => {
    // Audit and logs record digests and metadata. A `messages` or `completion`
    // value reaching a log sink turns the observability layer into an
    // uncontrolled copy of every client's business data.
    const RAW = /logger\.(debug|info|warn|error)\([^)]*\b(messages|completion|promptText|rawContent)\b/s;
    assert.deepEqual(offenders(aiSources, RAW), []);
  });
});
