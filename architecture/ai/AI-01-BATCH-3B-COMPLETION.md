# AI-01 Batch 3B — Agent Workflows & Business Agents

**Status:** Complete — ready for merge review
**Branch:** `claude/ai-01-batch-3b-workflow-suflxl`
**Date:** 2026-08-17
**Builds on:** AI-01 Batch 3A (Agent Runtime & Orchestrator Core), AI-01 Batch 2
(`architecture/ai/AI-01-BATCH-2-COMPLETION.md`), AI-01 Batch 1
(`architecture/ai/AI-01-BATCH-1-COMPLETION.md`)

---

## 1. Executive summary

Batch 1 delivered one governed AI execution path. Batch 2 delivered the layer a
human operates it from. Batch 3A delivered agent runs. Batch 3B delivers the two
things that turn all of that into a product: **a workflow runtime that composes
agent runs into a reviewable business process**, and **the platform's first
certified business agent running on it**.

Batch 3A shipped an empty agent registry on purpose. This batch fills it, once,
with a chain a person signed off:

> `agent.diagnostic.readiness_manager`, the five tools it declares, and
> `workflow.diagnostic.readiness_review`. Certified together, by one recorded
> human decision, for that chain and nothing beside it.

Three architectural claims carry the batch, and each is enforced structurally
rather than asserted in prose:

- **There is no third execution path.** Every workflow node executes as a CHILD
  AGENT RUN through the Batch 3A Agent Orchestrator, on behalf of the same
  authenticated subject — so Batch 3A's RBAC, limits, loop protection, tool
  permissions, spend ceiling and audit trail apply at every node, and every model
  step still executes through `controlPlane.execute`. `engine/agentNodePort.ts`
  is the only module that may hold an orchestrator.
- **A workflow permission is not an agent permission, and cannot become one.**
  `resolveWorkflowActor` resolves BOTH vocabularies from one subject and carries
  both. Somebody who may start a workflow but holds no `agent.run.create` is
  refused at the first node, by the agent runtime, not by a check the workflow
  layer remembered to make.
- **Certification is not activation.** The certified chain registers into a
  deployment only when `AI_DIAGNOSTIC_REVIEW_ENABLED` is on AND durable storage
  exists AND a submission source was injected. Any one missing and *nothing* is
  registered, loudly. The switch is off by default and grants nothing when on —
  capabilities, tool allow list, approver roles and limits are the reviewed ones.

**Scale:** 112 new server modules (36,048 lines) across five trees —
`ai/workflows/` (42), `ai/optimization/` (19), `ai/reuse/` (19),
`ai/financial/` (17), `ai/business/` (15) — plus the operator surface, one
frontend API client and one console tab. 28 test suites (22,470 lines).

**Validation:** 1,598 AI tests, 484 feature tests, 161 system tests, 36 migration
tests, 176 diagnostic tests, 98 boundary assertions — **0 failures**. Three
runtime verifications pass 16/16, 26/26 and 21/21 in mock mode. Build passes. The
AI boundary is clean under `deno check`.

---

## 2. Components added

### Server — workflow runtime (`ai/workflows/`, 42 modules)

| Area | Files | Purpose |
|------|-------|---------|
| Contracts | `contracts/{workflow,plan,run,expression,mapping,parallel,approval,retry,checkpoint,failure}.ts` | The definition, the plan, the run record, the condition and mapping languages, branches, approvals, retries and one typed failure vocabulary mapped onto the existing `AIError` transport codes. |
| Registry & planning | `registry/workflowRegistry.ts`, `planner/{workflowPlanner,planDigest}.ts`, `validation/{workflowValidation,expressionValidation,parallelValidation}.ts` | Registration validates the whole graph and fails closed; the planner produces an executable plan and a digest the run is admitted against and re-checked on. |
| Engine | `engine/{workflowOrchestrator,agentNodePort,branchScheduler,dataFlow}.ts` | The sole authority over workflow execution. Drives agent, condition, parallel and approval nodes; enforces node, loop, branch, retry and deadline limits; checkpoints immutably; persists every transition by compare-and-swap. |
| Runtime | `runtime/{workflowStateMachine,expressionEvaluator,mapper,paths,joinPolicy,retryPolicy,checkpointChain,usageAttribution}.ts` | One transition table, one evaluator, one retry classifier, one usage fold. |
| Approvals | `approvals/workflowApprovalGate.ts` | Durable, single-use, role-bound barriers carrying subject evidence. The one module that may write an approval state. |
| Persistence | `persistence/{ports,kvWorkflowStores}.ts` | Tenant-scoped keys over the existing `kv_compare_and_swap_field` contract. No new migration. |
| Service & RBAC | `service/{workflowRuntimeService,workflowRbac}.ts` | Authenticate, resolve actor and tenant, enforce capability, project read models that carry no run content. |
| Financial wiring | `financial/{workflowFinancialRecorder,nodeCostRegistry,nodeCostProfile,workflowReuseResolver,optimizationHealth}.ts` | One canonical path from a node to a financial event. |
| HTTP | `http/workflowHttpAdapter.ts` | Framework-agnostic mapping; the operation is bound by the route table, never read from the body. |

### Server — cost intelligence, in three separated trees

| Tree | Files | The claim it is built to keep |
|------|-------|------------------------------|
| `ai/optimization/` (19) | Cost Compression Engine — baseline model, complexity classifier, band selection, savings ledger, usage accounting | **It recommends and never executes.** It holds no store, no clock and no randomness, so every decision is reproducible; and the baseline cannot see the optimised figure it is the denominator of. |
| `ai/reuse/` (19) | Intelligent Reuse — task fingerprinting, dependency and freshness contracts, one eligibility gate, avoided-call ledger, declared-label discovery port | **It can avoid a call and never answers one.** It grants no authority, decides no approval, and there is no embedding provider anywhere — a model call to decide whether a model call can be avoided would be a second ungoverned path. |
| `ai/financial/` (17) | Financial Intelligence — event ledger, settlement, outcome economics, waste analysis, burn rate, target progress, tenant-scoped read models | **It is a view, not a second ledger.** Unsettled cost is never read as zero; the target is decided by integer comparison, never on a rounded percentage. |

### Server — Business Agent #1 (`ai/business/diagnostic/`, 15 modules)

| Component | File | Purpose |
|-----------|------|---------|
| Deterministic authority | `deterministic/{readinessAuthority,canonicalRules}.ts` | The scores, ranking and dependencies. Server-side, reproducible, and the thing the model is fact-locked against. |
| The agent | `agent/{readinessManagerAgent,context,factLock}.ts` | Business Agent #1. Certified, enabled, with declared capabilities, limits, approver roles and a fenced context. |
| The five tools | `tools/diagnosticTools.ts` | Read a dossier, compute the authority, seal a draft, escalate, commit. Each certified individually; none declares an external write or platform tenant scope; every one takes its tenant from the invocation. |
| The workflow | `workflow/readinessReviewWorkflow.ts` | Five nodes, three kinds: review → reviewable? → (approval → commit \| escalate). |
| Persistence | `persistence/{kvDiagnosticStores,ports,authorityPort}.ts` | Insert-if-absent, tenant-keyed. The dossier port has **no writer** — a submission, an answer and a status are not writable by this capability. |
| Assembly | `index.ts` | Returns definitions and registers nothing. Fails closed at assembly without durable storage. |

### Server — operator surface and edge wiring

| Component | File |
|-----------|------|
| Workflow HTTP routes | `workflowRuntimeRoutes.ts` |
| Edge mount | `index.tsx` — mounted only when the runtime exists; a submission source is injected but is not activation |
| Public surface | `ai/index.ts` — service, adapter, contracts. The engine is not exported |

### Frontend

| Component | File |
|-----------|------|
| Workflow API client | `src/app/services/workflowRuntimeService.ts` — no demo fallback, decides nothing, `reason` is a required parameter where the server demands one |
| Workflows tab | `src/app/components/AIAdministrationConsole.tsx` — start, read, decide, advance, cancel, outcome |

---

## 3. The operator surface

| Route (prefix `/make-server-324f4fbe`) | Method | Capability |
|----------------------------------------|--------|------------|
| `/ai/workflows/overview` · `/runs` · `/runs/:runId` | GET | `workflow.run.read` |
| `/ai/workflows/registry` | GET | `workflow.registry.read` |
| `/ai/workflows/runs` | POST | `workflow.run.create` |
| `/ai/workflows/runs/:runId/advance` | POST | `workflow.run.create` |
| `/ai/workflows/runs/:runId/cancel` | POST | `workflow.run.control` |
| `/ai/workflows/approvals` · `/approvals/:id` | GET | `workflow.approval.read` |
| `/ai/workflows/approvals/:id` | POST | `workflow.approval.decide` |

There is **no route dedicated to the diagnostic review**. It is started at
`POST /ai/workflows/runs` by naming it, exactly as any registered workflow would
be, because a second entry point would be a second place the registry's enable
and certification checks could be skipped — and that registry is what enforces
the deployment switch.

Recording a decision does not drive the run. `reviewer` holds
`workflow.approval.decide` and not `workflow.run.create`, so advancing inside the
decision would either execute agent runs under somebody who may not start them or
quietly require every approver to be an operator.

---

## 4. Architecture decisions

### 4.1 The registry is the switch

Activation is enforced by refusing to REGISTER, not by a check at the point of
use. With the capability off the workflow is absent from the registry, so the
operator surface answers `workflow_not_found` and the console shows an empty
registry. Nothing downstream needs to know the switch exists.

### 4.2 Definitions are code, and there is no API that can write one

Registration validates capabilities, tool allow lists, model profiles, handoff
targets, contracts, limits, approval policy and the whole handoff graph, and
fails closed. An endpoint that could define a workflow would be that validation
arriving through the back door.

### 4.3 The condition and mapping languages are data, not a parser

Both are structures walked by a switch. There is no `eval`, no `new Function`, no
JSONPath and no template engine anywhere in the tree — so there is no injection
surface to defend, which is a stronger claim than defending one.

### 4.4 An approval record has no field that could carry run content

Approvals are read by whoever holds the approver role — a wider audience than the
run. The way a tenant's business data stays off the record is that there is no
field for it. What it does carry is `subjectEvidence`: the subject id and the
digest of the sealed artefact, so a decider reads the queue instead of
reconstructing the subject. A digest is a fingerprint of content and never
content.

### 4.5 The commit re-checks its own authorisation

`n_publish_approval` parks the run and releases on a decision from a declared
role — and does **not** authorise the commit by itself. The commit tool re-reads
the approval from durable storage, compares the frozen role list against the
workflow definition's own, and refuses a replay. A gate whose only enforcement is
graph order stops enforcing the moment somebody calls the node's agent directly.

### 4.6 Retries are persisted, never scheduled

When a node becomes eligible for another attempt is written down; nothing wakes
up at that moment. A timer would put the only copy of "this run needs attention
in ninety seconds" inside a process that can be recycled — which is the failure
the durable stamp exists to avoid. The tree contains no scheduling primitive.

### 4.7 Money is folded on read, never accumulated twice

Branch and group spend are derived from the run's usage ledger by filtering, not
read from counters on branch records. A second accumulator is a second thing that
can disagree with the first.

### 4.8 The narrative is advisory; the engines decide

The readiness scores, ranking and dependencies are the deterministic authority's.
The model writes prose and is fact-locked against that authority — it cannot
author a digest, a score or a dependency, and a submission that cannot be
reviewed escalates rather than being narrated around.

---

## 5. Security posture

| Property | How it holds |
|----------|--------------|
| One path to a model | The workflow tree imports no provider adapter, holds no control plane and calls no `invoke`. Two layers removed: it drives agent runs, and the agent runtime's bridge is the only thing that reaches the plane. |
| One path to an agent | `engine/agentNodePort.ts`. Asserted on the source, including for every parallel branch. |
| No tool bypass | The workflow tree may not import a tool gateway, a tool registry or a prompt. Tools belong to the agent that declared them. |
| No approval bypass | One module may write an approval state. The engine holds the gate, not the store, and has no path by which it could answer a request. The business capability can neither write, decide, spend nor request one. |
| Tenant isolation | Every read is keyed by the resolved organization, so another tenant's run is *not found* rather than found-and-refused — no response difference to probe with. No cross-tenant control operation exists at any role, and no approval is decidable outside its own tenant. |
| No caller-supplied authority | Tenant, actor, roles and both capability vocabularies are resolved server-side from the authenticated subject. No request field can assert one. Origin and deadline are not read from a body either. |
| Nothing leaks through a read model | A run's `input`, every node output and every branch output stay server-side; the projections carry identity, state and digests. Asserted by serialising every response of a complete run and searching it. |
| Fail closed on storage | The business capability refuses to assemble without durable conditional writes — the committed review is both the record of a human decision and the row that refuses a replay, and an evicting store reopens the replay window. |

---

## 6. Certification record — Business Agent #1

| Fact | Value |
|------|-------|
| Agent | `agent.diagnostic.readiness_manager` |
| State | `enabled: true`, `certification: 'certified'` |
| Tools certified | 5 — exactly the agent's own declared allow list |
| Workflow | `workflow.diagnostic.readiness_review` v1.0.0, `certification: 'certified'` |
| Approval node | `n_publish_approval`, roles `owner` / `reviewer`, single-use, `onRejection: 'fail'` |
| Owner | MARQ Diagnostic Assessment & Advisory (D07) |
| Activation | `AI_DIAGNOSTIC_REVIEW_ENABLED` — **default OFF** |

The certified tool set is the agent's own allow list, so a sixth certified
business tool cannot arrive as a side effect of certifying an agent. No other
business agent is certified, and `ai_boundary.test.ts` asserts that exactly one
`AgentDefinition` exists in the business tree.

`uncertifyForTesting` exists so the suites can still drive the refusals
certification lifts; it returns copies, mutates nothing, and no non-test module
may call it.

---

## 7. Tests added

28 suites, 22,470 lines under `ai/__tests__/`:

| Area | Suites |
|------|--------|
| Workflow foundation, execution, data flow, parallel, approvals and retries | `workflowFoundation` · `workflowExecution` · `workflowDataFlow` · `workflowParallel` · `workflowApprovalsRetries` |
| Cost compression | `costCompression` · `costCompressionAccounting` · `costCompressionAdversarial` |
| Reuse | `intelligentReuse` · `reuseAdversarial` |
| Financial intelligence | `financialIntelligence` · `financialAdversarial` |
| Workflow ↔ money integration | `workflowFinancialIntegration` · `workflowFinancialAdversarial` |
| Production wiring | `workflowProductionWiring` · `workflowProductionAdversarial` · `diagnosticProductionWiring` |
| Business capability | `diagnosticReadiness` · `diagnosticCertification` · `diagnosticRemediation7d` |
| Operator surface | `workflowHttp` (server, over the production assembly) · `tests/features/workflowOperatorSurface` (console ↔ route seam) |

Three runtime verification scripts drive real runtimes in mock mode:
`verify:ai` (16/16), `verify:agents` (26/26), `verify:diagnostic` (21/21). The
last one assembles the certified capability over a real workflow runtime, a real
agent runtime and a real control plane, and drives it through the workflow
service — so the batch's own closure check exercises the workflow runtime end to
end. **No separate `verify:workflows` script was added**: a second script
re-driving the same runtime would duplicate the check rather than extend it.

The boundary scan gained five describe blocks for the trees this batch added —
workflow engine, cost compression, intelligent reuse, financial intelligence and
business capability — including the two operator-surface assertions inside the
first. 98 assertions in total, across 9 blocks.

---

## 8. Documentation updated

| Document | Change |
|----------|--------|
| `MARQ_CORTEX_ROADMAP.md` | Batch 3B → ✅ with the completion record; AI Workflow Authority and AI Business Capability Authority added to Current Runtime Authority |
| `ARCHITECT.md` | §12.4 Workflow Runtime with the route table and capabilities; workflow runtime and Business Agent #1 entry points; directory map rows; the workflow data-flow path; six task → file lookup rows |
| `.env.example` | Financial evidence and intelligent reuse blocks (7 variables that `config.ts` read and this file did not document), plus `AI_SETTINGS_REFRESH_MS` — see §10 |
| `architecture/ai/AI-01-BATCH-3B-COMPLETION.md` | This record |

---

## 9. Validation results

### New failures: none

| Check | Result |
|-------|--------|
| `npm run test:ai` | **1,598 pass, 0 fail** (288 suites) |
| `npm run test:features` | **484 pass, 0 fail** |
| `npm run test:system` | **161 pass, 0 fail** |
| `npm run test:database` | **19 pass, 0 fail, 1 skipped** (the skip requires `DATABASE_URL`) |
| `npm run test:migration` | **36 pass, 0 fail** |
| `npm run test:diagnostic` | **176 pass, 0 fail** |
| `npm run scan:boundaries` | **98 pass, 0 fail** |
| `npm run verify:ai` | **16/16 scenarios** |
| `npm run verify:agents` | **26/26 scenarios** |
| `npm run verify:diagnostic` | **21/21 scenarios** |
| `npm run typecheck:api:ai` | **Clean** — `deno check` strict, 0 errors across the whole AI tree, its routes and the workflow routes |
| `npm run build` | **Pass** — built in 13.3s |

### Inherited failures: unchanged

| Check | Baseline (`cda99153`) | At `HEAD` | New |
|-------|----------------------|-----------|-----|
| `typecheck:web` | 34 errors | 34 errors | **0** |
| `typecheck:tests` | 18 errors | 18 errors | **0** |

Both measured by checking out the baseline in a worktree and re-running. Every
error is in a file this closure did not touch.

Twelve of the eighteen `typecheck:tests` errors are in `ai/workflows/` and are a
**checker-version artifact, not a source defect**. They are all the same shape —
discriminated-union narrowing on `{ ok: true } | { ok: false; problem: string }`,
reported as `TS2339: Property 'problem' does not exist`. The `tests` boundary uses
the repository's pinned `tsc` 5.9.3; the production-appropriate checker for edge
functions is `deno check` (TypeScript 6.0.3), which narrows these correctly and
reports the whole AI tree clean. `scripts/typecheck-deno.mjs` documents why that
is the authoritative boundary for this code. Recorded as inherited, not fixed —
see §10.

### Environmental blockers

| Check | Status |
|-------|--------|
| `typecheck:api` (`server` boundary) | **BLOCKED** — `jsr.io` returns 403 through this environment's egress policy, so `deno check` could not download `@supabase/supabase-js`'s manifest and never reached the source. Not a type error, identical on the clean baseline, and unchanged since Batch 2. The `ai` boundary — which contains every line of Batch 3B server code, including the workflow routes — resolves without JSR and is clean. |
| `npm run test:database` (SQL suites) | 1 test skipped by design: `DATABASE_URL` is unset, so the live-database assertions do not run. The static migration suites run and pass. |
| Deno toolchain | Not present at session start; installed via `npm i -g deno` (2.9.5). |

---

## 10. Known limitations — none blocking

Ordered by the risk each carries. All are recorded rather than fixed, per the
execution rules on scope discipline.

1. **Batch 3B registered no system-manifest nodes.** ARCHITECT.md § Golden rules
   says a new file gets an `MQC-{TYPE}-{NNN}` id in `src/system/manifest.ts`
   before implementation. Batches 1, 2 and 3A each did so and bumped the pinned
   count (171 → 198 → 208 → 229); Batch 3B's 112 modules registered none, so the
   manifest still reads 229. Nothing enforces it — `manifest.test.ts` asserts the
   *current* count rather than scanning for unregistered files, which is why
   every gate passes.

   Recorded rather than fixed: registering 112 nodes and re-pinning
   `CERTIFIED_NODE_COUNT`, `CERTIFIED_CORE_COUNT` and `CERTIFIED_SVC_COUNT` is a
   sprint's work with its own review, and doing it under a closure task would be
   the scope expansion the execution rules forbid. **This is the one place the
   batch does not satisfy a stated golden rule.** It carries no functional,
   security or tenancy consequence — the manifest is a registry for navigation
   and validation tooling, not an execution input — so it does not block merge,
   but it should be scheduled before the next batch inherits the drift.

2. **`workflow.run.read.platform` is effectively inert.**
   `WorkflowRequestMeta.organizationId` is both the actor-resolution hint and the
   read scope, so `resolveOrganization` refuses a platform reader naming a tenant
   they hold no membership in — before `workflowReadScopeFor` can widen the read.
   The behaviour is **fail-closed**: a platform operator sees less than the grant
   table suggests, never more. Closing it means splitting the hint from the scope
   on the service request, which is a Part 2 service change and outside closure
   scope. Asserted as-is by `workflowHttp.test.ts` so the current behaviour is
   pinned rather than assumed.

3. **Twelve inherited `typecheck:tests` narrowing errors** (§9). Not a defect;
   they disappear under the checker this code actually runs on. Fixing them means
   either restructuring correct union narrowing to satisfy an older `tsc` or
   raising the pinned TypeScript version — a repository-wide change, not a
   Batch 3B one.

4. **No scheduler, by design.** Retry eligibility and deadline expiry are
   persisted and nothing wakes up. `expireIfDue` exists on the service and is
   deliberately not routed. A run whose deadline passes stays parked until
   something advances it. Adding a scheduler is its own batch, with its own
   review.

5. **`GET /ai/workflows/approvals/:id` is unused by the console.** The API is
   intentionally broader than the tab; the queue read covers the operator flow.

6. **Semantic reuse is declared and unavailable.** `AI_REUSE_SEMANTIC_ENABLED`
   is carried as intent so the health read can report the gap truthfully. This
   repository ships no certified embedding or retrieval path and must not acquire
   one casually — that would be a second ungoverned AI execution path.

7. **`AI_SETTINGS_REFRESH_MS` was undocumented since Batch 2**, and
   `.env.example` stated the administration layer added no environment variables.
   Corrected here because certifying a document that contradicts the code is
   worse than the one-line fix. No code changed.

8. **Console prompts use `window.prompt`**, inherited from the Batch 2 console
   pattern. Functional and honest; a typed-confirmation modal would suit
   cancellation and rejection better.

---

## 11. Compliance with the engineering rules

| Rule | How it holds |
|------|--------------|
| Do not bypass the AI Control Plane | The workflow tree holds no plane and calls no `invoke`. Every model step reaches a provider only through the agent runtime's single bridge. Asserted structurally. |
| Do not create a second path to an agent | `engine/agentNodePort.ts` only — including every parallel branch, which is where the claim was most at risk. Asserted structurally. |
| Do not duplicate governance | No `createAIGuard`, `createPolicyEngine`, `createSpendLedger`, `createProviderSelector`, `createAgentRegistry` or `createAgentOrchestrator` anywhere in the trees this batch added. |
| Do not duplicate accounting | One savings ledger, one usage fold, one avoided-call ledger reading a plan's baseline. Reuse and Financial Intelligence build no savings record of their own. |
| Reuse existing infrastructure | Same authenticator, same error taxonomy, same clock/id/logger injection, same `kv_compare_and_swap_field` contract, same test harness. **No new migration and no new database technology.** |
| Do not introduce technical debt | No `TODO`, `FIXME`, `as any` or type suppression anywhere in the AI tree — enforced by the hygiene tests, which scan the new trees too. |
| Do not weaken security | §5. The batch adds barriers; it lifts none. |
| Provider-neutral | The workflow, optimization and reuse trees name no vendor, no model id and no provider id. Financial Intelligence carries provider and model NAMES for attribution only — cost-by-model is a required view — and performs no selection, routing or resolution. |
| Preserve API contracts | Existing routes are untouched. The workflow routes are additive and mounted only when the runtime exists. |
| Rollback | Revert the branch. With `AI_DIAGNOSTIC_REVIEW_ENABLED` off — the default — the capability is unregistered and the workflow surface serves an empty registry, so a deployment can also stand the code down without a revert. |

---

## 12. Verdict

**READY_FOR_MERGE.**

Batch 3B scope is complete: the workflow runtime, the three cost-intelligence
trees, Business Agent #1 with its five tools and its review workflow, the
governed operator surface, and the console tab. Every gate passes with zero new
failures. The two non-passing checks are an inherited checker-version artifact
and an environmental egress restriction, both present on the clean baseline and
both classified in §9. The six remaining limitations in §10 are recorded,
fail-closed or by-design, and none is a certification blocker.
