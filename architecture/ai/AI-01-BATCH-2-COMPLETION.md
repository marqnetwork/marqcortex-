# AI-01 Batch 2 — AI Administration & Operations

**Status:** Remediated after independent review — ready for re-review
**Remediation:** see `AI-01-BATCH-2-REMEDIATION.md` for what changed and why
**Branch:** `claude/ai-admin-operations-batch-2-6zw88i`
**Date:** 2026-08-03
**Builds on:** AI-01 Batch 1 (`architecture/ai/AI-01-BATCH-1-COMPLETION.md`)

---

## 1. Executive summary

Batch 1 delivered one governed AI execution path. Batch 2 delivers the layer
that lets a human operate it: enable and disable AI, steer providers and models,
manage money, watch usage and cost, read the audit trail, and stop everything
in an incident — all without touching code, and all recorded.

The whole batch rests on one architectural decision, and everything else follows
from it:

> The environment configuration states what the deployment **permits**.
> The operational settings overlay states what is currently **in effect**.
> The control plane reads the live value at the point of use.

That is why there is no second execution path and no duplicated governance. The
administration layer does not enforce budgets, decide provider eligibility or
deny requests — `policy/budget.ts`, `policy/spendLedger.ts`,
`providers/selector.ts` and `policy/policyEngine.ts` still do, unchanged. What
changed is that four of them now read a value an authorised administrator can
move, through a getter, on the very next request.

Two invariants make that safe, and neither is optional:

- **The overlay may narrow, never widen.** `AI_ALLOW_REAL_REQUESTS=false` cannot
  be overturned from a console. The effective value is the AND of the
  deployment's permission and the administrator's choice. An administrator can
  always turn real requests *off* — that is the kill switch, and it must work
  instantly — and can only turn them *on* inside an envelope the deployment
  already granted.
- **Every mutation is authorised, reasoned and recorded.** One door
  (`mutate`) enforces capability, then reason, then the change, then
  persistence, then the audit record. Rejections are recorded too, which are the
  records a security review actually wants.

**Scale:** 9 new server modules (2,857 lines), 4 new frontend/test files
(3,197 lines), 15 Batch 1 files modified surgically. 87 new tests, 465 AI tests
passing, 0 failures. Build passes. The AI boundary is strict-clean under
`deno check`.

---

## 2. Components added

### Server — control plane extension

| Component | File | Purpose |
|-----------|------|---------|
| `aiOperationalSettings` | `ai/runtime/operationalSettings.ts` | The live, versioned administrative overlay. Normalisation, bounds and the one-way rule live here alone. |

### Server — administration (`ai/admin/`)

| Component | File | Purpose |
|-----------|------|---------|
| `aiAdminRbac` | `admin/rbac.ts` | Server-side role resolution and capability grants. |
| `aiAdminSettingsStore` | `admin/settingsStore.ts` | Durable storage port plus a total parser for stored settings. |
| `aiAdministration` | `admin/administration.ts` | The service: authorization, settings, providers, budget, usage, diagnostics, audit. |
| `aiAdminAudit` | `admin/adminAudit.ts` | Append-only administrative change trail. |
| `aiUsageAnalytics` | `admin/usage.ts` | Pure projection of control plane metrics into an operations report. |
| `aiAdminHttpAdapter` | `admin/httpAdapter.ts` | Framework-agnostic mapping. Authorises first, dispatches second. |

### Server — adapters and routes

| Component | File | Purpose |
|-----------|------|---------|
| KV admin stores | `ai/adapters/kvAdminStores.ts` | Durable settings and administrative trail. |
| `aiAdminRoutes` | `aiAdminRoutes.ts` | The Hono binding — 13 endpoints, each contributing only an operation name. |

### Frontend

| Component | File | Purpose |
|-----------|------|---------|
| `aiAdminService` | `src/app/services/aiAdminService.ts` | Typed client. No demo fallback, deliberately. |
| `AIAdministrationConsole` | `src/app/components/AIAdministrationConsole.tsx` | Seven-tab operator console, mounted as the AI Administration settings tab. |

---

## 3. Components modified

Every change to Batch 1 was surgical and additive. No Batch 1 behaviour was
removed, weakened, or made optional.

| File | Change | Why |
|------|--------|-----|
| `controlPlane.ts` | Creates the settings overlay; wires live getters into the selector, spend guard, pipeline config, budget policy and policy engine; adds `settings`, `applySettings`, `budgetState`, `budgetPolicy`. | The single place the overlay meets the plane. Values are read through getters at the point of use, never copied at assembly — a snapshot would make an emergency stop wait for an isolate recycle. |
| `policy/policyEngine.ts` | New first rule `platform.ai_enabled`, fed by an injected live state accessor. Rule names moved from positional to named. | The kill switch enforces where every other denial does, so it produces an audit record, a metric and an event like any other. Named rules because the ordered list lands on the audit record and an index shift would relabel every past denial. |
| `policy/spendLedger.ts` | New `raiseCap` operation; `SpendResetEvent.kind` discriminates `reset` from `cap_raise`. | "We authorised more money" and "we wiped the record of what was spent" are different decisions. Batch 1 had only the second, so an operator who wanted the first had to destroy the evidence to get it. |
| `policy/spendGuard.ts` | Reads `realRequestsEnabled` and `enforce` through `options` per call instead of destructuring once. | A destructured value would make the kill switch wait for an isolate recycle. |
| `policy/budget.ts` | Alert threshold computed per call rather than cached at construction. | Same reason — the threshold is now administrable. |
| `providers/registry.ts` | `ModelPolicy` port (allow list + pinned model); `lastFailureAt` / `lastRecoveryAt`; certification restored on re-enable; `models()`; allow-list validation. | Model selection narrowing without a second copy of the setting. Certification restore closes a real defect: disabling a certified provider during an incident and re-enabling it would previously demote it to `unverified` and leave it refused by `requireCertifiedProviders` — the recovery action left the platform worse than the outage. |
| `observability/health.ts` | Adds `configurationVersion`, `aiEnabled`, `emergencyStopEngaged`; reports `unhealthy` when AI is administratively stopped. | The endpoint answers "can this platform serve AI requests right now". During a deliberate stop the answer is no, and reporting healthy would make it useless during the incident it exists for. |
| `contracts/errors.ts` | New `AI_DISABLED` code (503, retryable, never failoverable). | A console that cannot tell "this capability is off" from "an administrator stopped all AI" will tell a user to try a different feature during an incident. |
| `contracts/provider.ts` | `lastFailureAt`, `lastRecoveryAt` on `AIProviderHealth`. | Provider management requires both, and "never failed" is a different statement from "not recovered". |
| `contracts/ids.ts` | New `adm` id kind. | A record's id tells a reviewer which trail it came from. |
| `bootstrap.ts` | Assembles the administration service from the same authenticator; hydrates stored settings. | One credential path. Two would be two things to get wrong, on the surface that governs the platform. |
| `index.ts`, `index.tsx` | Public exports; admin route registration guarded on the service existing. | An administration surface that fails open is worse than one that is missing. |
| `__tests__/harness.ts` | `buildTestAdministration`, the six-token role matrix, `adminAuthenticator`. | RBAC tests resolve through the real `resolveAdminActor` against the real subject shape. A hand-built actor would prove the capability table works and nothing about whether a real user could reach it. |

---

## 4. Architecture decisions

### 4.1 A live overlay, not a config reload

`AIControlPlaneConfig` remains a pure function of the environment. The overlay
sits beside it and consumers read through getters (`get preference()`,
`get realRequestsEnabled()`), so the selector, spend guard and pipeline never
learn that an administration layer exists. Two Batch 1 modules had to change
from destructuring to per-call reads; both are documented in place.

### 4.2 The one-way rule

`effectiveRealRequestsEnabled(settings, environmentPermits)` is the AND of both.
This is the security property that keeps a console toggle from overturning a
deployment decision. The administrator's stated position is stored honestly —
so a later "why isn't this on?" has an answer — while the effective answer stays
no.

### 4.3 Capabilities derived from fields, not endpoints

`capabilitiesForPatch` computes the required grants from which field groups a
patch touches. One endpoint that can change anything is one endpoint whose
least-privileged caller can change everything. An empty patch still demands a
grant, so a caller with no write capability cannot bump the configuration
version with nothing in it.

### 4.4 Only the platform operator writes, and that is the feature

Every switch on this surface is platform-wide: the kill switch, the provider
order, the model pin, the retry curve. There is no "our team's provider
preference". A role that could only be exercised by affecting people outside its
scope is not a safe role, so writes stop at Super Admin and the other tiers
get what they actually need — a truthful, live view of what AI is doing and what
it costs. An organization *owner* resolves to Organization Admin, never to the
platform operator: conflating them would hand a tenant the ability to clear
MARQ's own spend ceiling.

### 4.5 Reset and increase are different operations

`reset` clears settled spend and every open hold (Batch 1 behaviour, unchanged,
super-admin only). `raiseCap` moves the ceiling and preserves both settled spend
and every in-flight reservation. A request that was running when the ceiling
moved can still settle its own hold — a reset would have discarded it.

### 4.6 Reservation TTL floored against the *maximum* deadline

The workflow deadline is now administrable, so the ledger's hold TTL is floored
at twice the largest deadline an administrator may set rather than twice the one
in force at assembly. Deriving it from the current value would let a deadline
raised after a hold was taken outlive the hold protecting it — and reclaiming
headroom from a request that is still running is the one failure that ledger
must never have.

### 4.7 Persist before apply

`commit` reads the authoritative durable record, applies the change on top of
it, narrows the result to the deployment envelope, writes it under
compare-and-swap, and **only then** adopts it locally and projects it onto the
registry. If storage fails or the write loses a race, nothing is adopted and the
plane keeps serving under the settings it already had.

> **Correction.** As originally shipped this section described an ordering the
> code did not implement: `plane.settings.replace()` ran *before* the durable
> write and was not rolled back when that write failed, so a change the operator
> had been told had failed was live until the isolate recycled — including, in
> the worst direction, a released kill switch. An independent review
> demonstrated it. The ordering above is the remediated behaviour, pinned by
> `administrationDurability.test.ts`.

### 4.8 No demo mode on the console

Every other service in this repository falls back to seed data when the backend
is off. That is right for a sales demo of a dashboard and wrong for a control
panel: an operator who "engages the kill switch" against fabricated state and
sees success has been told a dangerous lie.

---

## 5. Security improvements

| Improvement | Detail |
|-------------|--------|
| Server-side RBAC with no client input | Roles resolve from Supabase `user_metadata` and organization membership rows — both writable only through the service-role admin API. `resolveAdminRole`'s entire input is the authenticated subject. |
| No default administrative role | A subject with no qualifying role resolves to `undefined`, not to a fallback. A missing row cannot grant access. |
| Authorization before dispatch, structurally | `executeAdminHttpRequest` resolves the actor and *then* switches on the operation. There is no handler reachable without a resolved administrative actor. The test suite asserts this by looping over the operation table, so a new operation without an authorization path fails the build. |
| Operation names cannot come from a body | The route table binds them. A caller cannot ask for `budget.reset` at the `usage` endpoint. |
| Refused access is a recorded security event | `authorize` writes an `ai.admin.access.denied` record — the one place the trail records an actor it could not resolve. |
| Tenant-scoped audit reads | Organization and Team Admins see only their own organizations' execution records; only the platform operator sees all. The same boundary the execution path enforces, applied to reading. |
| Undeclared fields cannot reach settings | The HTTP adapter reads exactly the fields it declares. Asserted directly: a body carrying `capMicroUsd`, `emergencyStop`, `configurationVersion` and `providers` changes none of them. |
| No diagnostics in responses | Server-side detail stays on the log line and the trail. Asserted. |
| Caller-safe kill-switch message | An ordinary user gets "AI is currently paused by an administrator"; the operator's incident note stays in diagnostics. Asserted. |
| Append-only trail, structurally | The store interface has `append`, `recent`, `size` — no update, no delete. No implementation can offer one. Asserted on the source tree. |
| Certification restore | Closes the re-enable defect described in §3. |

---

## 6. Tests added

**87 new tests. 465 AI tests pass, 0 fail.**

`ai/__tests__/administration.test.ts` (67 tests, 11 suites)

| Group | Covers |
|-------|--------|
| Role resolution | Three roles resolved from real subjects · non-administrator refused · unauthenticated refused · client-supplied role never trusted · organization owner ≠ platform operator · Team Admin reads succeed and every write refused · Organization Admin refused the lifetime reset · capability derived from field not endpoint · role capability sets are nested |
| Audit reason | Missing, empty, whitespace, single-character and non-string reasons all refused with nothing applied · reason recorded on both the change and the settings record · over-long reason bounded |
| Runtime settings | Baseline equals the environment · version increments per change · retry change live on the next request · out-of-range values clamped · undeclared fields dropped · **cannot widen the deployment's real-request permission** · can withdraw one it granted |
| Configuration persistence | Every change persisted · stored settings restored into a fresh plane including the registry projection · version not inflated by hydration · unreadable storage degrades to baseline loudly · failed write reported and recorded rather than silently lost · stored record from an older revision normalised field by field · unusable value treated as nothing stored |
| Kill switch | Every AI request stopped · previous posture restored on release · master switch stops AI too · stopped platform reports `unhealthy` · who/when/why recorded · configuration version on the health snapshot |
| Provider management | Status, certification, circuit and models reported · last failure and last recovery surfaced · disable moves traffic to the backup · certification restored on re-enable · unregistered provider refused · default provider steers traffic · preference reorder · model allow list narrows selection · allow list matching nothing is ignored and reported · pinned model never overrides a capability requirement |
| Budget administration | Current, remaining, lifetime and reserved reported · reservation recovery state · authorised reset clears spend but keeps history · **cap increase preserves settled spend** · increase refuses to lower · absurd cap clamped · Batch 1 hard cap still enforcing · daily allowance applies to the next authorization · change recorded with before/after |
| Usage analytics | Requests, tokens, rates, retries, per-feature and per-provider · retries derived as attempts beyond the first · failure rate and error breakdown · estimated vs actual cost separated · zero rates rather than NaN when idle |
| Diagnostics | Versions, environment posture, circuits, rate limits, prompt fingerprints · refused to a non-administrator |
| Audit visibility | Platform operator sees every organization · others scoped to their own · refused access recorded · authorization failure on a mutation recorded with an empty `before` · administrators see their own changes · **no edit or delete exists on the surface** · page size bounded |
| Overview | Landing view in one authorised call · Team Admin told exactly what they may do |

`ai/__tests__/adminHttp.test.ts` (15 tests, 3 suites)

- Every declared operation refuses an unauthenticated caller (loop over the table)
- Every declared operation refuses an authenticated non-administrator
- Every mutation refuses a Team Admin; every read serves one
- Every mutation demands a reason
- Undeclared body fields dropped · capability derived from the patch · `null` clears a pinned id
- Kill switch through the boundary stops AI and records transport facts
- No diagnostics in responses · unknown operation is a 404 · bounded audit page

`ai/__tests__/spend.test.ts` (+5 tests) — ledger `raiseCap`: refuses without
actor or reason · raises while preserving settled spend · leaves open
reservations settle-able · refuses to lower · survives a restart.

`tests/system/ai_boundary.test.ts` (+5 tests) — structural: the admin tree never
imports or invokes a provider adapter · never re-implements a Batch 1 guarantee
· exposes no audit mutation · routes carry no role comparison of their own.

---

## 7. Runtime validation

Behaviour verified end to end against a real control plane, not mocked:

| Behaviour | Evidence |
|-----------|----------|
| Emergency stop halts AI | `plane.execute` returns `AI_DISABLED` (503) after the switch; succeeds before and after release |
| Release restores prior posture | A `failoverEnabled: false` set before the stop survives it |
| Provider disable reroutes traffic | `result.execution.providerId` moves from `primary` to `backup` |
| Default provider steers traffic | Same assertion via `defaultProviderId` |
| Model allow list narrows selection | `result.execution.modelId` equals the single allowed model |
| Retry policy applies live | Diagnostics report the new curve without a restart |
| Daily budget applies live | `plane.budgetPolicy()` and `plane.budgetState()` reflect the change |
| Settings survive a restart | A second plane over the same store hydrates the engaged stop and the disabled provider, including the registry projection |
| Last failure / recovery observable | A `fail_once` scenario produces both stamps on the provider view |
| Health reflects the administrative posture | `status: 'unhealthy'`, `aiEnabled: false`, `emergencyStopEngaged: true`, issue text naming the switch |

---

## 8. Documentation updated

| Document | Change |
|----------|--------|
| `architecture/ai/AI-01-BATCH-2-COMPLETION.md` | This report |
| `ARCHITECT.md` | New §12.2 (administration model, one-way rule, role table, endpoint/capability table); Batch 2 entry point; administration canonical path; test count |
| `MARQ_CORTEX_ROADMAP.md` | Batch 2 marked complete, Batch 3 (Orchestration & Agents) queued; AI Operational Authority recorded |
| `architecture/system_map.json` | `ai_control_plane.administration` block (roles, capabilities, settings authority, persistence, 13 routes); policy sequence updated; node and route counts |
| `src/system/manifest.ts` | 10 new nodes (MQC-SVC-047 → 055, MQC-COMP-090); cross-references updated; 198 → 208 |
| `.env.example` | Batch 2 section explaining why there are no new variables and how the one-way rule works |
| `tests/system/manifest.test.ts`, `system_map_authority.test.ts` | Certified counts 198 → 208, SVC 46 → 55 |

---

## 9. Validation results

### New failures: none

| Check | Result |
|-------|--------|
| `npm run test:ai` | **465 pass, 0 fail** (378 inherited + 87 new) |
| `npm run test:features` | **386 pass, 0 fail** |
| `npm run test:system` | **80 pass, 0 fail** (75 inherited + 5 new) |
| `npm run scan:boundaries` | **17 pass, 0 fail** |
| `npm run build` | **Pass** — built in 10.3s |
| `typecheck:api` (AI boundary) | **Clean** — `deno check` strict, 0 errors across the whole AI tree including `ai/admin/` |

### Inherited failures: unchanged

| Check | Baseline (main) | With Batch 2 | New |
|-------|-----------------|--------------|-----|
| `typecheck:web` | 34 errors | 34 errors | **0** |
| `typecheck:tests` | 6 errors | 6 errors | **0** |

Both measured by stashing this branch's changes and re-running. The two
`SettingsPage.tsx` errors shifted line numbers (71/118 → 78/125) because the AI
tab was added above them; they are the same pre-existing `companyName` type
mismatches.

### Environmental blockers

| Check | Status |
|-------|--------|
| `typecheck:api` (`server` boundary) | **BLOCKED** — `jsr.io` returns 403 through this environment's egress policy, so `deno check` could not download `@supabase/supabase-js`'s manifest and never reached the source. Not a type error, and identical on the clean baseline. The `ai` boundary — which contains every line of Batch 2 server code — resolves without JSR and is clean. Re-run where `jsr.io` is reachable to complete it. |
| Deno toolchain | Not present at session start; installed via `npm i -g deno` (2.9.4). |

---

## 10. Remaining recommendations

Ordered by the risk each one carries. None blocks review.

1. **Per-organization AI settings.** Today the overlay is platform-wide, which
   is why Team Admin is read-only. A per-organization layer beneath it —
   feature enablement and daily ceilings scoped to one tenant — would let a Team
   Admin change something safely. Non-trivial: it needs an inheritance rule and
   a resolution order the audit trail can explain.

2. **Atomic settings compare-and-swap.** Two administrators writing through
   different isolates within the same second can have the second write win with
   the first's version number consumed. The trail records both, so nothing is
   lost, but a `configurationVersion` precondition on the store would make it
   impossible rather than merely visible. Same underlying gap as the documented
   cross-isolate spend reservation limitation from Batch 1.

3. **Metrics are process-lifetime.** `UsageReport.window` says so honestly, but
   an operator asking "what did we spend last Tuesday" cannot answer it from the
   console. The durable audit records carry per-request cost — a windowed
   aggregation over them is the natural next step.

4. **Admin trail durable reads.** The KV admin audit store is write-through, so
   the console reads the in-memory ring buffer. Changes older than the buffer
   are durable but not queryable from the console. A prefix-scan read path over
   `ai:admin:audit:{date}:` would close it.

5. **Console prompts use `window.prompt`.** Functional and honest, but a modal
   with a typed confirmation for the destructive actions (kill switch, spend
   reset) would suit the blast radius better.

6. **Notifications on administrative change.** The trail is complete and nobody
   is told. An email or Slack notification on kill-switch engagement and spend
   reset would close the loop; the event bus is already there to hang it on.

7. **Retire the `server` boundary's JSR dependency or vendor its types**, so the
   full API typecheck can run in restricted-egress environments.

---

## 11. Compliance with the engineering rules

| Rule | How it holds |
|------|--------------|
| Do not bypass the AI Control Plane | The admin tree imports no provider adapter and calls no `invoke`. Asserted structurally in `ai_boundary.test.ts`. |
| Do not duplicate governance | The kill switch enforces inside the existing policy engine as a new first rule, producing the same audit record, metric and event as any other denial. |
| Do not duplicate budget logic | `raiseCap` was added *to* the Batch 1 ledger, which remains the only thing that may change the ceiling. The admin layer supplies the actor and reason the ledger already demanded. Asserted: no `createSpendLedger` in the admin tree. |
| Reuse Batch 1 infrastructure | Same authenticator, same audit patterns, same error taxonomy, same clock/id/logger injection, same KV port shape, same test harness. |
| Do not introduce technical debt | No `TODO`, `FIXME`, `as any` or type suppression anywhere in the AI tree — enforced by the existing hygiene tests, which now scan the admin tree too. |
| Do not weaken security | §5. The one substantive posture change is the one-way rule, which only tightens. |
| Provider-neutral | The admin layer names no vendor. Providers are configured by id through the registry; models by id through the descriptor the adapter declares. The only vendor strings anywhere remain inside `ai/providers/`. |
