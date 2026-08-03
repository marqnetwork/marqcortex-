# AI-01 Batch 1 — Remediation Record

Base implementation: `999619db`
Remediation branch: `claude/marq-cortex-ai01-batch1-remediation-v305cj`

This document records what the remediation changed, what it verified as already
correct, and — importantly — what it did **not** close. It is written to be read
alongside `AI-01-BATCH-1-COMPLETION.md`, which describes the original delivery.

---

## 1. What the governed path looks like now

Every AI capability executes through `controlPlane.execute()`. There is one path
and no flag that bypasses it.

```
HTTP route (aiRoutes.ts)
  → httpAdapter            transport mapping, trace-id sanitisation
    → orchestrator
      → AI Guard           contract version → feature → payload size →
                           authentication → organization → actor →
                           body validation → cost-weighted rate limit
      → Policy Engine      feature enabled → actor type → channel → capability
      → Spend Guard        MARQ lifetime ceiling: estimate + RESERVE
      → Pipeline           prompt render → input guard (redact, de-inject) →
                           provider select → capability assert → invoke
                           (timeout, retry, Retry-After, circuit, failover,
                           workflow deadline) → output guard → parse → fact lock
      → Accounting         settle reservation; charge daily budget
      → Observability      audit record, metrics, structured log, events
```

The stage that did not exist before is **Spend Guard**, and its position is the
point: the reservation is taken before the pipeline can reach a provider, so a
request projected to cross the ceiling is refused with no vendor call made.

---

## 2. The two spending instruments, and why there are two

They are frequently conflated. They are not the same thing.

| | `policy/budget.ts` | `policy/spendLedger.ts` |
|---|---|---|
| Scope | per organization, per actor | the whole platform |
| Window | rolling daily | **lifetime** |
| Resets | on a timer, by design | **never** on a timer |
| Question | "has this tenant used its allowance today?" | "is MARQ still permitted to spend money at all?" |
| Method | check-then-charge | **reserve-then-settle** |
| Storage | in-memory | durable port (`adapters/kvSpendStore.ts`) |

The lifetime ceiling defaults to **$9** (`AI_MAX_SPEND_USD`). Clearing it
requires an authorising actor and a written reason; the ledger refuses an
unattributed reset, and every reset is retained on the record. An authorised
reset clears **both** settled spend and every outstanding hold — a reset that
left holds behind would not actually restore AI.

### 2.1 Reservation lifecycle, and why holds are durable

A first pass at this ledger persisted the reserved *total* but tracked which
request owned each hold in a module-level `Map`. That is one restart away from a
permanent outage: an isolate recycled between reserve and settle loses the map,
the persisted hold has no owner, nothing can settle or release it, and the
headroom is gone for good. Enough interrupted requests and the platform refuses
every AI call **having spent nothing at all**.

Ownership is therefore durable. `reservedMicroUsd` is a cached sum;
`openReservations` — id, amount, owner feature, `createdAt`, `expiresAt` — is the
authority, and it is written to the same row as the balance.

| Event | Behaviour |
|---|---|
| Reserve | Appends a hold with an expiry. Idempotent per reservation id — a retried reserve returns the existing hold rather than taking a second. |
| Settle / release | Matches the durable hold by id, from any isolate. The id lands in a bounded recently-closed ring, so a repeat is a no-op rather than a double charge. |
| Restart mid-flight | The hold is still there. A new isolate lists it, rehydrates a handle from the stored metadata (`reservationFrom`), and settles it normally. |
| Expiry | Once `expiresAt` is in the past, the next touch of the scope reclaims the hold and returns its headroom. Never before that instant. |
| Late settlement | Settling a hold that was already reclaimed still **charges** the measured cost. The vendor call really happened; under-counting real spend is the one error the ceiling cannot survive. |
| Legacy row | A record with a reserved total and no hold metadata is time-boxed from the moment it is first observed, then reclaimed. That is the upgrade path for orphans written by the earlier schema. |

The TTL (`AI_SPEND_RESERVATION_TTL_MS`, default 15 minutes) is floored in code at
**twice the workflow deadline**, because a hold that expired while its request
was still running would let the same money be reserved twice.

Reclaiming an expired hold is **not** a budget reset. It returns headroom that no
live request owns; it never reduces `spentMicroUsd`, and no timer anywhere in the
module clears settled spend.

### Failure policy, stated explicitly

- **Audit writes fail OPEN.** Losing an audit record must not fail a customer's
  AI request. Failures are reported through `onError` and the in-memory buffer
  still holds the record.
- **Spend writes fail CLOSED.** An unreadable ledger is not a zero balance. A
  corrupt or unreachable spend record throws, and the request is refused. A
  ledger that failed open would grant unlimited budget at exactly the moment the
  platform lost the ability to observe itself.

These are opposite policies on purpose.

---

## 3. Findings closed, with the mechanism

| Finding | Mechanism |
|---|---|
| B1 anonymous execution | No feature declares `anonymous`; guard rejects pre-prompt. Pinned by tests asserting **zero provider calls**. |
| B2 authorization | `teamAuthorization.ts` (admin gate, role table, strict rank comparison) + roles/memberships wired into the plane's authenticator. |
| B3 single path | Legacy handlers absent; `tests/system/ai_boundary.test.ts` scans the source tree for vendor hosts, credentials, bypass flags and deep imports. |
| B4 pipeline | Reservation stage added; capability asserted before the network call. |
| B5 spend | Durable reserve-then-settle lifetime ledger; failed billable attempts charged; **reservation ownership is durable, expired holds are reclaimed, and an authorised reset clears spent and reserved** (see §2.1 and §4.2). |
| B6 PII | Redaction verified to run before adapter invocation; audit stores digests only. |
| B7 typecheck | `deno.json` + two-boundary `typecheck-deno.mjs`. AI boundary clean, 68 files. |
| B8 safe errors | `diagnostics` never serialised; verified by test against vendor-host and key substrings. |
| H1 tenancy | Default-org fallback is opt-in and marks `membershipVerified: false` into the audit record. |
| H2 fact lock | Three-way reconciliation (restore / restore-on-omission / **remove invention**), dotted paths, `locked_facts` as explicit authority, extended to block assist. |
| H3 failover | Ordered candidates; every attempt reported and costed. |
| H4 circuit | Verified real state machine; governance and auth failures do not trip it. |
| H5 health | Kill switch and certification are named eligibility reasons; health probes spend nothing. |
| H6 tracing | Errors carry trace ids out; adapter mints one for pre-guard failures; inbound headers sanitised. |
| H7 audit | Real attempt counts and cost on failure; attributable guard rejections audited. |
| H8 input | Bounded sizes, validated roles, injection neutralisation (heuristic — see limitations). |
| H9 rate limits | Cost-weighted units; heavy features priced at 4×. |
| H10 provider | Retry-After honoured; workflow deadline; no re-send after an uncertain timeout. |
| H11 telemetry | Verified bounded — did not reproduce against `999619db`. |
| H12 output | Feature validators, structured shapes, fact lock after validation. |

---

## 4. Limitations this remediation does NOT close

Stated plainly, because a certification that overstates them is worse than one
that omits them.

### 4.1 Tenant isolation is enforced at the AI boundary only

Every AI request resolves an organization from a verified membership, and a
membership-less caller fails closed. But the **legacy KV data this platform
stores is not organization-keyed**. Re-keying it is a storage migration outside
AI-01 Batch 1.

What is true: AI execution, audit records, budget scopes and rate-limit keys are
organization-scoped, and a cross-tenant hint is refused and audited.

What is **not** true: that all stored business data is tenant-partitioned.

Do not describe the current state as complete tenant isolation.

### 4.2 The spend ceiling is exact within a process, approximate across isolates

Reservations are serialised per scope by an in-process mutex, so concurrency is
exact within one runtime. The key-value backend has no compare-and-swap, so two
isolates can reserve against the same read. The overshoot is bounded by
(concurrent isolates × one request's estimate) — cents, not dollars — and
closing it fully needs an atomic counter in the storage layer.

Two consequences of the recovery design belong here rather than in the claims:

- **Abandoned headroom is unavailable until its TTL passes.** A hold left by a
  recycled isolate is returned on expiry, not immediately — nothing can prove a
  request is dead, and reclaiming early would let the same money be spent twice.
  An operator who does not want to wait has the authorised reset.
- **A settlement that arrives after its hold was reclaimed is charged.** That is
  deliberate (real money left the platform), and it means such spend is recorded
  against the ceiling even though its reservation is gone. Repeat settlements are
  still suppressed, but only within the bounded recently-closed ring.

### 4.3 Copilot target filtering trusts caller-declared block state

`FORBIDDEN_BLOCK_TYPES` is server-side and authoritative. `is_locked` and
`has_pending` arrive in the request body. A caller could understate a block's
lock state and have the copilot plan against it. The plan is advisory and
applying it is a separate human-initiated step, but the filter is not fully
server-authoritative until the AI boundary can read proposal state.

### 4.4 Prompt-injection defence is heuristic

`inputGuard.ts` neutralises known instruction-override patterns. Pattern
matching does not and cannot detect every injection. The platform's real defence
is structural: deterministic engines own every number, and the fact lock
restores authoritative fields regardless of what the model returns. Do not claim
injection immunity.

### 4.5 Rate limiting is per-isolate

Windows are cost-weighted and organization/actor/feature aware, but held in
isolate memory. A recycled isolate starts with a fresh window. The durable
backstop is the spend ledger, which does survive recycling. A distributed
limiter is the correct fix and is not in Batch 1.

---

## 5. Reproducing the checks

```bash
npm ci
npm run typecheck:api:ai      # AI boundary under Deno strict — must be clean
npm run typecheck:web
npm run typecheck:tests
npm run build
npm run test:intelligence     # the AI suite
npm run test:features
npm run test:system
npm run scan:boundaries       # single-execution-path source scan
node --experimental-strip-types scripts/ai-runtime-verify.ts
```

`typecheck:api` needs a Deno toolchain (`npm i -g deno` is sufficient) and
network access to `jsr.io` and `registry.npmjs.org`. The script distinguishes an
unreachable registry from a type error, because reporting the two identically is
how a blocked runner gets recorded as "the code does not compile".

`ai-runtime-verify.ts` runs entirely in mock mode with
`AI_ALLOW_REAL_REQUESTS=false`; its final scenario asserts that the MARQ ledger
was not touched.
