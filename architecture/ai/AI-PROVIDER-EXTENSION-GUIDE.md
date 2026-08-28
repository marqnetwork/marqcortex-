# Extending the MARQ Cortex AI Control Plane

**Applies to:** AI-01 Batch 1 onward · **Supersedes:** `MCV2-intelligence-gateway-provider-extension-guide.md`
**Provider administration:** AI-01 Batch 4C — see §1a below and `AI-01-BATCH-4C-COMPLETION.md`

Three things get added to this platform over time: providers, AI features and
prompts. Each has exactly one way in. If a change you are making does not fit one
of these three shapes, it probably belongs in the control plane itself — raise it
rather than working around it.

---

## 1. Adding a provider

**Business logic never changes.** A provider is a translation layer between the
platform's neutral invocation and one vendor's wire format. Nothing above
`ai/providers/` learns that it exists.

### Steps

1. **Implement `AIProviderAdapter`** in `ai/providers/<vendor>Provider.ts`
   (contract: `ai/contracts/provider.ts`).

   ```ts
   export function createVendorProvider(options: {
     env: EnvSource;
     fetchImpl?: FetchLike;
     credentials?: ProviderCredentialResolver;  // Batch 4C
     clock?: Clock;
   }): AIProviderAdapter
   ```

   Your adapter must:
   - declare its models, capabilities and **rate card** in the descriptor;
   - declare its **credential policy** in the descriptor (Batch 4C) — see §1a;
   - resolve its secret through the injected `ProviderCredentialResolver`
     inside `invoke`, never by reading an environment variable directly;
   - perform **exactly one attempt** — no retry loop, no timeout, no telemetry;
   - throw `AIError` with the right taxonomy code on failure;
   - keep the vendor's error body in `diagnostics`, never in `message`
     (vendor errors sometimes echo the request, which may contain client data);
   - accept an injected `fetch` so it is testable without network access.

2. **Declare only models you have certified.** The list in your descriptor IS
   the allow list — nothing above `ai/providers/` names a model, and an
   administrator's `modelAllowList` can only narrow what you declare. Two rules
   follow, both learned during AI-01 Batch 4B:

   - **Do not declare a model "because the vendor offers it".** The spend guard
     reserves the worst case across every billable provider's FULL declared
     catalogue, not the model that will be selected, so an expensive declared
     model raises the pessimistic hold on every request — including requests
     another vendor serves. Declaring one is a budget decision; make it
     deliberately, and re-check the reservation arithmetic against the MARQ
     ceiling when you do.
   - **Use dated model snapshots, not aliases.** A vendor may repoint an alias
     at a new model version. An audit record naming the model behind a
     completion has to stay true a year later.

   State capabilities conservatively. `maxOutputTokens` is read as a floor, so
   understating it can only remove your provider from a request it could have
   served — never send an oversized one.

3. **Set `productionReady`** honestly. `false` means the registry will report a
   deployment where your provider is the only usable one.

4. **Export a `CredentialProviderProfile`** from your adapter module —
   `<VENDOR>_CREDENTIAL_PROFILE` — and **register it** in `ai/bootstrap.ts` by
   adding both the adapter and its profile.

   The profile, not `bootstrap.ts`, is where your vendor's environment variable
   name is written down. That is a boundary rule, not a preference: the AI
   boundary scan forbids a provider credential variable from appearing outside
   `ai/providers/`, and `bootstrap.ts` is outside it. One definition, inside the
   provider boundary, used by the adapter and by the production resolver.

5. **Add it to `AI_PROVIDER_PREFERENCE`** documentation in `.env.example` and
   ARCHITECT.md §12.1, and add its certified models to the catalogue table
   there.

6. **Test it** in `ai/__tests__/providers.test.ts` against a stub `fetch`:
   the request shape it produces, the completion shape it normalises back, and
   the taxonomy mapping for 401 / 429 / 5xx / transport failure.

7. **If it is billable, drive it through the whole governed path** in its own
   `ai/__tests__/<vendor>GovernedPath.test.ts`, modelled on
   `anthropicGovernedPath.test.ts`. Adapter unit tests prove you speak the wire
   format; they prove nothing about the sequence that spends money. That suite
   must cover: the paid request end to end, usage normalisation, the hold taken
   BEFORE the vendor is reached (pinned by refusal one µUSD below it AND
   admission at exactly it), settlement, reconciliation on provider error,
   missing credentials, the `AI_ALLOW_REAL_REQUESTS` kill switch, the emergency
   stop, an allow list naming a model you do not serve, retry, failover, the
   circuit breaker, timeout normalisation, audit attribution — and that
   registering you did not change what the already-certified providers do.

8. **Write a controlled production proof script**, modelled on
   `scripts/anthropic-live-proof.ts`, and wire `verify:<vendor>` /
   `verify:<vendor>:live` into `package.json`. It must run its full preflight
   with no network, refuse the live call unless `--live` AND a credential AND
   `AI_ALLOW_REAL_REQUESTS=true` are all present, never set the kill switch
   itself, and use its own in-memory ledger so a proof run cannot consume the
   deployment's funded headroom.

---

## 1a. Provider administration (AI-01 Batch 4C)

A MARQ platform administrator manages providers, credentials and models from the
console — Team Dashboard → Settings → AI Administration → Providers. Your
adapter participates in that surface by DECLARING things, never by implementing
them. There is no administration code in an adapter.

### The credential policy you declare

```ts
credential: {
  required: true,                          // can you execute without a secret?
  manageable: true,                        // may an operator store one for you?
  environmentVariable: 'VENDOR_API_KEY',   // a NAME, never a value
  credentialFormatHint: 'Vendor API key',  // console copy, never an example key
}
```

The console is written once, generically, against this policy. It contains no
provider name in any branch — `manageable: false` is what makes the synthetic
mock provider render without a credential form, and a provider you add renders
correctly with no frontend change. `tests/features/providerAdministrationSurface.test.ts`
holds that property.

### Credential precedence, and what it means for you

```
Provider Adapter
      │
      ▼
ProviderCredentialResolver
      ├── 1. an ACTIVE managed Cortex credential   (encrypted, rotatable, audited)
      ├── 2. the deployment environment variable   (bootstrap / emergency compat)
      └── 3. none — the provider is unavailable and says so
```

Your adapter sees none of this. It calls `credentials.resolve(providerId)` once
per attempt and gets a secret or nothing.

Three consequences worth knowing:

- **The environment stays supported.** It is a compatibility and emergency
  source, not a deprecated one: a deployment whose database is unreachable can
  still serve, and an operator locked out of the console can still restore
  service through a deploy. What it stops being is the *only* mechanism.
- **A managed credential that cannot be decrypted does NOT fall through to the
  environment.** Falling through would mean an operator who rotated a key kept
  executing on the old one. The provider goes unavailable and the failure is
  reported.
- **Plaintext is never cached.** `describe()` — the synchronous probe the
  registry, selector and spend guard use — reads a non-secret snapshot bounded
  by `AI_CREDENTIAL_SNAPSHOT_TTL_MS` (default 30s). `resolve()` reads storage
  and decrypts every time, which is why a revoked credential stops working on
  the next request rather than at the end of a window.

### Secret handling rules an adapter must not break

- Never log, echo, or put a credential in an `AIError` — not in `message`, not
  in `diagnostics`.
- Never return it from anything. There is no API, route, service method or
  database view in this platform that returns a stored provider credential, and
  adding one is out of scope for every future batch.
- Never read `options.env` for your credential once you take a resolver. Two
  credential paths for one provider is two things to get wrong.

### Models, certification and the budget

Batch 4C keeps four ideas apart, and an adapter only supplies the first:

| Idea | Who decides | Where it lives |
|---|---|---|
| Which models exist | the adapter | your descriptor's `models` |
| Which are certified | MARQ governance | derived from the declared catalogue + provider certification |
| Which are enabled | an administrator | the operational settings overlay's `modelAllowList` |
| Which are runtime-eligible | the selector | enabled ∧ certified ∧ provider enabled ∧ capable |

An administrator **cannot type a model name and make it eligible**: a model the
adapter does not declare is rejected at the administration boundary.

Enabling a model can raise the platform's worst-case single-request spend
reservation. `ai/policy/exposure.ts` computes that figure, the console shows it,
and a change that would push it past the governed ceiling is refused with the
number named. The Batch 4B certified figure — **105,920 µUSD** for
`cortex.chat`, driven by OpenAI's `gpt-4o` — is pinned by
`providerAdministration.test.ts`. **If your provider's rate card moves it, that
is a governance change and the pin must be updated deliberately, with the MARQ
ceiling re-checked.**

### What administration does NOT let anyone do

- Register a provider by naming it. The registry is the authority; a provider
  exists because an adapter was written and reviewed.
- Point a provider at an arbitrary endpoint. Self-hosted providers are Batch 4E,
  and they arrive as adapters.
- Manage another organization's credentials. Batch 4C administers the
  `platform` scope only; the schema carries an `organization` scope for Batch 4D
  and every 4C write path refuses it.

### What you do NOT implement

Retry, backoff, timeouts, circuit breaking, provider selection, cost accounting,
prompt rendering, PII redaction, output validation, fact locking, audit, metrics
and logging are all control plane concerns, applied identically to every
provider. An adapter that implements any of them is duplicating platform
behaviour and will drift from it.

### Where vendors genuinely differ

Two differences surfaced when Anthropic was added alongside OpenAI, and both are
handled adapter-locally by design:

| Difference | OpenAI | Anthropic | Handled in |
|---|---|---|---|
| System prompt | a message with `role: "system"` | top-level `system` parameter | adapter |
| JSON output | `response_format: { type: "json_object" }` | assistant prefill with `{`, restored on the way out | adapter |

If you hit a third difference that cannot be absorbed inside an adapter, the
neutral contract is wrong — fix the contract, do not leak the vendor upward.

---

## 2. Adding an AI feature

A feature is **data plus four small functions**. There is no route handler to
write and no security code to remember.

1. **Create `ai/features/<name>.ts`** exporting an `AIFeatureDefinition`:

   | Member | Purpose |
   |---|---|
   | `descriptor` | governance: owner, capability, allowed actor types and channels, limits, guard rules |
   | `inputValidator` | the exact shape accepted from callers; undeclared keys are dropped |
   | `buildVariables` | validated input → prompt variables |
   | `parseOutput` | raw model content → your typed output |
   | `resolvePromptId?` | only if the input selects between sibling prompts |
   | `buildConversation?` | only for multi-turn features |
   | `applyFactLock?` | restore authoritative fields the model must not decide |

2. **Register it** in `ai/features/index.ts` and add its id to `FEATURE`.

3. **Grant the capability** to the roles that should have it, in
   `ROLE_CAPABILITIES` (`ai/security/actor.ts`). A capability nobody holds is a
   feature nobody can call.

4. **Bind a route** in `aiRoutes.ts` with one `featureRoute(path, FEATURE.x)`
   line — if you find yourself writing more than that, the logic belongs in the
   feature definition or the control plane.

5. **Test it** in `ai/__tests__/features.test.ts` (validator, variables, parse,
   fact lock) and add it to the "routes every registered feature through the same
   path" case in `controlPlane.test.ts`.

### Choosing limits

Use `INTERACTIVE_LIMITS` or `HEAVY_LIMITS` from `ai/policy/featureCatalog.ts`.
A feature that uses neither is stating it is genuinely different — say why in a
comment. The catalog rejects a descriptor whose organization limit is below its
actor limit, or whose JSON feature does not require structured output, at
bootstrap rather than at runtime.

---

## 3. Adding or changing a prompt

**No production prompt may exist outside `ai/prompts/catalog.ts`.**

- Compose the system prompt from the shared governance fragments (`FACT_LOCK`,
  `NO_FABRICATION`, `TONE`, `JSON_ONLY` / `TEXT_ONLY`). Do not re-type safety
  language — that is exactly how the pre-Batch-1 codebase ended up with three
  different banned-word lists.
- Declare every `{{variable}}` the template uses. The registry rejects an
  undeclared placeholder *and* a declared-but-unused variable at registration.
- **Changing text is a version bump.** Never edit a released version in place: a
  completion audited last quarter must stay attributable to the exact text that
  produced it, and `requireVersion()` keeps old versions resolvable for replay.
- Templates are documents, not programs. `{{variable}}` substitution only — no
  conditionals, no loops. Anything needing logic goes in `buildVariables`, where
  it is typed and testable.

---

## 4. Local development without vendor credentials

```bash
AI_ENABLE_MOCK_PROVIDER=true supabase functions serve
```

The mock provider serves every feature deterministically. Force a failure mode
by embedding a directive in prompt text: `[[scenario:timeout]]`,
`unavailable`, `rate_limited`, `auth_failed`, `invalid_json`, `missing_fields`,
`empty`, `guarantee_language`, `jargon`, `oversized`, `fail_once`, `hang`.

Scenarios are read from prompt text rather than request metadata on purpose:
metadata travels through the same envelope in production, so a metadata-driven
switch would be a production-reachable behaviour toggle.

---

## 5. Verifying a change

```bash
npm run test:ai         # control plane suite
npm run test:security   # security + governance subset
npm run test:features   # feature regression
npm run test:system     # manifest + system map authority + AI boundary scan
npm run typecheck       # web, api (deno check), tests
npm run verify:ai       # runtime assembly probe
npm run verify:openai   # OpenAI production proof — PREFLIGHT, no network
npm run verify:anthropic # Anthropic production proof — PREFLIGHT, no network
```

The two `verify:*` proofs are preflight-only without `--live`. Adding `--live`
executes exactly one paid request and requires a configured credential and
`AI_ALLOW_REAL_REQUESTS=true`; neither script will set that switch for you.

Then confirm `GET /ai/health`:

| Status | Meaning |
|---|---|
| `healthy` | at least one production-ready provider is eligible |
| `degraded` | serving is possible but on reduced redundancy, or only on a non-production provider — **completions may be synthetic** |
| `unhealthy` | no provider can serve a request (503) |
