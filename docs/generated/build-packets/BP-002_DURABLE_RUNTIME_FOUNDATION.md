# BP-002 — Durable Runtime Foundation

> **DERIVED IMPLEMENTATION PACKET — DELETE AFTER VERIFIED IMPLEMENTATION**
> This packet translates A1 of the approved Cortex Target Architecture v2.0 into one bounded coding task. It is not a source of product truth.

**Status:** Ready for Claude implementation  
**Repository:** existing `marqnetwork/marqcortex-` repository only  
**Working branch:** continue from `claude/affectionate-dirac-u3jdp0` unless explicitly instructed otherwise  
**Prerequisite:** A0 / BP-001 accepted through `d722d60f58eb649df94af59b85315f0117a0c314`  
**Infrastructure rule:** reuse the existing Supabase project, Postgres database, Edge Function runtime, environments, secrets/configuration, deployment pipeline, agent runtime, workflow runtime, audit/observability and BP-001 authority module. **Do not create a new Git repository, Supabase project, backend, hosting project, queue vendor, scheduler vendor or parallel orchestration system.**  
**Deployment rule:** implement and verify locally/in CI-style tests only. **Do not deploy, db-push, enable production cron, or mutate production in this packet.**

---

## 1. Objective

Create the durable execution substrate Cortex needs for work that must survive beyond a browser request or one Edge Function invocation.

A1 must establish a reusable platform foundation for:

- durable background jobs;
- one-time jobs;
- delayed jobs;
- recurring schedules;
- atomic job claiming;
- leases / heartbeats;
- retries with bounded backoff;
- pause / resume / cancellation;
- dead-letter / recovery;
- immutable domain-event contracts;
- transactional outbox;
- idempotent inbox / processed-event handling;
- correlation and causation propagation;
- tenant isolation;
- BP-001 authority enforcement;
- audit and operational observability.

Canonical target:

```text
Authoritative domain change / workflow need
  ↓
Durable job or event record in existing Postgres
  ↓
Scheduler / dispatcher tick
  ↓
Atomic claim + lease
  ↓
Actor / tenant / BP-001 authority evaluation
  ↓
Execute existing service / workflow capability
  ↓
Result + domain event / outbox
  ↓
Idempotent consumer(s)
  ↓
Retry / recovery / dead-letter if required
  ↓
Audit + metrics + trace
```

This is an **execution foundation**, not a new workflow product.

---

## 2. Why This Packet Exists

Target Cortex work may run for minutes, days, months or years. Future capabilities depend on execution that is independent of:

- a browser remaining open;
- a user session remaining alive;
- one HTTP request finishing;
- one Edge isolate remaining resident;
- one model call succeeding.

A1 therefore comes before organizational AI workforce expansion, Attention Required, Tool Gateway, autonomous growth, memory consolidation and self-improvement.

---

## 3. Existing Assets to Reuse

Before building anything, inspect the actual repository and reuse what already exists.

At minimum inspect:

- `supabase/functions/server/ai/workflows/**`;
- `supabase/functions/server/ai/agents/**`;
- current workflow state machine / retry / approval logic;
- current agent checkpoint / persistence ports;
- current `kv_compare_and_swap_field` concurrency mechanism and migration history;
- `supabase/functions/server/platform/authority/**` from BP-001;
- current organization / tenancy / RLS migrations;
- current audit writers and metrics;
- current clock / id / logger abstractions;
- current migration conventions and rollback conventions;
- current server composition / route registration;
- any existing event, notification, retry, scheduler or queue-like code.

### Reuse rule

Do not create a second implementation of something the repository already does correctly.

Examples:

- existing workflow orchestration remains the workflow engine;
- existing agent runtime remains the agent runtime;
- BP-001 remains the authority decision boundary;
- existing audit trails remain the audit mechanisms;
- existing tenant/RLS architecture remains the tenant boundary;
- existing Postgres remains durable authority.

A1 adds missing **platform durability primitives around/under those systems**.

---

## 4. Hard Scope Boundaries

### BP-002 MUST NOT build

- new Cortex UI/navigation;
- Command Center;
- AI Workforce UI;
- self-forming departments;
- dynamic agent spawning;
- Goal-to-Execution decomposition;
- Tool Gateway;
- email/social/telephony connectors;
- autonomous sales;
- Knowledge Graph;
- vector search;
- enterprise memory / dreaming;
- self-improvement;
- billing/entitlements;
- investment execution;
- new model providers;
- tenant-authored authority-envelope product UI;
- wholesale agent/workflow KV → SQL migration (that is A2);
- a second workflow engine;
- an external queue/broker merely because one is convenient.

### BP-002 MAY add

Only what A1 requires:

- generic durable job contracts;
- generic schedule contracts;
- generic domain-event envelope;
- SQL persistence required for these new platform primitives;
- atomic claim/lease mechanisms;
- outbox/inbox/dead-letter persistence;
- worker/scheduler service logic;
- one bounded internal pilot;
- tests, observability and minimal server wiring needed to prove the foundation.

---

## 5. Infrastructure Constraints

1. No new Git repository.
2. No new Supabase project.
3. No new database.
4. No Redis, Kafka, RabbitMQ, SQS, Temporal, Inngest, Trigger.dev, cloud queue or scheduler vendor in BP-002.
5. No production deployment.
6. No production cron configuration.
7. No destructive migration.
8. Any database change is an additive migration in the existing Supabase migration chain.
9. Use existing repository migration/rollback conventions.
10. If the existing stack genuinely cannot meet an A1 invariant, **stop and report the exact blocker** rather than creating infrastructure around it.

---

## 6. Required Platform Contracts

Names may follow repository conventions. Semantics are mandatory.

### 6.1 Durable Job

A durable job must represent at least:

```text
job_id
organization_id
job_type / handler_key
state
priority
run_at / available_at
actor context or actor reference
authority context/reference
attempt
max_attempts / retry policy
lease_owner
lease_expires_at
heartbeat_at
idempotency_key
correlation_id
causation_id
objective/workflow reference where applicable
input or governed payload reference
result reference / bounded result metadata
failure code / bounded failure metadata
created_at
updated_at
started_at
completed_at
```

Minimum lifecycle should support the semantics of:

```text
SCHEDULED / QUEUED
→ LEASED / RUNNING
→ SUCCEEDED

or
→ retryable failure → QUEUED at next available time

or
→ terminal failure → DEAD_LETTER

plus
PAUSED
CANCELLED
```

Do not force these exact string names if an existing state vocabulary can be reused cleanly.

### 6.2 Schedule

A schedule must support at least:

- one-time execution;
- delayed execution;
- recurring interval execution.

Minimum concepts:

```text
schedule_id
organization_id
job_type
status
next_run_at
recurrence definition
actor/authority context
idempotency basis
correlation context
last_run_at
created_at / updated_at
```

Do not build a full cron-expression product unless the existing repository already has one. A deterministic interval recurrence is enough to prove recurring scheduling in A1.

### 6.3 Domain Event Envelope

Events are immutable facts.

Minimum event metadata:

```text
event_id
event_type
version
organization_id
actor_id
occurred_at
correlation_id
causation_id
source
entity_refs
classification
payload or governed payload reference
```

Rules:

- event type/version are explicit;
- event IDs are stable and unique;
- events are tenant-scoped;
- event payloads are bounded and must not become an uncontrolled copy of secrets or large business documents;
- correlation/causation are preserved across derived jobs/events;
- events are facts, not commands disguised as events.

### 6.4 Transactional Outbox

Where authoritative state change and event publication must agree, persist both in one Postgres transaction or equivalent atomic database operation.

The outbox record must be durable before dispatch.

A process crash after commit must not lose the event.

### 6.5 Inbox / Processed Event

A consumer must be able to prove that a duplicate event does not duplicate its effect.

At minimum:

```text
organization_id
consumer_key
event_id
status / processed_at
result/failure metadata
```

Uniqueness must enforce idempotency at the database layer where practical.

### 6.6 Dead Letter / Recovery

Repeatedly failing jobs/events need a durable monitored terminal path.

Minimum evidence:

- original job/event reference;
- organization;
- attempts;
- final reason/failure code;
- correlation/causation;
- first/last failure timestamps;
- recovery/requeue status if supported.

Do not silently drop failed work.

---

## 7. Persistence and SQL Authority

A1 is one of the packets where **new durable SQL state is expected if no equivalent already exists**.

First inspect existing schemas.

If equivalent authoritative tables do not exist, add the minimum additive schema needed for:

- durable jobs;
- schedules;
- outbox;
- inbox / processed-event ledger;
- dead-letter state.

### Mandatory database requirements

Every authoritative table must have:

- stable primary key;
- `organization_id` or an explicitly justified platform-global scope;
- tenant-safe foreign keys where relationships cross tenant-owned entities;
- RLS/equivalent tenant controls consistent with current Cortex standards;
- indexes for claimability / schedule / retry / organization access;
- timestamps;
- deterministic status constraints;
- uniqueness for idempotency where required.

### No A2 drift

Do **not** migrate all existing agent/workflow KV runtime records into these tables in BP-002.

A2 handles broad runtime persistence migration.

A1 tables serve the new durable job/event foundation and the one A1 pilot only.

---

## 8. Job Claiming and Lease Semantics

The runtime must be safe under more than one worker/isolate.

Required semantics:

1. only jobs whose `run_at/available_at <= now` and whose state permits execution are claimable;
2. claiming is atomic;
3. two workers cannot successfully own the same live lease;
4. a lease has an expiry;
5. a worker may heartbeat/extend only its own live lease;
6. an expired lease can be recovered/reclaimed according to policy;
7. completion/failure must verify lease/version ownership;
8. stale workers must not overwrite the result of a newer owner;
9. cancellation/pause must not be silently ignored by an already-running stale worker;
10. claim ordering is deterministic enough to prevent starvation where practical.

Use SQL transactional/locking/CAS patterns appropriate to the existing Supabase/Postgres architecture. Do not simulate durability with in-memory maps.

---

## 9. Retry and Backoff

Retry policy is deterministic configuration, not model judgment.

Support:

- retryable vs terminal failure;
- max attempts;
- bounded exponential backoff or an equivalent deterministic bounded policy;
- next-attempt timestamp;
- no tight retry loops;
- transition to dead-letter after exhaustion;
- audit/metrics per attempt.

A duplicate delivery or worker restart must not reset the attempt history.

---

## 10. Scheduler Semantics

Implement a scheduler/tick service that can be invoked independently of a browser.

It must:

- discover due one-time/delayed work;
- materialize due recurring work exactly once per occurrence;
- enqueue/claim without duplicate execution;
- calculate the next recurring occurrence deterministically;
- tolerate repeated scheduler ticks;
- tolerate two scheduler callers racing;
- preserve tenant, actor, correlation and authority context.

### Important deployment boundary

BP-002 implements the scheduler **runtime/service and tests**.

Do **not** configure production cron or a new scheduler service in this packet.

The runtime should be callable by the existing Edge/server environment when deployment is later authorized.

---

## 11. Authority and Security

BP-001 is now a prerequisite, not an optional integration.

Every job that can cause a consequential effect must have an explicit machine actor:

- workflow;
- job;
- service;
- integration;
- AI agent where the job is acting for an agent.

Before the job performs the consequential action:

```text
job actor
→ organization
→ permission
→ policy
→ authority envelope
→ consequence
→ ALLOW | DENY | REQUIRE_APPROVAL
```

### Rules

- never inherit unrestricted authority from the human who originally initiated the job;
- `initiatedBy` is provenance, not authority;
- fail closed if actor/tenant/authority context is unavailable;
- cross-tenant claiming/execution is prohibited;
- worker/service credentials do not grant business authority by themselves;
- do not expose provider/connector secrets in job/event payloads;
- authority denial is a governed job outcome, not something to catch-and-ignore;
- `REQUIRE_APPROVAL` must not be converted to ALLOW by the worker.

If the selected A1 pilot needs an actor envelope that existing certified definitions cannot represent, stop and report the exact requirement before inventing tenant-authored authority persistence.

---

## 12. Event Reliability

### Producer

For the pilot, prove at least one authoritative state transition that also emits an outbox event atomically.

### Dispatcher

Dispatch must:

- claim pending outbox records safely;
- preserve event identity;
- retry transient failures;
- avoid duplicate downstream effect;
- mark successful dispatch durably;
- send exhausted failures to a monitored failure/dead-letter path.

### Consumer

At least one test consumer must prove:

```text
same event delivered twice
→ one logical effect
→ one inbox/processed-event identity
```

Do not introduce a network broker merely to prove this.

---

## 13. Observability and Audit

Every job needs traceability across:

```text
correlation_id
causation_id
organization_id
job_id
schedule_id (if any)
event_id(s)
actor_id
attempt
lease owner / lease generation
authority decision reference/evidence
result/failure
```

Reuse existing logger/metrics/audit architecture.

Do not create a parallel general-purpose audit store.

Required operational measures should include enough to observe:

- queued jobs;
- due jobs;
- leased/running jobs;
- retries;
- failures;
- dead-letter count;
- schedule materializations;
- outbox backlog;
- oldest pending outbox age;
- duplicate/inbox suppression;
- lease recovery.

Exact metrics API may follow existing conventions.

---

## 14. Pilot Integration

A1 needs **one safe end-to-end pilot**, not a migration of every workflow.

Before coding, inspect the repository and propose the lowest-risk existing internal operation that:

- is meaningful enough to prove durable execution;
- has no external customer-facing side effect;
- already has clear actor/tenant ownership;
- can be executed idempotently or has an explicit idempotency key;
- does not require building a future domain.

Preferred classes include an existing internal workflow/agent continuation, maintenance action, or other deterministic internal operation.

Do not use email, social, telephony, payment, production mutation or new product functionality as the A1 pilot.

Pilot path:

```text
existing internal trigger
→ durable job persisted
→ scheduler/worker claims
→ BP-001 authority evaluation where consequential
→ existing capability executes
→ durable result
→ outbox event
→ idempotent consumer proof
→ audit/metrics
```

If no existing safe operation fits, a **test-only handler** may prove the generic substrate, but report that limitation explicitly rather than inventing a new product feature.

---

## 15. Required Baseline Before Editing

Claude must first read this packet completely and inspect the actual code.

Before edits, return a short baseline:

```text
A. Existing workflow/job/event/concurrency mechanisms found
B. Existing mechanisms that will be reused
C. Exact missing A1 primitives
D. Proposed SQL additions (if any)
E. Proposed low-risk pilot
F. Exact files/modules likely to change
G. Whether BP-001 requires a new adapter for the chosen job actor
H. Any blocker or architecture conflict
```

If there is a blocker, stop.

Otherwise continue without expanding scope.

---

## 16. Implementation Checkpoints

### CHECKPOINT 1 — Current-runtime reuse map

Document in the session only; do not create a new progress file.

Identify current:

- workflow orchestration;
- agent persistence/concurrency;
- retry/state machines;
- event-like mechanisms;
- audit/metrics;
- SQL/RLS conventions;
- BP-001 integration seams.

### CHECKPOINT 2 — Contracts

Create only the minimum shared platform contracts for:

- durable job;
- schedule;
- domain event;
- retry policy;
- lease;
- outbox;
- inbox;
- dead-letter.

Avoid framework-heavy abstractions.

### CHECKPOINT 3 — SQL persistence

Only after inspecting existing schemas.

Add minimum additive migrations and rollback assets required by A1.

Prove:

- constraints;
- RLS/tenant safety;
- idempotency uniqueness;
- claim indexes;
- due-work indexes;
- outbox indexes.

### CHECKPOINT 4 — Atomic claim / lease

Implement and test claim, heartbeat, expiry/recovery and stale-owner refusal.

### CHECKPOINT 5 — Job runtime

Implement:

- enqueue;
- claim;
- execute handler through a registry/adapter;
- retry/backoff;
- success;
- failure;
- pause/cancel;
- dead-letter.

Handler registry must not become a second workflow engine.

### CHECKPOINT 6 — Scheduler

Implement due-work materialization and recurring occurrence semantics.

Repeated/racing ticks must not duplicate occurrences.

### CHECKPOINT 7 — Events / outbox / inbox

Implement immutable envelope, transactional producer path, dispatch and idempotent consumer record.

### CHECKPOINT 8 — Pilot

Wire exactly one safe pilot.

### CHECKPOINT 9 — Security / observability

Prove tenant isolation, authority path, audit and operational metrics.

### CHECKPOINT 10 — Regression / cleanup

Run all required tests.

Remove only code made genuinely obsolete by this packet.

Do not perform unrelated cleanup.

---

## 17. Required Tests

At minimum prove:

### Jobs / leases

1. queued due job can be claimed;
2. future job cannot be claimed early;
3. only one of two racing workers owns a live lease;
4. heartbeat extends only the correct live lease;
5. stale lease owner cannot complete;
6. expired lease can be recovered;
7. successful job cannot execute again;
8. cancellation prevents future claim/execution;
9. paused work does not execute until resumed;
10. duplicate idempotency key does not create duplicate logical work.

### Retry / dead-letter

11. retryable failure increments attempt;
12. retry uses bounded deterministic backoff;
13. attempt history survives re-claim/restart simulation;
14. max attempts transitions to dead-letter;
15. terminal failure does not retry forever.

### Scheduler

16. one-time schedule materializes once;
17. delayed work waits until due;
18. recurring schedule calculates next occurrence;
19. duplicate/racing scheduler ticks do not duplicate the same occurrence.

### Events

20. event envelope preserves organization, actor, correlation and causation;
21. outbox record is durable with the authoritative pilot transition;
22. dispatch retry does not mint a new event id;
23. same event delivered twice produces one logical consumer effect;
24. malformed/oversized event payload fails closed according to the chosen bounded contract;
25. exhausted dispatch enters monitored failure/dead-letter state.

### Security

26. cross-tenant job read/claim is denied;
27. cross-tenant event/inbox access is denied;
28. job actor does not inherit initiating human authority;
29. missing actor/authority context fails closed for consequential execution;
30. BP-001 DENY prevents execution;
31. BP-001 REQUIRE_APPROVAL never executes as ALLOW;
32. no secret material is persisted in job/event test fixtures.

### Regression

33. existing AI tests remain green;
34. existing workflow/agent tests remain green;
35. existing database/migration tests remain green;
36. current browser/product behavior is unchanged by A1.

---

## 18. Acceptance Gate

BP-002 is complete only when all are true:

- durable jobs are stored in existing Postgres/Supabase authority;
- due work can be atomically claimed with safe lease semantics;
- jobs survive process/isolate restart by design and test simulation;
- retries/backoff are bounded and durable;
- cancellation/pause/recovery semantics are deterministic;
- exhausted work is not lost and reaches a monitored dead-letter path;
- one-time, delayed and recurring scheduling are proven;
- domain-event envelope exists;
- transactional outbox semantics are proven;
- idempotent inbox/processed-event semantics are proven;
- correlation/causation propagate through the pilot;
- tenant isolation/RLS are verified;
- consequential job execution uses BP-001 rather than bypassing it;
- existing workflow/agent orchestration is reused, not replaced;
- one safe pilot is integrated or a clearly reported test-only pilot is used because no safe production path exists;
- no current behavior regresses;
- no new repository/Supabase/deployment/external queue was created;
- nothing was deployed;
- all required tests pass with evidence.

---

## 19. Verification Sweep

At minimum run the suites relevant after repository inspection, including:

```text
npm run test:ai
npm run test:security
npm run test:features
npm run test:system
npm run test:lifecycle
npm run test:database
npm run typecheck:api
npm run typecheck:tests
```

Add a dedicated:

```text
npm run verify:bp002
```

covering the A1 foundation.

If the repository has dedicated workflow/migration/boundary suites that exercise changed code, run them too.

Pre-existing advisory failures must be named separately. Do not weaken unrelated tests to obtain green output.

---

## 20. Required Implementation Report

Claude must stop at BP-002 and return:

```text
A. Baseline / existing mechanisms reused
B. Files changed
C. Database migrations / rollback assets added
D. Durable job model implemented
E. Lease / concurrency semantics
F. Scheduler semantics
G. Event / outbox / inbox semantics
H. BP-001 authority integration
I. Pilot integrated
J. Tests run + exact results
K. RLS / tenant / security verification
L. Observability / recovery verification
M. Temporary compatibility adapters remaining
N. Obsolete code removed
O. Known limitations / follow-up work
P. Commit SHA(s)
Q. Confirmation: nothing deployed
R. Confirmation: BP-003 / A2 not started
```

Do not claim completion without test evidence.

---

## 21. Cleanup Rule

After BP-002 is independently reviewed and accepted:

- record A1 completion in the active progress/reconciliation map;
- delete this temporary BP-002 packet;
- remove temporary compatibility code only when no caller needs it;
- do not retain duplicate planning/audit notes;
- proceed to A2 only after explicit review.

The repository should become cleaner after each accepted packet.
