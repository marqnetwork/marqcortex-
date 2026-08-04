# AI-01 Batch 2 — Remediation

**Branch:** `claude/ai-admin-operations-batch-2-6zw88i`
**Follows:** the independent review that produced `administrationDurability.test.ts`
and `administrationAdversarial.test.ts` (commit `6eedfa57`)

---

## 1. What was actually wrong

Three blocking defects and two high-severity ones, all of which shared a single
cause: **the administration layer was written as if the platform were one
process.** Under that assumption the settings overlay is trivially correct — the
object an administrator writes is the object the execution path reads. Supabase
Edge Functions serve from several warm isolates, each holding its own memoised
plane, and every guarantee that depended on the single-process assumption failed
the moment there was a second isolate.

| Root cause | What it produced |
|---|---|
| Settings hydrated once per isolate, never re-read | The kill switch stopped one isolate. Warm isolates kept calling providers. |
| Durable writes were blind whole-record overwrites | A routine retry tune from a second isolate silently released an engaged kill switch. Two configurations were written under version 2. |
| Version allocated from per-isolate memory | `configurationVersion` did not identify a configuration. |
| Overlay applied to live state before the durable write | A change the operator was told had failed was live until the isolate recycled. |
| Envelope enforced for one setting out of five | Certification enforcement, budget enforcement and both daily ceilings could be loosened from the console. |
| Platform-wide capabilities granted to a tenant role | Any organization admin could halt AI, disable a provider or pin a model for every other tenant. |
| Allow list fell back to the full catalogue | A narrowing an operator applied silently became no narrowing, and the console reported success. |
| `resetSpend` accepted a new cap | One call cleared the spend history and raised the ceiling a thousandfold, audited only as a reset. |

## 2. Design of the fixes

### Cross-isolate propagation

`OperationalSettingsStore` gained a `SettingsSource` port and a `refresh()` that
re-reads the durable record when the cached copy has aged past
`AI_SETTINGS_REFRESH_MS` (**default 0 — re-read every request**). The control
plane awaits it at the top of `execute()`, before the guard, so the first thing
any request establishes is whether an administrator has stopped AI.

Three properties make it safe:

- **Only strictly newer versions are adopted.** Versions are globally unique, so
  a slow read landing after a local write cannot undo it.
- **Concurrent refreshes are coalesced.** A burst on a cold cache issues one read.
- **A failed read keeps the last known configuration.** An isolate that cannot
  reach storage keeps serving what it knows rather than falling open to baseline.

This is *eventual* propagation, bounded by the refresh interval. Cross-process
propagation cannot be synchronous; "by the isolate's next AI request" is the
strongest achievable guarantee, and at the default interval that is immediate.

### Compare-and-swap and versioning

`AdminSettingsStore.save(settings, expectedVersion)` — the precondition is a
required parameter, not an option, because an optional precondition is one a
caller forgets, and the caller that forgets is the one that reverts a kill
switch. A mismatch rejects with a typed `CONFLICT` (409).

`commit()` runs a bounded read-modify-write: read durable → catch this isolate
up → apply the change *as a function* of that base → narrow to the envelope →
save under CAS → adopt. A change is a function rather than a finished record
precisely so it can be re-applied to a newer base, which is what turns two
administrators racing into two changes that both survive. Four attempts, then a
`CONFLICT` the caller can see.

Versions come from `max(durableVersion, localVersion) + 1` under CAS, so only
one writer can ever claim a given number.

A per-isolate mutation chain serialises same-isolate writes. CAS already makes
lost updates impossible; the chain makes write *ordering* deterministic, which
is what stops a slow first write from landing on top of a fast second one.

### Deployment envelope

One module, `runtime/envelope.ts`, applied on all three paths into the overlay —
an administrator's write, a hydrate, and a refresh. Permissions AND with the
deployment; restrictions OR with it; ceilings take the minimum.

Two kinds of bound are now distinct: **absolute bounds** (`SETTINGS_BOUNDS`,
what any value may ever be) and the **deployment envelope** (what this
deployment authorised). A value passes both.

The retry curve is bounded absolutely rather than by the deployment's current
value, deliberately: a longer backoff is not a permission — it cannot reach a
withheld provider or spend unauthorised money — and a request's lifetime is
governed by the workflow deadline, which *is* clamped to the deployment value.
Clamping the curve to the current value would make `AI_RETRY_BASE_DELAY_MS=0`
mean "retries may never be delayed", which no deployment intends permanently.

### RBAC

Every mutation on this surface changes one settings record shared by every
tenant, so every mutation is now the platform operator's. The organization tier
holds the viewer capabilities until there is a genuinely organization-scoped
layer to write to — per-tenant enablement and ceilings, the natural next batch.

The role is kept distinct from `team_admin` rather than collapsed into it: it
still differs in read scope, and the grant table is where a per-tenant write
capability will be added when the surface exists.

## 3. Deliberate deviations from the review's tests

Three assertions in `administrationDurability.test.ts` originally required a
change made on isolate A to be visible on isolate B **synchronously**, with no
intervening await on B. No design can deliver that across processes. They now
assert the achievable and operationally meaningful property — that B has the
change by the time it serves its next request. The assertions themselves
(disabled provider, budget value, configuration version) are unchanged.

## 4. Pre-existing tests updated, and why

| Test | Change |
|---|---|
| `cannot widen the deployment's real-request permission` | Now asserts the stored value is narrowed, not merely overridden on read. Storing an administrator's `true` under a deployment that says no would arm the platform to spend the moment the flag flipped, with nobody re-deciding. |
| `keeps the Batch 1 hard cap enforcing after administrative changes` | Runs with `AI_BUDGET_ENFORCE=false`, so the deployment permits what the administrator then toggles. Its actual point — that the MARQ ceiling's enforcement is *not* administrable — is unchanged. |
| `refuses an organization admin the lifetime spend reset` | Extended: every platform-wide mutation is now refused, and reads are asserted to still work. |
| `shows an administrator their own changes` | The organization admin's record is now a *rejected* mutation, which is exactly the kind of record an administrator should see about themselves. |
| `ignores an allow list that matches nothing` | Renamed and inverted to `rejects an allow list that matches nothing`. |
| `demands only the capability the patch actually implies` | The permitted caller is the platform operator; an organization admin on the same endpoint with the same body is asserted to get 403. |

None of these weakened a guarantee. Each encoded behaviour the remediation
deliberately changed.

## 5. Remaining findings

1. **The KV compare-and-swap is read-then-write, not atomic.** The injected
   key-value port offers a read and a write, not a conditional write. The
   guarantee is "no write proceeds on a version it did not observe", which closes
   the realistic window (administrators seconds apart) and narrows but does not
   eliminate the window of two writes inside one read-modify-write. Closing it
   needs a conditional-write primitive from the storage layer.
2. **Propagation is eventual.** At the default refresh interval a change reaches
   every isolate on its next request. A deployment that raises
   `AI_SETTINGS_REFRESH_MS` is explicitly choosing to let a stopped platform keep
   serving for up to that long.
3. **Every AI request performs one settings read at the default interval.** The
   cost is small next to a provider call, and it is the correct default for a
   control whose purpose is to stop the platform immediately.
4. **Organization Admin currently has no writes.** This is correct but not
   final: the tier needs a per-organization settings layer, which is the natural
   next batch.
5. Unchanged from the original review: admin trail durable reads, process-lifetime
   metrics, and `window.prompt` on the console.
