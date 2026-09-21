# BP-003 — Workflow Runtime SQL Persistence Foundation & Parity Gate

> **DERIVED IMPLEMENTATION PACKET — DELETE AFTER VERIFIED IMPLEMENTATION**
> This is the first bounded slice of A2 Runtime Persistence. It is not a product source of truth.

**Status:** Ready for Claude implementation  
**Repository:** existing `marqnetwork/marqcortex-` repository only  
**Working branch:** continue from `claude/gallant-einstein-0ggpqe` unless explicitly instructed otherwise  
**Prerequisites:** A0 accepted; A1/BP-002 accepted through `de62e09bfc09e0d2387e1834febc2a3b330e133d`  
**Infrastructure rule:** same Git repository, same Supabase project, same Postgres database, same Edge/server runtime, same auth/tenancy/RLS, same workflow/agent engines, same A0 authority and A1 durable-runtime primitives.  
**Deployment rule:** **NO hosted migration, NO db push, NO production cutover, NO production backfill, NO deployment in BP-003.**

---

## 1. Objective

Build a **SQL-backed implementation of the EXISTING workflow persistence contracts** and prove that it behaves identically to the current workflow runtime persistence before any production authority is moved.

This packet is intentionally narrower than all of A2.

BP-003 covers only:

- workflow run persistence;
- workflow checkpoint persistence;
- workflow approval persistence;
- relational schema / SQL concurrency primitives needed for those three stores;
- a Postgres adapter implementing the existing workflow persistence ports;
- live-local-PostgreSQL parity and concurrency tests;
- migration/rollback assets;
- composition seams required for a later controlled cutover.

BP-003 does **NOT** switch production/bootstrap authority away from KV.

Target after this packet:

```text
Existing workflow engine / service / approval gate
             │
             │ unchanged persistence ports
             ▼
   ┌──────────────────────────────┐
   │ WorkflowRunStore             │
   │ WorkflowCheckpointStore      │
   │ WorkflowApprovalStore        │
   └──────────────────────────────┘
        │                 │
        │ current         │ new, proven
        ▼                 ▼
   KV implementation    SQL implementation
   STILL AUTHORITY      NOT YET CUT OVER
                            │
                            ▼
                    live-local parity gate
```

The purpose is to create a safe replacement **under the existing ports**, not a new workflow engine.

---

## 2. Why Workflow Persistence Is the First A2 Slice

Repository inspection before this packet confirmed:

### Current workflow authority

`supabase/functions/server/ai/workflows/persistence/kvWorkflowStores.ts` currently persists:

- `workflow_run`;
- `workflow_checkpoint`;
- `workflow_approval`.

Tenant-scoped KV keys are currently shaped as:

```text
org:{org}:ai:workflow_run:{workflowRunId}
org:{org}:ai:workflow_checkpoint:{workflowRunId}:{version}
org:{org}:ai:workflow_approval:{workflowApprovalId}
```

Current mutation concurrency uses the existing `kv_compare_and_swap_field` contract.

### Existing workflow persistence contracts

`WorkflowRunStore`
- load
- create, insert-if-absent
- save with `expectedVersion`
- tenant-scoped filtered list
- optimistic concurrency on `runVersion`

`WorkflowCheckpointStore`
- append-only write
- latest
- read version
- ordered history
- duplicate version is a conflict
- no update/delete contract

`WorkflowApprovalStore`
- load
- create, insert-if-absent
- save with `expectedVersion`
- tenant-scoped filtered list
- optimistic concurrency on `approvalVersion`

These interfaces are already the abstraction boundary. **Keep them.**

### Shared authority invariant

The workflow engine and the diagnostic capability's approval-authority port deliberately share the SAME workflow run/approval stores. BP-003 must preserve that property. Never assemble one SQL store for the engine and another independent store for approval authority.

### Agent persistence remains separate

Agent runs/checkpoints/approvals currently have their own KV stores and similar contracts. **Do not migrate them in BP-003.**

That will be another bounded A2 packet after workflow SQL parity is accepted.

---

## 3. Governing Rule

> **Change persistence authority underneath the workflow runtime; do not change workflow semantics.**

The following must remain behaviorally unchanged:

- workflow registry;
- workflow orchestrator/state machine;
- node execution;
- child-agent execution path;
- retries;
- approval gate semantics;
- approval expiry behavior;
- checkpoint digest-chain behavior;
- workflow RBAC;
- tenant resolution;
- HTTP/service contracts;
- A0 authority behavior;
- A1 durable jobs/events behavior;
- diagnostic review capability semantics.

If implementing SQL storage requires changing any of those semantics, **STOP and report the conflict**.

---

## 4. Hard Scope Boundaries

### MUST NOT do in BP-003

- no agent runtime persistence migration;
- no agent runs/checkpoints/approvals cutover;
- no AI audit-store migration;
- no financial-event migration;
- no reusable-result migration;
- no diagnostic dossier migration;
- no Tool Gateway;
- no UI work;
- no autonomous sales;
- no graph/memory;
- no self-forming workforce;
- no scheduler/queue replacement;
- no new repository;
- no new Supabase project;
- no external database;
- no hosted migration;
- no production backfill;
- no deletion of existing KV workflow records;
- no deletion of `kvWorkflowStores.ts`;
- no disabling `kv_compare_and_swap_field`;
- no production/bootstrap switch to SQL as authority;
- no "migrate everything to SQL" refactor.

### MAY do

Only what is required to create and prove a SQL implementation of the three existing workflow persistence ports.

---

## 5. Mandatory Baseline Audit Before Editing

Before writing schema or code, inspect the actual branch and return a short baseline in the Claude session:

```text
A. Every current workflow persistence record type
B. Every field used for identity, tenancy, filtering, ordering and concurrency
C. Every production caller of WorkflowRunStore / WorkflowCheckpointStore / WorkflowApprovalStore
D. Every place that directly constructs KV workflow stores
E. Every workflow persistence invariant enforced today
F. Current corruption-handling behavior
G. Exact current query/list ordering semantics
H. Current diagnostic approval-authority dependency on workflow stores
I. Proposed SQL schema shape
J. Proposed SQL atomic operations
K. Exact files likely to change
L. Any blocker or semantic ambiguity
```

Do not infer fields from names. Read the actual contracts and records.

If a required invariant cannot be represented without changing runtime semantics, stop.

---

## 6. SQL Design Principle — Preserve Contracts, Minimize Semantic Rewrite

Do not fully normalize every nested workflow object just because SQL exists.

Prefer a **relational authority envelope + bounded JSONB record payload** unless actual query requirements prove more normalization is necessary.

The relational columns must hold the fields required for:

- primary identity;
- organization ownership;
- foreign-key integrity;
- concurrency/version checks;
- state filtering;
- workflow/run relationship;
- actor filtering where the existing list contract requires it;
- approval pending filtering;
- ordering/paging;
- checkpoint version/digest-chain integrity;
- timestamps;
- operational indexes.

The JSON payload may preserve the full current domain record so the workflow contracts do not need to be redesigned.

The SQL row and JSON payload must never disagree about identity/version/tenant/state. Enforce or validate that invariant.

---

## 7. Required SQL Authority Model

Exact table names may follow repository conventions after inspection. Semantics are mandatory.

### 7.1 Workflow Runs

Minimum authoritative concepts:

```text
workflow_run_id
organization_id
workflow_id
actor_id
state
run_version
created_at
updated_at
record JSONB
```

Requirements:

- unique run identity with tenant-safe composite uniqueness where needed;
- `organization_id` FK to organizations;
- state constrained to the current workflow state vocabulary;
- non-negative/incrementing version;
- bounded payload;
- indexes matching current list filters and newest-first ordering;
- no cross-tenant FK/reference possible.

### 7.2 Workflow Checkpoints

Minimum concepts:

```text
organization_id
workflow_run_id
version
digest
previous_digest / chain field if present in the current contract
created_at
record JSONB
```

Requirements:

- append-only;
- unique `(organization_id, workflow_run_id, version)`;
- composite FK back to the same tenant's run;
- no UPDATE path through the runtime store;
- no DELETE path through the runtime store;
- ordered history by numeric version;
- checkpoint payload bounded;
- preserve current digest-chain/recovery semantics exactly.

### 7.3 Workflow Approvals

Minimum concepts:

```text
workflow_approval_id
organization_id
workflow_run_id
node_id
approval_state
approval_version
created_at
updated_at
expires_at if present in the current contract
record JSONB
```

Requirements:

- tenant-safe FK to workflow run;
- insert-if-absent creation;
- optimistic concurrency on `approval_version`;
- current pending-only query semantics;
- current oldest-first approval queue ordering;
- same single-use approval guarantee as KV.

Do not invent new approval states.

---

## 8. Atomicity and Concurrency

The current KV implementation has real concurrency guarantees. SQL must be **at least as strong**.

### Run create

```text
no row
→ insert exactly once

duplicate run id
→ typed existing persistence failure
→ never overwrite
```

### Run save

```text
WHERE organization_id = ?
AND workflow_run_id = ?
AND run_version = expectedVersion
→ write next version atomically
```

Two concurrent saves with the same expected version:
- exactly one wins;
- exactly one gets the existing typed stale-version outcome;
- no merged state.

### Checkpoint write

```text
(organization_id, run_id, version)
→ insert exactly once
```

No overwrite.

### Approval create/save

Same insert-if-absent + version-CAS behavior as today.

Two concurrent approval decisions on the same version:
- exactly one wins;
- the loser gets the same typed stale-approval semantics used today.

Use SQL/RPC/conditional UPDATE/INSERT mechanisms that make each guarantee one database operation. Do not implement concurrency as read → decide → write in TypeScript.

---

## 9. Existing Error Semantics Must Survive

The SQL stores must present the same public/store errors the current KV implementation presents where behavior is equivalent.

At minimum preserve the meaning of:

- duplicate workflow run creation;
- workflow run not found;
- stale workflow version;
- checkpoint conflict;
- workflow approval conflict;
- stale workflow approval;
- unreadable/corrupt record handling.

Do not leak raw Postgres errors through the workflow engine.

Map database outcomes to existing workflow failures.

---

## 10. Tenant Isolation and RLS

Every workflow persistence table is authoritative tenant data.

Requirements:

- `organization_id` mandatory;
- composite same-tenant references;
- RLS enabled and forced consistent with current Cortex patterns;
- service/runtime write path only unless an existing, proven requirement needs authenticated direct access;
- no authenticated direct mutation;
- no cross-tenant list/load;
- database constraints must make cross-tenant references unrepresentable, not merely unlikely;
- SQL functions/RPCs must scope every mutation by organization.

The workflow service/API remains the authorization surface. Do not create direct database APIs for the browser.

---

## 11. Store Implementation

Add a SQL/Postgres implementation satisfying the EXISTING interfaces:

- `WorkflowRunStore`
- `WorkflowCheckpointStore`
- `WorkflowApprovalStore`

Do not create replacement interfaces just because SQL uses different mechanics.

The adapter should be thin:

```text
existing domain record
→ validate/project storage row
→ atomic SQL operation
→ map storage row
→ validate tenant/identity/version
→ existing domain record
```

Runtime reads must fail loudly on malformed authoritative rows. Do not silently turn malformed SQL into "not found".

---

## 12. Parity Gate — This Is the Core Acceptance Rule

The current KV implementation is the behavioral baseline until cutover is separately approved.

Create a reusable persistence contract suite and run equivalent cases against:

1. in-memory reference stores;
2. current KV stores using deterministic fake KV/CAS harness;
3. new SQL stores against live local PostgreSQL.

Prove the same externally observable behavior for:

### Run store
- create/load;
- duplicate create;
- save expected version;
- stale save;
- missing save;
- tenant mismatch;
- state filter;
- workflow filter;
- actor filter;
- newest-first stable order;
- limit behavior.

### Checkpoints
- append;
- duplicate version conflict;
- read one;
- latest;
- full numeric ordered history;
- tenant mismatch;
- digest/recovery compatibility.

### Approvals
- create/load;
- duplicate create;
- save expected version;
- stale decision race;
- pending filter;
- workflow-run filter;
- oldest-first stable queue order;
- expiry fields preserved;
- tenant mismatch.

If memory/KV/SQL produce different domain outcomes, **do not paper over it**. Identify whether the existing implementations already differ. Stop on an unresolved semantic conflict.

---

## 13. Live Local PostgreSQL Is Mandatory

Use the existing PostgreSQL 16 local harness pattern established in BP-002.

No hosted Supabase project is required or allowed.

Create a dedicated command such as:

```text
npm run test:database:workflow-persistence
```

It must return non-zero when local PostgreSQL is unavailable. "Not run" must never look like "passed."

Live tests must apply the real migration chain to a fresh scratch database and destroy it afterward.

---

## 14. Mandatory Live Concurrency Proofs

Static source scans are not enough.

Against real local PostgreSQL prove at minimum:

1. two run creates with same identity → one row, one conflict;
2. two run saves with same expected version → exactly one winner;
3. stale run save cannot overwrite winner;
4. two writes of same checkpoint version → one winner;
5. checkpoint history remains numeric and append-only;
6. two approval creates with same id → one winner;
7. two approval decisions with same expected version → exactly one winner;
8. cross-tenant run cannot be loaded/listed through tenant path;
9. cross-tenant checkpoint FK is refused;
10. cross-tenant approval FK is refused;
11. authenticated role cannot mutate;
12. service-role/runtime SQL operations work;
13. migration apply → rollback → re-apply is clean.

---

## 15. NO PRODUCTION CUTOVER IN BP-003

This is locked.

At the end of BP-003:

- existing production bootstrap must still construct the current KV workflow stores as authority;
- existing workflow KV records remain untouched;
- no live data is copied;
- no hosted tables are created;
- SQL stores exist in code/migrations and are proven locally;
- a later packet will decide shadowing/backfill/cutover.

Do not add an environment flag that can silently flip production authority to SQL unless it is test-only/internal and impossible to activate accidentally. Prefer leaving bootstrap unchanged.

The next A2 packet, after review, will own:
- inventory/backfill strategy for existing KV data;
- optional shadow writes/reads;
- parity monitoring;
- cutover;
- rollback to KV;
- final KV retirement only after evidence.

---

## 16. A1 Integration Rule

BP-003 may reuse A1 durable infrastructure where appropriate for test traceability or future migration orchestration, but **workflow runtime rows are not durable jobs**.

Do not store workflow runs/checkpoints/approvals inside:

- `durable_jobs`;
- `durable_outbox`;
- `durable_inbox`;
- `durable_schedules`.

Different authorities, different semantics.

Do not make workflow persistence depend on a scheduler tick.

---

## 17. Diagnostic Capability Safety

The diagnostic review capability currently derives approval authority from the SAME workflow run and approval stores the workflow engine writes.

BP-003 must preserve this architectural invariant in the SQL implementation and in any future composition seam.

Add a test proving one assembled store pair is shared, not independently instantiated copies with divergent state.

No change to diagnostic certification or activation.

---

## 18. Data Migration Planning — Inspect, Do Not Execute

BP-003 should document in its final report what a future KV → SQL backfill must handle, based on actual key/schema inspection:

- current key namespaces;
- schema markers such as `ai.workflow.*.v1`;
- JSON-string vs object storage shapes;
- corrupt-record behavior;
- deterministic identity mapping;
- version mapping;
- checkpoint ordering;
- approvals and pending decisions;
- how to verify counts/digests before cutover.

But do **not** build or run a hosted backfill in this packet.

A small pure mapper used in tests is allowed if needed to prove record projection. It must not connect to production KV.

---

## 19. Implementation Checkpoints

### CHECKPOINT 1 — Persistence inventory
No code edits. Return the baseline from §5.

### CHECKPOINT 2 — SQL schema
Add only the minimum workflow runtime tables, constraints, indexes and rollback.

### CHECKPOINT 3 — Atomic SQL operations
Implement insert-if-absent and version-CAS semantics.

### CHECKPOINT 4 — SQL store adapters
Implement the existing workflow persistence ports.

### CHECKPOINT 5 — Shared parity suite
Drive memory, KV harness and SQL through the same contract cases.

### CHECKPOINT 6 — Live concurrency/RLS
Run the local PostgreSQL behavioral tests.

### CHECKPOINT 7 — Composition seam only
Prove the SQL stores can be assembled as one shared run/checkpoint/approval set. Do not switch production bootstrap authority.

### CHECKPOINT 8 — Regression and cleanup
Run full suites. Remove only temporary code introduced by BP-003. Do not delete KV stores.

After each checkpoint report briefly:

```text
CHECKPOINT:
FILES CHANGED:
MIGRATION STATUS:
PARITY STATUS:
TEST STATUS:
NEXT:
BLOCKER:
```

Do not create extra progress documents.

---

## 20. Required Verification

Create:

```text
npm run verify:bp003
npm run test:database:workflow-persistence
```

Also run:

```text
npm run verify:bp002
npm run test:ai
npm run test:security
npm run test:features
npm run test:system
npm run test:lifecycle
npm run test:database
npm run test:migration
npm run scan:boundaries
npm run typecheck:api
npm run typecheck:tests
```

Run any dedicated workflow persistence/runtime tests discovered during the baseline audit.

Pre-existing advisory failures must be named separately. Do not weaken existing tests.

---

## 21. Acceptance Gate

BP-003 is complete only when:

- relational workflow run/checkpoint/approval schema exists in additive local migration files;
- rollback removes only BP-003 assets;
- SQL implementation satisfies the existing persistence interfaces;
- run optimistic concurrency is proven live;
- approval single-use concurrency is proven live;
- checkpoints are append-only and ordered;
- tenant-safe FKs/RLS are proven live;
- memory/KV/SQL parity suite passes;
- diagnostic approval-authority shared-store invariant is preserved;
- existing workflow/agent behavior remains green;
- existing production bootstrap still uses KV workflow authority;
- no KV records were deleted or rewritten;
- no hosted migration/backfill occurred;
- nothing deployed;
- agent persistence migration was not started.

---

## 22. Required Final Report

Claude must return:

```text
A. Baseline persistence inventory
B. Existing invariants preserved
C. Files changed
D. SQL tables / functions / rollback assets
E. WorkflowRunStore SQL behavior
F. WorkflowCheckpointStore SQL behavior
G. WorkflowApprovalStore SQL behavior
H. Memory/KV/SQL parity results
I. Live PostgreSQL concurrency results
J. RLS / tenant verification
K. Diagnostic shared-store invariant
L. Full regression results
M. Production bootstrap status — must still be KV
N. Future backfill/cutover requirements discovered
O. Known limitations
P. Commit SHA(s)
Q. Nothing deployed confirmation
R. No hosted DB migration/backfill confirmation
S. Agent persistence migration NOT started confirmation
T. A2 remains IN PROGRESS; next packet required before cutover
```

Then STOP.

---

## 23. Cleanup Rule

After BP-003 is independently reviewed and accepted:

- record this A2 slice as complete;
- delete this temporary BP-003 packet;
- keep the existing KV workflow stores because cutover has not occurred;
- create the next bounded A2 packet for shadow/backfill/cutover only after review;
- do not claim A2 complete until workflow AND agent authoritative runtime persistence have safely left legacy KV where the architecture requires it.

**Safety over speed. No migration is successful merely because new tables exist.**
