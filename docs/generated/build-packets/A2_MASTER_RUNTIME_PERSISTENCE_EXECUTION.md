# MARQ CORTEX — A2 MASTER RUNTIME PERSISTENCE EXECUTION

> **TEMPORARY EXECUTION AUTHORITY — DELETE AFTER A2 IS ACCEPTED**
>
> This is the single resumable implementation packet for the remainder of A2.
> It replaces the need to create separate BP-005/BP-006/BP-007 instruction files.
> It does not replace the canonical product/architecture authorities.

**Status:** READY  
**Repository:** `marqnetwork/marqcortex-`  
**Branch:** `claude/stoic-hypatia-o7ihgj`  
**Accepted lineage at creation:** `5556eef7a48a07d519cafea688f9fdf00607e960`  
**A0:** COMPLETE  
**A1:** COMPLETE  
**A2 foundation:** BP-003 COMPLETE; BP-004 COMPLETE  
**Current workflow production authority:** KV  
**Current agent production authority:** KV  
**Infrastructure:** existing repository + existing Supabase/PostgreSQL only  
**New repo / new Supabase / new deployment stack:** FORBIDDEN

---

# 0. EXECUTION CURSOR — UPDATE IN EVERY COMPLETED CHECKPOINT COMMIT

```text
MASTER_STATUS: IN PROGRESS — GATE R BLOCKED, SAFE LOCAL REORDER AUTHORIZED
ACTIVE_PHASE: A2-P08 (reordered, local-only)
LAST_COMPLETED_CHECKPOINT: A2-P08-C01
LAST_VERIFIED_COMMIT: 55205e4 (P07-C05); P08-C01 = this commit
NEXT_CHECKPOINT: A2-P08-C02
REORDER_AUTHORIZATION: USER AUTHORIZED SAFE LOCAL-ONLY A2 WORK TO PROCEED WHILE P05 HOSTED READ-ONLY ACCESS IS BLOCKED
BLOCKERS:
- GATE_R_ACCESS_UNAVAILABLE (2026-09-22): this execution environment cannot reach
  the existing Cortex Supabase (project ref oqybniefkbppptfatoae, from
  supabase/config.toml) even read-only:
  1. egress proxy refuses CONNECT to oqybniefkbppptfatoae.supabase.co:443 and
     api.supabase.com:443 with 403 (organization network policy); not worked around;
  2. db.oqybniefkbppptfatoae.supabase.co does not resolve; no pooler reachable;
  3. no Supabase credential/DB URL present in the environment (names checked,
     no values read); no Supabase CLI installed.
  Same root cause as Checkpoint A / CP-1 / CP-2 records. No guessed data substituted.
  UNBLOCK (any one): (a) environment network policy allowing *.supabase.co +
  pooler host, plus a READ-ONLY Postgres role/URL for the Cortex project supplied
  as an env secret; or (b) run P05-C01..C04 from an operator machine with that
  access and supply the sanitized inventory output.
  REORDER AUTHORIZED: while this blocker remains, execute A2-P07 completely.
  After P07, A2-P08-C01 and A2-P08-C02 may also proceed because they are local-only
  and do not require hosted workflow-estate evidence.
  DO NOT start A2-P06, A2-P08-C03+, any hosted workflow strategy implementation,
  hosted migration, deployment, shadow write, or cutover until P05 is unblocked
  and its real-estate strategy evidence exists.

HOSTED_READ_ONLY_GATE: OPEN FOR THE EXISTING CORTEX HOSTED SUPABASE, READ-ONLY A2 INVENTORY ONLY — BUT NOT REACHABLE FROM THIS ENVIRONMENT (see BLOCKERS)
HOSTED_WRITE_GATE: CLOSED — EXPLICIT LATER USER APPROVAL REQUIRED
DEPLOYMENT_GATE: CLOSED — EXPLICIT LATER USER APPROVAL REQUIRED
PRODUCTION_WORKFLOW_AUTHORITY: KV
PRODUCTION_AGENT_AUTHORITY: KV

COMPLETED_PHASES:
- A0
- A1
- BP-003
- BP-004
- A2-P07 (agent SQL persistence foundation; local only; production still KV)

CHECKPOINT_EVIDENCE:
- A2-P08-C01 AGENT SOURCE INVENTORY + TENANT MAPPING (pure, in-memory, no
  repair): ai/agents/persistence/migration/{contracts,inventory,readiness}.ts.
  REUSED from BP-004: resolveTenantMappings + CanonicalOrganization + manifest
  entry shape + GO_FOR_LATER_BACKFILL_PACKET|NO_GO vocabulary (one resolver so
  a workflow run and its child agent run cannot resolve differently).
  AGENT-SPECIFIC: key grammar/coercion/structural checks mirrored from
  kvAgentStores (pinned by test); row classes incl. progress_digest_mismatch
  (blocking: stored progress must hash to its progressDigest — the one
  integrity fact an agent checkpoint proves); pointer classes EMPTY_CHAIN |
  EXACT_TIP_MATCH | RECOVERABLE_ONE_AHEAD_CANDIDATE (tip = pointer+1 and links
  to the named checkpoint; NON-blocking: faithful copy reproduces the exact
  KV state, never repaired) | ACTUAL_POINTER_MISMATCH | POINTER_WITHOUT_CHAIN
  (blocking); chain linkage CONTIGUOUS_LINKED|IRREGULAR = evidence only (agent
  contract never promised a chain); dangling pendingApprovalId = evidence;
  census: terminal/active/byState, waitingForApproval, pendingAction,
  workflowLinked, childRuns, claimedToolKeys. Manifest reports tenantChanges
  and constant integrityRewriteRequired=false; carries no business content.
  Boundary: BP-004 test 39b exempts ONLY the agent migration folder; new block
  'agent migration readiness boundary (A2-P08)' (unreachable from any non-
  test module/bootstrap; no client/env/clock/random/SQL/host; no writer or
  store reach; no cutover/shadow/dual vocabulary) — 2 mutations caught.
  Evidence: agentMigrationReadiness 23/23 (estate written by the REAL runtime
  into KV rows; planted defects each classified; secret business marker absent
  from manifest; snapshot unmodified); verify:a2-agent 336/336; verify:bp004
  334/334; scan:boundaries 138/138; typecheck:tests clean; typecheck:api ai/
  registry-free/server clean.
- A2-P07-C05 LIVE LOCAL PG CONCURRENCY/RLS/ROLLBACK + REAL RUNTIME OVER SQL:
  test:database:agent-persistence exit 0 (117 ok lines): two-session races
  (create, save, stale-late, checkpoint dup + UPDATE refused, approval
  decide, approval spend-once, held row lock), cross-tenant service calls
  read nothing / save 'missing', authenticated+anon no read/write/execute,
  service_role works, apply x2 -> rollback x2 -> re-apply (agent assets only;
  workflow tables + their trigger fn, KV, CAS, durable, tenancy intact), 33/33
  contract cases on SQL, AND the real agent runtime (buildTestAgentRuntime,
  new test-only `tenantId` fixture option) over SQL: run completes; restarted
  runtime reads 2 steps/3 checkpoints, pointer = chain tip; approval parked by
  runtime c, decided+spent by runtime d (pending:1 -> consumed:3, run
  completed); other tenant reads nothing; no foreign-tenant rows.
  P07 PHASE BATTERY: verify:a2-agent 308/308, verify:bp003 489/489,
  verify:bp004 329/329, verify:bp002 347/347, test:ai 2458/2458,
  test:security 1141/1141, scan:boundaries 133/133, test:database 403 pass
  (2 skipped: need DATABASE_URL), test:migration 244/244, test:system 203/203,
  test:features 1441/1441, test:lifecycle 241/241, live workflow-persistence +
  workflow-cutover-readiness exit 0, typecheck:tests clean, typecheck:api
  ai/registry-free/server clean. Production agent bootstrap: KV (asserted).
- A2-P07-C04 SQL ADAPTERS + SHARED PARITY: agents/persistence/sqlAgentStores.ts
  (one-verb AgentSqlGateway port, no client; fail-closed persistence_failed
  on non-UUID tenant writes, empty reads; DB errors -> persistence_failed with
  bounded server-side diagnostics; `missing` collapsed to stale_run_version =
  KV parity; shared domain predicates/comparators). ports.ts exports
  byNewestRun (memory/KV/SQL use one comparator; behaviour unchanged).
  __tests__/agentPersistenceContract.ts = 33 cases (runs, checkpoints incl.
  one-ahead tip + non-adjacent predecessor, approvals, REAL approvalGate over
  each store incl. expiry and expired-after-spent). Finding pinned: production
  treats `states: []` as match-nothing; SQL matches via domain re-filter.
  Evidence: agentPersistenceParity (memory+KV) 68/68; live PG SQL harness
  33/33 cases; agentSqlComposition 10/10 (bootstrap KV-only, no SQL import;
  slug tenant never reaches DB); ai_boundary 133/133 (new agent SQL scan);
  verify:a2-agent 308/308; agentPersistence 43/43; typecheck:api ai/
  registry-free/server clean (node-targeted server/migration/* advisory
  pre-existing, none in new files); typecheck:tests clean.
  New scripts: verify:a2-agent, test:database:agent-persistence; static agent
  migration test added to test:database.
- A2-P07-C03 ATOMIC SQL AGENT OPERATIONS: migration
  20260922120002_cortex_agent_persistence_functions.sql — 12 SECURITY DEFINER
  fns (run create/save/load/list, checkpoint append/read/latest/history,
  approval create/save/load/list); create = INSERT..ON CONFLICT DO NOTHING;
  save = single UPDATE..WHERE version = expected, then classify
  saved|stale|missing; NULL tenant refused; every predicate org-scoped;
  listings bounded 50/200 with FETCH..WITH TIES (domain sorts); EXECUTE revoked
  from PUBLIC, granted to service_role only. Harness 410-413 (fixture, schema,
  RLS/privilege incl. cross-tenant service calls -> 'missing', rollback leaves
  workflow tables + workflow trigger fn + KV + durable intact).
  Evidence: static test 26/26 (+3 fn mutations caught: dropped CAS predicate,
  upsert, authenticated grant); live PG16 scenarios exit 0 (schema, RLS, two-
  session races: create 1/1, save 1 winner + late stale refused, checkpoint
  1/1 + UPDATE refused, 2 deciders -> 1 decider recorded, spend exactly once,
  held-lock waits then stale; idempotent re-apply, rollback x2, re-apply).
- A2-P07-C02 AGENT RELATIONAL SCHEMA (additive, local only): migrations
  20260922120000_cortex_agent_persistence.sql (agent_runs/agent_checkpoints/
  agent_approvals; tenant in every PK; composite FKs; NULL-safe record
  agreement incl. tenant; bounded JSONB 2MiB/512KiB/64KiB; own append-only
  trigger fn cortex.refuse_agent_checkpoint_mutation; NO workflow chain rule —
  agent previousDigest is latest-at-write, not version-1; approval lifecycle
  from approvalGate.ts: expired => decided NOT NULL, consumed any; no FK into
  workflow tables), 20260922120001_..._rls.sql (RLS enabled+FORCED, no policy,
  anon/authenticated revoked, service_role only), rollback
  20260922120000_rollback_agent_persistence.sql (no CASCADE; agent assets only).
  Evidence: static_agent_persistence_migration.test.ts 19/19; 4 mutations
  (NULL-unsafe compare, tightened expired rule, dropped state, borrowed
  workflow trigger fn) each caught. Live PG16: chain applied twice
  (idempotent), RLS t/t on 3 tables, rollback -> 0 agent tables, 3 workflow
  tables + workflow trigger fn intact, re-apply OK.
- A2-P07-C01 AGENT BASELINE AUDIT (2026-09-22, no code change):
  PORTS agents/persistence/ports.ts: AgentRunStore load/create/save/list;
    AgentCheckpointStore write/latest/read/history; AgentApprovalStore
    load/create/save/list. Memory impls in ports.ts; KV impls kvAgentStores.ts
    over kv_compare_and_swap_field. Bootstrap (ai/bootstrap.ts ~L814) builds
    KV stores when kvRead/kvReadByPrefix/kvCompareAndSwapField are injected,
    else agentRuntime.ts L189-191 falls back to memory. SQL agent stores: none.
  KV KEYS: org:{org}:ai:agent_run:{runId} | agent_checkpoint:{runId}:{v pad6}
    | agent_approval:{approvalId}; stored value gets `_schema`
    ai.agent.{run,checkpoint,approval}.v1 (leaks into loaded records; P08
    transform must strip it).
  CAS: runs/approvals: create = expected 0 insert-if-absent (dup ->
    persistence_failed); save = CAS on runVersion/approvalVersion (lost ->
    stale_run_version). Save on MISSING record: memory run_not_found, KV
    stale_run_version (pre-existing divergence; SQL must declare KV's answer).
    Checkpoint write = insert-if-absent per version (dup -> checkpoint_conflict).
  INTEGRITY: progressDigest = digestValue(progress) (sha256/128 of canonical
    progress); previousDigest = latest().progressDigest. Chain binds ONLY
    progress content — NOT organizationId/runId/version/state (differs from
    workflow). No chain verification on read (readProgress takes latest).
    => tenant remap needs no digest recomputation unless progress embeds org id.
  WRITE ORDER: runs.create(v1,cp0) -> checkpoint v1 -> runs.save(v2,cp1);
    every step writes checkpoint BEFORE run pointer => one-ahead crash window
    exists for agents too.
  ORDERING: runs newest-first createdAt desc, tie runId desc (localeCompare);
    approvals newest-first createdAt desc with NO tiebreak (workflow approvals
    are oldest-first); history numeric asc; limit default 50, max 200.
  IDENTITY: context.organizationId / checkpoint.organizationId /
    approval.organizationId; tenancy grammar admits slugs (default
    marq-cortex) => same BP-003 fail-closed-on-non-UUID rule applies.
  CORRUPTION: object/JSON-string coerce, structural check, onCorrupt, treat as
    absent; load refuses record whose org disagrees with key.
  APPROVAL LIFECYCLE (approvalGate.ts, actual): pending(no stamps) ->
    approved|rejected (decidedAt) -> consumed (decidedAt+consumedAt);
    expire() stamps decidedAt=now and runs whenever due in decide()/consume()
    REGARDLESS of state, so approved/rejected/consumed/expired can become
    expired; consumed->expired keeps consumedAt. No `withdrawn`. SQL lifecycle
    CHECK must admit exactly this (expired: decided NOT NULL, consumed any).
    PRE-EXISTING DOMAIN FINDING (not fixed; product semantics, out of A2
    persistence scope): consume() of an already-consumed, past-due approval
    rewrites state to `expired`, hiding that it was spent (consumedAt kept).
  BOUNDS: maxTotalSteps<=64, handoffs<=16, retries<=8; progress<=32KiB,
    output<=128KiB, action input<=64KiB; 1 checkpoint per step + entry.
  WORKFLOW LINK: WorkflowRunRecord.childAgentRunIds + pendingNode.agentRunId
    reference agent runs by id (same org); agent context.parentRunId /
    workflowId. No cross-domain FK (agent and workflow cut over separately).
- A2-P05-C01 (partial, 2026-09-22): branch claude/stoic-hypatia-o7ihgj @ 2d00ba6,
  clean tree; BP-003 42a1b73, BP-004 aac5a3f, packet lineage 5556eef all
  ancestors of HEAD; branch is main (388a4cc) + 51 A2 commits.
  verify:bp004 328/328, verify:bp003 488/488. No code/bootstrap change needed
  for inventory. Hosted access proof FAILED (see BLOCKERS). No hosted contact
  beyond refused CONNECTs; no hosted read or write performed.
```

### Cursor rule

At the end of every checkpoint:

1. finish the atomic checkpoint;
2. run its focused verification;
3. fix any in-scope defect discovered by that verification;
4. update this cursor with checkpoint, commit/test evidence and blockers;
5. commit the code + cursor together;
6. continue immediately unless a HARD GATE or genuine blocker says STOP.

Do not create separate checkpoint-report documents.

If the session is nearing its limit, finish the current safe atomic change, verify it, update the cursor, commit, and stop. If the session dies unexpectedly, the next session must inspect Git and this cursor, verify the last recorded checkpoint, and resume from the first incomplete checkpoint.

---

# 1. PURPOSE

Finish A2 — Runtime Persistence — with one coherent, resumable execution plan.

A2 is complete only when the existing agent/workflow/checkpoint/approval runtime state that still depends on generic KV has a proven authoritative PostgreSQL path, the selected production transition has been executed safely, SQL is the active runtime authority, obsolete parallel authority is retired or explicitly non-authoritative, recovery/concurrency/tenant isolation are proven, and temporary A2 migration artifacts are cleaned up.

This packet must **reuse the existing architecture**. It must not turn A2 into an excuse to redesign A3+.

---

# 2. NON-NEGOTIABLE ARCHITECTURE RULES

1. PostgreSQL is durable runtime/business truth.
2. Durable jobs/outbox/inbox from A1 remain separate execution/event primitives. Do not store workflow or agent domain state in the durable job tables.
3. Existing persistence ports are the compatibility seam. Preserve domain semantics unless an accepted migration finding requires an explicit, reviewed change.
4. Tenant boundary is canonical `public.organizations.id` UUID in the SQL authority.
5. No fuzzy tenant mapping. No automatic `marq-cortex → marq`.
6. Checkpoint/digest integrity is authoritative. Never manufacture a clean chain from an invalid source.
7. Optimistic concurrency must remain atomic in PostgreSQL — no TypeScript read-then-write CAS.
8. RLS forced; runtime persistence RPCs/service access remain internal. Do not create browser database APIs.
9. Production authority is singular. Temporary shadowing may duplicate writes for transition evidence, but there must never be two independent authoritative stores.
10. Same repo, same Supabase project, existing secrets/env/deployment configuration.
11. No new external queue, database, cache, migration service, or deployment project.
12. No A3 organizational-workforce feature work.
13. No Tool Gateway, graph/memory, autonomous growth, or UI scope drift.
14. Math/rules/state transitions remain deterministic; AI does not become persistence authority.

---

# 3. TOKEN / SESSION ECONOMY RULES

The goal is maximum engineering progress per Claude session.

- Do not write long narrative reports after each checkpoint.
- Put compact evidence in the cursor and continue.
- Do not rerun the full repository battery after every small change.
- Atomic checkpoint: focused tests.
- Phase completion: subsystem + boundary tests.
- Major integration gate: broader regression.
- Final A2 acceptance: full required battery.
- Do not reread every historical document on every continuation. Read this packet, the cursor, the active progress/gap map, and the exact contracts/files needed by the current phase.
- Fix in-scope defects yourself and continue. Stop only for a hard gate, an unresolved semantic ambiguity, an infrastructure conflict, or evidence that the planned migration is unsafe.

---

# 4. HARD GATES

## GATE R — Hosted READ-ONLY inventory

The user's A2 master go-ahead authorizes **read-only inspection of the existing Cortex hosted Supabase solely for A2 estate inventory**.

Allowed:
- SELECT/read-only access to the existing Cortex database;
- system/catalog reads needed to prove schema and counts;
- reading workflow KV records in memory to validate structure/digests;
- reading canonical organizations;
- reading registered workflow definitions/config required for the `organizationId` dependency scan.

Forbidden:
- INSERT/UPDATE/DELETE/TRUNCATE;
- DDL;
- RPCs that mutate;
- migrations;
- backfill;
- shadow writes;
- deployment;
- changing bootstrap/config;
- storing customer/business payloads in Git or committed artifacts.

If hosted credentials are unavailable or the environment cannot prove read-only behavior, STOP at this gate and record the exact missing prerequisite. Do not substitute guessed data.

### Read-only enforcement

Prefer a database session/transaction that is technically read-only:
- `default_transaction_read_only=on` and/or `BEGIN READ ONLY`;
- fail closed if the connection target cannot be identified as the existing Cortex Supabase;
- no write-probe against hosted data;
- inventory output must contain counts, classifications, identifiers required for mapping, digests/fingerprints, and non-sensitive reasons — not raw workflow input/output/evidence payloads.

## GATE W — Hosted writes / migrations / cutover / deployment

**CLOSED.**

No instruction in this master packet alone opens GATE W.

Before crossing it, all local workflow + agent implementation/rehearsal phases must be complete and Claude must stop with a concise cutover dossier containing:
- exact hosted migrations to apply;
- exact runtime/deployment changes;
- selected workflow transition strategy and why;
- selected agent transition strategy and why;
- source counts and tenant mappings;
- unresolved mapping entries, if any;
- active-run/approval exposure;
- checkpoint health and recoverable one-ahead count;
- rollback method;
- expected writes;
- verification steps;
- go/no-go conditions.

Then wait for explicit user approval of the hosted-write/cutover plan.

After approval is received in a later message, record that approval in the cursor and continue from the same master packet. Do not require a new master specification.

---

# 5. ACCEPTED FOUNDATION — DO NOT REBUILD

## BP-003 accepted

Already proven:
- SQL workflow run/checkpoint/approval stores;
- PostgreSQL atomic create/save/append operations;
- forced RLS and service-role-only RPCs;
- parity for UUID-backed tenants;
- workflow approval lifecycle;
- local PostgreSQL concurrency;
- rollback;
- production bootstrap still KV.

## BP-004 accepted

Already proven:
- workflow KV source inventory;
- explicit tenant mapping;
- deterministic slug/noncanonical → UUID transformation;
- organizationId-bound checkpoint re-chaining;
- exact vs migration-semantic fingerprints;
- local workflow backfill rehearsal;
- GO/NO-GO rules;
- local-only DB safety;
- source KV immutability;
- production boundary isolation.

Do not duplicate these systems. Extend/generalize only when required by the remaining A2 work.

Two BP-004 findings are load-bearing:

1. `organizationId` is available to workflow condition expressions. Tenant remapping may change FUTURE condition evaluation.
2. The workflow engine appends a checkpoint before saving the run pointer. A chain tip exactly one version ahead of the run pointer can be a legitimate recoverable crash window.

---

# 5A. SAFE REORDER RULE WHEN GATE R IS BLOCKED

If the existing Cortex hosted Supabase cannot be reached read-only from the execution environment, do **not** idle A2 and do **not** guess hosted data.

Authorized reordering while GATE R remains blocked:

1. execute **A2-P07** completely (agent SQL persistence foundation; local/code only);
2. then execute **A2-P08-C01** (agent source inventory / tenant-mapping mechanics, local fixtures/code only);
3. then execute **A2-P08-C02** (agent transformation/fingerprint mechanics, local fixtures/code only);
4. stop before **A2-P08-C03** unless P05 has been completed, because final transition strategy must not be chosen as if real hosted estate evidence existed;
5. do not execute A2-P06 before P05 strategy selection;
6. preserve the P05 blocker in the cursor until real hosted read-only evidence is supplied.

This reorder changes scheduling only. It does not weaken any acceptance gate and does not mark P05 complete.

---

# 6. PHASE A2-P05 — HOSTED READ-ONLY WORKFLOW ESTATE INVENTORY & STRATEGY

## A2-P05-C01 — Baseline + access proof

Before code changes:
- verify branch/head and accepted A0/A1/BP-003/BP-004 lineage;
- inspect current hosted-access mechanism available in the environment;
- prove the target is the existing Cortex Supabase project;
- configure read-only session enforcement;
- record only non-secret connection evidence;
- verify no production runtime/bootstrap changes are needed for inventory.

If safe hosted read-only access cannot be proven, STOP and update cursor.

## A2-P05-C02 — Real workflow estate inventory

Run the BP-004 inventory mechanics against the real hosted workflow KV estate **read-only/in-memory**.

Measure at minimum:
- total KV rows inspected;
- workflow run/checkpoint/approval counts;
- counts per source tenant identifier;
- UUID vs non-UUID tenant census;
- exact active canonical slug candidates;
- corrupt JSON/wrong schema/key-payload mismatch/duplicate/orphan counts;
- checkpoint-chain health;
- run checkpoint-pointer health;
- pending approvals;
- active vs terminal run states;
- pending child-agent nodes;
- retry/backoff exposure;
- approximate workflow persistence byte volume;
- oldest/newest relevant timestamps;
- no raw business payload in output.

### Pointer classification

Do not treat every pointer mismatch equally.

Classify at least:
- EXACT_TIP_MATCH;
- RECOVERABLE_ONE_AHEAD_CANDIDATE: stored tip version = run.checkpointVersion + 1 AND tip.previousDigest = run.checkpointDigest AND preceding chain verifies;
- ACTUAL_POINTER_MISMATCH;
- POINTER_WITHOUT_CHAIN;
- CHAIN_WITHOUT_POINTER where contract makes it invalid.

The one-ahead candidate is evidence, not automatic repair. Record counts and examples by identifiers only.

## A2-P05-C03 — Organization-sensitive workflow-definition scan

Inspect the registered workflow definitions/configuration that can execute for any tenant requiring organization-ID translation.

Detect any expression/reference where `organizationId` is used in:
- condition nodes;
- mappings;
- branch/join criteria if supported;
- stored definition metadata that feeds expression evaluation.

Classify:
- no dependency;
- dependency uses dynamic organization identity safely;
- literal comparison/reference that would change behavior after slug→UUID remap;
- ambiguous/unparseable definition.

A remapped tenant with unresolved organization-sensitive behavior is NO-GO.

Do not rewrite workflow definitions in P05.

## A2-P05-C04 — Real tenant mapping dossier

For every source tenant:
- if source id is already canonical UUID and active → resolved;
- otherwise identify exact canonical candidates by active slug as EVIDENCE ONLY;
- require explicit mapping authority before hosted mutation;
- never infer by name/prefix/similarity;
- many-source→one-target remains blocked unless explicit tenant consolidation is separately authorized.

Do not commit raw tenant business data. Identifiers needed for migration authority may be recorded in the temporary cursor/dossier only if they are not secrets.

## A2-P05-C05 — Strategy decision

Choose the minimum safe workflow transition mechanism based on the real estate.

Evaluate:
A. short write freeze + backfill + verify + cutover;
B. shadow/dual write + historical backfill + catch-up + verify + cutover;
C. drain active workflows + backfill + cutover;
D. hybrid or another bounded mechanism proven necessary.

Decision must account for:
- real active-run count;
- approval decisions arriving independently of run advancement;
- checkpoint-before-run-pointer write ordering;
- KV CAS and SQL CAS behavior;
- data volume;
- expected backfill duration;
- whether writes during backfill can be lost;
- operational rollback.

Commit a compact strategy decision in code comments/tests/cursor, not a new permanent architecture document.

### P05 exit

P05 ends with:
- real estate measured;
- blockers named;
- tenant mapping requirements explicit;
- organization-sensitive definitions known;
- workflow transition strategy selected;
- no hosted write performed.

Run focused BP-004 regression + security/boundary checks.

---

# 7. PHASE A2-P06 — WORKFLOW TRANSITION MACHINERY + FULL LOCAL CUTOVER REHEARSAL

This phase is local/code-only. GATE W remains closed.

## A2-P06-C01 — Transition contracts/state machine

Implement the smallest temporary transition control required by P05's selected strategy.

Requirements:
- explicit states;
- resumable/idempotent;
- one authority at every state;
- no hidden fallback;
- transition evidence is deterministic;
- crash/restart safe;
- rollback path explicit;
- no normal production activation yet.

If strategy is shadow/dual-write, define which store is authoritative and which is evidence at every state.

If strategy is freeze/drain, encode the exact freeze/drain precondition rather than relying on operator memory.

## A2-P06-C02 — Workflow historical backfill + catch-up

Build/reuse:
- source inventory;
- explicit tenant mapping;
- checkpoint re-chain;
- run pointer transform;
- approvals transform;
- idempotent SQL insert/update semantics;
- catch-up/version reconciliation if the selected strategy requires it.

Never overwrite a newer SQL record with an older KV version.

Never translate corrupt/unverified chains.

Classify recoverable one-ahead candidates explicitly according to P05/P06 evidence.

## A2-P06-C03 — Workflow mirror/shadow or freeze/drain mechanism

Implement only the P05-selected mechanism.

For shadowing:
- KV remains authority before cutover;
- SQL write is evidence until cutover state changes;
- failures observable and cannot silently change authority;
- approval/run/checkpoint families all covered;
- ordering/crash windows modeled.

For freeze/drain:
- all mutation entry points included;
- approvals included, not only run advancement;
- timeout/recovery behavior explicit.

## A2-P06-C04 — Workflow parity + cutover verifier

Machine-verifiable:
- counts;
- IDs;
- versions;
- states;
- checkpoint chains;
- run pointers;
- approval lifecycle/version;
- tenant ownership;
- semantic fingerprints;
- active-run safety state;
- no unclassified divergence.

Produce GO/NO-GO, never percentage-based acceptance.

## A2-P06-C05 — Local adversarial cutover rehearsal

Using local PostgreSQL + KV fixture:
- writes during backfill;
- approval decision during backfill;
- checkpoint appended before run save;
- recoverable one-ahead state;
- stale KV version;
- stale SQL version;
- duplicate backfill execution;
- worker crash/restart;
- transition-controller restart;
- partial tenant migration;
- invalid checkpoint chain;
- unresolved tenant mapping;
- SQL outage during evidence/shadow phase;
- simulated authority cutover;
- runtime restart after simulated SQL authority;
- simulated rollback before rollback window closes.

At the end:
- local workflow runtime can operate with SQL authority;
- local rollback is proven where the selected strategy says rollback remains possible;
- production bootstrap/authority still KV because GATE W is closed.

---

# 8. PHASE A2-P07 — AGENT SQL PERSISTENCE FOUNDATION

Do not assume workflow and agent semantics are identical.

## A2-P07-C01 — Agent baseline audit

Inspect actual:
- `AgentRunStore`;
- `AgentCheckpointStore`;
- `AgentApprovalStore`;
- KV keys and schema markers;
- run/checkpoint/approval contracts;
- version/CAS semantics;
- checkpoint integrity/digest behavior;
- organization identity fields;
- ordering/filtering;
- corruption behavior;
- runtime/bootstrap construction sites;
- child-agent/workflow dependencies.

Return compact audit in cursor before edits.

If the agent checkpoint/digest model binds organizationId or other identity fields, preserve that exactly and design migration accordingly.

## A2-P07-C02 — Agent relational schema

Add additive migrations + rollback for authoritative agent runtime persistence.

Requirements:
- tenant-safe composite references;
- bounded JSONB + projected authority fields;
- NULL-safe JSON/relational agreement;
- forced RLS;
- no authenticated/browser table API;
- service/runtime-only functions;
- append-only checkpoint rules where the domain contract says immutable;
- approval lifecycle constraints derived from actual agent contract, not copied blindly from workflow.

## A2-P07-C03 — Atomic SQL agent operations

Implement SQL atomic create/save/append/approval operations.

No TypeScript read-then-write concurrency.

Map database outcomes to existing typed agent-domain failures.

## A2-P07-C04 — SQL adapters + shared contract parity

Implement SQL stores behind existing ports.

Run one reusable parity suite against:
1. memory/reference implementation where present;
2. current KV implementation;
3. live local PostgreSQL SQL implementation.

Preserve:
- listing/filter ordering;
- create-if-absent;
- optimistic concurrency;
- append immutability;
- approval lifecycle;
- tenant isolation;
- corruption reporting.

## A2-P07-C05 — Live local PostgreSQL concurrency/RLS/rollback

Prove:
- concurrent create/save behavior;
- stale version refusal;
- duplicate checkpoint behavior;
- approval races;
- cross-tenant denial;
- no direct authenticated mutation/read where internal-only;
- service runtime success;
- apply→rollback→reapply;
- rollback removes only A2-owned assets.

Production agent bootstrap remains KV.

---

# 9. PHASE A2-P08 — AGENT MIGRATION READINESS + COMBINED LOCAL A2 REHEARSAL

## A2-P08-C01 — Agent source inventory / tenant mapping

Build only the domain-specific pieces not already safely reusable from BP-004.

Reuse generic local-only and explicit tenant mapping mechanics where semantics truly match.

Classify malformed/orphan/integrity failures; never repair during inventory.

## A2-P08-C02 — Agent transformation/fingerprint

If tenant translation changes integrity-bound fields:
- verify source first;
- transform deterministically;
- recompute only mathematically required integrity values;
- prove exact/migration-semantic equivalence;
- preserve all other domain facts.

## A2-P08-C03 — Agent transition strategy

Choose based on agent mutation semantics and real known runtime behavior.

Do not copy workflow strategy automatically.

Implement local transition/backfill/catch-up/rollback mechanism needed by the chosen agent strategy.

## A2-P08-C04 — Combined local A2 cutover rehearsal

Start from:
- workflow KV authority;
- agent KV authority.

Rehearse the complete planned sequence through:
- SQL schemas;
- transition modes;
- backfill;
- catch-up;
- workflow SQL authority;
- agent SQL authority;
- process/runtime restart;
- pending approvals;
- active workflow child-agent relationships;
- concurrency;
- rollback according to the planned rollback windows.

End-state of rehearsal:
```text
workflow SQL authority
agent SQL authority
A1 durable runtime unchanged
tenant isolation green
restart/recovery green
approvals green
no duplicate authority
```

Production remains unchanged.

## A2-P08-C05 — Pre-hosted-write dossier

Run the broad regression suite.

Update cursor with:
- P05 hosted read-only measurements;
- selected workflow strategy;
- selected agent strategy;
- exact migrations;
- exact production code/deployment changes;
- exact backfill/catch-up actions;
- tenant mappings requiring approval;
- known blockers;
- exact rollback plan;
- test evidence.

Then STOP at GATE W.

Do not start hosted writes from the master prompt alone.

---

# 10. GATE W STOP FORMAT

When P08 is complete, respond briefly:

```text
A2 MASTER — HOSTED WRITE GATE

Local/read-only preparation: COMPLETE
Workflow transition rehearsal: PASS/FAIL
Agent SQL candidate: PASS/FAIL
Agent transition rehearsal: PASS/FAIL
Hosted read-only estate: <summary>
Unresolved mappings/blockers: <summary>

Proposed hosted actions:
1. ...
2. ...
3. ...

Rollback:
...

Exact approval required:
"APPROVE A2 HOSTED WRITE GATE: <scope>"
```

The user may approve the whole exact plan once. After that, continue the SAME master packet from the cursor.

---

# 11. PHASE A2-P09 — HOSTED SQL FOUNDATION + TRANSITION ACTIVATION

**Only after GATE W approval recorded in cursor.**

Before any mutation:
- re-run read-only preflight;
- confirm counts/versions have not invalidated the dossier;
- confirm branch/commit/deployment inputs;
- confirm no new blocker;
- backup/recovery capability appropriate to existing Supabase setup;
- verify rollback assets.

Then apply only approved existing-repo migrations:
- BP-003 workflow SQL persistence migrations if not already hosted;
- P07 agent SQL persistence migrations;
- any narrowly required transition-state migration explicitly included in the approved dossier.

Deploy only approved transition-capable runtime code.

After deployment, SQL is still not authoritative until the selected strategy's cutover gate says so.

No new infrastructure.

---

# 12. PHASE A2-P10 — HOSTED WORKFLOW MIGRATION + SQL AUTHORITY CUTOVER

Execute the selected P05/P06 strategy exactly.

Required gates:
1. transition mechanism healthy;
2. tenant mappings explicit;
3. historical backfill complete;
4. catch-up/freeze/drain condition complete;
5. zero unclassified parity divergence;
6. checkpoint chains valid;
7. recoverable one-ahead cases handled by the proven rule;
8. approvals synchronized;
9. active runs safe under the selected mechanism;
10. rollback still available.

Then change **workflow authority only** to SQL.

Immediately verify:
- create/load/save;
- checkpoint append/recovery;
- approval request/decision/consume/expiry;
- active run continuation;
- restart/reconstruction;
- tenant isolation;
- audit/trace continuity;
- no new KV authoritative write.

If any hard gate fails, use the approved rollback and STOP.

Do not retire workflow KV transition assets until workflow SQL authority is proven stable enough for the approved rollback policy.

---

# 13. PHASE A2-P11 — HOSTED AGENT MIGRATION + SQL AUTHORITY CUTOVER

Repeat the same discipline using P07/P08's agent-specific strategy.

Required proof:
- agent runs;
- agent checkpoints;
- agent approvals;
- concurrency/CAS;
- child-agent relationships used by workflow;
- restart/recovery;
- tenant isolation;
- no authority split.

Then change agent authority to SQL.

If workflow depends on child-agent state during the agent cutover, test that integration explicitly before declaring success.

---

# 14. PHASE A2-P12 — AUTHORITY CONSOLIDATION / LEGACY KV RETIREMENT

After both SQL authorities are proven:

- production bootstrap must construct SQL workflow stores;
- production bootstrap must construct SQL agent stores;
- no runtime path may select KV workflow/agent authority;
- transition-only dual/shadow paths disabled;
- verify no writes occur to legacy workflow/agent KV namespaces.

Do not delete generic KV infrastructure still used elsewhere.

For workflow/agent-specific KV adapters and migration helpers:
- KEEP if they are still required for an approved rollback window or non-production compatibility test;
- otherwise REMOVE them in this phase;
- do not leave dead parallel persistence architecture "just in case".

Hosted legacy KV rows:
- do not destroy evidence impulsively;
- follow existing retention/recovery posture;
- they may remain read-only/non-authoritative through the rollback window;
- deletion, if appropriate, must be explicit and verified, never required merely to call SQL authoritative.

---

# 15. PHASE A2-P13 — FINAL A2 VERIFICATION + CLEANUP

## Full regression

At minimum run all commands accumulated by A0/A1/A2, including:

```text
npm run verify:bp002
npm run verify:bp003
npm run verify:bp004
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

plus every new A2 master workflow/agent persistence/cutover verification command.

Hosted post-cutover smoke/recovery verification must be separate from local tests and must never be represented as passed if it was not actually run.

## Architecture cleanup

Before A2 can close:
- progress record says A2 COMPLETE;
- architecture gap map says A2 COMPLETE;
- implementation truth names SQL as workflow + agent runtime authority;
- current bootstrap matches that claim;
- no temporary BP-005/BP-006/BP-007 docs exist;
- no duplicate derived architecture doc is created;
- no dead transition code remains outside an explicitly documented rollback need;
- temporary A2 master packet is deleted only after independent acceptance;
- do not start A3.

---

# 16. A2 COMPLETION CONTRACT

A2 may be marked COMPLETE only if all are true:

### Workflow
- SQL persistence hosted and authoritative;
- existing runtime uses SQL stores;
- tenant mappings resolved;
- checkpoint chains and pointers valid;
- active/recovery semantics verified;
- approvals verified;
- KV is no longer workflow authority.

### Agent
- SQL persistence hosted and authoritative;
- existing runtime uses SQL stores;
- concurrency/checkpoints/approvals verified;
- workflow→child-agent integration verified;
- KV is no longer agent authority.

### Platform
- A1 durable runtime unchanged except explicitly required integration;
- tenant isolation/RLS green;
- no direct browser persistence API created;
- no new infrastructure stack;
- restart/recovery green;
- no unresolved correctness/security blocker;
- full regression green;
- hosted changes documented truthfully;
- progress/gap records reconciled;
- obsolete transition artifacts cleaned.

If any item is false, A2 remains IN PROGRESS.

---

# 17. CONTINUATION PROTOCOL

When a new Claude session starts, the user should only need to say:

```text
CONTINUE MARQ CORTEX A2 MASTER

Repository: marqnetwork/marqcortex-
Branch: claude/stoic-hypatia-o7ihgj

Read:
docs/generated/build-packets/A2_MASTER_RUNTIME_PERSISTENCE_EXECUTION.md

Read its EXECUTION CURSOR.
Inspect git status and recent A2 commits.
Verify the last completed checkpoint from repository evidence.
Resume from the FIRST INCOMPLETE checkpoint.

Do not redo completed checkpoints unless verification shows them incomplete.
Preserve every hard gate.
Continue automatically until the next hard gate, genuine blocker, or A2 completion.
```

Never restart the master plan from phase 1 merely because a session ended.

---

# 18. INITIAL SESSION INSTRUCTION

On the first run:

1. read this entire packet;
2. read:
   - `docs/development/AUTONOMOUS_BUILD_PROGRESS.md`
   - `docs/generated/architecture/CURRENT_ARCHITECTURE_VS_TARGET_GAP_MAP.md`
   - `architecture/MARQ_CORTEX_TARGET_ARCHITECTURE_v2.0.md`
3. verify accepted BP-003/BP-004 implementation evidence in code;
4. begin at `A2-P05-C01`;
5. work continuously through checkpoints;
6. keep reports compact;
7. stop only at a hard gate/blocker/session limit;
8. never start A3.

**The objective is not to finish a prompt. The objective is to finish A2 with one authoritative runtime persistence architecture and no known correctness/security blocker.**
