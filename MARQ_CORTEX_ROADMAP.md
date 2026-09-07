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
| S7.4 | Outcome Shadow Read | ✅ |
| S7.5 | Outcome Validation | ⏳ |
| S7.6 | Lead Shadow Read | ❌ |
| S7.7 | Submission Shadow Read | ✅ |
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
| AI-01 Batch 3B | Agent Workflows & Business Agents | ✅ |
| AI-01 Batch 4A | Live Provider Certification (OpenAI) | ✅ |
| AI-01 Batch 4B | Live Provider Certification (Anthropic) | ✅ |
| AI-01 Batch 4C | Provider Administration | ✅ |
| AI-01 Batch 4D | Customer BYOK | ✅ |
| AI-01 Batch 4E | Self-Hosted / OpenAI-Compatible Providers | ✅ |
| AI-01 Batch 4F | Routing, Failover & Economics | ✅ |

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

AI-01 Batch 3B completed 2026-08-17. Report:
`architecture/ai/AI-01-BATCH-3B-COMPLETION.md`

Delivered: the workflow runtime above the Batch 3A agent runtime, and the
platform's first certified business capability on top of it.

A versioned workflow registry that validates the graph, its conditions, its
mappings and its approval policy at registration, and a planner that turns a
definition into an executable plan with a digest the run is admitted against.
One state machine with a central transition table and optimistic concurrency.
An orchestrator that drives agent, condition, parallel and approval nodes,
enforces node, loop, branch, retry and deadline limits, checkpoints immutably
and persists every transition by compare-and-swap. A declarative condition and
mapping language that is data walked by a switch — there is no parser, so there
is no injection surface. Parallel branches with join and failure policies, node
retries whose eligibility is persisted rather than scheduled, and single-use
approval barriers that park a run for a named human role and carry the subject
and content digest a decider needs.

Every node executes as a CHILD AGENT RUN through the Agent Orchestrator on
behalf of the same authenticated subject, so Batch 3A's RBAC, limits, tool
permissions, budgets and audit trail apply at every node and every model step
still executes through the AI Control Plane. `engine/agentNodePort.ts` is the
only module that may reach an agent, and the boundary scan asserts it.

Cost intelligence in three separated trees: a Cost Compression Engine that
recommends a capability band and never executes, an Intelligent Reuse engine
that can avoid a call and never answers one itself, and a Financial
Intelligence layer that reports measured spend, avoided spend and target
progress on integers — with exactly one savings ledger between them, and no
embedding provider anywhere.

Business Agent #1: `agent.diagnostic.readiness_manager`, certified with the five
tools it declares and the `workflow.diagnostic.readiness_review` workflow, by a
recorded human decision. The readiness manager reviews one diagnostic submission
against the deterministic engines, drafts an advisory review, escalates what
cannot be reviewed, and commits only what a declared role approved — through a
tool that re-checks that approval against durable storage. The scores, ranking
and dependencies remain the deterministic engines'; the narrative is advisory
and fact-locked. The capability cannot write a submission, an answer or a
status: the dossier port has no writer.

A governed operator surface at `/ai/workflows/*` with tenant-scoped RBAC, and a
Workflows tab in the AI Administration console — start a review, read run
status, answer the barrier, advance, cancel, read the committed or escalated
outcome.

CERTIFICATION IS NOT ACTIVATION. `AI_DIAGNOSTIC_REVIEW_ENABLED` is off by
default and registers nothing without durable storage and an injected submission
source. A deployment that turns nothing on runs an empty workflow registry, and
the operator surface refuses to start the review rather than quietly starting
it.

AI-01 Batch 4F completed 2026-09-04. Report:
`architecture/ai/AI-01-BATCH-4F-COMPLETION.md`

Delivered: the Routing Authority (`supabase/functions/server/ai/routing/`) — a
deterministic, governed policy that ORDERS providers the selector has already
found eligible and can never admit one. Four strategies (preference, cost,
latency, resilience) with four invariants ahead of every strategy's own key: the
configured fallback stays last, a provider that charges nothing is never
promoted above paid capacity, a half-open circuit is unproven rather than
healthy, and the default `preference` strategy returns the selector's order
untouched. Eligibility is unchanged and keeps its one owner.

A governed failover breadth (`AI_ROUTING_MAX_PROVIDERS`, deployment-capped,
administrator-narrowable) bounds a walk that was previously unbounded. A
per-request BILLABLE ATTEMPT BUDGET closes the certified defect that the spend
guard reserved `maxAttempts` per request while the pipeline granted
`maxAttempts` to every failover candidate — the certified 105,920 uUSD
`cortex.chat` hold did not move; the execution path now matches it.

Economics on one arithmetic: projected cost, cheapest paid alternative, routing
premium, realized spend and signed variance, reconciled per request into a
bounded operational ledger holding no prompt, completion, actor or credential.
Metrics, events and a Routing tab in the AI Administration console. No schema
change, no migration, no new secret, and no routing write path — the strategy
and the breadth are settings fields, audited like every other.

---

MCV2-S7.4 completed 2026-09-07. Report:
`architecture/database/MCV2-S7.4-OUTCOME-SHADOW-READ-COMPLETION.md`

Delivered: the runtime storage shadow read
(`supabase/functions/server/storage/`) — the instrument Phase 3 needs before
anything reads SQL first. It serves the KV answer, reads the relational row
alongside it under a deadline, records whether the two stores agree, and
returns nothing. Four invariants: it never changes what is served, never fails
a request, never runs unbounded, and never records a customer value. Off by
default (`MCV2_SHADOW_READ_OUTCOMES`).

The comparator declares a rule per field so that a timestamptz that lost its
milliseconds, a numeric that arrived as a string and a NULL where KV wrote an
empty string are not reported as drift — a comparator nobody trusts gets
switched off, and then the migration proceeds with no instrument at all. An
absent relational row is a first-class result rather than a fault: the outcome
backfill has not been written, so that is the expected reading, and it is the
number the backfill will be judged by.

KV REMAINS AUTHORITATIVE. `index.tsx` imports no repository, and nothing the
storage module exports hands a relational row to a route.

MCV2-S7.6 / S7.7 completed 2026-09-07. Report:
`architecture/database/MCV2-S7.6-S7.7-SHADOW-READ-COMPLETION.md`

S7.6 — Lead Shadow Read is CANCELLED, as a finding rather than a blocker. A
shadow read observes a runtime read, and the lead domain has none: leads are
written by two capture routes and no route serves one. A shadow read wired to a
write would be write verification, which is not the evidence Phase 3 needs, and
bulk KV-to-SQL comparison for that domain already exists as
`npm run migration:reconcile`. If a lead read route is ever added, the
instrument extends to it the way the submission one did.

S7.7 — Submission Shadow Read delivered: the S7.4 instrument aimed at the core
entity, sharing one reader, one deadline and one report, behind its own switch
`MCV2_SHADOW_READ_SUBMISSIONS` (off by default). Status is canonicalised to the
relational vocabulary on both sides through a declared table — `approved` is the
console's word for `won`, and a hyphen-to-underscore rule would quarantine every
converted deal. Presentation fields, the answer map (which migrates to rows, not
a column) and the capture route's written placeholders are deliberately not
compared.

---

# Current Sprint

MCV2-S7.5 — Outcome Shadow Read Validation

Status: ⛔ Blocked — the exit condition is a mismatch rate measured over real
traffic, which needs `MCV2_SHADOW_READ_OUTCOMES` switched on in a deployment.
That is a human decision.

---

Phase 2 backfill completed 2026-09-07 for every KV namespace that holds stored
data. Report:
`architecture/database/MCV2-PHASE2-SUBMISSION-BACKFILL-COMPLETION.md`

Delivered: the submission, cortex-analysis and outcome domains, on one
domain-parameterised orchestrator loop rather than three copies of it; a
reconciliation for the submission domain that compares FIELDS through the same
comparator the shadow read uses; and a real-PostgreSQL harness
(`npm run test:database:diagnostic`) that drives all three in dependency order.

Also fixed: the certified lead reconciliation hard-coded its field-mismatch
count to zero, so every report claimed a field-level pass it had never made.

CODE COMPLETE, NOT RUN. Executing a backfill against real data is a deployment
action and awaits human authorisation.

---

# Next Sprint

Reconciliation for the cortex and outcome domains, then the documented gap
register (`MARQ_CORTEX_MASTER_BLUEPRINT_v1.0.md` §VI-5). G3 — intelligence
breadth — is closed by AI-01 Batches 1 through 4F. The next open backend gap is
G5, enterprise performance instrumentation.

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

AI Workflow Authority: Workflow Orchestrator
(`supabase/functions/server/ai/workflows/`) — the sole authority over workflow
execution. Every node executes as a child agent run through the Agent
Orchestrator; there is no second path to an agent and no path at all to a
provider. Runs, checkpoints and approvals are durable, versioned and
compare-and-swap persisted. Workflow definitions are registered in code, never
through an API.

AI Business Capability Authority: one certified capability —
`agent.diagnostic.readiness_manager`, its five tools and
`workflow.diagnostic.readiness_review` (`ai/business/diagnostic/`). Registered
only where `AI_DIAGNOSTIC_REVIEW_ENABLED` is on AND durable storage and a
submission source exist; off by default. Readiness scores, ranking and
dependencies remain the deterministic engines'.

AI Routing Authority: the Routing Authority
(`supabase/functions/server/ai/routing/`) — orders providers the selector has
already found eligible, and admits none. Deterministic and replayable; the
routed order is asserted to be a subset of what routing was offered. One
request's billable attempts are bounded by what the spend guard reserved for it.

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