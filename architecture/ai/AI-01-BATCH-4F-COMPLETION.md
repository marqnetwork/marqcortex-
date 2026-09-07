# AI-01 Batch 4F — Routing, Failover and Economics

**Status:** code complete, verified locally.
**Branch:** `claude/marq-cortex-batch-4f-c1hmm0`
**Baseline:** `b13d3a3` (Batch 4E merged and certified)

---

## 1. What this batch is

Batch 4C left the forward plan in one sentence:

> **Batch 4F — routing, failover, economics.** The credential schema already
> supports many rows per configuration (primary, backup, regional, rotated)
> with one deterministic active credential, so 4F extends the selection
> semantics rather than replacing the schema. `ai/policy/exposure.ts` gives it a
> calculated exposure figure to build on.

That is what was built. No schema changed, no migration was written, and no
credential path was touched. What changed is the SELECTION SEMANTICS: how the
platform orders providers it has already decided it may use, how far one request
may fail over, and what that choice costs.

Three things ship:

| | |
|---|---|
| **Routing** | A deterministic, governed policy that ORDERS eligible candidates — by preference, cost, observed latency or health — and can never admit one. |
| **Failover** | A governed breadth bound on how many providers one request may span, and a per-request BILLABLE ATTEMPT BUDGET that makes the spend reservation true. |
| **Economics** | Projected cost, cheapest paid alternative, routing premium, realized spend and signed variance, reconciled per request and reported to an operator. |

---

## 2. The defect this batch closes

`policy/spendGuard.ts` reserves, for one request:

```
worst-case model across the billable catalogue  x  the feature's maxAttempts
```

`pipeline/executionPipeline.ts` then granted a FRESH allowance of `maxAttempts`
to **every failover candidate**:

```ts
for (const candidate of candidates) {
  for (let attempt = 1; attempt <= descriptor.limits.maxAttempts; attempt += 1) {
```

So a feature with a two-attempt allowance and three eligible paid providers
could make **six billable attempts against a hold that covered two**. The
settlement was honest — every attempt was charged — but the RESERVATION was
not, and a reservation that under-states what a request may spend is how a
ceiling that was proved sufficient stops being sufficient without anybody
deciding it should.

Nobody crossed the ceiling deliberately. The allowance was counted in one unit
(per provider) and reserved in another (per request).

**The fix.** The budget is now per REQUEST and is spent by BILLABLE attempts
only:

- a candidate that charges is skipped when the budget is spent, before it is
  announced and before it is dialled;
- a non-billable candidate — the mock — spends nothing, so a total vendor
  outage still degrades to something rather than nothing, which is the
  behaviour `runtime/config.ts` documents and Batch 1 certified;
- a skipped candidate is recorded as SKIPPED, never as failed. An operator
  reading `failedProviders` must not be sent looking for an outage at a vendor
  that was never called.

**The certified figures did not move.** The Batch 4B hold of 105,920 µUSD for
`cortex.chat` is unchanged, `policy/exposure.ts` is unchanged, and
`spendGuard.estimateFor` is unchanged. The number was already correct; the
execution path now matches it. Both pinning suites — `providerAdministration`
and `anthropicGovernedPath` — pass unmodified, and `routingPolicy.test.ts` pins
the same 105,920 through the routing projection so the three cannot drift apart.

---

## 3. Routing orders; it does not admit

The single most important property of this batch, stated three times and
enforced twice:

1. **Stated** in `routing/contracts/routing.ts`.
2. **Enforced** in `routing/engine/routingPolicy.ts`, which asserts that its
   output is a subset of its input and throws rather than returning a candidate
   it was not offered.
3. **Enforced again** in `providers/selector.ts`, which maps the routed order
   back through the eligible set and can only drop.

Eligibility is untouched. The registry still decides operational state
(`registry.state`, the Batch 4E remediation), and the selector still applies the
real-request kill switch, the certification requirement, the credential check,
the circuit and capability matching — in the same function, in the same order,
with the same reasons. Routing is layered on that answer rather than mixed into
it, so there is no strategy that can reach a provider the gates refused. The
adversarial case is driven end to end: the cheapest provider on the platform,
disabled by an administrator, is not selected under the cost strategy.

---

## 4. The four invariants a strategy may not express away

Applied as sort keys AHEAD of whatever the strategy optimises for, so a strategy
only ever breaks a tie within a tier.

| Invariant | Why |
|---|---|
| The configured fallback stays last | `AI_FALLBACK_PROVIDER` is a Batch 1 selection guarantee. A cheap fallback promoted to first place would repeal it silently. |
| A provider that charges nothing is not therefore the best value | The mock costs zero. A naive cost ranking makes every request on a deployment that authorised real spending a synthetic completion — healthy-looking, free, and wrong about every answer it gives. |
| A half-open circuit is unproven, not healthy | It admits one probe at a time and may re-open on it. Ranking one first spends a user's request on a health check. |
| `preference` is the identity | The default strategy returns the selector's order untouched, so a deployment that adopts this batch and configures nothing routes exactly as it did before it. |

When the kill switch is off, billable providers are not eligible at all, the
paid tier is empty, and the mock serves — which is correct, and is why the
second invariant costs nothing in a mock-only deployment.

---

## 5. Governance

| Control | Where an administrator moves it | What bounds them |
|---|---|---|
| `routing.strategy` | settings patch; demands `ai.admin.provider.write` | Validated against the declared set. An unrecognised value keeps the current strategy rather than resetting it — a typo must not silently re-steer a platform. NOT clamped by the envelope: it cannot admit a provider, spend money the deployment withheld or lift a certification requirement. |
| `routing.maxProviders` | settings patch; demands `ai.admin.settings.write` | Absolute bounds 1–6, then the deployment's own `AI_ROUTING_MAX_PROVIDERS`. It is a spend and latency bound, so an administrator may tighten it freely and may never raise it past what the deployment authorised. `envelopeAdjustments` names the cap so the console says what happened. |

The split across two grants is deliberate and follows the rule
`capabilitiesForPatch` already applies: the requirement is derived from the
FIELDS a patch touches, not from the endpoint it arrived at. `strategy` decides
which provider serves — the same class of decision as the preference order
beside it. `maxProviders` bounds failover — the same class as `failoverEnabled`
beside it. A caller who sends both needs both.

There is **no routing write path of its own**. `/ai/admin/routing` is a GET.
The strategy and the breadth are fields of the settings patch, so they pass
through the same authorisation, normalisation, deployment envelope, versioning
and audit trail as every other setting, and both appear on the administrative
change record (`routingStrategy`, `routingMaxProviders`).

**Backward compatibility.** A settings record written before this batch carries
no `routing` key. It hydrates to the deployment baseline — the `preference`
strategy and the deployment's own breadth — which is exactly how the platform
behaved before the field existed. Pinned by test.

---

## 6. Economics

One arithmetic, not a second price table. Every rate comes from the model
descriptor the adapter declared, which is the source the spend guard reserves
against and the budget engine settles against.

```
projected(attempt)  = ceil(promptTokens x promptRate/1000 + completionTokens x completionRate/1000)
projected(request)  = projected(attempt) x billableAttemptBudget
premium             = max(0, projected(chosen) - projected(cheapest paid))
variance            = realized - projected(request)          // SIGNED
```

- The **premium** is what a non-cost strategy accepts per attempt for whatever
  it optimises for instead of price. Zero under the cost strategy by
  construction, which is the point of measuring it. A request served by a
  provider that charges nothing reports zero rather than a negative saving — it
  did not save the difference, it produced a different kind of answer.
- The **variance is signed**. Persistently negative means the platform holds
  more than it spends: safe, wasteful of headroom. Persistently positive means
  the projection under-states real spend: the condition a ceiling exists to
  prevent. An absolute value would hide the difference.
- Economics **measures; it never controls**. No request is refused because of a
  premium, no candidate is excluded by one, and no ceiling moves.
  `policy/exposure.ts` remains the control and is deliberately separate — a
  number that both steers traffic and gates configuration is a number nobody can
  reason about during an incident.

---

## 7. The routing ledger

Bounded, in memory, and that is the right answer here: every micro-USD it
discusses is already durable in the spend ledger, the audit trail and the
financial event ledger. Nothing in it is an authority for anything; it is the
operational view that answers "where is traffic going, and what is the strategy
costing?".

It holds provider ids, model ids, feature ids, an organization id and integers.
No prompt, no completion, no message content, no actor identity, no credential
and no fingerprint — asserted by a test that serialises the whole view and scans
it, and by a contract scan on the console's own types.

Recent records are tenant-scoped by `scopeRecords`, the same way the execution
audit is. The platform-wide summary carries no organization id and is reached
under `ai.admin.view`, which is the posture `usage()` already has.

---

## 8. Observability

| | |
|---|---|
| Metrics | `ai_routing_decisions_total{feature,strategy,provider}`, `ai_routing_premium_micro_usd_total{feature,strategy}`, `ai_routing_budget_exhausted_total{feature,strategy}` |
| Events | `ai.routing.decided`, `ai.routing.budget_exhausted` |
| Log | `ai.routing.budget_exhausted` at warn, naming the budget, the attempts spent and the providers skipped |

A request that stopped failing over because it spent its allowance looks
identical, from the outside, to one that ran out of providers. An operator
tuning the failover breadth or a feature's attempt allowance needs to know which
of the two happened, so it is said out loud on the metric, the event stream, the
log and the `NO_PROVIDER_AVAILABLE` diagnostics.

---

## 9. Console

A **Routing** tab in the AI Administration console: the strategy with what each
option actually optimises for, the failover breadth bounded by what the
deployment permits, the reconciled economics, per-provider aggregates and the
recent decisions.

The Batch 4C surface properties are kept and re-asserted for this panel by
`tests/features/routingSurface.test.ts`: no vendor identity in any executable
branch, no free-text strategy field, no routing mutation outside the audited
settings patch, no bare `fetch`, every change carries a reason, and no contract
the console reads has a field a secret, prompt or completion could occupy.

---

## 10. What was NOT built, and why

- **No per-tenant routing.** An organization-scoped strategy is a real product
  question and a different blast radius; the routing settings are platform-wide,
  exactly like every other field of the settings overlay.
- **No dynamic or learned routing.** Every decision is a pure function of
  facts the registry and the breaker already publish. A router that trained on
  its own outcomes could not be replayed from an audit record, and "explain the
  bill" is most of what economics means.
- **No geographic or compliance routing.** The reference architecture lists both
  under provider routing; neither has a data model yet — there is no region on a
  provider configuration and no residency policy on an organization. Inventing
  one here would be architecture invented at the point of use.
- **No arbitrage across credentials.** The BYOK precedence chain and the funding
  latch are Batch 4D's, unchanged. Routing reorders providers; it never chooses
  whose money pays.
- **No schema change and no migration.** As Batch 4C predicted.

---

## 11. Verification

```
npm run verify:4f          167 tests   routing policy, governance, surface,
                                       resilience, providers, spend
npm run test:ai          2,183 tests   the whole AI control plane
npm run test:features      717 tests
npm run test:system        170 tests
npm run scan:boundaries    107 tests   the AI boundary scan
npm run typecheck:api:ai   clean       deno check across the AI boundary
npm run typecheck:web      34 errors   unchanged from the baseline, none in
                                       any file this batch touches
npm run build              clean
```

No test was weakened, skipped or deleted. The two suites that pin the certified
budget invariant — `providerAdministration.test.ts` and
`anthropicGovernedPath.test.ts` — pass unmodified.

No test reaches a real provider. `AI_ALLOW_REAL_REQUESTS` is untouched by this
work; the suites that exercise paid behaviour declare the in-process mock
`billable`, which changes what the platform BELIEVES about an invoice and
reaches no network.

---

## 12. Production

Nothing here requires a deployment action. There is no migration, no secret, no
key and no new environment variable that must be set: `AI_ROUTING_STRATEGY`
defaults to `preference` (the pre-4F order, exactly) and
`AI_ROUTING_MAX_PROVIDERS` defaults to 3, which is the number of providers a
certified MARQ deployment registers — so the default bounds a previously
unbounded walk without narrowing the estate that exists.

**The one behaviour change a deployment inherits without configuring anything**
is the billable attempt budget: a request may no longer make more paid attempts
than were reserved for it. That is a narrowing of spend and a correction of the
certified invariant, and it is the change this batch exists to make.

Batch 4E's production rollout remains deferred, unchanged by this work.
