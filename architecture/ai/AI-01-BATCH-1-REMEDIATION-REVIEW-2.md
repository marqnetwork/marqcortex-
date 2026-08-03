# AI-01 Batch 1 Remediation Review

**Second independent enterprise review — verification of prior BLOCKER and HIGH findings**

| | |
|---|---|
| Subject | AI-01 — Secure Foundation, Batch 1 Remediation |
| Branch reviewed | `claude/marq-cortex-ai01-batch1-remediation-v305cj` @ `cb6f72d4` |
| Base implementation | `999619db` |
| Merge base | `origin/main` @ `1ece066e` |
| Review date | 2026-08-03 |
| Authority | Source code and executed checks. The remediation report was read for its claims and independently verified, never accepted. |

> **Branch note.** The designated branch `claude/ai-01-batch-1-remediation-r0q532` contains zero commits beyond `origin/main`. The remediation work actually lives on `claude/marq-cortex-ai01-batch1-remediation-v305cj` (5 commits, 112 files, +18,286/−3,580). That branch is what was reviewed. No pull request exists for it, so no prior review record was recoverable from GitHub; the finding IDs below are taken from the remediation record's own enumeration (B1–B8, H1–H12) because it is the only surviving list, but every verdict was re-derived from source.

---

## 1. Executive Summary

The remediation is substantially real. This is not a documentation exercise — the legacy handlers are physically deleted, the authorization gate is wired into live routes, the kill switch is enforced at a structural boundary rather than by convention, and the claims are pinned by 817 passing tests plus a 16-scenario runtime harness that asserts behaviour (zero provider calls on auth failure) rather than absence of exceptions.

**19 of the 20 prior findings are RESOLVED. One — B5, the spend ceiling — is PARTIALLY RESOLVED**, and the gap is a defect the remediation introduced while fixing it.

The reserve-then-settle ledger persists reservations durably but tracks open reservation IDs in isolate memory. An isolate recycled between `reserve()` and `settle()` leaks the reservation permanently: the durable record keeps the held amount, nothing ever releases it, and — critically — the documented recovery path, `reset()`, does not clear `reservedMicroUsd`. I reproduced this: **19 interrupted heavy-feature requests exhaust the $9 platform ceiling with $0 actually spent, and an authorised reset does not recover it.** The failure direction is safe (it refuses to spend rather than overspending), but the outcome is a platform-wide AI outage recoverable only by direct key-value surgery.

The remediation report discloses a *different* concurrency limitation (cross-isolate overshoot, §4.2) and is candid about five others. This one is not disclosed, and the spend test suite's restart test covers only settled spend — the coverage gap sits exactly where the defect is.

Everything else I probed held up, including the things most likely to be overstated: no hidden provider bypass, no gateway flag, credentials confined to two adapter files, and the boundary scan that pins it is non-vacuous.

**Decision: REQUIRES FIXES.** One well-scoped defect in a former-BLOCKER area. The remaining work is small.

---

## 2. BLOCKER Findings

| ID | Finding | Verdict | Evidence |
|---|---|---|---|
| **B1** | Anonymous AI execution | **RESOLVED** | No feature declares `anonymous`. Independent grep of all 6 descriptors: `analysis`/`narrative` = `['team_user','service']`, `blockAssist`/`copilotPlan`/`chat`/`sectionCopilot` = `['team_user']`. `guard.ts:122-125` derives `allowAnonymous` from the descriptor and throws `AUTH_REQUIRED` at step 4 — before prompt render, provider selection or any spend. Runtime scenario 2: `status=401 code=AUTH_REQUIRED providerCalls=0`. |
| **B2** | Team privilege escalation | **RESOLVED** | `teamAuthorization.ts` is new and, more importantly, *wired*: `index.tsx:2775, 2842, 2896` gate invite/patch/delete. Caller role is server-resolved by `resolveTeamRole()` (`index.tsx:288-298`) from `user_metadata`, writable only via service-role admin API — not from the body. Strict rank comparison (`roleRank(requested) >= roleRank(caller)` rejects), self-role-change blocked, target-outranks-caller blocked from both ends. `normalizeTeamRole` defaults to `viewer`; the prior code defaulted missing roles to `admin`. Pinned by 178 lines of new tests. |
| **B3** | Multiple AI execution paths | **RESOLVED** | All 6 legacy handlers (`blockAiAssist`, `copilotPatch`, `cortexAnalysis`, `cortexChat`, `cortexNarrative`, `proposalSectionCopilot`) and the entire `intelligence/` gateway are deleted from the tree. My own grep — not their test — confirms vendor hosts and `*_API_KEY` reads appear **only** in `ai/providers/openaiProvider.ts` and `anthropicProvider.ts`. No bypass flag exists. `tests/system/ai_boundary.test.ts` pins this structurally and is **non-vacuous**: it asserts >20 server files and >30 AI files before scanning. |
| **B4** | Pipeline / capability enforcement | **RESOLVED** | `executionPipeline.ts:309` asserts model capabilities immediately before the network call rather than trusting selection. Spend reservation is a distinct stage in `orchestrator.ts:232`, before `pipeline.run()`. |
| **B5** | Platform spend ceiling | **PARTIALLY RESOLVED** | **Resolved:** durable reserve-then-settle ledger; per-scope async mutex; `reset()` refuses unattributed clearing; failed billable attempts charged; kill switch enforced *structurally* at `selector.ts:89-91`, so a billable provider cannot be selected at all when `AI_ALLOW_REAL_REQUESTS=false` — not merely skipped for reservation. **Not resolved:** orphaned reservations permanently exhaust the ceiling and survive `reset()`. See §3.1 below — reproduced, undisclosed, and untested. |
| **B6** | PII reaching providers | **RESOLVED** | `applyInputGuard` runs at pipeline stage 2, before `adapter.invoke` (`executionPipeline.ts:253` vs `:338`). Audit stores SHA-256 digests only; `audit.ts:10-15` states prompt text and output are deliberately not stored, and the source-hygiene scan asserts no `messages`/`completion` reaches a log sink. Runtime scenario 5 confirms the email is a placeholder by the time the adapter sees it. |
| **B7** | API boundary not type-checked | **RESOLVED** | Verified with a real toolchain (Deno 2.9.4, which I installed). `deno check` over the **AI boundary: 68 files, exit 0, clean.** The two-boundary script correctly distinguishes a blocked registry from a type error — see §5. |
| **B8** | Unsafe error serialization | **RESOLVED** | `AIError.toResponseBody()` (`errors.ts:229-252`) constructs the body field-by-field and structurally cannot include `diagnostics`. `toAIError()` puts an unknown throwable's message into `diagnostics` only, with a fixed caller-safe `'AI request failed.'` — so a provider SDK that embeds a payload in its error text cannot leak it. |

---

## 3. HIGH Findings

| ID | Finding | Verdict | Evidence |
|---|---|---|---|
| **H1** | Default-organization fallback collapsed tenancy | **RESOLVED** | `allowDefaultOrganization` defaults **false** (`config.ts:228`); `tenancy.ts:107-113` throws `ORGANIZATION_REQUIRED` when no verified membership exists. When opted in, the organization carries `membershipVerified: false` into the audit record. A hint the subject does not hold is a hard `ORGANIZATION_NOT_RESOLVED`, never a silent downgrade. |
| **H2** | Fact lock incomplete | **RESOLVED** | All three cases present in `factLock.ts:87-98`, including the previously-missing third: a locked field with no authority behind it is **removed** and reported. Dotted paths supported; `writePath` materialises a parent only when the authority has a value. `deepEqual` is structural, replacing a `JSON.stringify` comparison that produced false "restored" entries on key reordering. Runtime scenario 12 confirms authority wins over caller echo. |
| **H3** | Provider failover | **RESOLVED** | `selector.select()` returns an ordered candidate list; the pipeline walks it. Every attempt — success or failure — is reported through `onAttempt` and costed. Runtime scenario 9: served by backup after 2 primary attempts. |
| **H4** | Circuit breaker not a real state machine | **RESOLVED** | Only `PROVIDER_FAULTS` (`executionPipeline.ts:75-81, 490`) trip it; governance and auth failures explicitly do not, so a prompt problem cannot take a healthy provider offline. Runtime scenario 10 exercises the full cycle: `open → afterCooldown half_open → afterTwoProbes closed`, with backup absorbing 3 requests while open. |
| **H5** | Health endpoint dishonest | **RESOLVED** | `health.ts:87-89`: only non-production providers eligible ⇒ **`degraded`**, never `healthy`. Kill switch and certification appear as named eligibility reasons via `selector.explain()`. Health touches no ledger. Runtime scenario 15 confirms mock-only reports degraded. |
| **H6** | Correlation IDs lost on failure | **RESOLVED** | `AIError.withTrace()` stamps ids on the way out (`orchestrator.ts:440`); the HTTP adapter mints one for pre-guard failures rather than returning an empty string. Inbound `x-correlation-id`/`x-request-id` are bounded by `SAFE_TRACE_ID` at the edge, so a header cannot be reflected into a body or log as an injection vector. Runtime scenario 14 confirms the id returns on both success and failure. |
| **H7** | Audit understated failures | **RESOLVED** | Attempts are collected as they occur, not read off an outcome that a failed request never produces (`orchestrator.ts:198, 369-381`) — so a request that burned two paid attempts and errored records both and their cost. Attributable guard rejections are audited via `withSecurityContext` → `synthesizeContext`, with `organizationId` falling back to `'unresolved'` rather than to a real tenant. Runtime scenario 13 confirms 2 records, digests only. |
| **H8** | Input validation and injection | **RESOLVED (as scoped)** | Per-feature byte ceilings enforced against both `content-length` and true UTF-8 length; roles validated; unknown keys dropped. Injection neutralisation is pattern-based and the system message is exempt (platform-authored, hash-verified). The heuristic limitation is correctly and prominently disclosed — no immunity is claimed. |
| **H9** | Rate limits ignored request cost | **RESOLVED** | `guard.ts:182` reads `rateLimitCost`; `HEAVY_LIMITS.rateLimitCost = 4`. Organization window is consumed before actor window, so a tenant at its ceiling does not burn an individual's allowance to discover it. Recorded last among stateful checks, so failed validation does not consume quota. |
| **H10** | Provider retry policy | **RESOLVED** | `retry.delayFor()` honours provider `Retry-After` over local backoff, clamped to `maxDelayMs`. A whole-workflow deadline bounds total time across all providers. `UNCERTAIN_OUTCOME_CODES` (`executionPipeline.ts:115, 525`) prevents re-sending to the same billable provider after a timeout — the model may have generated and billed a completion that never arrived. |
| **H11** | Unbounded telemetry | **RESOLVED** | Metrics and audit buffers are bounded by configuration (`metricsBufferSize`, `audit.bufferSize`), both clamped. Consistent with the report's claim that it did not reproduce against the base commit. |
| **H12** | Output validation | **RESOLVED** | Output guard runs **inside** the attempt loop, making a malformed completion retryable rather than terminal; required-field assertion; feature-owned parsing; fact lock applied after parse. Runtime scenario 11: malformed output ⇒ `502 INVALID_MODEL_OUTPUT`. |

### 3.1 New HIGH — orphaned spend reservations wedge the platform ceiling

**Introduced by remediation commit `224dded9` (the B5 fix). Not present in the base implementation. Not disclosed. Not covered by tests.**

`spendLedger.ts:214` holds open reservation IDs in an in-memory `Map`. `reserve()` writes the held amount to the **durable** store but records the ID **in memory**. `settle()` and `release()` both no-op when the ID is absent (`:256-259`, `:280`).

An isolate recycled between reserve and settle therefore leaves `reservedMicroUsd` held in durable storage with nothing able to release it. There is no expiry, no TTL, and no reaper — I grepped for all three. Because `committedMicroUsd = spent + reserved` is what `reserve()` compares against the cap, leaked holds permanently shrink headroom.

`reset()` compounds it. At `:315-322` it clears `spentMicroUsd` and `attemptCount` but spreads `reservedMicroUsd` through unchanged — so the one documented recovery mechanism cannot recover from this state.

Reproduced against the real module, sizing the estimate from the actual descriptors and price tables (heavy feature: 256 KB ÷ 4 tokens × 3,000 µUSD/1k + 2,500 × 15,000 µUSD/1k, × 2 attempts = **$0.468** per reservation):

```
cap                 = 9000000 ($9)
per-request reserve = 468216 ($0.468)

request 19: DENIED (insufficient_headroom) after 19 orphaned reservations

--- ledger state after orphaned reservations ---
spentMicroUsd    = 0          (nothing was ever actually spent)
reservedMicroUsd = 8896104
remaining        = 103896

--- after an authorised reset() ---
spentMicroUsd    = 0
reservedMicroUsd = 8896104    <-- survives the reset
reserve after reset granted = false
```

**Impact.** 19 interrupted heavy requests — deploys, crashes, isolate recycling mid-request — produce a platform-wide `BUDGET_EXCEEDED` on every AI request with zero dollars spent, unrecoverable through the documented path. Supabase edge isolates are recycled routinely, and `bootstrap.ts:10-13` acknowledges this directly.

**Direction of failure is safe** — it refuses to spend rather than overspending — which is why this is HIGH and not a BLOCKER. But it converts a spend control into an availability failure with a broken recovery path.

**Minimal fix.** Either (a) persist reservations with an issued-at timestamp and reclaim any older than the workflow deadline on the next `reserve()`, or (b) at minimum, clear `reservedMicroUsd` in `reset()` so the documented recovery works. (a) is correct; (b) alone is a viable stopgap. Add a test that reserves on one ledger instance and reads from a second — the existing restart test at `spend.test.ts:125` covers only settled spend.

---

## 4. Remaining MEDIUM Findings

These are accurately disclosed in the remediation report's §4 and I confirmed each is real and correctly characterised. None is a certification blocker; all should be tracked.

| # | Finding | Status |
|---|---|---|
| M1 | **Tenant isolation is enforced at the AI boundary only.** AI execution, audit, budget and rate-limit keys are organization-scoped and a cross-tenant hint is refused and audited. Legacy KV business data is *not* organization-keyed. | Correctly disclosed; re-keying is a storage migration outside Batch 1. Do not describe as complete tenant isolation. |
| M2 | **Spend ceiling is exact per process, approximate across isolates.** No compare-and-swap in the KV backend; two isolates can reserve against the same read. | Correctly disclosed. Bounded by (isolates × one estimate). Note this is the *opposite* direction to §3.1. |
| M3 | **Copilot target filtering trusts caller-declared block state.** `FORBIDDEN_BLOCK_TYPES` is server-authoritative; `is_locked` and `has_pending` arrive in the request body (`copilotPlan.ts:58-59, 98`). | Confirmed real. Mitigated by the plan being advisory and applying it a separate human step. |
| M4 | **Prompt-injection defence is heuristic.** Pattern matching cannot catch every injection. | Correctly disclosed. Real defence is structural: deterministic engines own every number, fact lock restores authoritative fields. |
| M5 | **Rate limiting is per-isolate.** Windows live in isolate memory; a recycled isolate starts fresh. | Correctly disclosed. A distributed limiter is the right fix and is out of Batch 1 scope. |

---

## 5. Runtime Validation

All checks executed against `cb6f72d4`, with `origin/main` @ `1ece066e` as the baseline for classifying failures.

| Check | Result | Classification |
|---|---|---|
| `typecheck:web` | 38 errors | **Inherited — byte-identical to `main`.** Zero new. |
| `typecheck:tests` | 8 errors | **Inherited, and 4 fewer than `main`'s 12.** The remediation *fixed* 4 (deleted `intelligence/providers/mockProvider.ts` import, 3 in `proposalSectionCopilot.ts`). The surviving `manifest.test.ts` error is the same error at a shifted line (203 → 291). **Zero new.** |
| `typecheck:api` — `[ai]` boundary | **68 files, exit 0, CLEAN** | Verified under real Deno 2.9.4 strict. |
| `typecheck:api` — `[server]` boundary | **BLOCKED** | **Environmental.** Proxy returns `403 Forbidden` for `https://jsr.io/@supabase/supabase-js/meta.json`, reached via the pre-existing `repositories/tenancyRepository.ts` — not AI-01 code. The script correctly reports this as an egress restriction, not a type error. |
| `build` | **PASS** (`✓ built in 12.05s`) | Chunk-size warnings only, pre-existing. |
| `test:intelligence` (→ `test:ai`) | **356 / 356 pass** | New AI suite. |
| `test:features` | **386 / 386 pass** | `main` baseline: 368. +18, no regressions. |
| `test:system` | **75 / 75 pass** | `main` baseline: 56. +19, no regressions. |
| `scan:boundaries` | **12 / 12 pass** | Single-execution-path source scan. |
| `ai-runtime-verify.ts` | **16 / 16 scenarios pass** | Mock mode; final scenario asserts the MARQ ledger was untouched. |

**Total: 817 tests, 0 failures, 0 new type errors, 4 inherited type errors fixed.**

### Classification summary

- **New failures: none.**
- **Inherited failures:** 38 `typecheck:web` + 8 `typecheck:tests` errors, all pre-existing on `main` and outside AI-01 scope.
- **Environmental limitations:**
  1. No Deno toolchain preinstalled — I installed 2.9.4 to complete the AI boundary check rather than reporting it unverifiable.
  2. `jsr.io` blocked by the agent proxy (403), so the `[server]` type boundary could not be completed anywhere.
  3. No Supabase instance or live credentials — HTTP routes, Supabase auth and the KV-backed durable stores were exercised through their injected ports and unit tests, never end-to-end.
  4. `test:smoke` (Playwright) not run; it requires a running application, not a code check.

> **Script note.** `test:intelligence` was redefined to alias `test:ai`. On `main` it ran the now-deleted `intelligence/*.test.ts` (8 tests). The redefinition is legitimate — the module it targeted no longer exists — but anyone comparing raw counts across branches should know the script changed meaning.

---

## 6. Architecture Assessment

The single-execution-path claim holds under adversarial checking, which is the claim most worth attacking.

- **One path, no flag.** `config.ts:9-11` states there are deliberately no per-feature gateway switches, and the boundary scan enforces the absence of five named bypass patterns. Rollback is by revert, documented as such in `system_map.json`.
- **Ports and adapters are honest.** Everything under `ai/` is pure and injectable; Supabase and Deno appear only in `bootstrap.ts` and the adapters. This is what allows 356 tests to run the plane end-to-end under a plain Node runner.
- **Fail-closed defaults are consistent.** `denyAllAuthenticator` when no `getUser` is injected; `allowDefaultOrganization: false`; `allowRealRequests: false`; `normalizeTeamRole → viewer`; spend store fails closed on a corrupt read. The audit store deliberately fails *open* — losing a record must not fail a customer request — and the report states both policies and why they are opposite. That is the right call, correctly reasoned.
- **Registration is data, not branching.** Features, prompts and providers are declarative; adding a capability is a definition, not a new branch in the execution path. `validateDescriptor` rejects unsafe descriptors at bootstrap rather than at 3am.
- **Deep-import discipline is enforced,** not merely intended: server code reaching past `ai/index.ts` into `pipeline/`, `providers/`, `policy/`, `security/` or `governance/` fails the boundary scan.

One observation, not a defect: `assertCapabilities` (`executionPipeline.ts:309`) throws out of the whole candidate loop rather than skipping to the next provider. Since the selector already filtered on exactly those properties, this fires only if selector and pipeline disagree — a bug, and failing loudly is defensible. Worth a comment noting the deliberate choice.

---

## 7. Security Assessment

| Control | Verdict | Note |
|---|---|---|
| Authentication | **Sound** | Guard step 4; fails closed with no authenticator; bearer parsing strict; a verification exception rejects rather than admits. |
| Authorization | **Sound** | Capability-based, roles server-resolved from `user_metadata`; team admin routes gated with strict rank comparison in both directions. |
| Tenant isolation | **Sound at the AI boundary** | Hints honoured only against verified membership; `tenantScopedKey` uses an allow-list on key segments. **Legacy KV data is not tenant-partitioned** (M1) — correctly disclosed. |
| Single AI execution path | **Sound** | Verified by independent grep and a non-vacuous structural scan. |
| AI Guard | **Sound** | Eight ordered stages, cheapest and most absolute first. |
| Budget enforcement | **Sound (daily)** / **Defective (lifetime)** | Daily rolling budget is correct. Lifetime ceiling carries §3.1. |
| Prompt registry & governance | **Sound** | Versioned, hashed, owned; every version stays resolvable for replay; prompt hash recorded in every result and audit record. |
| Fact Lock | **Sound** | Three-way reconciliation; unconditional; every touch reported. |
| Provider abstraction | **Sound** | Business logic names capabilities, never vendors or models. |
| Provider failover | **Sound** | Ordered candidates; every attempt costed. |
| Circuit breaker | **Sound** | Real state machine; only provider faults trip it. |
| Retry policy | **Sound** | `Retry-After` honoured; workflow deadline; no re-send after an uncertain timeout. |
| Health endpoint | **Sound** | Mock-only is `degraded`, never `healthy`; unauthenticated by design and carries no tenant data. |
| Durable audit | **Sound** | Digests only; fails open by explicit, reasoned policy. |
| Correlation IDs | **Sound** | Survive the failure path; inbound headers sanitised at the edge. |
| PII redaction | **Sound** | Runs before adapter invocation; credentials matched first so later patterns cannot mangle a secret into a still-recognisable form. |
| Prompt injection protection | **Partial by design** | Heuristic; structural defence is the real control. Correctly disclosed. |
| Output validation | **Sound** | Inside the attempt loop; required fields; fact lock after parse. |
| Rate limiting | **Sound per isolate** | Cost-weighted. Not distributed (M5) — correctly disclosed. |
| Safe error handling | **Sound** | `diagnostics` structurally cannot reach a response body. |

**No security regressions found.** The remediation closes two real vulnerabilities — unauthenticated AI endpoints spending platform budget, and team privilege escalation via a body-supplied `teamRole` — and introduces none. §3.1 is an availability defect, not a security one; it fails toward refusing to spend.

---

## 8. Technical Debt

| # | Item | Severity | Location |
|---|---|---|---|
| D1 | Spend reservation index is in-memory while the ledger is durable; no expiry or reaper; `reset()` cannot clear held reservations. | **High** | `ai/policy/spendLedger.ts:214, 315-322` |
| D2 | Test coverage gap: the "survives a restart" test covers settled spend only, never an in-flight reservation — the exact case that fails. | **High** | `ai/__tests__/spend.test.ts:125` |
| D3 | Stale header comment states a failed membership lookup "falls back to the configured default." The code fails **closed** (`allowDefaultOrganization` defaults false). Behaviour is safer than documented, but a misleading fail-open comment in the auth adapter invites a future maintainer to "restore" the wrong thing. | Low | `ai/adapters/supabaseAuthenticator.ts:14-17` |
| D4 | Two references to `supabase/functions/server/proposalSectionCopilot.ts`, deleted in this branch (now `ai/features/sectionCopilot.ts`). | Low | `src/app/core/proposalCopilotEngine.ts:40`, `src/system/manifest.ts:1883` |
| D5 | Frontend fact-lock logic in `proposalCopilotEngine.ts` intentionally duplicates the server policy as defence-in-depth. Legitimate, but two copies drift; the server copy has now moved once already. | Low | `src/app/core/proposalCopilotEngine.ts` |
| D6 | 38 inherited `typecheck:web` errors and 8 inherited `typecheck:tests` errors remain on `main`. Out of AI-01 scope; noted so the gate is not misread as clean. | Inherited | repo-wide |

**No dead code, no duplicate execution logic, and no hidden provider bypasses were found.** The `intelligence/` reference in `system_map.json:109` is a deliberate `replaces` record of the removed component, not drift.

---

## 9. Final Decision

# REQUIRES FIXES

**AI-01 Batch 1 is NOT yet ready for certification and merge.**

Nineteen of twenty prior findings are genuinely resolved, verified against source rather than against the remediation report, and pinned by 817 passing tests with zero new type errors and zero regressions. The engineering quality is high and the disclosure of limitations is unusually honest — the report volunteers five real constraints rather than claiming completeness.

Certification is withheld for a single defect: **B5 is only partially resolved.** Orphaned spend reservations permanently exhaust the MARQ platform ceiling, and the documented recovery path cannot clear them. It was introduced by the remediation, is not disclosed, and is not covered by the test that appears to cover it.

### Required before certification

1. **Fix D1.** Persist reservations with an issued-at timestamp and reclaim any older than the workflow deadline on the next `reserve()`. At minimum, clear `reservedMicroUsd` in `reset()` so the documented recovery works.
2. **Fix D2.** Add a test that reserves against one ledger instance and reads the ledger from a second instance over the same store, asserting that an abandoned reservation does not permanently consume headroom.
3. **Update the remediation record** so B5 and §4.2 describe both concurrency directions — overshoot across isolates *and* leaked holds across restarts.

### Recommended, non-blocking

4. Correct the stale fail-open comment in `supabaseAuthenticator.ts` (D3).
5. Repoint the two references to the deleted `proposalSectionCopilot.ts` (D4).

Once items 1–3 land with tests green, this branch should be re-verified on the spend boundary alone and is then, on the evidence gathered here, fit for certification and merge. Items 4–5 need not gate it.

### Explicitly not required

Do not treat M1–M5 as merge blockers. They are correctly scoped out of Batch 1 and correctly disclosed. In particular, the platform must continue **not** to describe its current state as complete tenant isolation until legacy KV data is organization-keyed.
