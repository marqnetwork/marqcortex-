# MARQ CORTEX — AI-01 BATCH 4D CUSTOMER BYOK
## FINAL INDEPENDENT CERTIFICATION

**Verdict: `REMEDIATION_REQUIRED`**

| | |
|---|---|
| Tested commit SHA | `0fe170dfac18ca0f0b82e252f56792b9469765ef` |
| Branch | `claude/customer-byok-audit-knnx78` |
| Baseline compared against | `origin/main` @ `1cc015062d4fc4173dc36ca30ee0ca44e75f3ee4` |
| Working tree at test time | clean (`git status --porcelain` empty) |
| Real provider calls made | **zero** — `AI_ALLOW_REAL_REQUESTS` unset, no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` present |
| PostgreSQL used | real cluster, PostgreSQL 16.13 |
| Certification date | 2026-09-02 |

Blockers outstanding: **1**. Highs outstanding: **1**. `CERTIFIED_FOR_MERGE` is therefore forbidden.

---

## 1. COMMIT / DIFF INTEGRITY

| Check | Result | Evidence |
|---|---|---|
| HEAD is `0fe170d` | **PASS** | `git rev-parse HEAD` → `0fe170dfac18ca0f0b82e252f56792b9469765ef` |
| Working tree clean | **PASS** | `git status --porcelain` empty before and after all runs |
| Remediation bounded to Batch 4D | **PASS** | 14 files; 11 production/wiring files all under `supabase/functions/server/ai/`, 2 new test files, `package.json` script wiring only |
| Migration `20260901120000_ai_customer_byok.sql` unchanged | **PASS** | blob `b20172bdd268430d3ce0899dfdfc49f450b86e9d` identical at `79fa1ad`, `d3f4d27`, `0fe170d`; `git diff origin/main 0fe170d -- supabase/migrations/` empty |
| No unrelated production behaviour changed | **PASS** | every new parameter is optional and defaults to the Batch 4C behaviour (`funding?`, `rateLimit?`, `SpendGuard.reserve(…, funding?)`); with no store injected the whole path is byte-for-byte pre-4D |

### 1a. GOVERNANCE FINDING — the baseline stated in the brief is not the baseline on disk

The brief describes `main` as "production-certified Batch 4C". It is not. `origin/main` is
`1cc0150 Merge Batch 4D — Customer BYOK (certified at d3f4d27)`, which already contains:

* `79fa1ad feat(ai): a customer's own key is theirs…` — the Batch 4D feature
* `d3f4d27 fix(ai): a policy already read is a policy that must be honoured` — the split-catch fix

and **does not** contain `0fe170d`, the B-1/B-2 remediation. **The two certified BLOCKERs are live on
`main` today.** On `main`, `orchestrator.ts` still reserves `SPEND_SCOPE.platform` unconditionally and
`resolver.ts` still derives the fallback policy per provider. This is reported as `INFO-1` below.

---

## 2. RE-CERTIFICATION OF B-1 — FUNDING CONTAINMENT

### Production path traced (not the tests)

```
aiRoutes → controlPlane.execute
  → guard.admit            security/guard.ts → security/tenancy.ts resolveOrganization
                           (server-derived; a hint the subject does not hold is a hard refusal)
  → orchestrator.ts:266    executionFunding = funding.resolve(context.organization)      ← PRE-READ
  → orchestrator.ts:281    spend.reserve(descriptor, requestId, {mode, organizationId})  ← SCOPE
  → orchestrator.ts:295    pipeline.run(…, createExecutionFundingLatch(executionFunding))← LATCH
  → executionPipeline.ts:328  candidate loop (circuit → capability → attempt loop)
  → executionPipeline.ts:369  adapter.invoke({… tenant:{organizationId, membershipVerified, funding}})
  → openaiProvider.ts:155 / anthropicProvider.ts:185  credentials.resolve(providerId, tenant)
  → resolver.ts:538        tenant branch (verified membership only)
  → resolver.ts:396        latch tightens on an observed `tenant_only` configuration
  → resolver.ts:405        effective policy = STRICTER of latch and this row
  → resolver.ts:567        execution-level refusal when the tenant branch cannot run
```

Single funnel confirmed by grep: `pipeline.run` has exactly one call site, `spend.reserve` exactly one,
`adapter.invoke` exactly one, and `credentials.resolve` only the two adapters. Agent and workflow
execution reach providers through `controlPlaneBridge.ts:72 → plane.execute`, i.e. the same orchestrator,
so they inherit the latch.

`ExecutionFundingLatch` (`executionFunding.ts:120-133`) exposes only `observeTenantOnly()`. There is no
operation that returns `mode` to `platform_allowed`, and one latch object is shared by every attempt.
**The latch itself cannot widen.**

### Multi-provider results (candidate suite + independent re-derivation)

| Case | Required outcome | Result |
|---|---|---|
| A — `tenant_only` OpenAI + decryption-failed BYOK + MARQ Anthropic | MARQ never executes | **PASS** |
| B — `tenant_only` OpenAI + provider auth failure + MARQ Anthropic | MARQ never executes | **PASS** |
| C — `tenant_only` + first provider unavailable + MARQ Anthropic | MARQ never executes | **PASS** |
| D — `tenant_only` org A + valid BYOK of org B | org B credential never executes | **PASS** (AAD binds `organizationId`; row equality asserted at `resolver.ts:374` before any decrypt) |
| E — `tenant_only` + own credential on the fallback provider | may execute, must stay `customer_byok` | **PASS** — resolved category `customer_byok`, same `organizationId`. Current policy permits tenant-owned cross-provider failover; that is the correct reading, since `tenant_only` constrains *whose chequebook*, not *which vendor* |
| F — `platform_allowed` request | MARQ failover still works | **PASS** — `platform_managed` resolved on the fallback provider |
| G — latch cannot widen during retry / provider failover / model failover / storage error / partial resolver failure | must hold | **PASS for the latch itself**; **FAIL for the execution as a whole** — see BLOCKER-1 |

**Verdict on B-1: NOT CLOSED.** The latch is sound; the *execution* is not, because the latch is only
one of two mechanisms and the other one fails open.

---

## 3. FAILURE-OF-POLICY-READ ATTACK — **BLOCKER**

The remediation documents its residual as "this read fails **AND** the first provider's own read fails
**AND** a later provider then resolves a platform credential" (`executionFunding.ts:161-171`).
**That characterisation is too narrow.** The true residual is:

> the pre-read fails **AND** the first provider the pipeline actually reaches does not carry a
> `tenant_only` row.

"Does not carry a `tenant_only` row" includes the ordinary case of **no row at all**, which is exactly
the state the certified B-1 defect described. Only one read has to fail, not two.

### Constructed exploit path

1. ACME declares `tenant_only` on OpenAI and stores their key. They have no Anthropic configuration —
   the normal state, and the state the original B-1 finding described.
2. `listOrganizationConfigurations(acme)` fails once (statement timeout, pool exhaustion, PostgREST 500,
   schema-cache reload). `executionFunding.ts:197-203` catches it and returns `PLATFORM_FUNDING`.
3. `orchestrator.ts:281` reserves against `SPEND_SCOPE.platform` — **B-2 recurs.**
4. The pipeline reaches Anthropic first. This needs no exotic condition: `executionPipeline.ts:329`
   skips a provider whose circuit is open *without calling the adapter at all*, so an OpenAI outage —
   precisely when failover matters — means OpenAI's tenant read never happens and the latch never
   tightens. Provider priority, a capability filter, or MARQ decertifying OpenAI do the same.
5. `resolver.ts:337` finds no Anthropic organization row (a successful read returning `undefined`, not
   an error), `credentialFallback` is `undefined`, `effectiveFallback` at `resolver.ts:405-406` is
   `undefined` because the latch mode is `platform_allowed`, `decideTenantCredential` returns
   `platform`, and `resolveTenant` returns `undefined`.
6. `resolver.ts:567` does not fire (mode is `platform_allowed`). Execution falls through to
   `resolver.ts:600` (MARQ platform managed) and then `resolver.ts:663` (MARQ deployment environment).
7. **MARQ's Anthropic credential executes ACME's traffic, charged to MARQ's ledger, while ACME's console
   reports `customer_byok` from an OpenAI row that still says `active`.** The certified defect, verbatim.

### Empirical proof

Independent probes written outside the repository tree (`/…/scratchpad/cert/residual.test.ts`), driving
the real resolver, real cipher, real store semantics and the real
`createExecutionFundingResolver`/`Latch`:

```
R-1  pre-read fails, ONLY that read     → [{"provider":"anthropic","category":"platform_managed",
                                            "secret":"sk-ant-marq-platform-…"}]
R-1b pre-read + first tenant read fail  → [{"provider":"openai","category":"platform_managed", …}]
R-1c pre-read + all cortex reads fail   → [{"provider":"openai","category":"environment", …}]
R-2  spend scope on the same fault      → spend:marq:platform:lifetime
CONTROL pre-read healthy                → customer_byok, spend:org:acme:lifetime   ✅
```

The brief's instruction is explicit: *"For an unknowable funding policy, prefer containment over
MARQ-funded execution. If such a path exists, classify BLOCKER."* It exists. It is **BLOCKER-1**.

A second consequence, present even when the latch *does* rescue B-1: the spend scope is chosen from the
pre-read value only (`orchestrator.ts:282-284`), never from the latch. So whenever the pre-read fails and
the latch later tightens, containment holds but the customer's own vendor spend is still settled against
MARQ's lifetime ceiling — the exact harm B-2 was raised for.

---

## 4. RE-CERTIFICATION OF B-2 — SPEND ISOLATION

### Trace

`spendScopeFor` (`spendGuard.ts:118-146`) resolves the scope **once**, before the hold. The ledger returns
a `SpendReservation` that **carries its own scope** (`spendLedger.ts:168-176`), and `settle`/`release`
take that reservation rather than a scope (`spendLedger.ts:586`, `spendLedger.ts:628`). **There is no call
shape in which a request settles against a scope it did not reserve against.** Reservation/settlement
divergence is structurally impossible. `isolationKeyFor` is applied to the organization id before it can
become a KV key, and it throws rather than silently degrading to the platform scope.

### Independent results (`/…/scratchpad/cert/spend.test.ts`, 6/6 pass)

| Scenario | Result |
|---|---|
| Successful BYOK — reserve and settle on `spend:org:acme:lifetime`, MARQ untouched during the hold and after | **PASS** |
| Failed BYOK — hold released, MARQ `spent + reserved == 0` | **PASS** |
| Retry / cross-provider failover — scope fixed at reservation | **PASS** (structural) |
| Concurrent org A / org B / platform — 400 / 200 / 400 µUSD, no scope leaked a hold | **PASS** |
| Org A budget exhaustion — blocks neither MARQ nor org B | **PASS** |
| Platform request after org A exhaustion | **PASS** |
| MARQ ceiling exhausted — a tenant-funded execution is still admitted | **PASS** |
| Unsafe organization id (`marq:platform`) cannot address another scope | **PASS** (throws) |

**Required invariant — "org A cannot consume, reserve, exhaust, or block MARQ platform budget when
execution is tenant_only" — HOLDS whenever the funding pre-read succeeds.** It does not hold when the
pre-read fails (BLOCKER-1, step 3).

### HIGH-1 discovered here

`createSpendLedger` applies **one configured `capMicroUsd` to every scope** (`spendLedger.ts:471-480`),
sourced from `AI_MAX_SPEND_USD`, default **$9** (`runtime/config.ts:88-93`). Every production
administrative path is hardcoded to the platform scope:

* `administration.ts:1096` — `reset(SPEND_SCOPE.platform, …)`
* `administration.ts:1135` — `raiseCap(SPEND_SCOPE.platform, …)`
* `spendGuard.ts:239` and `controlPlane.ts:521` — `read(SPEND_SCOPE.platform)`

So an organization scope is **write-only from every operator surface**: nobody can read it, reset it, or
raise it. Declaring `tenant_only` — the very control that buys funding containment — silently imposes an
**unraisable $9 lifetime ceiling on the customer's own vendor spend**, after which every AI request in
that organization fails permanently with `BUDGET_EXCEEDED` ("Your organization's AI spending allowance has
been reached"), with no console to raise it, no visibility for MARQ, and the only remedies being a
platform-wide cap raise or reverting to `platform` policy — which reintroduces the MARQ-funding exposure.
Confirmed empirically: `org cap micro-usd: 9000000`.

---

## 5. TENANT ISOLATION

Organization authority is server-derived throughout. `resolveOrganization` (`security/tenancy.ts:112-177`)
honours a caller hint **only** when the authenticated subject holds that membership, refuses a
multi-membership subject rather than guessing, and marks the `AI_ALLOW_DEFAULT_ORGANIZATION` fallback
`membershipVerified: false`. The HTTP surface reads `providerId` and `credentialId` from the **path only**
and never from the body (`byokHttpAdapter.ts:17-48`); `configurationId` is never caller-supplied at all.

| Forged input | Outcome |
|---|---|
| `organizationId` | `ORGANIZATION_NOT_RESOLVED` — hint not held by the subject |
| `configurationId` | not accepted from any caller; derived from the resolved tenant |
| `credentialId` | looked up **within this organization's own configuration**; another tenant's id is `FEATURE_NOT_FOUND`, indistinguishable from a nonexistent one (`byokAdministration.ts:1056-1070`) |
| `providerId` | `requireCatalogued` refusal |
| `modelId` | narrowed by the registry/selector; administration-governed |

A cannot enumerate, read, activate, rotate, revoke or execute using B. Two independent defences on
execution: the row-equality assertion at `resolver.ts:374` before any decryption, and the AES-256-GCM AAD
which binds `organizationId` (`resolver.ts:440-448`) so a ciphertext copied onto another tenant's row does
not open. Proven against real PostgreSQL by `scripts/ai-customer-byok-scenarios.mjs`.
**PASS.**

---

## 6. SECRET SECURITY

| Surface | Result |
|---|---|
| Database | **PASS** — real-PG assertion `no plaintext column`; ciphertext + AAD only |
| API response | **PASS** — write-only; `aiByokService.ts` response types carry no `secret`/`apiKey`/`value`/`plaintext` |
| Logs | **PASS** — structured-log scan for the fixture secrets returned 0 hits across `verify:4d` and `test:security` output |
| Audit | **PASS** — digests and fingerprints only |
| Errors | **PASS** — `AIError.diagnostics` is excluded from the HTTP body by construction (`contracts/errors.ts:239`); `describeForOperator` output reaches `console.error` only |
| Telemetry | **PASS** — `credentialSource` category recorded beside the key, never its value |
| localStorage / sessionStorage | **PASS** — no storage API touched by the BYOK panel |
| URL / query string / browser history | **PASS** — POST body only; `<input type="password" autoComplete="off">`, state cleared unconditionally in a `finally` |

AES-256-GCM with tenant-bound AAD is intact and unmodified by the remediation. **PASS.**

---

## 7. RBAC

`byokRbac.ts:150-245` grants **only** from `flooredRolesFor(subject, membership)`; `globalRoles` is never
consulted for a grant, so there is no platform capability to strip. A cache-resolved membership is refused
outright, and `membershipVerified: false` is refused outright.

| Requirement | Result |
|---|---|
| Ordinary customer member denied | **PASS** |
| Customer `org_admin` manages only its authorized org | **PASS** |
| MARQ `org_admin` cannot gain customer-secret authority accidentally | **PASS** |
| `platform_admin` / `super_admin` cannot retrieve plaintext | **PASS** — no read-back exists on any surface |
| Platform/customer administration separated | **PASS** — `byokRbac.ts` imports nothing from `admin/rbac.ts`; the customer surface refuses `scope: 'platform'` |

---

## 8. MIGRATION / DATABASE — real PostgreSQL 16.13

`npm run test:database:4d` — **all scenarios passed**, exit 0:

* 4D migration applies over the real tenancy foundation + real 4C migration, as `cortex_migration_owner` (NOSUPERUSER, BYPASSRLS)
* schema: fallback column and constraints, immutability trigger, tenant index, Batch 4C intact, **RLS forced with no policy**, **no plaintext column**
* privileges 4D-P1: matrix unchanged; 4D-P2: anon and authenticated denied read *and* mutate, by attempt as well as by catalogue; 4D-P3/P4/P5: trigger function not browser-executable, no column grant, tenancy guard binds `service_role`
* 4C assertions re-run **against the 4D-applied schema**: 4C-P1…P8 all pass, including activation under a NOSUPERUSER owner
* rollback: 4D removed cleanly, 4C intact, customer rows preserved and inert, comments restored
* clean re-apply after rollback: schema and privileges re-assert
* out-of-order failure case: 4D without 4C beneath it refuses and leaves **no partial state**

`npm run test:database:4c` — all Batch 4C scenarios passed against real PostgreSQL.
`npm run test:database` with `DATABASE_URL` set — 210/210, 0 skipped.

Migration verdict `MIGRATION_REQUIRED` stands. No migration defect discovered. **PASS.**

---

## 9. MEDIUM / LOW DISPOSITION

**M-3 rate limiting — correct.** Keyed by `byok:org:${actor.organization.organizationId}` — the
server-resolved organization, unsteerable by a caller. Its **own** limiter instance
(`bootstrap.ts:489-496`), not the AI Guard's, so credential administration cannot consume an
organization's execution allowance and one organization can never exhaust another's. Mutations only;
reads deliberately unlimited. The three wrappers are `async`, so a refusal is a **rejected promise**, not
a synchronous throw escaping a `.catch()` — the contract the brief asked about. The refusal names no other
tenant and no count; `diagnostics` never reaches a response body. **Cannot cross-limit, cannot leak
identity, cannot throw outside the Promise contract. PASS.**

| Deferred item | Disposition |
|---|---|
| M-1 organization suspension | **Accurately characterised, not promoted.** `membershipDirectory.ts:94-108` enforces membership `status = 'active'` and drops soft-deleted organizations, but does not read the organization's own `status IN ('active','suspended','archived')`. No 4D acceptance or security invariant depends on it |
| M-2 deleted-tenant credential retention | **Accurately characterised, not promoted.** Retention/privacy concern only; a deleted organization can no longer resolve, so no execution can reach the retained rows |
| L-1 multi-membership UI | **Accurately characterised.** `resolveOrganization` refuses rather than guessing — functional, not a security gap |
| L-2 `typecheck:api` environment requirement | **Outdated; superseded by MEDIUM-1.** Deno installs from npm (`npm i -g deno`, deno 2.9.6) and the `ai` boundary type-checks fully offline. Run in that state, the candidate **fails** it. Only the `server` boundary remains blocked here, by a proxy 403 on `jsr.io` — an egress restriction, not a code defect |

---

## 10. REGRESSION

| Suite | Result |
|---|---|
| `verify:4d` | **164 / 164 pass** |
| `verify:4c` | **132 / 132 pass** |
| `test:security` | **548 / 548 pass** |
| `test:ai` | **1855 / 1855 pass** |
| `test:features` | **717 / 717 pass** |
| `test:system` | **170 / 170 pass** |
| `test:database` (with `DATABASE_URL`) | **210 / 210 pass**, 0 skipped |
| `scan:boundaries` | **107 / 107 pass** |
| `test:database:4d` (real PostgreSQL) | **all scenarios passed** |
| `test:database:4c` (real PostgreSQL) | **all scenarios passed** |
| `verify:ai` | **16 / 16 pass** — including `allowRealRequests=false spent=0 reserved=0` |
| `verify:openai` (no live call) | 11 / 12 — the only failure is `LIVE CALL`, reported **BLOCKED**: no credential configured, `--live` not passed, `outboundCalls=0` |
| `verify:anthropic` (no live call) | 12 / 13 — same, `outboundCalls=0` |
| `build` | **PASS** (`vite build`, exit 0) |
| `typecheck:web` | 34 errors — **byte-identical to `origin/main`**; pre-existing debt, untouched by this commit |
| `typecheck:tests` | 29 errors — **identical to `origin/main`** (paths aside); pre-existing debt |
| `typecheck:api:ai` (Deno 2.9.6) | **FAIL on candidate, CLEAN on `origin/main`** → see MEDIUM-1 |
| `typecheck:api` (all boundaries) | **BLOCKED** on the `server` boundary — `jsr.io` returns 403 through this environment's proxy |

**Zero paid provider calls confirmed:** `AI_ALLOW_REAL_REQUESTS` unset for every run; no
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the environment; both live-proof scripts report the live check
`BLOCKED — no credential is configured … No gate was weakened and no placeholder credential was created`;
`verify:ai` reports `spent=0 reserved=0`; every unauthenticated probe reports `outboundCalls=0`.

---

## 11. ACCEPTANCE MATRIX

| Criterion | Verdict |
|---|---|
| Tenant isolation | **PASS** |
| Server-side organization authority | **PASS** |
| Encryption reuse (AES-256-GCM + tenant-bound AAD) | **PASS** |
| Secret non-exposure | **PASS** |
| Customer RBAC | **PASS** |
| Platform / customer separation | **PASS** |
| Rotation | **PASS** |
| Revocation | **PASS** |
| Concurrency | **PASS** |
| Execution funding latch | **PASS** (the latch itself only tightens) |
| Cross-provider containment | **FAIL** — BLOCKER-1 |
| No MARQ fallback under `tenant_only` | **FAIL** — BLOCKER-1 |
| Organization spend isolation | **FAIL** — BLOCKER-1 (step 3); holds whenever the pre-read succeeds |
| Retry / failover spend stability | **PASS** — scope is fixed at reservation and carried by the reservation |
| Audit | **PASS with a gap** — see MEDIUM-2 |
| Rate limiting | **PASS** |
| Database security | **PASS** |
| Migration integrity | **PASS** |
| UI secret handling | **PASS** |
| 4C regression | **PASS** |
| Zero paid provider calls | **PASS** |

---

## 12. FINDINGS

### BLOCKER-1 — a single failed policy read re-opens both certified BLOCKERs

* **File / line:** `supabase/functions/server/ai/providers/credentials/executionFunding.ts:197-203`
  (the `catch` returning `PLATFORM_FUNDING`), with `supabase/functions/server/ai/providers/credentials/resolver.ts:405-406`
  (`effectiveFallback` inherits the *degraded* mode) and `supabase/functions/server/ai/orchestrator.ts:266-284`
  (spend scope taken from the degraded pre-read).
* **Failure / exploit:** ACME declares `tenant_only` on OpenAI and has no Anthropic row.
  `listOrganizationConfigurations(acme)` fails **once** — a statement timeout, pool exhaustion, a PostgREST
  500, a schema-cache reload. The pre-read degrades to `platform_allowed`. The request reserves against
  `spend:marq:platform:lifetime`. The pipeline reaches Anthropic first (an open OpenAI circuit skips the
  adapter entirely at `executionPipeline.ts:329`, so OpenAI's tenant read never runs and the latch never
  tightens). Anthropic has no organization row, the absent policy reads as `platform`, and **MARQ's
  Anthropic credential executes ACME's traffic on MARQ's ledger** while ACME's console reports
  `customer_byok`. Reproduced: `R-1` returns `{"provider":"anthropic","category":"platform_managed"}`;
  `R-1c` degrades all the way to MARQ's deployment environment key; `R-2` returns
  `spend:marq:platform:lifetime`.
* **Why the documented residual understates it:** `executionFunding.ts:161-171` claims two reads must
  fail. Only one must. "The first provider's own read fails" is not required — "the first provider reached
  carries no `tenant_only` row" suffices, and having no row for the failover provider is the ordinary case
  and the original defect's own premise.
* **Required remediation:** an unknowable funding policy must not resolve to `platform_allowed`.
  Introduce a third state (e.g. `mode: 'unknown'`) that the credential resolver treats as `tenant_only`
  for any organization-scoped candidate, or fail the request closed for that organization while leaving
  organizations with no BYOK estate unaffected — for instance by making the pre-read's failure retryable
  and, on exhaustion, refusing only tenants for whom a `tenant_only` row could exist. Separately, derive
  the spend scope from the latch at settlement as well as from the pre-read at reservation, so a
  latch-rescued execution is not settled on MARQ's ceiling. **Not fixed here — certification only.**

### HIGH-1 — `tenant_only` imposes an unraisable, invisible $9 lifetime ceiling on the customer's own spend

* **File / line:** `supabase/functions/server/ai/policy/spendLedger.ts:471-480` (one configured cap for
  every scope), with `supabase/functions/server/ai/admin/administration.ts:1096` and `:1135`
  (`reset`/`raiseCap` hardcoded to `SPEND_SCOPE.platform`) and
  `supabase/functions/server/ai/policy/spendGuard.ts:239` / `controlPlane.ts:521` (`status` reads the
  platform scope only).
* **Failure:** a `tenant_only` organization's ledger is created with `capMicroUsd = AI_MAX_SPEND_USD`
  (default $9) and is unreachable from every operator surface. Once that customer has spent $9 **of their
  own vendor money**, every AI request in their organization fails permanently with `BUDGET_EXCEEDED`
  ("Your organization's AI spending allowance has been reached"). MARQ cannot read the ledger, cannot
  reset it, and cannot raise it; the only remedies are a platform-wide cap raise or reverting the customer
  to `platform` policy — which reintroduces the exposure this batch exists to close. Adopting the security
  control therefore guarantees an eventual, permanent, undiagnosable outage for the adopter. Confirmed:
  `org cap micro-usd: 9000000`.
* **Required remediation:** give organization scopes their own ceiling — a per-organization configured cap
  (unbounded or governed separately from `AI_MAX_SPEND_USD`) — and expose read, reset and raise for an
  organization scope through an authorised, audited administrative path. **Not fixed here.**

### MEDIUM-1 — the candidate breaks `typecheck:api:ai`, which the baseline passes

`supabase/functions/server/ai/__tests__/byokSpendIsolation.test.ts:346` —
`assert.ok(error.retryAfterSeconds > 0, …)`; `retryAfterSeconds` is optional, so Deno reports
`TS18048: 'error.retryAfterSeconds' is possibly 'undefined'`. `origin/main` runs the same boundary clean
(exit 0). Test-file only, no production behaviour, but a red repository gate introduced by this commit.

### MEDIUM-2 — the new funding control is not represented in the audit record

`observability/audit.ts:186-242` records `credentialSource` but neither the execution funding mode nor the
ledger scope, and a degraded pre-read is reported only to `console.error`
(`bootstrap.ts:358`). Under BLOCKER-1 the degradation is silent in the audit trail; an auditor can only
infer it by cross-referencing a `platform_managed` source against a `tenant_only` console row.

### MEDIUM-3 — `AI_ALLOW_DEFAULT_ORGANIZATION` bypasses the funding control entirely

`executionFunding.ts:186` returns `PLATFORM_FUNDING` without reading anything when
`membershipVerified` is false, and `resolver.ts:538` skips the whole tenant branch — including the
execution-level refusal at `resolver.ts:567` — for the same reason. A membership-lookup failure degrades a
subject to "no memberships" (`supabaseAuthenticator.ts:43-52`); in a single-tenant console deployment
where `AI_ALLOW_DEFAULT_ORGANIZATION=true` and the default organization **is** the BYOK customer, that
customer's traffic then executes on MARQ's credential and MARQ's ledger. The option defaults to false,
which is what keeps this MEDIUM rather than HIGH.

### LOW-1 — the BYOK read/authorize path is unmetered

`byokService.ts` rate-limits mutations only, by design. `authorize()` performs an authoritative
(uncached) membership resolution on every call, so an authenticated customer administrator can drive
unbounded database load against `/ai/organization/…` reads. Consistent with the documented M-3 decision;
noted as residual abuse surface.

### LOW-2 — L-2's characterisation is stale

Deno is installable without privilege (`npm i -g deno`) and the `ai` boundary type-checks fully offline;
only the `server` boundary needs `jsr.io` egress. The finding should read "one boundary requires registry
egress", not "the check requires an environment we do not have".

### INFO-1 — the uncertified Batch 4D is already merged to `main`

`origin/main` = `1cc0150 Merge Batch 4D — Customer BYOK (certified at d3f4d27)` contains the Batch 4D
feature and the split-catch fix but **not** the B-1/B-2 remediation. Both certified BLOCKERs are live on
`main` in their original form: `orchestrator.ts` on `main` reserves `SPEND_SCOPE.platform`
unconditionally, and the fallback policy is still derived per provider. This should be treated as an
active production exposure independent of this certification's verdict.

### INFO-2 — pre-existing typecheck debt

`typecheck:web` (34 errors) and `typecheck:tests` (29 errors) fail identically on `origin/main` and on the
candidate. Untouched by this commit; recorded so the red gates are not mistaken for a regression.

---

## 13. FINAL VERDICT

# `REMEDIATION_REQUIRED`

One BLOCKER and one HIGH remain outstanding, so `CERTIFIED_FOR_MERGE` is forbidden.

The remediation is the right architecture — funding as a property of the execution, resolved once,
carried as a one-way latch, with the ledger scope chosen from the same single answer — and it closes the
certified defects on the healthy path completely and provably. What it does not do is hold the guarantee
when the one read it depends on fails, and it purchases containment at the cost of a ceiling the customer
cannot see and MARQ cannot raise. Both are fixable inside the existing design; neither requires rework of
the architecture.

* **Tested commit SHA:** `0fe170dfac18ca0f0b82e252f56792b9469765ef`
* **Test results:** 3,943 automated assertions across the ten Node suites, all passing; two real-PostgreSQL
  migration harnesses (4C and 4D) passing in full including rollback and clean re-apply; `build` clean;
  `typecheck:api:ai` **red on the candidate and green on the baseline**; `typecheck:web`/`typecheck:tests`
  red identically on both.
* **Migration result:** `MIGRATION_REQUIRED` stands; migration file unchanged by the remediation and
  verified against real PostgreSQL 16.13 — apply, constraints, tenancy immutability, `credential_fallback`
  constraint, grants, FORCE RLS with no policy, RPC privileges, anon/authenticated denial, rollback, clean
  re-apply, and 4C assertions against the 4D-applied schema.
* **Zero-real-provider-call confirmation:** `AI_ALLOW_REAL_REQUESTS` unset throughout; no provider API key
  present; live checks reported `BLOCKED` with no gate weakened; `spent=0`, `reserved=0`,
  `outboundCalls=0`.
* **Git status:** clean at `0fe170d` before and after every run; no repository file was modified by this
  certification. The independent probes were written outside the repository tree.

*Certification only. Nothing was merged, deployed, or fixed.*
