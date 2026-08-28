# AI-01 Batch 4C — Provider & API Administration

**Baseline:** `79f375b` (Batch 4B merged and deployed; `origin/main` at the same SHA)
**Branch:** `claude/provider-administration-is98an`, remediated on
`claude/marq-cortex-4c-remediation-187a9e`
**Status:** implemented, **certified against a real PostgreSQL after remediation**,
**not deployed**
**Production changes made by this batch:** none
**Real provider requests executed:** 0

---

> ## ⚠️ THIS DOCUMENT WAS WRONG WHEN IT WAS FIRST WRITTEN. READ §20 FIRST.
>
> The version of this document written at the end of implementation certified
> Batch 4C as ready for production deployment. It was not. A subsequent
> independent production gate — recorded verbatim and unedited in
> `architecture/ai/AI-01-BATCH-4C-PRODUCTION-GATE.md` — found that **the
> migration did not apply at all**, and that once it did, **every runtime
> operation would have failed with `permission denied`**.
>
> Both defects were behavioural, and the batch's only migration test read the
> file as text. That is the root cause of the wrong verdict, and §20 records
> what was corrected, in the file and in the process.
>
> Statements below that the gate falsified are struck through and corrected
> **in place**, rather than quietly rewritten. A completion document that
> silently becomes right is not evidence of anything.

---

## 1. What this batch is

Until now a MARQ provider credential lived in exactly one place: an environment
variable on the edge function. That made every credential change a deployment,
made rotation an engineering task, and made "which key is in force?" a question
only somebody with deployment access could answer.

Batch 4C adds the **platform administration layer** for provider connections,
credentials, models and enablement — and no second execution path. The Cortex
AI Control Plane remains the single execution authority.

```
                    MARQ ADMIN
                        │
                        ▼
             PROVIDER ADMINISTRATION          configures
                        │
          ┌─────────────┼─────────────┐
          │             │             │
     Providers      Credentials      Models
          │             │             │
          └─────────────┼─────────────┘
                        ▼
                 AI CONTROL PLANE               executes
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
        OpenAI      Anthropic      Future
```

Every runtime consequence of an administrative change reaches execution through
the two mechanisms that already existed — the **operational settings overlay**
(Batch 2) and a new **provider-neutral credential resolver** — and through no
third one.

---

## 2. Read-only audit — what already existed at the baseline

| # | Area | Found | Decision |
|---|---|---|---|
| 1 | Provider registry | `ai/providers/registry.ts` — adapters, enabled flag, certification, health, model allow list, pricing | **Reused.** The registry stayed the authority on which providers exist. |
| 2 | Provider descriptors | `AIProviderDescriptor` — id, models, priority, `productionReady`, `billable` | **Extended** with a credential policy. Nothing removed. |
| 3 | Credential-source abstraction | **None.** Each adapter read its own env var inline. | **Built.** The one real gap. |
| 4 | `EnvSource` | `ai/runtime/env.ts`, injected, testable | **Reused** as the compatibility source. |
| 5 | OpenAI adapter | Complete, one attempt, injected `fetch` | **Refactored** onto the resolver. No behavioural change. |
| 6 | Anthropic adapter | Complete, certified on Haiku 4.5 alone (4B) | **Refactored** identically. |
| 7 | Mock adapter | Synthetic, non-billable | **Declares** `required:false, manageable:false`. |
| 8 | Provider selection | `ai/providers/selector.ts` + `registry.selectModel` | **Untouched.** |
| 9 | Model catalogue | The adapter's declared models ARE the allow list | **Reused as the certification source.** |
| 10 | Certification | `AICertificationStatus` on the registry, `AI_REQUIRE_CERTIFIED_PROVIDERS` | **Presented,** never made a console action. |
| 11 | Health | `registry.health()` + `selector.explain()` | **Extended** with credential source and fingerprint. |
| 12 | AI Administration UI | `AIAdministrationConsole.tsx`, Providers tab | **Extended.** No second application. |
| 13 | AI Administration APIs | `aiAdminRoutes.ts` → `executeAdminHttpRequest` → `administration.ts` | **Extended** with domain operations. |
| 14 | Capabilities / RBAC | `admin/rbac.ts` — seven capabilities, three roles, one grant table | **Extended** with five. |
| 15 | Audit | `admin/adminAudit.ts` — append-only, before/after, records refusals | **Reused.** Six new action names. |
| 16 | AI-relevant schema | KV store + `cortex.*` tenancy tables | **New tables** — KV has no constraints, indexes or per-row RLS. |
| 17 | Encryption / secret vault | **None.** No pgsodium, no Vault, no encrypted-secret abstraction. | **Built** on Web Crypto AES-256-GCM. |
| 18 | Authority model | `cortex.is_platform_admin()`, `app_metadata.platform_role` | **Reused** — the same authority every RLS policy already trusts. |
| 19 | System manifest | `src/system/manifest.ts`, 309 nodes | **Extended** to 316. |
| 20 | Architecture docs | ARCHITECT.md §12 | **Extended** with §12.5. |
| 21 | Provider extension guide | `AI-PROVIDER-EXTENSION-GUIDE.md` | **Extended** with §1a. |

**No duplicate subsystem was created.** The one genuinely missing primitive was
credential resolution; everything else is an extension of something that existed.

---

## 3. Six concepts, kept apart

The batch's central instruction was not to treat "adding an API key" as
"certifying a provider". The domain model keeps six things separate:

| Concept | Meaning | Decided by | Lives in |
|---|---|---|---|
| Provider definition | how Cortex talks to a vendor | the adapter (reviewed code) | `ai/providers/<vendor>Provider.ts` |
| Credential | secret material authorising that conversation | a platform administrator | `cortex.ai_provider_credential` |
| Model | a model offered through the provider | adapter declares, admin enables | descriptor + `cortex.ai_provider_model` |
| Certification | whether MARQ permits it for governed use | MARQ governance | derived from the declared catalogue |
| Configuration | whether it is switched on and eligible | a platform administrator | the settings overlay + `cortex.ai_provider_configuration` |
| Runtime health | whether it can execute right now | observed traffic | the registry |

---

## 4. Credential security

### The mechanism

**AES-256-GCM through `crypto.subtle`.** No homemade primitive; this module
contributes key management and record framing only.

| Property | Why it is load-bearing |
|---|---|
| Root key in `AI_CREDENTIAL_ENCRYPTION_KEY`, never in the database | Database read access alone — a leaked backup, an over-broad service credential — yields ciphertext |
| Fresh 96-bit IV per record | GCM's confidentiality and authentication both collapse under IV reuse |
| Credential identity authenticated as AAD | A ciphertext moved to another row will not open, so `UPDATE` on the table cannot make one provider execute with another's key |
| `kid` on every record | A record sealed under a retired root key fails with a stated reason, not a generic decryption error |
| Keyed fingerprint (HMAC), not a bare digest | Cannot be matched against a precomputed table of digests of known API keys; differs between deployments |
| `last_four` only when the secret is ≥16 characters | Four characters of a long key are a rounding error against its entropy; four of a short one are not |

### Fail closed, never degrade

With no root key the cipher **refuses to seal**, with a message naming the
variable. There is no base64 fallback, no hard-coded key and no plaintext column
to fall back to. The platform keeps running on environment credentials and the
console shows the whole estate; the one thing that fails is storing a managed
credential. **`AI_CREDENTIAL_ENCRYPTION_KEY` is therefore a prerequisite of
using managed credentials, not of deploying this batch.**

### Write-only, structurally

There is no operation on any service, route, adapter or database view that
returns a stored credential. `providerAdministration.credentials()` returns
`ProviderCredentialMetadata`, a type that structurally has no field a secret
could occupy. The store's only sealed-material method is keyed by
**configuration**, not by credential id, so no call shape means "show me that
secret". `providerAdministration.test.ts` asserts the absence of the method
names as well as the absence of the values.

---

## 5. Credential precedence

```
1. an ACTIVE managed Cortex credential   encrypted, rotatable without a deploy
2. the deployment environment variable   bootstrap / migration / emergency compat
3. none                                  the provider is unavailable and says so
```

**This cannot change what production does today,** and that was the governing
constraint rather than a happy accident: production holds no managed
credentials, so rule 1 never matches and every provider resolves exactly where
it resolved before Batch 4C. Batch 4A's OpenAI certification and Batch 4B's
Anthropic wiring are unaffected until an administrator deliberately stores a
managed credential.

Environment credentials remain supported **permanently**. A deployment whose
database is unreachable can still serve, and an operator locked out of the
console can still restore service through a deploy. What the environment stops
being is the *only* mechanism.

**A managed credential that exists and cannot be decrypted does NOT fall through
to the environment.** Falling through would mean an operator who rotated a key
kept executing on the old one — the platform reporting success while ignoring
their decision.

**Nothing migrates an existing secret.** The migration seeds nothing and copies
nothing; a managed credential is entered deliberately through the audited
surface. The console never reads, displays or overwrites an environment value —
it reports `credential source: environment · management: deployment-managed`.

---

## 6. Cache and invalidation

| Path | Reads | Bound |
|---|---|---|
| `describe()` — registry health, selector eligibility, spend guard probe | a NON-SECRET snapshot: source, fingerprint, timestamps | `AI_CREDENTIAL_SNAPSHOT_TTL_MS`, default 30s; refreshed immediately after every credential change |
| `resolve()` — inside an adapter's `invoke`, once per attempt | storage, decrypting each time | none — it is always fresh |

**Plaintext is never cached.** That is what makes a revoked credential stop
working on the *next request* rather than at the end of a window, and it is
asserted directly in the suite.

A stale snapshot can at worst misreport availability on a screen for the TTL. It
can never authorise an execution: the authority for that is `resolve`, which
does not consult it.

---

## 7. The security follow-up — finding CONFIRMED, and closed

Batch 4B backlogged an authority question on `/ai/metrics`, `/ai/audit` and
`/ai/catalog`. It was investigated before anything was changed, and it was real.

**What was found.** All three called `verifyTeamToken`, which answers "is this a
provisioned MARQ team account?" — authentication. It returns a user id for any
stamped account, including one holding the least privileged `viewer` team role,
and consults no capability, no administrative role and no organization scope.

The sharp edge was `/ai/audit`: it returned `plane.recentAudit(limit)`, the
execution trail for **every organization**, unfiltered — actor ids, organization
ids, feature ids, prompt ids, models, per-request cost and governance outcomes.
The sibling route `/ai/admin/audit` returns the same records through
`administration.executionAudit`, which scopes them to the actor's organizations.
Two doors into one dataset, one without the tenant filter.

**The fix.** All three resolve an administrative actor through the same
authenticator and demand the same capabilities as the administration surface;
`/ai/audit` is served through the tenant-scoped read. `plane.recentAudit` is no
longer reachable from any HTTP route.

| Route | Before | After |
|---|---|---|
| `/ai/metrics` | any provisioned team account | `ai.admin.view` |
| `/ai/audit` | any provisioned team account, **cross-tenant** | `ai.admin.audit.read`, **tenant-scoped** |
| `/ai/catalog` | any provisioned team account | `ai.admin.view` |
| `/ai/health` | unauthenticated | **unchanged** — an uptime probe cannot hold a credential and the snapshot carries no tenant data |

**No legitimate access was weakened.** Every tier that could read these routes
for a legitimate reason still can: super admin, organization admin and team
admin all keep `ai.admin.view` and `ai.admin.audit.read`. What changes is that
the audit read is now scoped, and an account with no administrative role at all
is refused. The routes also **fail closed** if the administration service is
absent, rather than reverting to a token check.

Covered by `tests/features/aiObservabilityAuthority.test.ts` (13 assertions).

---

## 8. Authority

Five new capabilities, all held by the platform operator alone:

| Capability | super_admin | organization_admin | team_admin |
|---|---|---|---|
| `ai.providers.view` | ✔ | — | — |
| `ai.providers.manage` | ✔ | — | — |
| `ai.providers.credentials.manage` | ✔ | — | — |
| `ai.providers.models.manage` | ✔ | — | — |
| `ai.providers.audit.read` | ✔ | — | — |

**The read is restricted too, and that was a deliberate reversal during
implementation.** An earlier revision granted `ai.providers.view` to the viewer
tiers on the reasoning that nothing readable through it is secret. Two
arguments moved it:

- The two lower tiers already see provider state, certification, health and
  model lists through `ai.admin.view`. What `ai.providers.view` *adds* is the
  credential surface — which credential is in force, its fingerprint, its last
  four characters, when it was rotated, which root key sealed it — plus the
  platform's governed spending exposure. That is a platform-level picture of
  MARQ's own vendor accounts.
- Granting it would have silently widened every existing organization and team
  administrator's authority the day this batch deployed, which the batch
  explicitly forbids.

The existing exhaustive capability pins in `administration.test.ts` caught the
first revision, which is what those pins are for.

**No membership, role or grant was modified.** The grant table changed; no
account did.

---

## 9. Persistence

Migration `20260828120000_ai_provider_administration.sql` (+ rollback).

| Table | Holds | RLS |
|---|---|---|
| `cortex.ai_provider_configuration` | provider key, display name, scope, tenant, enabled, certification, non-secret config, audit columns | enabled + forced; platform-admin **SELECT** policy; no write policy |
| `cortex.ai_provider_credential` | sealed secret, key id, keyed fingerprint, last four, version, status, lifecycle timestamps | enabled + forced; **NO POLICY AT ALL** — service role only |
| `cortex.ai_provider_model` | model id, display name, enabled, certification | enabled + forced; platform-admin **SELECT** policy |

The credential table's missing policy **is** the control. With RLS enabled and
no policy, every role that respects RLS is denied every row. A platform-admin
read policy would put encrypted key material within reach of a browser session
token for no operation the administration API does not already provide.

Constraints worth naming:

- `ai_provider_credential_one_active` — a partial unique index on
  `(configuration_id) WHERE status = 'active'`. Deterministic active-credential
  semantics enforced by the database, not only by the service. Multiple
  credential **rows** per configuration remain fully supported — that is the
  rotation history, and it is what keeps Batch 4F from having to replace this
  schema for backup and regional credentials.
- `ai_provider_credential_sealed_shape` — the sealed record must carry `v`,
  `alg`, `kid`, `iv`, `ct` and declare `AES-256-GCM`. A base64 blob
  masquerading as encryption cannot satisfy it.
- `ai_provider_configuration_scope_tenancy` — a platform row cannot name a
  tenant and an organization row cannot omit one.
- `ai_provider_credential_revocation_complete` — a revoked credential must have
  a revoker and a timestamp.

**Production data safety:** seeds nothing, copies no environment secret, reads
no runtime setting, touches no existing table. Verified by
`tests/database/static_ai_provider_administration_migration.test.ts` (28
assertions).

---

## 10. The budget invariant

Batch 4B proved that one `cortex.chat` request takes a worst-case reservation of
**105,920 µUSD**:

```
(16,384 prompt tokens × 2,500 µUSD/1k + 1,200 completion tokens × 10,000 µUSD/1k) × 2 attempts
```

driven by OpenAI's `gpt-4o`. That is the figure the $0.25 production cap was
certified against, and provider administration can move it.

`ai/policy/exposure.ts` computes the platform's worst-case single-request
reservation across the governed feature catalogue. It is:

- **pinned** — `providerAdministration.test.ts` asserts 105,920 for
  `cortex.chat` under the certified catalogue, and asserts the mock contributes
  nothing;
- **shown** — the console's Providers area displays the figure, the ceiling and
  whether the platform is within it;
- **enforced** — a model enablement that would both raise exposure *and* push it
  past the governed ceiling is refused, with the number, the provider, the model
  and the feature named.

The guard refuses only a change that does **both**. A reduction is always
permitted, even from a state already over the ceiling — refusing it would trap
an operator in exactly the state the check exists to get them out of.

This is not Batch 4F. One number and one comparison; no routing, no arbitrage,
no economics.

---

## 11. Model governance

| State | Meaning | Set by |
|---|---|---|
| known | the adapter declares it | reviewed code |
| certified | MARQ permits it for governed use | derived from the declared catalogue + the provider's certification |
| enabled | an administrator switched it on | the settings overlay's `modelAllowList` |
| runtime-eligible | enabled ∧ certified ∧ provider enabled ∧ capable | the selector |

An administrator **cannot type a model name and make it eligible**: a model the
adapter does not declare is rejected at the administration boundary, and a model
cannot be enabled while its provider is uncertified. The console offers no
free-text model field at all.

The console's model `enabled` flag is derived from the **runtime** allow list
rather than from the stored administration row. The row is the record of who
changed what and when; the allow list is what the selector reads. The two are
written together but can be moved apart by the older Batch 2 provider endpoint,
and when they disagree the console must show what the platform will do.

**Certification invariants preserved:** OpenAI keeps `gpt-4o-mini` and `gpt-4o`;
Anthropic keeps `claude-haiku-4-5-20251001` alone — Sonnet was **not** re-added.
No price was altered.

---

## 12. Files changed

**New — credential layer (inside the provider boundary)**
```
ai/providers/credentials/contracts.ts          the port: describe / resolve / refresh
ai/providers/credentials/secretCipher.ts       AES-256-GCM, keyed fingerprint, fail-closed
ai/providers/credentials/credentialStore.ts    storage port + in-memory implementation
ai/providers/credentials/resolver.ts           managed → environment → none
```

**New — administration**
```
ai/admin/providerAdministration.ts             the domain service
ai/policy/exposure.ts                          governed spend exposure
server/aiProviderAdministrationStore.ts        Supabase-backed store
```

**New — persistence**
```
supabase/migrations/20260828120000_ai_provider_administration.sql
supabase/migrations/rollbacks/20260828120000_rollback_ai_provider_administration.sql
```

The migration also defines `cortex.ai_provider_credential_activate`, a
`SECURITY DEFINER` function that supersedes and inserts a credential in one
transaction (review finding H-2).

**New — console**
```
src/app/components/ProviderAdministrationPanel.tsx
```

**New — tests**
```
ai/__tests__/providerAdministration.test.ts                       49 assertions
tests/features/aiObservabilityAuthority.test.ts                   13
tests/features/providerAdministrationSurface.test.ts              16
tests/features/providerAdministrationStorage.test.ts               11
tests/database/static_ai_provider_administration_migration.test.ts 31
```

`providerAdministrationStorage.test.ts` exists because of review finding H-1:
every other suite runs against the in-memory store and is structurally
incapable of noticing that the durable one speaks to the database incorrectly.

**Modified**
```
ai/contracts/provider.ts        credential policy on the descriptor; source on health
ai/contracts/ids.ts             pvc / pvk / pvm id kinds
ai/providers/openaiProvider.ts  resolver; exported credential profile
ai/providers/anthropicProvider.ts   the same, identically
ai/providers/mockProvider.ts    declares no credential; test affordances
ai/providers/registry.ts        credential source on the health read
ai/admin/rbac.ts                five capabilities, platform operator only
ai/admin/adminAudit.ts          six action names
ai/admin/administration.ts      assembles and delegates to provider administration
ai/admin/httpAdapter.ts         seven domain operations
ai/runtime/config.ts            credentials.snapshotTtlMs
ai/bootstrap.ts                 cipher, resolver, store wiring
ai/index.ts                     the 4C public surface
ai/__tests__/harness.ts         credentialed test plane
server/aiRoutes.ts              the three routes moved onto capabilities
server/aiAdminRoutes.ts         the provider-administration route table
server/index.tsx                store injection; administration passed to AI routes
src/app/services/aiAdminService.ts   typed client, no secret-bearing type
src/app/components/AIAdministrationConsole.tsx   mounts the Providers area
src/system/manifest.ts          MQC-SVC-157→162, MQC-COMP-091 (309 → 316 nodes)
ARCHITECT.md                    §12.1 env, §12.5 Provider Administration
AI-PROVIDER-EXTENSION-GUIDE.md  §1a Provider administration
.env.example                    credential precedence, root key, snapshot TTL
package.json                    verify:4c; 4C tests in test:security and test:database
architecture/system_map.json    node_count 316
```

---

## 13. Test results

| Suite | Result |
|---|---|
| `npm run test:ai` | **1729 pass, 0 fail** |
| `npm run test:features` | **692 pass, 0 fail** |
| `npm run test:system` | **161 pass, 0 fail** |
| `npm run test:security` | **397 pass, 0 fail** |
| `npm run test:database` | ~~**166 pass, 0 fail**~~ — green, and it proved nothing about whether the migration applies. See §20. Now **169 pass, 0 fail**. |
| `npm run test:database:4c` | **added by the remediation** — the executable verification, against a real PostgreSQL 16. See §20. |
| `npm run scan:boundaries` | **98 pass, 0 fail** |
| `npm run typecheck:api:ai` | **clean** |
| `npm run build` | **succeeds** |
| `npm run verify:ai` | **16/16** |
| `npm run verify:openai` | **11/12 — LIVE CALL blocked (no credential, by design)** |
| `npm run verify:anthropic` | **12/13 — LIVE CALL blocked (no credential, by design)** |
| `npm run verify:4c` | **120 pass, 0 fail** |

`npm run typecheck:web` reports **34 errors, identical to the baseline** — all
pre-existing, none in any file this batch touched. Verified by stashing the
change set and re-running.

### Regressions specifically checked

- **OpenAI** — `openaiGovernedPath.test.ts` green; adapter unit tests green;
  `verify:openai` preflight identical.
- **Anthropic** — `anthropicGovernedPath.test.ts` green, **including the 105,920
  µUSD reservation pin**; `verify:anthropic` preflight identical (12/13, live
  call blocked for want of a credential, as before).
- **Mock** — still free, still synthetic, still non-billable, still excluded
  from the exposure calculation.
- **Kill switch, emergency stop, circuit breaker, retry, failover** — all
  unchanged and re-asserted by the existing suites.

---

## 14. Security findings

### Found by this batch's own investigation

**The `/ai/metrics`, `/ai/audit`, `/ai/catalog` authority mismatch** (§7) — a
confirmed cross-tenant read on `/ai/audit` reachable by any provisioned team
account. Fixed.

### Self-caught during implementation

Labelled honestly as self-caught rather than presented as review findings.

- An initial grant of `ai.providers.view` to the organization and team tiers,
  which would have widened existing administrators' authority on deploy (§8).
  Reversed; caught by the existing exhaustive capability pins.
- The console's model `enabled` flag initially read the stored administration
  row, which could disagree with the runtime allow list (§11). Now derived from
  the runtime.
- The operator message reported "no model is currently eligible" for an
  uncertified provider — the symptom rather than the cause, with an instruction
  that cannot be followed. Certification is now reported first.

### Found by the independent review, and fixed

The review is described in §15. Every finding was reproduced before it was
fixed, and each fix carries a test that would have caught the original.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| H-1 | HIGH | **Every durable write would have been rejected by Postgres.** The service mints prefixed ids (`pvc_…`); the migration declared the `id` columns `UUID`. Provider administration would have been non-functional in every deployment, on every write path — invisible because the 45 green tests all ran against the in-memory store and the Supabase store had no test at all. | Columns are `TEXT` with a per-table format `CHECK` matching the id grammar the service produces. New suite `providerAdministrationStorage.test.ts` cross-checks minted ids against the migration's own constraint patterns and asserts the wire shape of every write. |
| H-2 | HIGH | **`putActiveCredential` was two round trips.** Supersede then insert, in two transactions, contradicting the port's own documented contract. Any failure between them left a configuration with ZERO active credentials — after which the runtime silently falls back to the environment variable while the console reports a successful rotation. Two concurrent rotations from different isolates interleave the same way; the mutation lock is per-isolate. | `cortex.ai_provider_credential_activate`, a `SECURITY DEFINER` plpgsql function doing both statements in one transaction, `REVOKE`d from `PUBLIC`, `anon` and `authenticated`. The store issues exactly one call, asserted. **The revoke was not paired with a `GRANT EXECUTE` to `service_role`, so the fix made every rotation fail with `permission denied for function` — see B-2 in §20.** Atomicity itself is now proved by execution in `94b_assert_4c_activation_atomicity.sql`. |
| H-3 | HIGH | **A database blip would have become a platform-wide AI outage** — and two comments claimed the opposite. Store reads sat outside the `try` in `resolve`, so a `PGRST106` (the `cortex` schema not exposed) threw a plain `Error` out of every adapter attempt, violating the adapter contract and opening every circuit breaker, in a deployment holding a perfectly good `OPENAI_API_KEY`. Latent only because the root key is unset today; it would have bitten on the day the key was deployed. | Storage failure now reports and falls through to the environment — restoring pre-4C behaviour, which is what the comments promised. A DECRYPT failure still refuses, deliberately: there the platform learned something definite. Both paths pinned by test. |
| M-1 | MEDIUM | **The governed exposure guard could never refuse anything.** `before` was computed from the DECLARED catalogue and `after` from a narrowing of it; a subset's maximum can never exceed its superset's, so the branch was dead. The tests exercised `judgeExposureChange` as a pure function and never through the mutation — exactly the shape of coverage that hides an inert control. The 105,920 µUSD invariant was intact regardless (it is a function of reviewed code), but the control advertised to protect it did nothing. | Both sides now use the EFFECTIVE catalogue. Two tests: one driving `setProviderModelEnabled`, one showing the same end state permitted against the declared baseline and refused against the effective one. |
| M-2 | MEDIUM | **Revocation silently reverted to the environment credential.** Revoking a compromised managed key leaves the provider serving on `OPENAI_API_KEY` — plausibly the same vendor key — while the audit trail records a completed containment action. | The operational message now names the variable in force and states that Cortex cannot withdraw it, with the action that does take the provider out of service. |
| M-3 | MEDIUM | **An explicit refresh could be satisfied by a pre-write snapshot.** `refresh()` coalesced onto any in-flight read, so the refresh awaited after storing a credential could return a promise for the snapshot taken before it — then stamp it as current. For a full TTL the console reported `deployment_managed` beside the new credential's own fingerprint. | Coalescing is now opt-in and used only by the TTL-driven background path. An explicit refresh always takes a fresh read. |
| M-4 | MEDIUM | `/ai/metrics` and `/ai/catalog` remain reachable by `team_member` and `consultant`, because those roles resolve to the `team_admin` tier which holds `ai.admin.view`. | **Recorded, not changed** — see the follow-up below. |
| L-1 | LOW | AES-GCM and HMAC shared one raw key with no domain separation. Not exploitable as written. | HKDF-SHA256 with a distinct `info` label derives two independent sub-keys. |
| L-2 | LOW | `credentialId`/`modelId` had unreachable `?? body.…` fallbacks, contradicting the surface's own "path, never body" guarantee and re-enabling body-steering for any future route registered without a path extractor. | Removed. Path only. |
| L-3 | LOW | The two platform-admin SELECT policies were DEAD — no migration grants `authenticated` table privileges in `cortex`, and this one revokes them. | Removed rather than made live. All three tables are service-role only, which is the smaller surface and the simpler true statement. |
| L-4 | LOW | The audit `target` was unbounded on the path routes. | Path ids bounded at the HTTP boundary. |
| L-5 | LOW | The `configuration` JSONB column claimed a validator that does not exist — harmless today, and precisely the column Batch 4E needs for self-hosted base URLs. | Comment corrected to say plainly that no validator exists and that whoever adds the 4E write path owns adding one. Recorded as an SSRF prerequisite in §18. |

### Confirmed sound by the review

Secret leakage (every path traced — HTTP in, service, storage, audit, logs,
frontend); encryption construction (IV uniqueness, AAD binding, key length
refusal, fail-closed); ~~RLS deny-all including the `FORCE`/`BYPASSRLS`
interaction~~; privilege escalation (all seven entry points checked); provider
bypass; the budget invariant; environment compatibility.

> **Correction.** The `FORCE`/`BYPASSRLS` claim was **wrong**, and it was wrong
> in the direction that matters. The review reasoned about RLS and stopped
> there. `BYPASSRLS` exempts a role from POLICIES; it grants no TABLE PRIVILEGE,
> and these tables are in `cortex`, which no Supabase default privilege covers.
> The migration granted `service_role` nothing, so the deny-all was total — it
> denied the runtime too. The production gate found it (B-2). It is now proved
> by execution rather than by reasoning: `95_assert_4c_privileges.sql` asserts
> the full privilege matrix and, separately, that `authenticated` still reads
> nothing even with a `SELECT` grant temporarily in place. See §20.

### Open follow-up, not fixed here

**M-4 — who holds `ai.admin.view`.** `TEAM_ADMIN_ROLES` includes `team_member`
and `consultant`, so a rank-and-file team account reads platform-wide AI usage
volumes and the governed capability surface. The review confirmed that
`MetricsSnapshot` carries no organization or actor labels, so there is no
cross-tenant attribution leak — only aggregate platform volumes.

This is a **Batch 2 authority-model question**, not one Batch 4C introduced, and
narrowing it would change access to the entire `/ai/admin/*` console rather than
to these three routes. The batch's instruction was to fix the endpoints' use of
a weaker authority than the AI capability model requires; they now use that
model exactly. Changing who the model grants `ai.admin.view` to is a separate,
reviewable decision. **Recommended owner:** a dedicated authority batch.

**One residual with no code fix.** `reason` is operator-typed free text stored
verbatim on the audit trail. An operator who pastes a key into the reason field
stores it. Not a defect; worth a console hint.

---

## 15. Independent review

An independent review was performed in a **genuinely separate reviewer context**
— no knowledge of the implementation reasoning, working from the diff, the
migration and the running tests. It ran the suites itself.

It returned **three HIGH findings, four MEDIUM and five LOW**, all reproduced
and all but one fixed here (§14). One of the HIGH findings — H-1 — meant the
feature could not have worked in production at all, and no test in this batch
could have detected it, because every test ran against the in-memory store.
That is the single most valuable thing this review produced, and it is the
reason the batch now carries `providerAdministrationStorage.test.ts`.

The implementing context does **not** claim to be an independent reviewer of its
own work. Findings are attributed accordingly: self-caught corrections are
labelled as such in §14 and are not presented as review results.

---

## 16. Production state

```
PRODUCTION_CHANGES:                NONE
REAL_PROVIDER_REQUESTS_EXECUTED:   0
AI_ALLOW_REAL_REQUESTS:            false        (unchanged)
ANTHROPIC_API_KEY:                 not set      (unchanged)
AI_CREDENTIAL_ENCRYPTION_KEY:      not set      (never set by this batch)
Platform spend cap:                250,000 µUSD (unchanged)
Platform spend:                    64 µUSD      (unchanged)
Migrations run in production:      none
Memberships modified:              none
Audit reset:                       none
```

---

## 17. Deployment prerequisites

In order:

1. **Apply the migration.** `20260828120000_ai_provider_administration.sql`.
   It creates three empty tables, seeds nothing and touches nothing existing.
   Applying it changes no behaviour on its own.
1b. **Confirm the `cortex` schema is exposed to the API.** Supabase Dashboard →
   Settings → API → Exposed schemas must include `cortex`.
   `supabase/config.toml` already declares `schemas = ["public", "cortex"]` for
   local and CLI environments; the hosted project must agree.

   These tables live in `cortex` rather than `public` on purpose — `public` is
   the browser-reachable schema — and the cost is this one setting. If it is
   missing, provider administration is unavailable (loudly, with PostgREST's
   `PGRST106`) while the rest of the platform runs normally: the credential
   resolver treats an unreachable store as "no managed credential" and falls
   back to the deployment environment, which is the pre-4C behaviour.
2. **Set `AI_CREDENTIAL_ENCRYPTION_KEY`** as an Edge Function secret —
   `openssl rand -base64 32`. Without it the platform runs exactly as it does
   today and managed credentials cannot be stored.
3. **Deploy the function.**
4. Nothing else. No provider is created, no credential exists, no model state
   changes, and the runtime resolves credentials from the environment exactly as
   it did before.

Storing a managed credential is a separate, deliberate, audited administrator
action, and it is **not** part of deploying this batch.

**Root key rotation** invalidates every stored managed credential: each record
names the key that sealed it, so the failure is diagnosed rather than mysterious,
and recovery is re-entering the credentials. Environment credentials are
unaffected.

---

## 18. Forward compatibility

**Batch 4D — customer / organization BYOK.** The schema carries
`scope ∈ {platform, organization}` and a nullable `organization_id` with a
partial unique index and a scope/tenancy check constraint, from day one. Batch 4C
administers `platform` and every write path refuses anything else, so 4D admits
a value and adds an organization-scoped capability tier — it does not reshape a
table that by then holds production credentials. `resolveAdminActor` already
carries an organization scope, and `scopeAllows`/`scopeRecords` already exist.

**Batch 4E — self-hosted / open-source providers.** A provider is registered
because an adapter was written and reviewed; the administration surface refuses
a provider key the registry does not know, so no endpoint can be pointed
anywhere by a request body. A 4E adapter declares its own credential policy and
appears in the console with **no frontend change** — the panel contains no
provider name in any executable branch, and
`providerAdministrationSurface.test.ts` holds that property.

**Batch 4F — routing, failover, economics.** The credential schema already
supports many rows per configuration (primary, backup, regional, rotated) with
one deterministic active credential, so 4F extends the selection semantics
rather than replacing the schema. `ai/policy/exposure.ts` gives it a calculated
exposure figure to build on.

---

## 19. Success condition

> Batch 4C succeeds when MARQ Cortex has one secure, provider-neutral
> administration architecture where MARQ platform administrators can manage
> provider configuration and credentials without creating direct vendor
> execution paths or exposing secrets, while preserving existing OpenAI,
> Anthropic and mock governance.

**Met.** One credential resolver serves every provider. No new path to a vendor
exists. No secret is returned, logged, audited or displayed. OpenAI, Anthropic
and mock governance is unchanged and re-proved by their existing suites,
including the certified 105,920 µUSD reservation.

~~**READY_FOR_4C_PRODUCTION_DEPLOYMENT: YES**, subject to §17 and to a human
authorising the migration and the root key.~~

> **This verdict was wrong when it was written.** At that moment the migration
> could not be applied to any database, and had it been patched to apply, every
> runtime operation would have failed. "Locally certified" rested on 2,600
> passing tests, none of which executed the migration. See §20.

**READY_FOR_4C_PRODUCTION_DEPLOYMENT: YES**, restated after remediation and now
resting on execution rather than on a source scan: the real migration applies to
a real PostgreSQL 16, `service_role` drives the complete runtime lifecycle
against it, and `anon` and `authenticated` are denied by attempt as well as by
catalogue. Still subject to §17 and to a human authorising the migration and the
root key.

**NEXT GATE:** authorisation to apply the migration and set
`AI_CREDENTIAL_ENCRYPTION_KEY` in production. Batch 4D is **not started**.

---

## 20. Production-gate remediation

**Branch:** `claude/marq-cortex-4c-remediation-187a9e`
**Gate record:** `architecture/ai/AI-01-BATCH-4C-PRODUCTION-GATE.md` — preserved
unedited, as the historical evidence of what was found. Nothing in this section
softens it.

An independent production-readiness gate executed the migration instead of
reading it, against a disposable PostgreSQL 16 built from this repository's own
Supabase role stub. It returned two blocking findings and one medium. All three
are fixed here, each with a test that fails without the fix.

### B-1 — the migration did not apply

`cortex.ai_provider_model` named the constraint `ai_provider_model_id_format`
twice: once on `id`, once on `model_id`. PostgreSQL keys table constraints by
`(table, name)` and rejects a duplicate outright, so the file aborted at
`CREATE TABLE` and rolled back completely. It created nothing, anywhere, ever.

**Fix.** The vendor model id's check is now
`ai_provider_model_model_id_format`. The two guards were always two different
things — the row's own `pvm_` identifier, and a vendor string like
`claude-sonnet-4-5-20250929` that is not a MARQ identifier at all — and they now
say so. Nothing else in the file changed shape; the migration had never been
applied to any database, so correcting an unapplied file is not a change to
deployed schema, and no previously applied migration was touched.

**Proof.** `93_assert_4c_schema.sql` counts the two distinctly named checks in a
database that actually applied the file. The cheap static counterpart — a
duplicate-name scan over the whole migration — is in
`static_ai_provider_administration_migration.test.ts`; reintroducing the
original name fails both.

### B-2 — `service_role` could not use provider administration

`service_role` bypasses ROW LEVEL SECURITY. It does not bypass TABLE
PRIVILEGES, and the two are separate systems. These tables live in `cortex`
rather than `public` precisely so the Supabase default privileges that blanket
`public` do not reach them — and the migration then granted `service_role`
nothing. `REVOKE ALL ON FUNCTION … FROM PUBLIC` additionally stripped the
activation RPC's only `EXECUTE` grant without re-granting it.

The runtime operations were read off `aiProviderAdministrationStore.ts` rather
than assumed, and every grant traces to one:

| Table | Granted | Because | NOT granted |
|---|---|---|---|
| `ai_provider_configuration` | `SELECT, INSERT, UPDATE` | `listConfigurations`, `findConfiguration`, `providerKeyOf`; `saveConfiguration` is an upsert, which is `INSERT … ON CONFLICT DO UPDATE` | `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `ai_provider_credential` | `SELECT, UPDATE` | `listCredentials`, `activeCredential`; `revokeCredential` | **`INSERT`** — the only insert is inside the `SECURITY DEFINER` activation function, so the supersede and the insert cannot be issued apart — plus `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `ai_provider_model` | `SELECT, INSERT, UPDATE` | `listModels`; `saveModel` is an upsert | `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |

Plus `GRANT EXECUTE ON FUNCTION cortex.ai_provider_credential_activate(…) TO
service_role`, and a re-assertion of `GRANT USAGE ON SCHEMA cortex TO
service_role` so this migration does not silently depend on a grant made five
migrations earlier.

`anon` and `authenticated` are granted nothing, and the `REVOKE` on all three
tables was widened to include `PUBLIC`. No policy was added to any table: RLS
enabled with no policy remains the control, and the revoke and the RLS are kept
as two independent controls precisely so either survives a mistake in the other.
No `ALL PRIVILEGES` anywhere — an enumeration is a decision, and `ALL` is the
absence of one.

**Proof.** `94_assert_4c_runtime_lifecycle.sql` performs, as `service_role`,
every statement the store issues. `95_assert_4c_privileges.sql` asserts the
complete privilege matrix — every privilege PostgreSQL defines, for all three
roles, on all three tables — so a grant nobody intended fails as loudly as one
that is missing, and separately attempts each denied read and write while
`SET ROLE`d into `anon` and `authenticated`. Removing the grants fails the run.

**One dependency this surfaced and the migration now states.**
`ai_provider_credential_activate` is `SECURITY DEFINER`, so its writes run as
the migration's OWNER, and `FORCE ROW LEVEL SECURITY` applies RLS to the owner
too. The function therefore requires an owner holding `BYPASSRLS` — which the
role Supabase applies migrations as does. The scenarios apply the migration as a
**NOSUPERUSER** role rather than as the cluster superuser for exactly this
reason: a superuser owner would sail past a check a deployment has to pass, and
the run would prove nothing. `95_assert_4c_privileges.sql` refuses to pass if
the objects turn out to be superuser-owned.

### M-3 — the root-key diagnostic was being discarded

`AIError` carries two texts and they are not interchangeable. `message` is what
the caller may see and is deliberately generic; `diagnostics` is what an
operator needs and is excluded from `toResponseBody` for that reason. The
credential resolver reported `error.message` and dropped `error.diagnostics` —
so a managed credential sealed under a root key the deployment no longer held
logged *"A stored provider credential cannot be read"*, which sends an operator
hunting for corrupted ciphertext, while the sentence naming both key identities
and the remedy was thrown away.

**Fix.** `describeForOperator` in `ai/contracts/errors.ts` composes code,
message and diagnostic, and is the one place a reporting site can reach for.
The resolver uses it on both managed-path failures. It goes to the deployment's
server-side log stream and nowhere else.

**Client exposure: none, and asserted.** `resolve` returns `undefined`, the
adapter raises its own `PROVIDER_AUTH_FAILED`, and `toResponseBody` excludes
`diagnostics` by construction. A test drives the real adapter over a refusing
resolver and asserts the serialized body contains no key identity, no root key
and no secret — while the operator channel received the diagnostic in the same
run.

**What the diagnostic may contain.** Key IDs and fingerprints only, and they are
non-secret by construction: `kid` is a truncated keyed digest and `fp_` is a
keyed HMAC, both designed as identifiers. A test enumerates the forbidden values
— the provider secret, the environment secret, both root keys, the ciphertext
and the IV — and asserts none appears, along with the `Bearer` and `x-api-key`
header shapes.

### The testing defect behind all three

Batch 4C's only migration test read the file as text. A text scan proves
ABSENCE well and BEHAVIOUR not at all, and all three findings were behaviour.
The suite was green through both blocking defects.

`scripts/ai-provider-administration-scenarios.mjs` (`npm run test:database:4c`)
replaces that with execution, reusing the pattern
`scripts/membership-bootstrap-scenarios.mjs` established: scratch databases the
script creates and drops, the **real** migration and rollback files as steps,
SQL assertion files under `tests/database/harness/`, and exit code `2` reserved
for "no database was reachable" so BLOCKED is never read as PASSED. It proves,
in order: the migration applies; it is transactionally valid; the tables,
constraints and indexes exist; the activation RPC exists with the argument types
and parameter names the store binds by; `service_role` performs the exact
runtime lifecycle; `service_role` holds only the intended privileges;
`authenticated` and `anon` can neither read nor mutate credential rows; neither
may execute the activation RPC and `service_role` may; active-credential
uniqueness holds; activation and supersession are atomic under failure;
plaintext-shaped storage is refused in nine plausible shapes; the platform and
organization scope constraints hold; the rollback removes 4C and nothing else;
the migration re-applies after its own rollback; and a migration made to fail at
its last statement leaves no partial 4C schema state.

The static suite is kept as the cheap half and now says, where it could be
mistaken, which executable assertion carries each behavioural claim.

### Root key policy — documented and now tested

`AI_CREDENTIAL_ENCRYPTION_KEY` is persistent infrastructure and **must not be
rotated** once managed credentials exist, until Cortex has a controlled
re-encryption or keyring mechanism. This remediation builds no such mechanism
and changes no cryptography.

Rotating **provider** credentials — the vendor API keys — remains fully
supported, audited, and needs no deploy. Root key loss affects managed provider
ciphertext and nothing else. Recovery: restore the original root key; revoke the
affected managed credential and fall back where permitted; or re-enter the
provider credential under the current key.

Cortex does **not** silently fall back to the environment when a managed
credential exists and will not open — that provider fails closed. Each of these
statements is now a test in `Batch 4C remediation — the root key operational
invariant`, driving the real cipher and the real resolver.

### Production state, unchanged

```
PRODUCTION_CHANGES:                NONE
REAL_PROVIDER_REQUESTS_EXECUTED:   0
AI_ALLOW_REAL_REQUESTS:            untouched
MIGRATION APPLIED TO PRODUCTION:   NO
AI_CREDENTIAL_ENCRYPTION_KEY:      not set in production
```

The migration was applied only to disposable scratch databases this repository's
own scripts create and drop.
