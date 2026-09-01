# AI-01 Batch 4D — Customer BYOK

**Baseline:** `476b5c5` (Batch 4C merged, migrated, deployed and closed; `origin/main` at the same SHA)
**Branch:** `claude/customer-byok-credentials-b0jbt6`
**Status:** implemented and verified locally — **NOT certified, NOT deployed**
**Production changes made by this batch:** none
**Real provider requests executed:** 0

> Implementation completion is not certification. This document records what was
> built and what was proved; the verdict on whether it may ship belongs to an
> independent review.

---

## 1. What this batch is

Batch 4C gave MARQ a platform administration layer for its own provider
credentials. Batch 4D gives a **customer organization** the same thing for
**its own** — and adds no second store, no second cipher, no second resolver, no
second execution path and no second audit trail.

```
     CUSTOMER ORG ADMIN                      MARQ PLATFORM ADMIN
             │                                        │
             ▼                                        ▼
   BYOK ADMINISTRATION   (4D)              PROVIDER ADMINISTRATION   (4C)
   ai.byok.*                               ai.providers.*
   organization scope only                 platform scope only
             │                                        │
             └────────────────────┬───────────────────┘
                                  ▼
                  ONE credential store · ONE AES-256-GCM cipher
                                  ▼
                  ONE PROVIDER CREDENTIAL RESOLVER  (now tenant-aware)
                                  ▼
                       ONE AI CONTROL PLANE
                                  ▼
                    OpenAI · Anthropic · synthetic mock
```

**Two administration surfaces, one of everything below them.** What differs is
the SCOPE of the rows and WHO may touch them.

---

## 2. The extension points 4C left, and which were used

Batch 4C was written for this batch and said so in its own text. Every one of
the following existed at the baseline and was **used rather than replaced**:

| 4C left | 4D used it for |
|---|---|
| `AIProviderScope = 'platform' \| 'organization'` | admitting the second value |
| `ai_provider_configuration.organization_id` + FK | tenant ownership |
| `ai_provider_configuration_scope_tenancy` CHECK | scope/tenancy agreement |
| `ai_provider_configuration_organization_key` partial unique index | one config per (tenant, provider) |
| `SecretBinding.organizationId` in the AAD | cross-tenant ciphertext reuse is refused |
| `ProviderCredentialResolver` | one resolver, one new optional argument |
| `ai_provider_credential_activate` (SECURITY DEFINER, atomic) | customer rotations, unchanged |
| `AdminAuditWriter` / `AdminAuditStore` | the same append-only trail |
| `resolveOrganization` | the one tenant resolver |
| `flooredRolesFor` | floored, not unioned, role resolution |

**No architectural conflict with the 4C contract was found.** Nothing in 4C had
to change its meaning. The three genuine additions are named in §4.

---

## 3. Credential resolution precedence

`resolve(providerId)` — no tenant — is **byte-for-byte the Batch 4C
resolution** and reads no organization-owned row at all. That is what keeps a
customer's credential out of MARQ's own execution.

`resolve(providerId, tenant)` — an AUTHENTICATED tenant — adds one branch in
front of it:

```
0. TENANT      an organization configuration that is present, ENABLED and holds
               an ACTIVE credential  →  open it.
               If it will not open   →  REFUSE. Never continue.
1. PLATFORM    an ACTIVE managed Cortex credential          ┐ Batch 4C,
2. ENVIRONMENT the deployment's variable                    │ unchanged
3. NONE        the provider cannot execute                  ┘
```

Reached only when `tenant.membershipVerified === true`. The
`AI_ALLOW_DEFAULT_ORGANIZATION` fallback — an account with no membership row
placed in the deployment's default organization — is treated as **no tenant**.

### Why a failed decrypt refuses instead of falling through

This is the one place the obvious ladder is wrong. A tenant whose credential
*exists and will not open* is not "a tenant with no credential"; it is "a tenant
whose recorded decision the platform cannot honour". Falling through would move
that customer's traffic onto **MARQ's vendor account** at the exact moment their
own key became unreadable, while the console went on reporting `customer_byok`
from a row that still says `active`.

The decision lives in one pure function, `tenantPrecedence.ts`, asked by **both**
the resolver and the customer console — so the console cannot report "your key
is in force" beside traffic billing MARQ.

### The customer's own fallback policy

`credential_fallback` ∈ `{'platform', 'tenant_only'}`, default `platform`.

- `platform` — MARQ's arrangement stands behind a tenant with no credential of
  their own. **The default, because it changes nothing for a tenant that never
  opts in.**
- `tenant_only` — their vendor account or nothing. Revoking their key stops
  their AI rather than quietly moving the bill to MARQ.

It is **not** a boundary between tenants and must not be read as one. No value of
it admits one customer's credential to another's execution.

---

## 4. What is genuinely new

Three things, and nothing else:

1. **One optional argument** on `ProviderCredentialResolver.resolve`.
2. **One column, two constraints, one index, one trigger** on tables 4C created.
3. **One customer-facing administration surface** — service, HTTP adapter,
   routes, console — with its own capability vocabulary.

---

## 5. Tenant isolation design

Isolation is enforced at **four independent layers**. Any one of them failing
still leaves three.

| Layer | Control |
|---|---|
| Identity | `resolveOrganization` admits a caller's organization hint only against a verified membership; more than one membership and no hint is a refusal, never a guess |
| Service | every storage call keyed by `actor.organization.organizationId`; no method takes an organization id; a row whose owner differs raises `TENANT_ISOLATION_VIOLATION` |
| Storage | `listOrganizationConfigurations(organizationId)` takes the tenant as its ONLY argument — there is no call shape meaning "every tenant's rows, and I will filter" |
| Database | partial unique index per (tenant, provider); a `BEFORE UPDATE` trigger makes `scope` and `organization_id` immutable, for `service_role` too |
| Cipher | the AAD binds the organization: a ciphertext moved onto another tenant's row does not open |

**The organization never comes from a request body.** It comes from the
authenticated session, optionally narrowed by an `X-MARQ-Organization` hint that
is admitted only against a membership. No route takes an organization path
parameter and no body field reaches one.

---

## 6. RBAC and capabilities

A **separate vocabulary**, disjoint from `ai.providers.*` by construction:

| Capability | Held by |
|---|---|
| `ai.byok.view` | organization administrators of that organization |
| `ai.byok.manage` | organization administrators of that organization |

- An ordinary member, consultant, analyst, reviewer or viewer of the
  organization holds **neither**.
- A membership row with no trusted team role behind it holds **neither**
  (floored, not unioned).
- A membership resolved from a **cache** is refused outright.
- **The MARQ platform operator holds neither**, deliberately — see §11.
- No capability name appears in both grant tables, and no code path translates
  between them.

---

## 7. API

`/make-server-324f4fbe/ai/organization/providers`

| Method | Path | Operation |
|---|---|---|
| GET | `/ai/organization/providers` | this organization's provider/credential status |
| GET | `/ai/organization/providers/:providerId/credentials` | this organization's credential history (metadata only) |
| POST | `/ai/organization/providers/:providerId/credentials` | configure **or rotate** |
| POST | `/ai/organization/providers/:providerId/credentials/:credentialId/revoke` | revoke |
| PATCH | `/ai/organization/providers/:providerId/fallback` | set the fallback policy |

Every object is named in the **path**; the operation is bound by the **route
table**; the tenant comes from the **session**. There is no `credential.read`,
no `credential.reveal` and no `credential.plaintext` — the operation does not
exist, so no route can bind it and no body can ask for it.

---

## 8. Encryption and secret handling

Unchanged from 4C, applied to a second population of rows:

- AES-256-GCM through `crypto.subtle`; no homemade cryptography.
- HKDF-SHA256 key separation; fresh 96-bit IV per record.
- AAD binds provider · scope · **organization** · credential id.
- Root key stays a deployment secret and is never written to the database.
- **Fail closed**: no root key → the credential is refused, not encoded.
- Refusals name **bounds, never values** — one shared `acceptCredentialSecret`.

**What a customer is never sent**, and cannot be: the plaintext, the ciphertext,
the IV, MARQ's root key identity, the deployment variable's name, MARQ's
managed-credential state, or the governed exposure figure. The credential
history is a **narrowed type**, not a forwarded one — a field added upstream
cannot reach a customer by default.

> This was found by this batch's own test suite: the first implementation
> forwarded `ProviderCredentialMetadata`, which carries `keyId`. Fixed before
> anything was committed; the assertion that caught it is retained.

---

## 9. Audit behaviour

The **same append-only trail**, with distinct action names so the two estates
are separable by a text filter:

`ai.byok.credential.configured` · `ai.byok.credential.rotated` ·
`ai.byok.credential.revoked` · `ai.byok.fallback.changed` ·
`ai.byok.access.denied`

Every record carries the actor, `actorRole: customer_byok_admin`, exactly one
organization, a **mandatory reason**, the before/after facts and the outcome.
**Rejections are recorded too** — including a refused access attempt, which is
the half of a trail that catches an attack.

Recorded credential facts: id, keyed fingerprint, secret version, status,
policy. **Never** the secret, and never the root key identity.

The audited-mutation discipline was **extracted** to `admin/auditedMutation.ts`
and is now shared by both surfaces, rather than copied. `administration.ts`
delegates to it with identical ordering and semantics.

---

## 10. Database

**No table was created.** One column (`credential_fallback`), two constraints,
one partial index, one `BEFORE UPDATE` trigger.

The trigger makes a configuration's `scope` and `organization_id` immutable.
Without it, one UPDATE could re-point a configuration at another organization
and every credential under it would follow — the cipher would refuse the
decryption, but the metadata leak would already have happened.

RLS **enabled and forced** on all three tables with **no policy on any of them**;
`anon` and `authenticated` revoked and granted nothing; `service_role` holds an
enumerated set with no DELETE, no TRUNCATE and no direct INSERT on the credential
table. **Batch 4D grants nothing new to anybody.**

**Rollback:** removes every 4D object and **deletes no customer row**. A stored
credential is write-only and unrecoverable; reversing a schema change must not
force every affected customer to re-enter their key. With 4D's code rolled back
those rows are simply never read.

---

## 11. Known limitations, stated rather than discovered

1. **Platform-wide eligibility.** Whether a provider may serve at all is decided
   by the selector's synchronous, platform-scoped `hasCredentials()` probe.
   Customer BYOK decides **which key** a selected provider executes with; it does
   not by itself bring a provider into service. Making the probe tenant-aware
   would push a storage read into the selector and the spend guard, which run
   synchronously on every request. Pinned by a test.

2. **The platform operator cannot administer a tenant's BYOK.** A platform
   operator has no tenant identity, so there is no organization whose BYOK they
   administer. MARQ acting on a customer's own vendor key is a support operation
   with a customer-consent question attached, and shipping it as a side effect of
   "the platform operator can do everything" would answer that question by
   accident. **Deferred to 4E/4F.**

3. **No per-tenant credential for an uncertified provider.** BYOK admits only
   providers MARQ has registered, certified and enabled. Otherwise "bring your
   own key" would become a way to route governed traffic through a vendor MARQ
   never reviewed.

4. **The BYOK trail is not yet exposed to the customer.** Records are written to
   the shared administrative trail; a customer-facing read of their own records
   is deferred.

---

## 12. What this batch did NOT do

- No production migration applied.
- No production secret set.
- `AI_ALLOW_REAL_REQUESTS` untouched and still `false`.
- No real OpenAI or Anthropic request. Every adapter test injects `fetch`.
- No customer API key inserted anywhere. Every credential in every test is
  fictional.
- No function deployed.
- No merge to `main`.
- No spend cap, budget, ceiling or governance value changed.

---

## 13. Verification

See the batch report for counts and results. The two halves:

- **`npm run test:database:4d`** — the real migration and rollback against a
  real PostgreSQL, driving two customers and MARQ through the statements the
  runtime issues, and attempting the cross-tenant writes an attacker would.
  A text scan proves absence well and behaviour not at all; this is the
  verification.
- **`npm run verify:4d`** — the service, the resolver, the adversarial suite and
  the console surface, against the production implementations.

Batch 4C's own harness assertions are **re-run after 4D is applied**, unmodified,
and again after the 4D rollback.
