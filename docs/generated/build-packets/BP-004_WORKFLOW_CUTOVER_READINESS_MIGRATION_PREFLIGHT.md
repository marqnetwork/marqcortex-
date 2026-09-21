# BP-004 — Workflow Cutover Readiness & Migration Preflight

> **DERIVED IMPLEMENTATION PACKET — DELETE AFTER VERIFIED IMPLEMENTATION**
> This packet is an A2 readiness slice. It does **not** authorize workflow SQL cutover, hosted backfill, shadow writes, deployment, or agent persistence migration.

**Status:** Ready for Claude implementation  
**Repository:** existing `marqnetwork/marqcortex-` repository only  
**Working branch:** continue from `claude/gallant-einstein-0ggpqe` unless explicitly instructed otherwise  
**Prerequisites:** A0 accepted; A1/BP-002 accepted; BP-003 workflow SQL candidate accepted through `42a1b73bea4d12e9156333bb07a9635ecb144bed`  
**Production authority at packet start and end:** existing KV workflow stores  
**Infrastructure rule:** same repository, same Supabase project, same Postgres architecture. No new database, queue, backend, repo, deployment project, or external migration service.  
**Hosted-system rule:** **NO production/staging DB read or write in BP-004 unless a later explicit user authorization names that environment and action.** All executable verification in this packet must use repository fixtures, synthetic/source snapshots, and the existing LOCAL PostgreSQL harness.

---

## 1. Objective

Prepare Cortex for a future workflow-persistence cutover **without moving authority**.

BP-003 proved that, for UUID-backed tenants, a SQL implementation can satisfy the existing workflow persistence contracts.

BP-004 must answer the harder migration questions:

1. What source workflow data shape can exist in KV today?
2. Which source tenant identifiers are already canonical `organizations.id` UUIDs?
3. Which source tenant identifiers require an explicit mapping?
4. Can every workflow run/checkpoint/approval be transformed into the BP-003 SQL authority without semantic loss?
5. What must be re-derived when a tenant identifier changes?
6. Can a candidate backfill be reproduced, verified and rolled back **before** any hosted system is touched?
7. What exact evidence must a later cutover packet require before production authority moves?

Target outcome:

```text
Current KV authority
     │
     ├── read-only source inventory
     ├── tenant identity classification
     ├── explicit mapping manifest
     ├── deterministic transformation plan
     ├── checkpoint re-chain proof when tenant id changes
     ├── local scratch SQL backfill simulation
     ├── source↔target parity manifest
     └── GO / NO-GO readiness verdict
              │
              └── NO production cutover in BP-004
```

---

## 2. Critical Finding This Packet Must Respect

The organization-ID mismatch is **not just a foreign-key problem**.

Current AI tenancy accepts identifiers matching:

```text
[a-z0-9][a-z0-9._-]{0,63}
```

and the deployment default is currently:

```text
AI_DEFAULT_ORGANIZATION_ID = "marq-cortex"
```

unless overridden.

Canonical tenancy in PostgreSQL is:

```text
public.organizations.id UUID
public.organizations.slug TEXT
```

with active slugs unique.

Authenticated organization memberships already carry `organization_id UUID`, but the AI default fallback may still resolve a non-UUID identifier.

### Important: do not guess the mapping

The existing membership bootstrap looks for active organization slug `marq`.

That does **not** prove:

```text
marq-cortex → slug marq
```

and BP-004 must never make that inference automatically.

### Even more important: checkpoint digests bind the organization ID

`computeCheckpointDigest()` includes:

```text
workflowRunId
organizationId
version
state
nodeId
stepCount
cursorNodeId
outputsDigest
loopIterations
nodeVisits
parallel
previousDigest
```

Therefore:

> changing a checkpoint's `organizationId` changes its digest.

And because each checkpoint contains `previousDigest`, remapping one source tenant identifier to a different canonical UUID requires the **entire checkpoint chain to be deterministically re-chained**, and the run's `checkpointDigest` pointer must be updated to the transformed tip.

This must be explicit and tested. A backfill that merely rewrites `organizationId` would corrupt restart recovery.

---

## 3. Governing Rule

> **BP-004 discovers and proves the migration. It does not perform the migration on any hosted environment.**

No matter how green the preflight is, this packet ends with KV still authoritative.

---

## 4. Hard Scope Boundaries

### MUST NOT do

- no production workflow cutover;
- no staging/production database connection;
- no hosted KV inventory query;
- no hosted SQL backfill;
- no `supabase db push`;
- no Edge Function deploy;
- no workflow bootstrap change;
- no SQL feature flag;
- no shadow write;
- no dual write;
- no SQL read fallback;
- no production read comparison;
- no deletion or mutation of KV workflow records;
- no change to `createKvWorkflow*Store`;
- no change to workflow engine semantics;
- no change to tenancy resolution semantics;
- no automatic `marq-cortex → marq` mapping;
- no creation of replacement organizations;
- no agent persistence migration;
- no agent cutover planning in this packet;
- no audit/financial/reuse/dossier migrations;
- no UI work;
- no deployment architecture work.

### MAY do

Only:

- pure/read-only source inventory logic;
- explicit tenant-mapping validation;
- deterministic record transformation logic;
- local/synthetic source snapshots;
- local PostgreSQL dry-run backfill simulation;
- source/target verification manifests;
- go/no-go readiness rules;
- tests;
- documentation comments in code where required for correctness.

---

## 5. Mandatory Baseline Audit Before Editing

Claude must first inspect the actual branch and return:

```text
A. Exact AI organization-resolution paths
B. Which paths always produce canonical UUID organization ids
C. Which paths may produce slug/non-UUID ids
D. Current default-organization configuration behavior
E. Canonical organizations table constraints / slug uniqueness
F. Exact workflow KV key namespaces
G. Exact workflow KV payload schemas / _schema markers
H. Which workflow fields contain organizationId
I. Which integrity digests bind organizationId
J. Which run fields point to checkpoint digests
K. Current KV corruption-handling behavior
L. Current workflow terminal vs active states
M. Proposed preflight source interface
N. Proposed explicit tenant-mapping format
O. Proposed transformed-record algorithm
P. Proposed local dry-run / verification algorithm
Q. Exact files likely to change
R. Any blocker or ambiguity
```

If any digest or identity dependency is unclear, **STOP before writing migration transformation code**.

---

## 6. Source Inventory Contract

Build a pure inventory layer that can consume workflow KV rows without modifying them.

Minimum source row:

```text
key
value
```

Value may be:
- JSON object;
- JSON string containing an object.

Match current KV coercion behavior.

Recognize only the workflow namespaces:

```text
org:{sourceTenant}:ai:workflow_run:{workflowRunId}
org:{sourceTenant}:ai:workflow_checkpoint:{workflowRunId}:{version6}
org:{sourceTenant}:ai:workflow_approval:{workflowApprovalId}
```

Schema markers:

```text
ai.workflow.run.v1
ai.workflow.checkpoint.v1
ai.workflow.approval.v1
```

### Inventory must never silently adopt malformed data

For each row classify at least:

```text
valid
corrupt_json
wrong_schema
key_payload_tenant_mismatch
key_payload_identity_mismatch
invalid_key
unknown_workflow_namespace
orphan_checkpoint
orphan_approval
duplicate_logical_identity
invalid_checkpoint_chain
run_checkpoint_pointer_mismatch
```

Do not mutate or repair a source row during inventory.

---

## 7. Tenant Identity Classification

Every source tenant identifier found in either the KV key or payload must be classified.

Minimum states:

```text
CANONICAL_UUID
  source id is UUID
  AND matches an existing canonical organizations.id in the supplied catalog

UUID_NOT_FOUND
  syntactically UUID but no canonical organization exists

SLUG_EXACT_CANDIDATE
  non-UUID source id exactly matches one active canonical organization slug
  — candidate evidence only, NOT automatic approval

EXPLICIT_MAPPING_REQUIRED
  source id needs a human/declared mapping

MAPPING_CONFLICT
  mapping disagrees with source/catalog evidence

TARGET_INACTIVE_OR_DELETED
  target exists but is not an eligible active canonical organization
```

### Locked rule

A slug match is **evidence**, not authority.

Only one of these may authorize transformation:

1. source tenant id already equals the canonical organization UUID; or
2. an explicit migration mapping manifest names the source identifier and target organization UUID.

No fuzzy match.
No name match.
No prefix match.
No `marq-cortex → marq` heuristic.

---

## 8. Tenant Mapping Manifest

Create a small explicit contract, e.g.:

```text
sourceTenantId
targetOrganizationId
expectedTargetSlug (optional but recommended)
reason / evidence classification
```

Requirements:

- target must be a UUID;
- target must exist in supplied canonical organization catalog;
- target must be active and not deleted;
- if `expectedTargetSlug` is supplied, it must match exactly;
- no two source tenants may map ambiguously;
- many source tenants mapping to one target is **NO-GO by default** unless a future packet explicitly authorizes tenant consolidation;
- mapping must never be inferred from organization name.

The mapping manifest is migration input, not a runtime tenancy table.

Do not persist it to production.

---

## 9. Transformation Rules

Transformation must be pure and deterministic.

### 9.1 Canonical UUID source tenant

When:

```text
sourceTenantId === targetOrganizationId
```

the domain records should remain semantically byte-equivalent after normal JSON decoding/encoding. No checkpoint digest may change.

### 9.2 Non-UUID / remapped source tenant

When:

```text
sourceTenantId !== targetOrganizationId
```

the following fields require transformation:

#### Workflow run

```text
record.context.organizationId
```

and, if checkpoints exist:

```text
record.checkpointDigest
```

must point at the transformed chain tip.

No run ID, workflow ID, actor ID, state, run version, step history, transition history, input, usage or business payload may change.

#### Workflow checkpoints

For every checkpoint in numeric version order:

1. verify the SOURCE chain first using existing `verifyChain`;
2. replace `organizationId` with target UUID;
3. version 1 keeps no `previousDigest`;
4. version N>1 receives the TRANSFORMED predecessor's digest;
5. recompute `digest` using the existing `computeCheckpointDigest`;
6. do not alter outputs, outputsDigest, node/state/cursor, loops, visits, parallel summary, timestamps or run ID.

Produce an explicit mapping:

```text
source checkpoint digest → transformed checkpoint digest
```

for evidence.

#### Workflow approvals

Replace only:

```text
organizationId
```

unless inspection proves another organization-bound field exists.

Approval IDs must not change unless the existing contract proves they bind organization identity. Do not invent new IDs.

### Locked rule

Never recalculate a checkpoint chain that fails source verification.

That source tenant is **NO-GO** until the corruption is separately resolved.

---

## 10. Migration Semantic Fingerprint

A raw byte comparison is impossible when tenant identity and chained digests intentionally change.

Therefore build two fingerprints:

### Exact fingerprint

Used when source tenant id already equals target UUID.

Must prove the domain records did not change.

### Migration-semantic fingerprint

Used only for explicit tenant remapping.

Must exclude ONLY the fields whose change is mathematically required by the tenant translation:

- organizationId location;
- checkpoint digest;
- checkpoint previousDigest;
- run checkpointDigest pointer.

Everything else must compare exactly.

If any other domain field changes, preflight is NO-GO.

Do not call this "same bytes." Call it deterministic migration-semantic equivalence.

---

## 11. Preflight Manifest

Generate an in-memory/report object with no secret/business payload copies.

Minimum per source tenant:

```text
sourceTenantId
classification
targetOrganizationId (if explicitly resolved)
targetSlug
runCount
checkpointCount
approvalCount
activeRunCount
terminalRunCount
pendingApprovalCount
corruptRowCount
orphanCheckpointCount
orphanApprovalCount
invalidChainCount
pointerMismatchCount
mappingRequired
digestRewriteRequired
sourceFingerprint
transformedFingerprint
readiness
reasons[]
```

Global manifest:

```text
sourceRowCount
recognizedWorkflowRowCount
unknownWorkflowRowCount
tenantCount
readyTenantCount
blockedTenantCount
allSourceChainsValid
allMappingsExplicit
allTargetsCanonical
localBackfillVerified
goNoGo
generatedAt
tool/version
```

Do not include raw workflow input/output/business content in the manifest.

---

## 12. GO / NO-GO Rules

Preflight may say **GO FOR A LATER BACKFILL PACKET** only when all are true:

- every recognized source workflow row parses;
- every source key agrees with its payload identity/tenant;
- every source tenant maps explicitly to exactly one active canonical organization UUID;
- no target tenant mapping conflict;
- every run referenced by a checkpoint/approval exists;
- every checkpoint chain verifies before transformation;
- every run checkpoint pointer matches its source tip;
- transformed chain verifies after tenant remap;
- transformed run points to transformed tip;
- migration-semantic fingerprint shows no unintended domain changes;
- local scratch SQL accepts every transformed record;
- SQL counts equal transformed source counts;
- SQL contract reads produce expected transformed domain records;
- rollback of the local simulation leaves the source KV fixture unchanged;
- no active-source condition is left unaccounted for.

Any failure => NO-GO with structured reasons.

---

## 13. Active Workflow Safety Classification

Inventory current workflow states using the real `WORKFLOW_RUN_STATES` / terminal-state helper.

Report at least:

```text
terminal
active/running
waiting_for_agent
waiting_for_branches
waiting_for_approval
paused
retry/backoff-relevant state if represented inside the run
```

Do not invent a migration policy for active runs yet.

BP-004 must tell the next packet exactly how many/synthetic examples fall into each category and what invariants a cutover would need to preserve.

A later packet decides whether cutover requires:
- a short workflow-write freeze;
- drain-to-terminal;
- dual/shadow writes;
- catch-up;
- or another mechanism.

BP-004 does not choose by intuition.

---

## 14. Local Dry-Run Backfill Simulation

Using the existing LOCAL PostgreSQL 16 harness:

1. apply the full migration chain including BP-003 SQL workflow tables;
2. seed canonical `organizations`;
3. seed workflow KV rows into local `kv_store_324f4fbe`;
4. run the pure preflight inventory;
5. apply an explicit tenant mapping manifest;
6. transform records in memory;
7. insert runs first;
8. insert checkpoints second;
9. insert approvals third;
10. verify counts;
11. verify run versions/states;
12. verify checkpoint chains and run tip pointers;
13. verify approval states/versions;
14. verify tenant isolation and target ownership;
15. produce parity/readiness manifest;
16. rollback/drop scratch database;
17. prove source KV rows were never changed by the preflight/backfill simulation.

### Required fixture scenarios

At minimum:

A. UUID-backed tenant — no transform required.

B. Slug-style source tenant with explicit target UUID — full checkpoint re-chain required.

C. Slug-style tenant with no explicit mapping — NO-GO.

D. Exact active slug candidate but no explicit mapping — still NO-GO.

E. Mapping to missing organization — NO-GO.

F. Mapping to inactive/deleted organization — NO-GO.

G. Two source tenants mapped to one target — NO-GO.

H. Source checkpoint chain corrupt — NO-GO and no transformed chain emitted.

I. Orphan checkpoint — NO-GO.

J. Orphan approval — NO-GO.

K. Run checkpoint pointer does not equal source chain tip — NO-GO.

L. Mixed object/JSON-string KV values — handled exactly like current KV reader.

M. Unknown non-workflow KV records — ignored, never mutated.

N. Active run present — inventoried and explicitly called out; readiness policy must not pretend it is terminal.

---

## 15. No Hosted Data Access in BP-004

This is load-bearing.

The new preflight command/test must run only against:

- in-memory rows;
- fixture/snapshot files supplied intentionally for testing;
- the existing local PostgreSQL harness.

If a database URL is accepted by a BP-004 script, it must fail closed for a non-local host.

Allowed local forms may include:

```text
localhost
127.0.0.1
::1
local Unix socket / repository harness equivalent
```

Do not weaken this to a warning.

A later explicitly authorized packet may run a **read-only hosted preflight**.

---

## 16. No New Persistent Production Schema

BP-004 should not need new production tables.

Do not add:

- migration-manifest tables;
- mapping tables;
- cutover-state tables;
- shadow-write tables.

If implementation discovers a genuine reason persistent migration state is required, STOP and report it. Do not invent it inside this packet.

Generated manifests for tests should remain temporary artifacts under the test runtime, not committed customer-data snapshots.

---

## 17. Cutover Strategy Decision Record — Session/Final Report Only

At the end, based on verified mechanics, Claude must recommend the safest **next packet shape**, not execute it.

Evaluate these possibilities factually:

```text
A. freeze + backfill + verify + cutover
B. shadow/dual write + backfill + catch-up + verify + cutover
C. drain active workflows + backfill + cutover
D. another bounded mechanism proven necessary by current runtime semantics
```

The recommendation must be based on:

- active-run mutation behavior;
- KV CAS semantics;
- SQL CAS semantics;
- whether a write can occur during backfill without being lost;
- approval decisions arriving independently of run advancement;
- checkpoint append timing;
- expected data size discovered from fixtures/authorized snapshots.

No production implementation in BP-004.

---

## 18. Implementation Shape

Prefer a small module under the existing workflow persistence area, for example:

```text
ai/workflows/persistence/migration/
  contracts.ts
  inventory.ts
  tenantMapping.ts
  transform.ts
  fingerprint.ts
  readiness.ts
  index.ts
  __tests__/
```

Names may follow repository conventions.

Do not make migration code part of normal workflow-runtime imports.

Production `bootstrap.ts` must not import it.

Boundary tests should assert that production bootstrap cannot reach BP-004 migration/preflight modules.

---

## 19. Required Tests

At minimum:

### Inventory
1. parses all three workflow key families;
2. ignores unrelated KV rows;
3. object and JSON-string values both work;
4. malformed JSON is reported, not skipped;
5. key/payload tenant mismatch is blocked;
6. key/payload identity mismatch is blocked;
7. wrong schema marker is blocked.

### Tenant mapping
8. canonical UUID + existing organization = resolved;
9. UUID missing from catalog = blocked;
10. exact slug match = candidate only;
11. explicit mapping to active UUID = resolved;
12. explicit mapping to missing UUID = blocked;
13. explicit mapping to inactive/deleted target = blocked;
14. many-source→one-target collision = blocked;
15. `marq-cortex` is never automatically mapped to `marq`.

### Checkpoint transformation
16. UUID/no-remap preserves all checkpoint digests;
17. remap changes checkpoint digest deterministically;
18. transformed version 2 points at transformed version 1;
19. full transformed chain verifies;
20. run checkpointDigest becomes transformed tip;
21. source chain remains unchanged;
22. corrupt source chain emits no transformed chain.

### Semantic parity
23. only permitted tenant/digest fields change on remap;
24. run business/runtime state remains identical;
25. checkpoint outputs and outputsDigest remain identical;
26. approval decision state/version/evidence remains identical.

### Local SQL dry run
27. transformed runs insert first;
28. checkpoints then satisfy tenant-safe FKs;
29. approvals then satisfy tenant-safe FKs;
30. source and target logical counts match;
31. SQL reads match transformed records;
32. rollback leaves source KV fixture untouched.

### Readiness
33. any corrupt row => NO-GO;
34. any unresolved tenant => NO-GO;
35. any invalid chain => NO-GO;
36. any pointer mismatch => NO-GO;
37. every valid resolved fixture => GO FOR LATER BACKFILL, not "cut over now";
38. active runs are reported explicitly.

### Safety
39. production bootstrap has no migration/preflight import;
40. preflight DB command rejects non-local database URLs;
41. no hosted connection helper is introduced;
42. no write/delete method exists for source KV inventory input.

---

## 20. Required Commands

Add:

```text
npm run verify:bp004
npm run test:database:workflow-cutover-readiness
```

The live local command must exit non-zero when local PostgreSQL is unavailable.

Also run:

```text
npm run verify:bp003
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

---

## 21. Acceptance Gate

BP-004 is complete only when:

- current organization-resolution paths are explicitly classified;
- default `marq-cortex` remains a named risk, not an inferred mapping;
- a source workflow KV inventory contract exists;
- explicit tenant mapping is required for noncanonical tenants;
- checkpoint digest dependence on organization ID is handled correctly;
- transformation re-chains checkpoints deterministically when tenant ID changes;
- transformed run checkpoint pointer matches the transformed chain tip;
- semantic fingerprints prove no unintended domain mutation;
- local dry-run backfill to BP-003 SQL succeeds for valid fixtures;
- invalid/corrupt/unmapped fixtures fail closed with structured reasons;
- source KV fixture remains unchanged;
- production bootstrap remains KV-only;
- no hosted DB was accessed;
- no production/staging backfill occurred;
- no shadow/dual write exists;
- no cutover exists;
- no agent persistence work started;
- the final report identifies the safest next workflow-migration packet shape.

---

## 22. Required Final Report

Claude must return:

```text
A. Organization-resolution audit
B. Source KV inventory model
C. Tenant mapping rules
D. Checkpoint digest / re-chain analysis
E. Transformation algorithm
F. Semantic fingerprint contract
G. Local dry-run backfill results
H. GO / NO-GO rules proven
I. Active-run safety findings
J. Files changed
K. Tests + exact results
L. Local PostgreSQL results
M. Production bootstrap status — MUST STILL BE KV
N. Hosted DB access — MUST BE NONE
O. Hosted migration/backfill — MUST BE NONE
P. Shadow/dual write — MUST NOT EXIST
Q. Agent persistence — MUST NOT BE STARTED
R. Recommended next packet shape and why
S. Commit SHA(s)
T. A2 remains IN PROGRESS
```

Then STOP.

---

## 23. Cleanup Rule

After independent review and acceptance:

- record BP-004 readiness findings in the active progress/reconciliation map;
- delete this temporary packet;
- do not retain generated fixture manifests unless they are generic non-customer test fixtures;
- create the next bounded workflow migration packet only after the review establishes whether it should be shadow/backfill, freeze/backfill, drain/backfill, or another mechanism;
- do not claim workflow SQL cutover complete until production authority actually moves under a separately reviewed packet;
- do not claim A2 complete until the required workflow and agent runtime authority migrations are both safely finished.

**The safe outcome of BP-004 is knowledge and proof, not movement of production authority.**
