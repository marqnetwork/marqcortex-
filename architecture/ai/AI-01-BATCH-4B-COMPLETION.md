# AI-01 Batch 4B — Anthropic as a governed provider

**Baseline:** `dc9dd7b` (Batch 4A complete and production-certified)
**Status:** implemented and locally certified — **awaiting authorisation for the production proof**
**Production changes made by this batch:** none
**Real Anthropic requests executed:** 0

---

## 1. What this batch was, and what it turned out to be

The brief was to make Anthropic "the Anthropic equivalent of the governed
OpenAI provider". The read-only audit that opened the batch found that most of
that already existed: `anthropicProvider.ts` was written in Batch 1 — on the
explicit reasoning that an abstraction with one implementation is an unproven
abstraction — and it is registered in `bootstrap.ts`, priced in the registry,
selected by the selector, reported by the health endpoint and certified at
assembly.

So Batch 4B is not an implementation batch. It is a **certification** batch, and
the distinction shaped every change in it:

| Question | Answer |
|---|---|
| Does Anthropic reach a model through the governed path? | Yes, and it always did. |
| Was that ever *proved*, as opposed to asserted? | No. Five adapter unit tests against a stub `fetch`, and nothing that exercised the sequence which spends money. |
| Did registering it change the platform that was already certified? | Yes — in one place nobody had looked. See §4. |

What 4B adds is the evidence, the corrected catalogue, and two shared-contract
repairs that Batch 4A's production proof surfaced.

---

## 2. Read-only audit — Anthropic's state at the baseline

| # | Area | Found at baseline |
|---|---|---|
| 1 | Provider adapter | **Complete.** `ai/providers/anthropicProvider.ts` — one attempt, no retry/telemetry of its own, injected `fetch`. |
| 2 | Credential configuration | **Complete.** `ANTHROPIC_API_KEY` read through `EnvSource`, only inside the adapter. Never logged, never returned, never in the repository. |
| 3 | Provider registry | **Registered** in `bootstrap.ts` at `certification: 'certified'`, priority 20. |
| 4 | Model catalogue / allow list | **Present but too wide.** Declared Haiku 4.5 *and* Sonnet 4.5. See §4. |
| 5 | Provider selection | **Participates.** Cheapest capable model wins; `AI_PROVIDER_PREFERENCE` orders providers. |
| 6 | Health reporting | **Generic and correct.** `registry.stateOf` + `selector.explain` cover it with no per-vendor code. |
| 7 | Certification state | `certified` at bootstrap; `AI_REQUIRE_CERTIFIED_PROVIDERS` enforces it in selection. |
| 8 | Token usage normalization | **Complete.** `input_tokens`/`output_tokens` → `promptTokens`/`completionTokens`/`totalTokens`, total computed (Anthropic sends none). |
| 9 | Pricing metadata | **Correct.** Haiku 4.5 at 1,000 / 5,000 µUSD per 1k = $1.00 / $5.00 per MTok, matching Anthropic list price. |
| 10 | Retry | Control-plane, shared. `PROVIDER_RATE_LIMITED` and `PROVIDER_UNAVAILABLE` are retryable; vendor `retry-after` overrides the backoff curve. |
| 11 | Failover | Control-plane, shared, and gated by `AI_FAILOVER_ENABLED`. |
| 12 | Circuit breaker | Control-plane, shared, per provider id. |
| 13 | Timeout | Control-plane `withTimeout`; the adapter forwards the abort signal to `fetch`. |
| 14 | Error normalization | **Complete.** 401/403 → `PROVIDER_AUTH_FAILED`; 429 → `PROVIDER_RATE_LIMITED` + `retry-after`; **529 overloaded** and 5xx → `PROVIDER_UNAVAILABLE`; anything else → `INVALID_MODEL_OUTPUT`, non-retryable. Vendor body kept in `diagnostics`, never in `message`. |
| 15 | Budget reservation compatibility | Compatible — and coupled in a way nobody had measured. See §4. |
| 16 | Audit attribution | Shared. `providerId` / `modelId` / usage / cost / digests on every record. |
| 17 | Admin UI / provider visibility | **Generic.** `AIAdministrationConsole` renders whatever the health surface reports; no per-vendor code and none needed. |
| 18 | Tests | **The real gap.** Five adapter unit tests. No governed-path suite. |
| 19 | Documentation | Extension guide named Anthropic; `.env.example` and ARCHITECT.md §12.1 carried the credential. |
| 20 | Environment / secrets contract | `ANTHROPIC_API_KEY` only. No client exposure anywhere. |
| 21 | Placeholder or mock Anthropic implementation | **None.** The adapter is real. |

Production health at the baseline reported `state: unavailable`,
`certification: certified`, `credentialsConfigured: false`, `circuit: closed`,
selection `credentials not configured`. That is exactly what the source says it
should report with no key set — verified against the source, not assumed.

---

## 3. Model policy

**Certified: `claude-haiku-4-5-20251001`, and only that.**

No canonical Cortex document names an Anthropic model; the only prior guidance
was the preference ordering in ARCHITECT.md §12.1. So the choice was made on
what Cortex actually asks for:

- The largest completion allowance any Cortex feature declares is **2,500
  tokens** (`HEAVY_LIMITS`). Haiku 4.5's declared 8,192 covers every feature
  with headroom.
- It is the smallest and cheapest model Anthropic offers in the current
  generation — $1 / $5 per MTok against Sonnet 4.5's $3 / $15.
- It is a **dated snapshot**, not the `claude-haiku-4-5` alias. An alias may be
  repointed at a new model version by the vendor; an audit record that names the
  model behind a completion has to stay true a year later, and a certification
  that can be moved underneath the platform is not a certification.

`maxOutputTokens` is deliberately declared at 8,192 rather than the vendor
maximum. The selector reads it as a **floor**, so understating it can only
remove Anthropic from a request it could have served — never send an oversized
one.

**Sonnet 4.5 was withdrawn from the catalogue** rather than left in unused. Why
that is not a scope reduction is §4.

---

## 4. The finding: a declared model costs money it never spends

`spendGuard.estimateFor` reserves the worst case a feature can cost across
**every billable provider's full declared catalogue** — not the permitted
subset, and not the model that will actually be selected. That is correct and
deliberately pessimistic. It also means a model's *declaration* has a price:

| Registered billable catalogue | Hold per interactive chat request |
|---|---|
| OpenAI only (the certified Batch 4A baseline) | 105,920 µUSD ($0.106) |
| OpenAI + Anthropic **with Sonnet 4.5 declared** | 134,304 µUSD ($0.134) |
| OpenAI + Anthropic, Haiku 4.5 only (**this batch**) | 105,920 µUSD ($0.106) — unchanged |

The middle row is the finding. Sonnet 4.5 would never have been selected — the
selector takes the cheapest capable model, which is Haiku — yet merely
declaring it raised the hold on **every request, including OpenAI's**, by 28,384
µUSD against a $0.25 MARQ-funded lifetime ceiling with $0.000064 already spent.
Certifying a second vendor would have silently moved a number the first vendor's
certification was proved against.

Narrowing the catalogue to Haiku 4.5 keeps Anthropic's own worst case at 44,768
µUSD — comfortably below OpenAI's — so registering it changes the platform's
reservation behaviour by exactly nothing.

This is now pinned in both directions by tests that bracket the figure: a
request is **refused** at one µUSD below it and **admitted** at exactly it. A
future catalogue change that moves the hold cannot pass silently.

---

## 5. The two Batch 4A follow-ups

### 5.1 `provider="openai"`, `model=null` — ROOT CAUSE AND FIX

**Root cause: an asymmetric response contract, not a lost value.**

The model was recorded correctly everywhere it was recorded: in
`PipelineOutcome.modelId`, in `AIExecutionResult.execution.modelId`, in the
audit record, and in the success log line. The defect was in
`httpAdapter.successBody`, which placed the two halves of one fact at two
different levels of the response:

```
{ success, ...output,
  model: result.execution.modelId,        ← top level (pre-Batch-1 client contract)
  meta: { provider: ...providerId,        ← provenance block
          attempts, latencyMs, usage, governance } }   ← no model here
```

`model` sits at the top level because clients that predate Batch 1 read it
there, and Batch 1 correctly refused to move an existing field. But provenance
moved into `meta`, and a reader who finds `meta.provider` reasonably looks for
`meta.model` next. It was not there, so the proof — reading both from the one
object that holds provenance — reported `provider=openai model=null` for a
request that was entirely correct.

**Fix (provider-neutral, in the shared contract):** `meta.model` is now reported
beside `meta.provider`. The top-level `model` keeps its name, position and
meaning, so no existing client changes. Regression-tested for **all three**
providers: `openaiGovernedPath.test.ts`, `anthropicGovernedPath.test.ts` (both
the paid path and the mock path), and structurally in
`tests/features/cortexChatProviderLabel.test.ts`.

### 5.2 "GPT-4o-mini · Live" over a mock completion — ROOT CAUSE AND FIX

**Root cause: three independent defects in `CortexChatPanel.tsx`, any one of
which was enough on its own.**

1. **The model name was a JSX literal** — `GPT-4o-mini` hard-coded. A platform
   that selects between OpenAI, Anthropic and the mock per request cannot label
   its output with a constant, and after this batch that constant is wrong more
   often than it is right.
2. **"Live" was `isBackendEnabled()`** — a build-time configuration flag. It
   answers "is a backend URL configured?", which is a different question from
   "did a model produce this text?". With `AI_ALLOW_REAL_REQUESTS=false` the
   server answers from the mock and the flag stays true — which is precisely the
   state production was in when the label was observed.
3. **The panel's own `catch` falls back to a locally generated narrative** when
   the API call fails, and the flag stays true through that too. Text this file
   wrote was labelled as live model output.

Underneath all three: the client contract had **no type for `meta`**, so the one
fact the badge needed was unreachable from the UI. That is shared provider-state
presentation, it is the direct cause, and it belongs in 4B — a governed platform
that cannot tell a user which engine answered has not finished being governed.

**Fix:**

- `AIExecutionMeta` added to the client contract (`src/app/lib/api.ts`) and
  exposed on `NarrativeResponse` and `AIChatResponse`. Optional, because a demo
  response is assembled on the client and has no governed execution behind it.
- `generateNarrative` now returns provenance rather than a bare string, so the
  local-fallback path is distinguishable from a served one.
- The badge and the header indicator render three honest states — a named
  provider and model (`live`), the mock provider (`synthetic`), or nothing at
  all (`local`) — and the header derives its status from the transcript rather
  than asserting it.
- No vendor is named anywhere in the component. `tests/features/cortexChatProviderLabel.test.ts`
  fails if one comes back.

### 5.3 The `/ai/metrics`, `/ai/audit`, `/ai/catalog` authorization question — **BACKLOGGED, NOT TOUCHED**

The prior audit flagged a possible authorization mismatch on these three
operator endpoints. It was examined and **deliberately left alone**, as
instructed.

What the source says: all three call `deps.verifyTeamToken(...)` and return 401
on a null result. That is a **team-membership** check, whereas the sibling
administration surface (`aiAdminRoutes.ts` → `executeAdminHttpRequest`) resolves
an admin actor and enforces a capability. So the three endpoints are gated by a
weaker authority than the console beside them, and they return cross-tenant
data: `/ai/metrics` carries usage volumes across all organizations,
`/ai/audit` names actors, organizations and prompts.

**Why it is not in 4B:** it is an authorization-model change on a shared
operator surface, unrelated to provider certification, and touching it here
would mean shipping an access-control change inside a batch whose proof is about
spending money at a vendor. Those are different reviews.

**Owner:** AI-01 Batch 4C or a dedicated security batch, whichever comes first.
**Recommendation when it is picked up:** move all three behind the same
`resolveAdminActor` + capability path the admin routes use (`ai.admin.view`),
and add the refusal to the admin change trail. **Nothing in this batch changed
their behaviour.**

---

## 6. Files changed

| File | Change |
|---|---|
| `supabase/functions/server/ai/providers/anthropicProvider.ts` | Certified catalogue narrowed to `claude-haiku-4-5-20251001`; reasoning documented in place. No behavioural change to the request/response mapping. |
| `supabase/functions/server/ai/http/httpAdapter.ts` | `meta.model` reported beside `meta.provider`. Top-level `model` unchanged. |
| `supabase/functions/server/ai/agents/runtime/defaultProfiles.ts` | Comment correction: the planning rates are an upper bound stated as a constant, not a figure derived from the registry. Values unchanged, still over-reserving. |
| `supabase/functions/server/ai/__tests__/anthropicGovernedPath.test.ts` | **New.** 26 tests across four suites — the paid sequence, the gates, failure behaviour, and the certified OpenAI/mock baselines. |
| `supabase/functions/server/ai/__tests__/openaiGovernedPath.test.ts` | `meta.model` regression assertion added. |
| `tests/features/cortexChatProviderLabel.test.ts` | **New.** 9 structural tests guarding the label repair and the response contract. |
| `src/app/lib/api.ts` | `AIExecutionMeta` added; exposed on `NarrativeResponse` and `AIChatResponse`. |
| `src/app/components/CortexChatPanel.tsx` | Provenance-driven badge and header; no vendor named; local fallback distinguishable. |
| `scripts/anthropic-live-proof.ts` | **New.** Controlled production proof, preflight-only without `--live`. |
| `package.json` | `verify:anthropic`, `verify:anthropic:live`. |
| `src/system/manifest.ts` | MQC-SVC-042 notes updated. No node added or removed. |
| `ARCHITECT.md`, `.env.example`, `architecture/ai/AI-PROVIDER-EXTENSION-GUIDE.md` | Certified catalogue table; the declared-model-costs-headroom rule; the governed-path and proof-script steps for the next provider. |

**Migrations added: none.** This batch adds no schema, no table and no policy.

---

## 7. Governance path — unchanged, and that is the deliverable

Anthropic is not a parallel execution path. It participates in the one path:

```
request → authentication → authority → feature policy → governance/input guard
        → provider selection → model allow list → budget reservation
        → provider adapter → usage normalization → settlement
        → output guard → audit/telemetry → response
```

Every stage is provider-neutral code that already existed. The proof that this
is true rather than merely intended is that **no stage was modified to make
Anthropic work** — the only production files this batch touched are the adapter
(catalogue), the HTTP adapter (a shared response field), one comment, and the
frontend label.

---

## 8. Test results

```
npm run test:ai            1680 tests · 1680 pass · 0 fail   (1654 at baseline; +26 new)
npm run test:features       652 tests ·  652 pass · 0 fail   (643 at baseline;  +9 new)
npm run test:system         161 tests ·  161 pass · 0 fail
npm run test:security       308 tests ·  308 pass · 0 fail
npm run scan:boundaries      98 tests ·   98 pass · 0 fail
npm run typecheck:api:ai    exit 0 — clean (deno check, AI boundary)
npm run build               ✓ built in 16.09s
npm run verify:ai           16/16 scenarios — allowRealRequests=false spent=0 reserved=0
npm run verify:anthropic    12/13 — the one FAIL is the deliberate live-call BLOCK
npm run verify:openai       preflight — unchanged
```

The new Anthropic suite covers, by name:

| Requirement | Test |
|---|---|
| Anthropic unavailable without credentials | `is unavailable, and never called, without a credential` |
| Cannot execute when `AI_ALLOW_REAL_REQUESTS=false` | `never reaches Anthropic while the real-request kill switch is off` |
| Uncertified model rejected | `refuses an administrative allow list naming a model the adapter does not serve` · `serves nothing when the permitted catalogue names only an uncertified model` |
| Allowed model accepted | `accepts an allow list naming the certified model, and still serves it` |
| Usage normalized correctly | `normalises Anthropic token usage onto the platform contract` |
| Reservation calculated before execution | `reserves the pessimistic worst case BEFORE the vendor is reached` · `admits the request at exactly the hold it computes, and no less` |
| Actual usage settles correctly | `settles the metered cost onto the MARQ ceiling and the daily budget` |
| Provider error reconciles reservation | `reconciles the reservation when the provider fails, stranding nothing` |
| Timeout normalized | `normalises a deadline expiry as a provider timeout` |
| Rate limit normalized | `normalises a rate limit and honours the vendor retry-after` |
| Circuit breaker | `opens the circuit on repeated provider faults and then reports it as the reason` |
| Retry policy | `stops at the feature attempt allowance rather than retrying indefinitely` · `does not retry a request the vendor refused on its merits` |
| Failover policy | `maps 529 overloaded onto provider unavailability and fails over when permitted` · `does not fail over when the operator has turned failover off` |
| Audit attribution | `attributes the paid call to a verified organization and actor in the audit trail` |
| Provider/model metadata surfaced | `reports the provider and the model together in one place` |
| OpenAI does not regress | `does not raise the hold the certified $0.25 ceiling was proved against` · `leaves OpenAI first in preference order and unchanged in what it serves` |
| Mock does not regress | `leaves the mock provider synthetic, free and non-production` |
| No credential or prompt leaks | `keeps the credential, the prompt and the completion out of the log` · `keeps the vendor error body in diagnostics and out of the caller-facing response` |

**No test was weakened to make anything pass.** Two tests were strengthened: the
4A OpenAI suite gained the `meta.model` assertion, and the reservation figure is
now bracketed from both sides rather than merely being large enough.

### Pre-existing validation failures, unchanged by this batch

`npm run typecheck` fails on `web` and `tests` at this baseline and continues to
fail identically: **34 web errors before this batch, 34 after**, none in any file
this batch touched. `npm run typecheck:api` reaches the AI boundary clean
(`exit 0`) and then stops on a JSR egress restriction fetching
`@supabase/supabase-js` — an environment restriction, not a type error. These are
reported rather than silently inherited; they are not this batch's to fix and
this batch did not add to them.

---

## 9. Security findings

| Finding | Status |
|---|---|
| `ANTHROPIC_API_KEY` reachable from the client | **No.** Read only inside the adapter, through `EnvSource`, at the edge. Not in the repository, not in any bundle, not in any response. |
| Credential in logs | **No.** Asserted at `AI_LOG_LEVEL=debug`, the most this platform ever emits. |
| Prompt or completion text in logs | **No.** Asserted on the same run. |
| Vendor error body reaching the caller | **No.** Kept in `diagnostics`; asserted with a synthetic confidential marker echoed in a 400 body. |
| Direct Anthropic call from the frontend | **No.** `tests/system/ai_boundary.test.ts` already fails the build on a vendor host or a provider import outside `ai/providers/`. |
| A provider bypassing governance | **Structurally impossible.** One `controlPlane.execute`, no bypass flag; the boundary scan enforces it on the source. |
| `/ai/metrics`, `/ai/audit`, `/ai/catalog` authority | **Open, backlogged, untouched.** See §5.3. |

---

## 10. Production state

**Unchanged. Nothing in this batch was deployed, applied or executed against
production.**

- `AI_ALLOW_REAL_REQUESTS` — still `false`. This batch never sets it.
- `ANTHROPIC_API_KEY` — **not set in production.** Setting it is a hard stop.
- MARQ-funded lifetime ceiling — still $0.25. Untouched.
- Settled lifetime spend — still 64 µUSD from the 4A OpenAI proof. Untouched.
- `attemptCount` — untouched.
- Historical audit records — untouched.
- Migrations — none added, none applied.
- Edge Function — not redeployed.

The proof script uses an in-memory ledger by construction, so no local run can
reach the production ceiling.

---

## 11. Ready for the Batch 4B production proof

Yes — pending explicit authorisation. The remaining steps are all hard stops and
none of them has been taken:

1. Set `ANTHROPIC_API_KEY` as a Supabase Edge Function secret.
2. Deploy the Edge Function.
3. Confirm `/ai/health` reports `anthropic` as `credentialsConfigured: true`,
   `certification: certified`, still refused by the kill switch.
4. Set `AI_ALLOW_REAL_REQUESTS=true`.
5. `npm run verify:anthropic:live` — exactly one paid Anthropic request.
6. Confirm: `provider=anthropic`, `model=claude-haiku-4-5-20251001` (in both
   `meta.model` and the top-level field), `attempts=1`, no retry, no failover,
   no governance block, no stranded hold, and lifetime spend advanced from
   64 µUSD by the metered cost alone.
7. Return `AI_ALLOW_REAL_REQUESTS=false` and redeploy.

**Do not begin without authorisation.**
