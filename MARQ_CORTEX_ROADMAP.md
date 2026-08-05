# MARQ Cortex Roadmap

Status Legend

✅ Complete
🔄 In Progress
⏳ Planned
⛔ Blocked
❌ Cancelled

---

# Phase 1 — AI Foundation

| Sprint | Name | Status |
|---------|------|--------|
| S1 | Intelligence Gateway | ✅ |
| S2 | Frontend Gateway Normalization | ✅ |

---

# Phase 2 — Data Platform

| Sprint | Name | Status |
|---------|------|--------|
| S3 | Database Architecture | ✅ |
| S4 | Tenancy Foundation | ✅ |
| S5 | Diagnostic Foundation | ✅ |

---

# Phase 3 — KV Migration

| Sprint | Name | Status |
|---------|------|--------|
| S6.1 | Migration Planning | ✅ |
| S6.2 | Migration Infrastructure | ✅ |
| S6.3 | Migration Validation | ✅ |

---

# Phase 4 — Runtime Storage Gateway

| Sprint | Name | Status |
|---------|------|--------|
| S7.1 | Runtime Gateway Planning | ✅ |
| S7.2 | Runtime Gateway Implementation | ✅ |
| S7.3 | Gateway Validation | ✅ |
| S7.4 | Outcome Shadow Read | 🔄 |
| S7.5 | Outcome Validation | ⏳ |
| S7.6 | Lead Shadow Read | ⏳ |
| S7.7 | Submission Shadow Read | ⏳ |
| S7.8 | Full Runtime Validation | ⏳ |

---

# Phase 5 — SQL Cutover

| Sprint | Name | Status |
|---------|------|--------|
| S8.1 | SQL Read Rollout | ⏳ |
| S8.2 | SQL Authority Validation | ⏳ |
| S8.3 | KV Retirement | ⏳ |

---

# Phase 6 — AI Platform

| Sprint | Name | Status |
|---------|------|--------|
| AI-01 Batch 1 | Secure AI Foundation — AI Control Plane | ✅ |
| AI-01 Batch 2 | AI Administration & Operations | ✅ |
| AI-01 Batch 3A | Agent Runtime & Orchestrator Core | ✅ |
| AI-01 Batch 3B | Agent Workflows, Token Optimization & Financial Intelligence | ✅ |

AI-01 Batch 1 completed 2026-07-31. Report:
`architecture/ai/AI-01-BATCH-1-COMPLETION.md`

Delivered: the MARQ Cortex AI Control Plane — the single governed AI execution
path. AI Guard (authentication, authorization, organization and actor
resolution, tenant isolation, request validation, rate limiting), request
context and versioning, policy engine, feature catalog, provider registry with
capability matching, health monitoring, circuit breaker, retry and timeout
management, prompt registry with versioning and hashing, input/output guards,
PII redaction, capability enforcement, budget engine, durable audit, structured
logging, metrics, health monitoring and an event bus. Providers: OpenAI,
Anthropic and a deterministic mock. The Intelligence Gateway, the five legacy
direct-OpenAI paths and the per-feature gateway bypass flags were removed.

AI-01 Batch 2 completed 2026-08-03. Report:
`architecture/ai/AI-01-BATCH-2-COMPLETION.md`

Delivered: the enterprise operational layer over the Batch 1 control plane. A
versioned, persisted operational settings overlay (AI master switch, emergency
kill switch, real-provider switch, default provider, provider priority, model
allow list and default model, retry policy, timeout policy, daily budget
ceilings) that the control plane reads live at the point of use. Server-side
RBAC across Super Admin, Organization Admin and Team Admin, enforced as
capabilities rather than role comparisons. Provider and model management,
budget administration with an authorised reset and a distinct authorised
increase that preserves settled spend, usage and cost analytics, runtime
diagnostics, and an append-only administrative change trail. Every mutation
requires an authorised administrator, a reason and an audit record; rejections
are recorded too. Operator console at the AI Administration settings tab.

The Batch 1 guarantees are untouched: budget enforcement, provider selection,
governance and request authorization each keep exactly one implementation, and
the administration layer cannot reach a provider adapter.

AI-01 Batch 3A completed 2026-08-04.

Delivered: the permanent agent runtime and orchestrator core
(`supabase/functions/server/ai/agents/`). A versioned agent registry that
validates capabilities, allowed tools, model profiles, handoff targets, input
and output contracts, limits and approval policy at registration and fails
closed on resolution. One explicit sixteen-state machine with a central
transition table, immutable terminal states and optimistic concurrency. An
orchestrator that is the sole authority over execution: it validates every
proposal, enforces step, handoff, retry, repeated-action, cycle, no-progress,
deadline, token and cost limits, and reaches a model only through
`controlPlane.execute` via the registered `cortex.agent_step` feature. Durable
runs, immutable versioned checkpoints and single-use human approval gates, all
compare-and-swap persisted so a run survives an isolate restart. A tool
registry and gateway with agent permission, actor permission, tenant scope,
schema validation, timeouts and idempotency, backed by deterministic in-process
tools. Token intelligence with pre-call preflight, post-call reconciliation and
attribution; a cost policy that projects retry and repair risk and decides
between execute, compress, downgrade, reduce, re-plan, ask a human or deny; a
deterministic context builder that fences untrusted content and returns a
manifest; and deterministic model-profile routing that never names a provider.
Secure APIs for run creation, reads, control, approvals and registry, with
tenant-scoped RBAC, plus a read-only Agents tab in the AI Administration
console.

Agents propose. The orchestrator decides. The AI Control Plane executes. No
production business agents ship in this batch: the registry starts empty by
design.

AI-01 Batch 3B completed 2026-08-05.

Delivered: the permanent workflow orchestration, token optimization and financial
intelligence layer (`supabase/functions/server/ai/workflows/`). A versioned
workflow registry that refuses duplicate ids, non-semantic versions, missing
initial nodes, unknown edge targets, unreachable nodes, any cycle, branch paths
with no terminal outcome, joins nobody feeds, joins two parallels claim, undeclared
agents, tools or profiles, invalid limits and unsafe side effects with no approval.
A deterministic planner — no language model builds a plan — that compiles the
graph, computes worst-case steps, retries, tokens and cost with per-node branch
multiplicity, refuses a plan above the platform bounds, and returns a digest and a
manifest persisted on the run. One explicit nineteen-state machine with three
tables, immutable terminal states and optimistic concurrency.

An orchestrator that is the sole authority over workflow execution: sequential
nodes, bounded fan-out with branch-local state and ledgers, deterministic
conditions from a typed predicate registry, four join policies with declared
failure handling, deterministic transforms, wait gates, durable runs, immutable
versioned checkpoints and single-use checkpoint-bound human approvals. Agent nodes
execute through the certified Batch 3A orchestrator, tool nodes through its
gateway, and model nodes through `controlPlane.execute` — three ports, no provider
import, no credential.

A Token Optimization Engine that selects declared context, deduplicates by digest
within an authority band, applies per-section ceilings, trims lowest-authority
content first, excludes optional retrieval and unapproved memory, and renders
through the hardened Batch 3A fence rather than reimplementing it — reporting a
baseline and a final figure in the same unit so every saving is arithmetic a
reviewer can redo. Deterministic complexity classification, minimum-capable
model-profile routing that explains its candidates, rejections, downgrades and
escalations, and a Cost Optimization Engine that projects retry, repair, branch,
child-agent and approval-resume exposure and returns one of ten named actions. A
cache whose key builder refuses to produce a key without a tenant, so a
cross-tenant entry is arithmetically unreachable. Avoided-call accounting where
every saving names the profile and estimate version it was priced against.
Provider-neutral financial attribution across eleven dimensions from durable run
records, with projections labelled as projections. An explainable, versioned
optimization score that cannot be maximised by producing nothing. Secure APIs with
tenant-scoped RBAC and finance as its own separately scoped capability, plus a
read-only Workflows tab in the AI Administration console.

Workflows plan. Agents propose. The orchestrator decides. The AI Control Plane
executes. No business workflows ship with this batch; the registry starts empty.

---

# Current Sprint

MCV2-S7.4 — Outcome Shadow Read

Status: 🔄 In Progress

---

# Next Sprint

MCV2-S7.5 — Outcome Shadow Read Validation

---

# Current Runtime Authority

Storage Authority: KV

Shadow Reads: Disabled (except current implementation work)

SQL Authority: No

Frontend: Stable

API Contracts: Stable

AI Execution Authority: AI Control Plane (`supabase/functions/server/ai/`) —
sole path, no bypass flag

AI Agent Authority: Agent Orchestrator (`supabase/functions/server/ai/agents/`)
— the sole authority over agent execution. Agents propose actions and the
orchestrator decides; every model step executes through the AI Control Plane.
Runs, checkpoints and approvals are durable and versioned; the registry ships
empty until business agents are certified.

AI Operational Authority: AI Administration (`supabase/functions/server/ai/admin/`)
— settings overlay persisted at `ai:admin:settings`, versioned by
`configurationVersion`. The environment states what is permitted; the overlay
states what is in effect and can only narrow within that permission.

---

# Rules

- Update only the sprint status after each completed sprint.
- Do not rewrite this file.
- Do not renumber completed sprints.
- Treat this file as the single source of truth for project progress.