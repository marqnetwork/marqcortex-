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

/**
 * The same scan over CODE ONLY, with comments removed.
 *
 * This repository documents heavily, and a file that explains in prose why it
 * must never derive a baseline from a savings target contains the words
 * "savings target". Scanning the raw text would make the explanation itself the
 * violation — which teaches the only lesson a source scan must never teach,
 * that the way to pass is to stop writing down the reasoning.
 *
 * So the patterns below are matched against the file with block and line
 * comments stripped. A real defect is code, and code is what this looks at.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function strippedOffenders(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(stripComments(file.text)))
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
 * AI-01 Batch 3B added a workflow engine. It sits one level further from the
 * model than the agent runtime does, and that distance is exactly what makes it
 * tempting to shorten: a node "just needs to call the agent's model", or "just
 * needs to check whether the tool succeeded", and either shortcut steps outside
 * the Agent Orchestrator — and therefore outside the limits, loop protection,
 * budgets, approvals, tool permissions and audit trail that Batch 3A places on
 * every agent step.
 *
 * The claim being asserted here is narrow and absolute: THE ONLY WAY FROM A
 * WORKFLOW TO AN AGENT IS `engine/agentNodePort.ts`. A behavioural test can
 * show that the port works; only a source scan can show there is no second way.
 */
describe('workflow engine boundary', () => {
  const WORKFLOWS_DIR = join(SERVER_ROOT, 'ai', 'workflows') + sep;
  const PORT = join('engine', 'agentNodePort.ts');
  const ASSEMBLY = 'workflowRuntime.ts';
  const workflowSources = serverSources.filter(
    (file) => file.path.startsWith(WORKFLOWS_DIR) && !isTest(file),
  );

  it('scans a non-empty workflow tree', () => {
    assert.ok(
      workflowSources.length >= 10,
      `expected the workflow tree, found ${workflowSources.length}`,
    );
  });

  it('never imports a provider adapter, names a vendor or reads a credential', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(workflowSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(workflowSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(workflowSources, CREDENTIAL), []);
  });

  it('never holds the control plane or invokes a provider adapter', () => {
    // The workflow engine is TWO layers from a model call: it drives agent runs,
    // and the agent runtime's own bridge is the only thing that reaches the
    // plane. A plane import here would skip both.
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    assert.deepEqual(offenders(workflowSources, PLANE_IMPORT), []);
    assert.deepEqual(offenders(workflowSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('never reaches a tool gateway, a tool registry or a prompt', () => {
    // Tools belong to the agent that declared them. A workflow that could call
    // one would be executing an effect no agent definition authorised.
    const TOOL_IMPORT = /from\s+['"][^'"]*(tools\/toolRegistry|tools\/mockTools|prompts\/)/;
    assert.deepEqual(offenders(workflowSources, TOOL_IMPORT), []);
    const TOOL_CALL = /\b(toolGateway|gateway)\s*\.\s*(execute|invoke|call)\s*\(/;
    assert.deepEqual(offenders(workflowSources, TOOL_CALL), []);
  });

  it('reaches the agent runtime through exactly one module', () => {
    // `engine/agentNodePort.ts` is the only place that may hold an
    // AgentOrchestrator. `workflowRuntime.ts` is the assembly that hands it one
    // — it constructs the port and resolves the actor through the agent
    // runtime's own RBAC, and never drives a run itself.
    const AGENT_EXECUTION_IMPORT =
      /from\s+['"][^'"]*agents\/(orchestrator|service|tools|approvals|registry)\//;
    const offending = workflowSources
      .filter((file) => !file.path.endsWith(PORT) && !file.path.endsWith(ASSEMBLY))
      .filter((file) => AGENT_EXECUTION_IMPORT.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(
      offending,
      [],
      'only the agent node port and the runtime assembly may import agent execution modules',
    );

    const port = workflowSources.find((file) => file.path.endsWith(PORT));
    assert.ok(port, 'the agent node port must exist');
    assert.match(port.text, /orchestrator\.createRun\(/, 'the port creates child runs');
    assert.match(port.text, /orchestrator\.advance\(/, 'the port drives child runs');
  });

  it('imports only pure contracts and the canonical serializer from the agent tree', () => {
    // Everything else a workflow module may borrow from `agents/` has to be
    // free of behaviour. `runtime/digest.ts` is the one non-contract exception
    // and it is a bounded, side-effect-free serializer — duplicating it would
    // give the platform two canonical forms to keep in step.
    const ALLOWED = /^\.\.\/\.\.\/agents\/(contracts\/[a-zA-Z]+\.ts|runtime\/digest\.ts)$/;
    const IMPORT = /from\s+['"](\.\.\/\.\.\/agents\/[^'"]+)['"]/g;
    const offending: string[] = [];
    for (const file of workflowSources) {
      if (file.path.endsWith(PORT) || file.path.endsWith(ASSEMBLY)) continue;
      for (const match of file.text.matchAll(IMPORT)) {
        if (!ALLOWED.test(match[1])) {
          offending.push(`${relative(SERVER_ROOT, file.path)} -> ${match[1]}`);
        }
      }
    }
    assert.deepEqual(offending, []);
  });

  it('does not re-implement a guarantee that already has one implementation', () => {
    // Spend enforcement, provider selection, request authorization, policy
    // evaluation, the agent state machine and the agent registry each have
    // exactly one implementation. A second one inside the workflow engine would
    // not weaken the first — it would replace it for whatever flows through it.
    const DUPLICATED =
      /createSpendLedger|createProviderSelector|createAIGuard|createPolicyEngine|createAgentRegistry|createAgentOrchestrator/;
    assert.deepEqual(offenders(workflowSources, DUPLICATED), []);
  });

  it('executes no code the definition supplied as data', () => {
    // AI-01 Batch 3B Part 3 gave workflow definitions a condition language and
    // a mapping language. Both are DATA STRUCTURES walked by a switch — there
    // is no parser, so there is no injection surface — and the whole claim
    // rests on nothing in the tree being able to evaluate a string.
    //
    // A behavioural test cannot prove the absence of such a path. This can.
    const CODE_EXECUTION =
      /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*['"`]|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/;
    assert.deepEqual(
      offenders(workflowSources, CODE_EXECUTION),
      [],
      'a code-execution primitive appears in the workflow tree',
    );

    // No JSONPath, JMESPath or template engine either. Every one of them ships
    // a predicate language, and several evaluate it with `eval`.
    const QUERY_LIBRARY = /from\s+['"](jsonpath|jmespath|jsonata|handlebars|mustache|lodash)/;
    assert.deepEqual(offenders(workflowSources, QUERY_LIBRARY), []);
  });

  it('keeps checkpoints append-only in the store contract itself', () => {
    // The immutability guarantee is the ABSENCE of a writer, not a rule about
    // how the writer is called. A `save`, `update` or `delete` on the
    // checkpoint port would make the digest chain a statement about intent.
    const stores = workflowSources.filter((file) =>
      file.path.includes(join('persistence', 'ports.ts')) ||
      file.path.includes(join('persistence', 'kvWorkflowStores.ts')),
    );
    assert.equal(stores.length, 2, 'both persistence modules must exist');
    const MUTATION =
      /\b(deleteCheckpoint|removeCheckpoint|updateCheckpoint|clearCheckpoint|purgeCheckpoint)\b/;
    assert.deepEqual(offenders(stores, MUTATION), []);
  });

  it('creates and drives every parallel branch through the same agent port', () => {
    // AI-01 Batch 3B Part 4 multiplied the number of agent runs a single
    // workflow node can produce. The claim that ONE module reaches the agent
    // runtime has to survive that, so the modules that own branch scheduling and
    // join policy are named explicitly here: a fan-out that reached an agent any
    // other way would be several ungoverned agent runs rather than one.
    const parallelModules = workflowSources.filter(
      (file) =>
        file.path.includes(join('engine', 'branchScheduler.ts')) ||
        file.path.includes(join('runtime', 'joinPolicy.ts')) ||
        file.path.includes(join('contracts', 'parallel.ts')) ||
        file.path.includes(join('validation', 'parallelValidation.ts')),
    );
    assert.equal(parallelModules.length, 4, 'the Part 4 modules must exist');

    const AGENT_REACH =
      /agents\/(orchestrator|service|tools|approvals|registry)\/|agentOrchestrator|AgentRunRecord/;
    assert.deepEqual(
      offenders(parallelModules, AGENT_REACH),
      [],
      'a parallel module reaches the agent runtime instead of taking the port',
    );

    // They hold no store either. Branch state is written by the engine, through
    // the run record's compare-and-swap; a scheduler that could persist would be
    // a second writer to the record the join reads.
    assert.deepEqual(
      offenders(parallelModules, /WorkflowRunStore|WorkflowCheckpointStore|\.save\(|\.write\(/),
      [],
      'a parallel module persists state instead of returning a value',
    );
  });

  it('fires a join through exactly one merge, behind its declared contract', () => {
    // The merge is the only path by which several branches' work becomes one
    // trusted node output. A second assignment of the join node's output, or a
    // merge that skipped `mergeContract.validate`, would put an unvalidated
    // value where later conditions and mappings read one.
    const engine = workflowSources.find((file) =>
      file.path.includes(join('engine', 'workflowOrchestrator.ts')),
    );
    assert.ok(engine, 'the workflow engine must exist');
    assert.equal(
      (engine.text.match(/data\.outputs\[group\.joinNodeId\]\s*=/g) ?? []).length,
      1,
      'the join node output is assigned in more than one place',
    );
    assert.match(engine.text, /mergeContract\.validate\(/);

    // And `joinedAt` — the once-only stamp — is set in exactly one place.
    const scheduler = workflowSources.find((file) =>
      file.path.includes(join('engine', 'branchScheduler.ts')),
    );
    assert.ok(scheduler);
    assert.equal(
      (scheduler.text.match(/joinedAt:\s*[^?]/g) ?? []).length,
      1,
      'joinedAt is stamped in more than one place',
    );
    // Everything else may READ `joinedAt` — the read model projects it, the
    // policy checks it — and nothing else may SET it from a clock. A second
    // writer would be a second way for a group to claim it had merged.
    assert.deepEqual(
      offenders(
        workflowSources.filter((file) => file !== scheduler),
        /joinedAt:\s*(clock\.|at\b|closure\.|new Date)/,
      ),
      [],
      'a module outside the branch scheduler stamps a join as fired',
    );
  });

  it('never returns a branch output through a read model', () => {
    // Branch outputs are the tenant's business data, exactly as a run's `input`
    // is. The service projects branches to identity, state and digests; a
    // projection that carried `outputs` would make every console a copy of them.
    const service = workflowSources.find((file) =>
      file.path.includes(join('service', 'workflowRuntimeService.ts')),
    );
    assert.ok(service, 'the workflow service must exist');
    assert.equal(
      /outputs:\s*branch\.outputs|outputs:\s*group\./.test(service.text),
      false,
      'a workflow read model returns branch outputs',
    );
    assert.match(service.text, /toWorkflowParallelGroupView/);
  });

  it('decides an approval in exactly one module, and never in the engine', () => {
    // AI-01 Batch 3B Part 5. The engine REQUESTS, READS and SPENDS approvals;
    // it has no path by which it could answer one. That is the difference
    // between "a human approved this" and "something approved this on a
    // human's behalf", and a behavioural test cannot prove the second is
    // impossible — only a source scan can.
    const gate = workflowSources.find((file) =>
      file.path.includes(join('approvals', 'workflowApprovalGate.ts')),
    );
    assert.ok(gate, 'the workflow approval gate must exist');
    assert.match(gate.text, /approvalState: input\.decision === 'approve'/);

    // `approved` is written in exactly one place, and it is inside `decide`.
    assert.equal(
      (gate.text.match(/approvalState:\s*'approved'/g) ?? []).length,
      0,
      'an approval state is set to approved by a literal rather than by a decision',
    );

    // Nothing else in the tree may set an approval state at all. A second
    // writer would be a second way for a request to become a yes.
    assert.deepEqual(
      offenders(
        workflowSources.filter((file) => file !== gate),
        /approvalState:\s*'(approved|rejected|consumed|expired|withdrawn)'/,
      ),
      [],
      'a module outside the approval gate writes an approval state',
    );

    // And the engine holds the GATE, not the store — so it cannot reach past it.
    const engine = workflowSources.find((file) =>
      file.path.includes(join('engine', 'workflowOrchestrator.ts')),
    );
    assert.ok(engine);
    assert.equal(
      /WorkflowApprovalStore/.test(engine.text),
      false,
      'the workflow engine holds an approval store instead of the gate',
    );
    assert.equal(
      /approvals\s*\.\s*decide\s*\(/.test(engine.text),
      false,
      'the workflow engine decides an approval',
    );
  });

  it('keeps approval records free of any field that could carry run content', () => {
    // An approval is read by whoever holds the approver role — a WIDER audience
    // than the run itself. The way a tenant's business data stays off it is that
    // there is no field for one, which is a claim about the type rather than
    // about a projection, and therefore a claim a source scan can settle.
    const contract = workflowSources.find((file) =>
      file.path.includes(join('contracts', 'approval.ts')),
    );
    assert.ok(contract, 'the approval contract must exist');

    const record = contract.text.slice(
      contract.text.indexOf('export interface WorkflowApprovalRecord'),
      contract.text.indexOf('export interface WorkflowApprovalBinding'),
    );
    assert.ok(record.length > 200, 'the approval record interface must be found');
    for (const forbidden of ['input', 'output', 'outputs', 'payload', 'merged', 'progress']) {
      assert.equal(
        new RegExp(`readonly ${forbidden}\\??:`).test(record),
        false,
        `WorkflowApprovalRecord declares a ${forbidden} field`,
      );
    }
  });

  it('adds no scheduler, timer or background worker for retries', () => {
    // AI-01 Batch 3B Part 5 persists WHEN a retry becomes eligible and wakes
    // nothing up at that moment. A timer would put the only copy of "this run
    // needs attention in ninety seconds" in a process that can be recycled,
    // which is precisely the failure mode the durable stamp exists to avoid.
    const SCHEDULING = /setTimeout\s*\(|setInterval\s*\(|queueMicrotask\s*\(|Deno\.cron|new\s+Worker\s*\(/;
    assert.deepEqual(
      offenders(workflowSources, SCHEDULING),
      [],
      'a scheduling primitive appears in the workflow tree',
    );
  });

  it('classifies a retryable failure in exactly one place, as an allow-list', () => {
    // Whether a node may be tried again is one judgement. A second copy of it —
    // in the engine, in a branch module, in the service — would be a second
    // answer, and the two would disagree the first time either changed.
    const policy = workflowSources.find((file) =>
      file.path.includes(join('runtime', 'retryPolicy.ts')),
    );
    assert.ok(policy, 'the retry policy module must exist');
    assert.match(policy.text, /RETRYABLE_CHILD_FAILURES/);

    assert.deepEqual(
      offenders(
        workflowSources.filter((file) => file !== policy),
        /RETRYABLE_CHILD_FAILURES|\bprovider_unavailable\b/,
      ),
      [],
      'a module outside the retry policy decides what is retryable',
    );

    // The retry policy is PURE: no store, no clock, no agent. A classifier that
    // could persist would be a second writer to the record the engine versions.
    assert.deepEqual(
      offenders([policy], /WorkflowRunStore|WorkflowCheckpointStore|WorkflowApprovalStore|Clock/),
      [],
      'the retry policy holds a store or a clock instead of taking values',
    );
  });

  it('changes workflow run state in exactly one place', () => {
    // Every state change goes through `assertTransition` and the store's
    // compare-and-swap. A `state:` assignment outside the engine's transition
    // helper would be a state the machine never agreed to.
    const engine = workflowSources.filter(
      (file) => file.path.includes(join('engine', 'workflowOrchestrator.ts')),
    );
    assert.equal(engine.length, 1, 'the workflow engine must exist');
    assert.match(engine[0].text, /assertTransition\(\{/);
    const others = workflowSources.filter(
      (file) =>
        !file.path.includes(join('engine', 'workflowOrchestrator.ts')) &&
        !file.path.includes(join('runtime', 'workflowStateMachine.ts')) &&
        !file.path.includes(join('contracts', 'run.ts')),
    );
    assert.deepEqual(
      offenders(others, /\bstate:\s*'(running|completed|failed|cancelled|expired)'/),
      [],
      'a workflow state is assigned outside the engine',
    );
  });
});

/**
 * AI-01 Batch 3B Part 6A added a Cost Compression Engine. It is the component
 * with the strongest possible motive to become a second execution path: its
 * entire job is to make model calls cheaper, and the shortest route to "cheaper"
 * is always to make the call itself, with the cheap model, skipping the layers
 * that cost something. Every one of those layers — the guard, the policy engine,
 * the spend ceiling, the certification checks, the audit trail — would then
 * simply not apply to whatever flowed through it.
 *
 * It is also the component with the strongest motive to LIE, which is why the
 * assertions below cover the accounting as well as the access. A baseline that
 * could be computed from a savings target, or a savings ledger with a second
 * writer, would produce numbers no reviewer could check.
 *
 * The claims are narrow and absolute: THE ENGINE RECOMMENDS AND NEVER EXECUTES,
 * and THE BASELINE CANNOT SEE THE RESULT IT IS THE DENOMINATOR OF. A behavioural
 * test can show the engine's advice is sound; only a source scan can show there
 * is no second way and no back channel.
 */
describe('cost compression boundary', () => {
  const OPTIMIZATION_DIR = join(SERVER_ROOT, 'ai', 'optimization') + sep;
  const optimizationSources = serverSources.filter(
    (file) => file.path.startsWith(OPTIMIZATION_DIR) && !isTest(file),
  );

  it('scans a non-empty cost compression tree', () => {
    assert.ok(
      optimizationSources.length >= 10,
      `expected the optimization tree, found ${optimizationSources.length}`,
    );
  });

  it('NEVER REACHES A PROVIDER: no adapter, no vendor, no credential, no invoke', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(optimizationSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(optimizationSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(optimizationSources, CREDENTIAL), []);
    assert.deepEqual(offenders(optimizationSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('never holds the control plane, an orchestrator, a tool gateway or a prompt', () => {
    // Three layers from a model call and permitted to hold none of them. The
    // engine returns advice; the control plane executes it.
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    assert.deepEqual(offenders(optimizationSources, PLANE_IMPORT), []);
    const EXECUTION_IMPORT =
      /from\s+['"][^'"]*(agents\/(orchestrator|service|tools|approvals|registry)\/|workflows\/(engine|service|approvals)\/|tools\/toolRegistry|prompts\/|pipeline\/)/;
    assert.deepEqual(offenders(optimizationSources, EXECUTION_IMPORT), []);
    const TOOL_CALL = /\b(toolGateway|gateway)\s*\.\s*(execute|invoke|call)\s*\(/;
    assert.deepEqual(offenders(optimizationSources, TOOL_CALL), []);
  });

  it('IS NOT A SECOND PROVIDER SELECTOR and re-implements no existing guarantee', () => {
    // The platform resolves a concrete model in exactly one place. This tree
    // recommends a capability BAND; a model id, a provider id or a selector here
    // would be the second resolver the whole design exists to prevent.
    const DUPLICATED =
      /createSpendLedger|createProviderSelector|createAIGuard|createPolicyEngine|createExecutionPipeline|createAgentOrchestrator|createWorkflowOrchestrator|routeModelProfile/;
    assert.deepEqual(offenders(optimizationSources, DUPLICATED), []);
    // No model or provider identifiers of any kind: the abstraction is the band.
    assert.deepEqual(offenders(optimizationSources, /\bmodelId\b|\bproviderId\b/), []);
  });

  it('holds no store, no clock and no randomness — every decision is reproducible', () => {
    // A cost decision that cannot be reproduced from its inputs cannot be
    // explained after an incident, and a savings figure that moves between two
    // runs of the same work is a savings figure nobody will trust twice.
    assert.deepEqual(
      offenders(optimizationSources, /\bMath\.random\s*\(|\bcrypto\.getRandomValues\s*\(/),
      [],
    );
    assert.deepEqual(
      offenders(optimizationSources, /\bDate\.now\s*\(|new\s+Date\s*\(|\bClock\b/),
      [],
    );
    assert.deepEqual(
      offenders(optimizationSources, /RunStore|CheckpointStore|ApprovalStore|kvGet|kvSet/),
      [],
    );
    const SCHEDULING = /setTimeout\s*\(|setInterval\s*\(|Deno\.cron|new\s+Worker\s*\(/;
    assert.deepEqual(offenders(optimizationSources, SCHEDULING), []);
  });

  it('THE BASELINE CANNOT SEE WHAT IT IS THE DENOMINATOR OF', () => {
    // The single most dangerous defect this subsystem could develop:
    // `optimised / (1 - target)`. The defence is that the value needed to
    // compute it is out of scope of the function that would compute it — so the
    // scan asserts the baseline module never names an optimised or actual cost,
    // and never names a target at all.
    const baseline = optimizationSources.find((file) =>
      file.path.includes(join('baseline', 'baselineCostModel.ts')),
    );
    assert.ok(baseline, 'the baseline cost model must exist');

    const declaration = baseline.text.slice(
      baseline.text.indexOf('export interface BaselineInput'),
      baseline.text.indexOf('function costMicroUsd'),
    );
    assert.ok(declaration.length > 100, 'the baseline input interface must be found');
    for (const forbidden of [
      'optimizedCost',
      'optimizedEstimatedCostMicroUsd',
      'actualCostMicroUsd',
      'targetSavings',
      'savingsTarget',
      'savingsPercent',
    ]) {
      assert.equal(
        declaration.includes(forbidden),
        false,
        `BaselineInput exposes ${forbidden}, which would let a baseline be derived from its own result`,
      );
    }

    // And no division by a savings figure anywhere in the tree — in CODE, not
    // in the paragraphs explaining why there is none.
    assert.deepEqual(
      strippedOffenders(optimizationSources, /\/\s*\(\s*1\s*-\s*[a-z_.]*(target|savings|desired)/i),
      [],
      'a baseline is being derived from a savings target',
    );
  });

  it('attributes savings in exactly one module, and refuses an unbalanced ledger', () => {
    const ledger = optimizationSources.find((file) =>
      file.path.includes(join('ledger', 'savingsLedger.ts')),
    );
    assert.ok(ledger, 'the savings ledger must exist');
    assert.match(ledger.text, /savings_reconciliation_failed/);

    // Nothing else may BUILD a savings record or refuse one. A second
    // constructor would be a second partition of the same gap, and the two
    // would eventually both be counted; a second reconciler would be a second
    // opinion about whether they balance.
    const aiSources = serverSources.filter((file) => file.path.startsWith(AI_DIR) && !isTest(file));
    for (const definition of [
      /export function buildSavingsRecord/,
      /export function reconcileSavings/,
    ]) {
      const defining = aiSources.filter((file) => definition.test(file.text));
      assert.deepEqual(
        defining.map((file) => relative(SERVER_ROOT, file.path)),
        [relative(SERVER_ROOT, ledger.path)],
        `${definition.source} is defined outside the savings ledger`,
      );
    }
  });

  it('attributes actual usage through exactly one fold', () => {
    // Parts 4 and 5 left zeroed placeholders precisely so this would arrive as
    // ONE mechanism. Several folds would mean several opinions about what a run
    // cost, differing on retries, cached tokens and repair calls.
    const accounting = optimizationSources.find((file) =>
      file.path.includes(join('accounting', 'usageAccounting.ts')),
    );
    assert.ok(accounting, 'the usage accounting port must exist');
    assert.match(accounting.text, /export function attributeUsage/);

    const aiSources = serverSources.filter((file) => file.path.startsWith(AI_DIR) && !isTest(file));
    const folders = aiSources
      .filter((file) => file !== accounting)
      .filter((file) => /function\s+attributeUsage|delta\(previous/.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(folders, [], 'a second module folds usage');
  });

  it('leaves no placeholder spend field anywhere in the workflow tree', () => {
    // The Part 4/5 placeholders are gone rather than filled in. A field named
    // like one reappearing would mean a second accumulator alongside the ledger.
    const WORKFLOWS_DIR = join(SERVER_ROOT, 'ai', 'workflows') + sep;
    const workflowSources = serverSources.filter(
      (file) => file.path.startsWith(WORKFLOWS_DIR) && !isTest(file),
    );
    assert.deepEqual(
      strippedOffenders(workflowSources, /tokensPlaceholder|costMicroUsdPlaceholder/),
      [],
      'a spend placeholder survives in the workflow tree',
    );
  });

  it('defers semantic and response caching to Part 6B', () => {
    // Reuse SOURCES need tenant, freshness, provenance and invalidation
    // contracts that get their own review. Part 6A accepts a prior output the
    // caller has already re-validated and never decides that one is still valid.
    const CACHE = /semanticCache|responseCache|embedding|cosineSimilarity|vectorSearch/i;
    assert.deepEqual(strippedOffenders(optimizationSources, CACHE), []);
  });

  it('adds no HTTP route, dashboard or admin surface', () => {
    const SURFACE = /\bapp\.(get|post|put|patch|delete)\s*\(|new\s+Hono\s*\(|Response\s*\(/;
    assert.deepEqual(offenders(optimizationSources, SURFACE), []);
    assert.equal(
      existsSync(join(SERVER_ROOT, 'ai', 'optimization', 'http')),
      false,
      'Part 6A ships no HTTP surface',
    );
  });
});

/**
 * AI-01 Batch 3B Part 6B added an Intelligent Reuse & Cache Engine. It is the
 * component with the strongest motive of all to become a second execution path,
 * because its job is to make model calls DISAPPEAR — and a component that can
 * make a call disappear is one short step from a component that answers it
 * itself, out of a store, without the guard, the policy engine, the spend
 * ceiling, the approval gate, the certification checks or the audit trail.
 *
 * It is also the component with the strongest motive to lie about money. An
 * avoided call leaves NO PROVIDER INVOICE, so the only record that an inference
 * did not happen is the one the platform writes about itself. Every other
 * savings figure in Cortex can eventually be reconciled against a bill; this one
 * cannot.
 *
 * Three claims, narrow and absolute:
 *
 *   THE REUSE LAYER RECOMMENDS AND NEVER EXECUTES.
 *   THERE IS EXACTLY ONE SAVINGS LEDGER, AND IT IS PART 6A'S.
 *   THERE IS NO EMBEDDING PROVIDER, SO THERE IS NO SECOND AI EXECUTION PATH.
 *
 * A behavioural test can show the reuse path is governed. Only a source scan can
 * show there is no ungoverned one beside it.
 */
describe('intelligent reuse boundary', () => {
  const REUSE_DIR = join(SERVER_ROOT, 'ai', 'reuse') + sep;
  const OPTIMIZATION_DIR = join(SERVER_ROOT, 'ai', 'optimization') + sep;
  const reuseSources = serverSources.filter(
    (file) => file.path.startsWith(REUSE_DIR) && !isTest(file),
  );

  it('scans a non-empty reuse tree', () => {
    assert.ok(reuseSources.length >= 10, `expected the reuse tree, found ${reuseSources.length}`);
  });

  it('NEVER REACHES A PROVIDER: no adapter, no vendor, no credential, no invoke', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(reuseSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(reuseSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(reuseSources, CREDENTIAL), []);
    assert.deepEqual(offenders(reuseSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('never holds the control plane, an orchestrator, a tool gateway or a prompt', () => {
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    assert.deepEqual(offenders(reuseSources, PLANE_IMPORT), []);
    const EXECUTION_IMPORT =
      /from\s+['"][^'"]*(agents\/(orchestrator|service|tools|approvals|registry)\/|workflows\/(engine|service|approvals)\/|tools\/toolRegistry|prompts\/[a-z]|pipeline\/)/;
    assert.deepEqual(offenders(reuseSources, EXECUTION_IMPORT), []);
    const TOOL_CALL = /\b(toolGateway|gateway)\s*\.\s*(execute|invoke|call)\s*\(/;
    assert.deepEqual(offenders(reuseSources, TOOL_CALL), []);
  });

  it('GRANTS NOTHING: it checks authority as evidence and never resolves it', () => {
    // The gate REFUSES when an authorization verdict is false. It must have no
    // way to produce one — a reuse layer that could resolve an actor, evaluate a
    // capability or decide an approval would be a second answer to "may this
    // happen", and the second answer is always the one an attacker aims at.
    const AUTHORITY_RESOLUTION =
      /resolveAdminActor|resolveAgentActor|requireCapability|requireAgentCapability|requireWorkflowCapability|createAIGuard|createPolicyEngine|createSpendLedger|createProviderSelector/;
    assert.deepEqual(offenders(reuseSources, AUTHORITY_RESOLUTION), []);
    // And it cannot decide an approval or set an approval state.
    assert.deepEqual(
      offenders(reuseSources, /approvalState:\s*'|approvals\s*\.\s*decide\s*\(/),
      [],
      'the reuse layer decides an approval',
    );
    // No model or provider identifiers of any kind: the abstraction is the band.
    assert.deepEqual(offenders(reuseSources, /\bmodelId\b|\bproviderId\b/), []);
  });

  it('IS NOT A SECOND SAVINGS LEDGER', () => {
    // Part 6B supplies a `ValidatedPriorOutput` and Part 6A does the accounting.
    // A savings record built here would be a second partition of the same gap,
    // and the two would eventually both be counted.
    // Stripped, because `avoidedCallLedger.ts` explains at length WHY it must
    // not build a savings record — and scanning the raw text would make the
    // explanation the violation.
    assert.deepEqual(
      strippedOffenders(
        reuseSources,
        /buildSavingsRecord|reconcileSavings|SavingsWeight|estimateBaselineCost/,
      ),
      [],
      'the reuse tree builds or reconciles a savings record',
    );
    // The one place Part 6B may compute an avoided figure reads it from a plan.
    const ledger = reuseSources.find((file) =>
      file.path.includes(join('accounting', 'avoidedCallLedger.ts')),
    );
    assert.ok(ledger, 'the avoided-call ledger must exist');
    assert.match(ledger.text, /plan\.baseline\.baselineEstimatedCostMicroUsd/);
    assert.match(ledger.text, /reuse_attribution_conflict/);

    // THE FRAUD THE WHOLE SUBSYSTEM IS EXPOSED TO: counting what the source
    // generation cost as newly avoided cost. The field exists for provenance and
    // nothing sums it — asserted on the code, with comments stripped, because
    // the file explains at length why it must not be summed.
    assert.deepEqual(
      strippedOffenders(reuseSources, /\+=\s*[a-z.]*sourceOriginalCostMicroUsd/i),
      [],
      'a source generation cost is being summed into an avoided total',
    );
    assert.deepEqual(
      strippedOffenders(reuseSources, /costAvoidedMicroUsd:\s*[a-z.]*originalActual/i),
      [],
      'an avoided cost is being taken from a source generation cost',
    );
  });

  it('DERIVES NO BASELINE AND NO SAVING FROM A TARGET', () => {
    assert.deepEqual(
      strippedOffenders(reuseSources, /\/\s*\(\s*1\s*-\s*[a-z_.]*(target|savings|desired)/i),
      [],
      'a figure is being derived from a savings target',
    );
  });

  it('ADDS NO EMBEDDING PROVIDER, NO MODEL AND NO ML ROUTING', () => {
    // The design finding, asserted rather than asserted-in-prose: this repository
    // has no certified embedding or retrieval path, and Part 6B does not add one.
    // A model call to decide whether a model call can be avoided would be a
    // second AI execution path with none of the governance the first one has.
    const EMBEDDING =
      /embed(ding)?\s*\(|createEmbedding|embeddings\.|vectorStore|vectorSearch|pgvector|cosineSimilarity|dotProduct|\bknn\b|nearestNeighbou?r/i;
    assert.deepEqual(
      strippedOffenders(reuseSources, EMBEDDING),
      [],
      'an embedding or vector search primitive appears in the reuse tree',
    );
    // Discovery scores DECLARED LABELS with set arithmetic. Nothing learned.
    const port = reuseSources.find((file) =>
      file.path.includes(join('discovery', 'semanticDiscoveryPort.ts')),
    );
    assert.ok(port, 'the semantic discovery port must exist');
    assert.match(port.text, /export interface SemanticReuseDiscoveryPort/);
    assert.match(port.text, /declaredFeatureSimilarity/);
  });

  it('reaches a reuse hit through exactly one gate', () => {
    // Every path to reuse runs through `evaluateReuseEligibility`. A second
    // decision function would be a second definition of "still valid", and the
    // looser one would be the one a caller reached for.
    const gate = reuseSources.find((file) =>
      file.path.includes(join('engine', 'eligibilityGate.ts')),
    );
    assert.ok(gate, 'the eligibility gate must exist');
    const aiSources = serverSources.filter((file) => file.path.startsWith(AI_DIR) && !isTest(file));
    const defining = aiSources
      .filter((file) => /export function evaluateReuseEligibility/.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(defining, [relative(SERVER_ROOT, gate.path)]);

    // The pipeline is the only caller, and it cannot reach a hit without one.
    const pipeline = reuseSources.find((file) =>
      file.path.includes(join('engine', 'reuseDecisionPipeline.ts')),
    );
    assert.ok(pipeline, 'the reuse decision pipeline must exist');
    assert.equal(
      (stripComments(pipeline.text).match(/contractValidated:\s*true/g) ?? []).length,
      1,
      'a validated prior output is minted in more than one place',
    );
    // `contractValidated: true` is set from the gate's verdict and nowhere else
    // in the AI tree — that flag is the whole difference between "the caller
    // says this is valid" and "the gate established that it is".
    assert.deepEqual(
      strippedOffenders(
        aiSources.filter((file) => file !== pipeline),
        /contractValidated:\s*true/,
      ),
      [],
      'a module outside the reuse pipeline mints a validated prior output',
    );
  });

  it('exposes no way to delete a reusable result or clear an invalidation', () => {
    // An invalidated record is unusable and still readable: the evidence behind
    // any avoided-call accounting that cited it has to outlive its usefulness.
    // The absence of a writer IS the guarantee.
    const MUTATION =
      /\b(deleteReusableResult|removeReusableResult|purgeReusableResult|clearInvalidation|revalidate|reviveReusableResult|extendExpiry|refreshExpiry|touchReusableResult)\b/;
    assert.deepEqual(offenders(reuseSources, MUTATION), []);

    // And no read path recomputes an expiry. A sliding window would make a
    // popular wrong answer live forever, and popularity is not evidence.
    const stores = reuseSources.filter((file) => file.path.includes(`persistence${sep}`));
    assert.equal(stores.length, 2, 'both persistence modules must exist');
    assert.deepEqual(
      strippedOffenders(stores, /expiresAt:\s*(?!record\.expiresAt)/),
      [],
      'a store writes an expiry',
    );
  });

  it('keeps the reuse layer out of the Part 6A tree, and Part 6A pure', () => {
    // Part 6A holds no store and no clock, and Part 6B needs both. Keeping them
    // in separate trees is what lets the Part 6A scan keep asserting purity —
    // a cache inside `optimization/` would have forced that assertion to be
    // relaxed, and a relaxed assertion protects nothing.
    const optimizationSources = serverSources.filter(
      (file) => file.path.startsWith(OPTIMIZATION_DIR) && !isTest(file),
    );
    assert.deepEqual(
      offenders(optimizationSources, /from\s+['"][^'"]*reuse\//),
      [],
      'the cost compression tree imports the reuse tree',
    );
    // The dependency runs one way: reuse reads Part 6A's contracts, never the
    // reverse, so Part 6A remains reviewable without reading Part 6B.
    const gate = reuseSources.find((file) =>
      file.path.includes(join('engine', 'eligibilityGate.ts')),
    );
    assert.ok(gate);
    assert.match(gate.text, /optimization\/contracts\/compression\.ts/);
  });

  it('scopes every store method and every invalidation to one organization', () => {
    // Cross-tenant reuse is not a policy this platform enforces — it is a query
    // this platform cannot express. Asserted on the port, because a method
    // without an organization parameter is a method that will eventually be
    // called without one.
    const ports = reuseSources.find((file) => file.path.includes(join('persistence', 'ports.ts')));
    assert.ok(ports, 'the reuse storage port must exist');
    const contract = ports.text.slice(
      ports.text.indexOf('export interface ReusableResultStore'),
      ports.text.indexOf('export const DEFAULT_CANDIDATE_LIMIT'),
    );
    assert.ok(contract.length > 200, 'the store interface must be found');
    for (const method of ['getById', 'findExact', 'invalidate', 'listByDependency']) {
      assert.match(
        contract,
        new RegExp(`${method}\\([\\s\\S]{0,40}organizationId`),
        `${method} must take an organization`,
      );
    }
    assert.match(contract, /findCandidates\(query: ReuseCandidateQuery\)/);
    assert.match(ports.text, /interface ReuseCandidateQuery[\s\S]{0,200}readonly organizationId: string;/);
  });

  it('holds no clock and no randomness — every reuse decision is reproducible', () => {
    // A reuse decision that cannot be reproduced from its inputs cannot be
    // explained after an incident. Times arrive as numbers on the request, so a
    // verdict is a pure function of a record and a request.
    assert.deepEqual(
      offenders(reuseSources, /\bMath\.random\s*\(|\bcrypto\.getRandomValues\s*\(/),
      [],
    );
    assert.deepEqual(
      strippedOffenders(reuseSources, /\bDate\.now\s*\(|new\s+Date\s*\(/),
      [],
      'the reuse tree reads a clock instead of taking a time',
    );
    const SCHEDULING = /setTimeout\s*\(|setInterval\s*\(|Deno\.cron|new\s+Worker\s*\(|queueMicrotask\s*\(/;
    assert.deepEqual(offenders(reuseSources, SCHEDULING), []);
  });

  it('reuses the existing storage primitives rather than adding a second stack', () => {
    // No new migration and no second database architecture for caching. The
    // durable store uses the same tenant-scoped key builder and the same
    // field-named compare-and-swap contract the agent and workflow stores use.
    const kv = reuseSources.find((file) =>
      file.path.includes(join('persistence', 'kvReusableResultStore.ts')),
    );
    assert.ok(kv, 'the durable reuse store must exist');
    assert.match(kv.text, /tenantScopedKey/);
    assert.match(kv.text, /isolationKeyFor/);
    assert.match(kv.text, /compareAndSwap\(key, VERSION_FIELD, 0,/);
    assert.deepEqual(
      offenders(reuseSources, /createClient\s*\(|new\s+Pool\s*\(|\bredis\b|\bmemcached\b/i),
      [],
      'the reuse tree opens its own storage stack',
    );
  });

  it('adds no HTTP route, dashboard, admin surface or financial intelligence', () => {
    const SURFACE = /\bapp\.(get|post|put|patch|delete)\s*\(|new\s+Hono\s*\(|Response\s*\(/;
    assert.deepEqual(offenders(reuseSources, SURFACE), []);
    for (const directory of ['http', 'routes', 'admin', 'financial']) {
      assert.equal(
        existsSync(join(SERVER_ROOT, 'ai', 'reuse', directory)),
        false,
        `Part 6B ships no ${directory} surface`,
      );
    }
    // Financial Intelligence is Part 6C. `metrics/` produces the figures it will
    // read and produces nothing else.
    assert.deepEqual(
      strippedOffenders(reuseSources, /optimizationScore|financialIntelligence|dashboard/i),
      [],
    );
  });
});

/**
 * AI-01 Batch 3B Part 6C added a Financial Intelligence engine. It is the layer
 * that finally SAYS how much Cortex saved — and that makes it the layer with the
 * most to gain from a flattering error and the least external check on one.
 *
 * An avoided call has no invoice. An unsettled call has no invoice yet. A 90%
 * claim is not something a provider bill contradicts. Every other number in this
 * platform can eventually be reconciled against money that moved; the headline
 * reduction cannot, so its correctness rests on the structure of the code that
 * produces it.
 *
 * Four claims, narrow and absolute:
 *
 *   IT IS A VIEW, NOT A SECOND LEDGER. No savings record is built here.
 *   IT IS READ-ONLY. No budget, no execution, no authority is ever granted.
 *   UNSETTLED IS NEVER READ AS ZERO.
 *   THE TARGET IS DECIDED ON INTEGERS, NOT ON A ROUNDED PERCENTAGE.
 *
 * A behavioural test can show the reporting path is honest. Only a source scan
 * can show there is no second one beside it.
 */
describe('financial intelligence boundary', () => {
  const FINANCIAL_DIR = join(SERVER_ROOT, 'ai', 'financial') + sep;
  const financialSources = serverSources.filter(
    (file) => file.path.startsWith(FINANCIAL_DIR) && !isTest(file),
  );

  it('scans a non-empty financial tree', () => {
    assert.ok(
      financialSources.length >= 10,
      `expected the financial tree, found ${financialSources.length}`,
    );
  });

  it('NEVER REACHES A PROVIDER: no adapter, no vendor, no credential, no invoke', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(financialSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(financialSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(financialSources, CREDENTIAL), []);
    assert.deepEqual(offenders(financialSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('never holds the control plane, an orchestrator or a tool gateway', () => {
    const PLANE_IMPORT = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    assert.deepEqual(offenders(financialSources, PLANE_IMPORT), []);
    const EXECUTION_IMPORT =
      /from\s+['"][^'"]*(agents\/(orchestrator|service|tools|approvals|registry)\/|workflows\/(engine|service|approvals)\/|tools\/toolRegistry|prompts\/[a-z]|pipeline\/)/;
    assert.deepEqual(offenders(financialSources, EXECUTION_IMPORT), []);
    const TOOL_CALL = /\b(toolGateway|gateway)\s*\.\s*(execute|invoke|call)\s*\(/;
    assert.deepEqual(offenders(financialSources, TOOL_CALL), []);
  });

  it('IS NOT A SECOND SAVINGS LEDGER', () => {
    // Part 6C READS Part 6A's savings partition. Building one here would be a
    // second partition of the same gap, and the two would eventually both be
    // counted — the exact double count Part 6A made unrepresentable.
    assert.deepEqual(
      strippedOffenders(
        financialSources,
        /buildSavingsRecord|reconcileSavings\b|estimateBaselineCost|projectOptimizedCost/,
      ),
      [],
      'the financial tree builds or reconciles a Part 6A savings record',
    );
    // Every money figure originates on a plan, an entry or a usage row.
    const ledger = financialSources.find((file) =>
      file.path.includes(join('ledger', 'financialEventLedger.ts')),
    );
    assert.ok(ledger, 'the financial event ledger must exist');
    assert.match(ledger.text, /plan\.savings\.baselineCostMicroUsd/);
    assert.match(ledger.text, /plan\.savings\.entries/);
  });

  it('MUTATES NO BUDGET and grants no authority', () => {
    // Financial Intelligence reports on budgets and must never change one. The
    // guarantee is that it holds no engine and no ledger to change.
    assert.deepEqual(
      offenders(financialSources, /BudgetEngine|BudgetLedger|createInMemoryBudgetLedger|createDurableBudgetLedger/),
      [],
      'the financial tree holds a budget engine or ledger',
    );
    assert.deepEqual(
      strippedOffenders(financialSources, /\.\s*(charge|record)\s*\(/),
      [],
      'the financial tree charges or records spend',
    );
    // And it cannot resolve an actor, evaluate a capability or decide anything
    // about permission. It CHECKS supplied evidence and can never produce it.
    const AUTHORITY_RESOLUTION =
      /resolveAdminActor|resolveAgentActor|requireCapability|requireAgentCapability|requireWorkflowCapability|createAIGuard|createPolicyEngine|createSpendLedger|createProviderSelector/;
    assert.deepEqual(offenders(financialSources, AUTHORITY_RESOLUTION), []);
  });

  it('IS NOT A PROVIDER SELECTOR, though it names providers for attribution', () => {
    // Part 6C is the one AI subsystem that legitimately carries provider and
    // model NAMES: cost-by-model is a required view. Identity is all they are —
    // there is no selection, no routing and no resolution here.
    assert.deepEqual(offenders(financialSources, /routeModelProfile|selectProvider|resolveModel/), []);
    const event = financialSources.find((file) =>
      file.path.includes(join('contracts', 'event.ts')),
    );
    assert.ok(event, 'the financial event contract must exist');
    assert.match(event.text, /interface ProviderIdentity/);
  });

  it('NEVER READS AN UNSETTLED COST AS ZERO', () => {
    // The single most dangerous simplification available to this engine. The
    // defence is structural: `actualCostMicroUsd` is optional, a settled event is
    // REQUIRED to carry one and an unsettled event is required not to, so the
    // two cannot be confused by a defaulting expression.
    const event = financialSources.find((file) =>
      file.path.includes(join('contracts', 'event.ts')),
    );
    assert.ok(event);
    assert.match(event.text, /readonly actualCostMicroUsd\?: number;/);
    assert.match(event.text, /const settled = event\.settlementState === 'settled';/);

    // `?? 0` on an actual cost appears ONLY inside the settled branch of the
    // fold, where the structural check has already guaranteed a measurement.
    const settlement = financialSources.find((file) =>
      file.path.includes(join('engine', 'settlement.ts')),
    );
    assert.ok(settlement, 'the settlement fold must exist');
    const others = financialSources.filter(
      (file) => file !== settlement && !file.path.includes(join('engine', 'outcomeEconomics.ts')) &&
        !file.path.includes(join('engine', 'wasteAnalysis.ts')),
    );
    assert.deepEqual(
      strippedOffenders(others, /actualCostMicroUsd\s*\?\?\s*0/),
      [],
      'an unsettled cost is being defaulted to zero outside the settlement fold',
    );
  });

  it('DECIDES THE TARGET ON INTEGERS, NEVER ON A ROUNDED PERCENTAGE', () => {
    // 89.95% displays as 90.0 under any sane rounding. If achievement were
    // computed from the displayed value, a platform 0.05 points short would
    // announce success — so the comparison is integer multiplication.
    const target = financialSources.find((file) =>
      file.path.includes(join('engine', 'targetProgress.ts')),
    );
    assert.ok(target, 'the target progress engine must exist');
    assert.match(
      target.text,
      /realizedSavings \* 100 >= realizedBaseline \* TARGET_REDUCTION_PERCENT/,
      'achievement must be decided by integer comparison',
    );
    // `achieved` is assigned in exactly one place, from the assessment.
    // Assigned in exactly one place, from the assessment. The interface's own
    // `readonly achieved` declaration is not an assignment and is not counted.
    assert.equal(
      (stripComments(target.text).match(/^\s+achieved: /gm) ?? []).length,
      1,
      'the achieved flag is set in more than one place',
    );
    assert.match(target.text, /achieved: assessment === 'target_met_on_settled_data'/);
    assert.equal(
      /achieved:\s*realizedReductionPercent/.test(target.text),
      false,
      'achievement is being decided from the rounded display percentage',
    );
  });

  it('holds no clock and no randomness — every report is reproducible', () => {
    // A financial figure that cannot be recomputed from its inputs cannot be
    // defended. Windows and event times arrive as numbers.
    assert.deepEqual(
      offenders(financialSources, /\bMath\.random\s*\(|\bcrypto\.getRandomValues\s*\(/),
      [],
    );
    assert.deepEqual(
      strippedOffenders(financialSources, /\bDate\.now\s*\(|new\s+Date\s*\(/),
      [],
      'the financial tree reads a clock instead of taking a time',
    );
    const SCHEDULING = /setTimeout\s*\(|setInterval\s*\(|Deno\.cron|new\s+Worker\s*\(|queueMicrotask\s*\(/;
    assert.deepEqual(offenders(financialSources, SCHEDULING), []);
  });

  it('adds no ML forecasting and no model-generated financial analysis', () => {
    // A forecast nobody can recompute is a forecast nobody can challenge. Burn
    // rate is settled spend divided by window days, and that is the whole model.
    const ML = /regression|forecastModel|trainModel|neuralNet|\bpredictor\b|anomalyScore|llmAnalysis/i;
    assert.deepEqual(strippedOffenders(financialSources, ML), []);
    const burn = financialSources.find((file) =>
      file.path.includes(join('engine', 'burnRate.ts')),
    );
    assert.ok(burn, 'the burn rate engine must exist');
    assert.match(burn.text, /readonly isEstimate: true;/);
  });

  it('scopes every read and every store method to one organization', () => {
    const ports = financialSources.find((file) =>
      file.path.includes(join('persistence', 'ports.ts')),
    );
    assert.ok(ports, 'the financial event store port must exist');
    const contract = ports.text.slice(
      ports.text.indexOf('export interface FinancialEventStore'),
      ports.text.indexOf('export function boundedEventLimit'),
    );
    assert.ok(contract.length > 150, 'the store interface must be found');
    assert.match(contract, /getById\(organizationId: string/);
    assert.match(
      ports.text,
      /interface FinancialEventQuery[\s\S]{0,300}readonly organizationId: string;/,
    );

    // The platform-wide aggregate is a sum of tenant-scoped reads and demands
    // authority it cannot grant. There is no query in the tree spanning tenants.
    const service = financialSources.find((file) =>
      file.path.includes(join('service', 'financialReadModels.ts')),
    );
    assert.ok(service, 'the financial read models must exist');
    assert.match(service.text, /financial_authority_required/);
    assert.match(service.text, /interface PlatformFinancialAuthority/);
  });

  it('exposes no way to delete or rewrite a financial event', () => {
    // A financial ledger somebody can edit proves nothing about spend. The
    // absence of the writer IS the guarantee.
    const MUTATION =
      /\b(deleteEvent|removeEvent|purgeEvent|clearEvents|rewriteEvent|updateEvent|adjustCost|overrideCost)\b/;
    assert.deepEqual(offenders(financialSources, MUTATION), []);
  });

  it('reuses the existing storage primitives rather than adding a second stack', () => {
    const kv = financialSources.find((file) =>
      file.path.includes(join('persistence', 'kvFinancialEventStore.ts')),
    );
    assert.ok(kv, 'the durable financial store must exist');
    assert.match(kv.text, /tenantScopedKey/);
    assert.match(kv.text, /isolationKeyFor/);
    assert.match(kv.text, /compareAndSwap\(key, VERSION_FIELD, 0,/);
    assert.deepEqual(
      strippedOffenders(
        financialSources,
        /createClient\s*\(|new\s+Pool\s*\(|\bredis\b|\bmemcached\b|\bclickhouse\b|\bolap\b/i,
      ),
      [],
      'the financial tree opens its own storage stack',
    );
  });

  it('adds no HTTP route, dashboard or admin surface', () => {
    const SURFACE = /\bapp\.(get|post|put|patch|delete)\s*\(|new\s+Hono\s*\(|Response\s*\(/;
    assert.deepEqual(offenders(financialSources, SURFACE), []);
    for (const directory of ['http', 'routes', 'admin', 'ui']) {
      assert.equal(
        existsSync(join(SERVER_ROOT, 'ai', 'financial', directory)),
        false,
        `Part 6C ships no ${directory} surface`,
      );
    }
  });

  it('keeps the dependency one-way: Part 6A and 6B never import Part 6C', () => {
    // The earlier parts stay reviewable without reading this one, and a cycle
    // would let a reporting change alter the accounting it reports on.
    const upstream = serverSources.filter(
      (file) =>
        (file.path.startsWith(join(SERVER_ROOT, 'ai', 'optimization') + sep) ||
          file.path.startsWith(join(SERVER_ROOT, 'ai', 'reuse') + sep)) &&
        !isTest(file),
    );
    assert.deepEqual(
      offenders(upstream, /from\s+['"][^'"]*financial\//),
      [],
      'an upstream accounting tree imports the financial reporting tree',
    );
  });
});

/**
 * AI-01 Batch 3B Part 7B added the platform's first BUSINESS capability: a
 * domain agent, its tools, and the workflow that drives them. It sits outside
 * both trees the scans above protect, and that is deliberate — it is neither
 * the agent runtime nor the workflow engine, it is a consumer of both.
 *
 * Which is exactly why it needs its own boundary. A business capability is the
 * first place in this platform where somebody will be tempted to "just call the
 * engines directly", "just write the submission back", or "just mark it
 * approved" — and every one of those shortcuts steps outside a control that the
 * two batches above spent their whole scope establishing.
 */
describe('business capability boundary', () => {
  const BUSINESS_DIR = join(SERVER_ROOT, 'ai', 'business') + sep;
  const businessSources = serverSources.filter(
    (file) => file.path.startsWith(BUSINESS_DIR) && !isTest(file),
  );

  it('scans a non-empty business tree', () => {
    assert.ok(
      businessSources.length >= 8,
      `expected the business tree, found ${businessSources.length}`,
    );
  });

  it('never imports a provider adapter, names a vendor or reads a credential', () => {
    const PROVIDER_IMPORT = /from\s+['"][^'"]*providers\/(openai|anthropic|mock)Provider\.ts['"]/;
    assert.deepEqual(offenders(businessSources, PROVIDER_IMPORT), []);
    const VENDOR = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    assert.deepEqual(offenders(businessSources, VENDOR), []);
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    assert.deepEqual(offenders(businessSources, CREDENTIAL), []);
  });

  it('holds no orchestrator, no control plane and no engine', () => {
    // A business capability DECLARES an agent, tools and a workflow. It never
    // drives one. Holding an orchestrator would let it start an agent run
    // outside the runtime that governs agent runs, which is the whole of what
    // the agent runtime is for.
    const PLANE = /from\s+['"][^'"]*controlPlane\.ts['"]/;
    const ORCHESTRATOR =
      /from\s+['"][^'"]*(agents\/orchestrator\/|agents\/agentRuntime\.ts|workflows\/engine\/|workflows\/workflowRuntime\.ts)/;
    assert.deepEqual(offenders(businessSources, PLANE), []);
    assert.deepEqual(offenders(businessSources, ORCHESTRATOR), []);
    assert.deepEqual(offenders(businessSources, /\.\s*invoke\s*\(\s*\{/), []);
  });

  it('never writes an approval state or spends an approval', () => {
    // The commit precondition READS approval records and refuses on what it
    // finds. A capability that could write one, or consume one, would be a
    // second path to "this was approved" — and the platform has one, in the
    // workflow approval gate.
    assert.deepEqual(
      offenders(
        businessSources,
        /approvalState:\s*'(approved|rejected|consumed|expired|withdrawn)'/,
      ),
      [],
      'a business module writes an approval state',
    );
    assert.deepEqual(
      offenders(businessSources, /approvals\s*\.\s*(decide|consume|request|save)\s*\(/),
      [],
      'a business module decides, spends or requests an approval',
    );
  });

  it('exposes no writer for a submission, an answer or a submission status', () => {
    // Part 7A: the readiness manager may not alter a submission, a diagnostic
    // answer or a submission status. The guarantee is the ABSENCE of a writer
    // on the dossier port, which a behavioural test cannot prove.
    const ports = businessSources.filter((file) =>
      file.path.endsWith(join('persistence', 'ports.ts')),
    );
    assert.equal(ports.length, 1, 'the diagnostic persistence port must exist');
    const WRITER =
      /interface DiagnosticDossierStore[\s\S]*?\n\}/.exec(ports[0].text)?.[0] ?? '';
    assert.ok(WRITER.includes('load('), 'the dossier port reads');
    for (const method of ['save(', 'put(', 'update(', 'create(', 'delete(', 'setStatus(']) {
      assert.equal(
        WRITER.includes(method),
        false,
        `the dossier port exposes ${method} — a submission must not be writable`,
      );
    }
  });

  it('computes the authority in exactly one module', () => {
    // A second implementation of the readiness chain would not weaken the
    // first — it would replace it for whatever flowed through it.
    const producers = businessSources.filter((file) =>
      /export function computeReadinessAuthority/.test(file.text),
    );
    assert.equal(producers.length, 1, 'the readiness authority has more than one producer');
  });

  it('certifies its first business agent for exactly the chain it declares', () => {
    // Part 7E. Certification is a human decision, and it was made for THIS
    // agent, THESE five tools and THIS workflow. What the scan holds is the
    // shape of that decision: the certified tool set is the agent's own allow
    // list, so a sixth certified business tool cannot arrive as a side effect
    // of certifying an agent.
    const agent = businessSources.find((file) =>
      file.path.endsWith(join('agent', 'readinessManagerAgent.ts')),
    );
    assert.ok(agent, 'the readiness manager definition must exist');
    assert.match(agent.text, /certification:\s*'certified'/);

    const tools = businessSources.find((file) =>
      file.path.endsWith(join('tools', 'diagnosticTools.ts')),
    );
    assert.ok(tools, 'the diagnostic tools must exist');
    const certified = [...stripComments(tools.text).matchAll(/certification:\s*'certified'/g)];
    assert.equal(certified.length, 5, 'exactly the five declared tools are certified');
    assert.equal(
      /certification:\s*'revoked'/.test(tools.text),
      false,
      'a diagnostic tool ships revoked',
    );

    // NO OTHER BUSINESS AGENT IS CERTIFIED. One certification decision, one
    // capability chain — a second business agent riding in on this one would be
    // an agent nobody reviewed.
    const agents = businessSources.filter((file) =>
      /:\s*AgentDefinition\s*=/.test(stripComments(file.text)),
    );
    assert.deepEqual(
      agents.map((file) => relative(SERVER_ROOT, file.path)),
      [relative(SERVER_ROOT, agent.path)],
    );
  });

  it('keeps every record of record off an in-memory store', () => {
    // Part 7D, F2. The committed review is the business record of a human
    // decision AND the row that refuses a replayed commit, so an evicting
    // isolate-local store under it does not merely lose data — it reopens the
    // replay window. After Part 7D there is no memory implementation of the
    // draft, escalation or committed-review ports anywhere in the tree, which
    // is a stronger statement than "the default is durable".
    const offenders = businessSources
      .filter((file) => /createMemory(ReviewDraft|Escalation|CommittedReview)Store/.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(offenders, [], 'a record of record has an in-memory implementation');

    const assembly = businessSources.find((file) =>
      file.path.endsWith(join('diagnostic', 'index.ts')),
    );
    assert.ok(assembly, 'the diagnostic assembly must exist');
    // The assembly reaches the durable stores and nothing else. An import of
    // the fixture module here would be the defect returning by another door.
    assert.match(assembly.text, /createKvDiagnosticStores/);
    assert.equal(
      /memoryStores\.ts/.test(assembly.text),
      false,
      'the production assembly imports the test-only store module',
    );
  });

  it('fails closed when the capability is assembled without durable storage', () => {
    // The type says `storage` is required; a deployment assembles this from
    // configuration a type cannot see, so the refusal is a runtime one — and it
    // happens at ASSEMBLY rather than at the first commit, which is the last
    // moment a missing guarantee can be refused without a run in flight.
    const assembly = businessSources.find((file) =>
      file.path.endsWith(join('diagnostic', 'index.ts')),
    );
    assert.ok(assembly);
    const code = stripComments(assembly.text);
    assert.match(code, /typeof storage\.compareAndSwap !== 'function'/);
    assert.match(code, /throw new Error\(/);
  });

  it('writes every durable diagnostic record insert-if-absent, under a tenant key', () => {
    // Part 7D, F2. Insert-if-absent is expected version 0; a non-zero expected
    // version anywhere in this module would be an overwrite path, and an
    // overwrite path is how "exactly one committed review per approval"
    // silently becomes "the last one wins".
    const store = businessSources.find((file) =>
      file.path.endsWith(join('persistence', 'kvDiagnosticStores.ts')),
    );
    assert.ok(store, 'the durable diagnostic store must exist');
    const code = stripComments(store.text);

    const expectations = [...code.matchAll(/compareAndSwap\(\s*key,\s*VERSION_FIELD,\s*(\d+)/g)];
    assert.equal(expectations.length, 3, 'three durable writes are expected');
    for (const match of expectations) {
      assert.equal(match[1], '0', 'a durable diagnostic write is not insert-if-absent');
    }
    // Every key is built by the tenant-scoped builder. A template literal key
    // would be a key that could be formed without its organization.
    assert.match(code, /tenantScopedKey\(scope\(organizationId\)/);
    assert.equal(
      /const key = `/.test(code),
      false,
      'a diagnostic storage key is assembled by hand rather than tenant-scoped',
    );
  });

  it('keeps the test-only certification helper out of every other module', () => {
    // `uncertifyForTesting` returns copies with the flags CLEARED so a suite can
    // still drive the refusals certification lifts. Nothing else may call it,
    // and the assembly that defines it is the only place it appears.
    const callers = businessSources
      .filter((file) => !file.path.endsWith(join('diagnostic', 'index.ts')))
      .filter((file) => /certifyForTesting/.test(file.text))
      .map((file) => relative(SERVER_ROOT, file.path));
    assert.deepEqual(callers, [], 'a non-test module calls a certification helper');
  });

  it('declares no external write and no platform tenant scope', () => {
    const tools = businessSources.find((file) =>
      file.path.endsWith(join('tools', 'diagnosticTools.ts')),
    );
    assert.ok(tools);
    const code = stripComments(tools.text);
    assert.equal(
      /sideEffect:\s*'external_write'/.test(code),
      false,
      'a diagnostic tool declares an external write',
    );
    assert.equal(
      /tenantScope:\s*'platform'/.test(code),
      false,
      'a diagnostic tool declares platform tenant scope',
    );
  });

  it('takes its tenant from the invocation and never from a payload', () => {
    const tools = businessSources.find((file) =>
      file.path.endsWith(join('tools', 'diagnosticTools.ts')),
    );
    assert.ok(tools);
    const code = stripComments(tools.text);
    assert.match(code, /invocation\.organizationId/);
    // No input schema may declare an organizationId field. `object()` drops
    // undeclared keys, so declaring one is the only way a payload could supply
    // the tenant — and that is what this forbids.
    assert.equal(
      /inputSchema:\s*object\(\{[^}]*organizationId/s.test(code),
      false,
      'a diagnostic tool accepts an organizationId from its caller',
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
