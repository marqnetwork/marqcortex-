# AI-01 Batch 4C — Final Production Readiness Gate

**Audit branch:** `claude/marq-cortex-4c-audit-7nxbbn`
**Subject:** `claude/provider-administration-is98an` @ `03d1326`
**Scope:** the production secret-encryption root of trust, the new migration,
the disaster-recovery story, and a targeted security regression.

**This audit made no production change.** No migration was applied to a hosted
database, no secret was created, read or changed, no deployment occurred, and no
real provider request was executed. The database evidence below comes from a
disposable local PostgreSQL 16 cluster built for this audit and destroyed with it.

**VERDICT: NOT READY TO DEPLOY.** Two blocking defects, both proved by execution
rather than by reading. The cryptography itself is sound; the migration that is
supposed to carry it does not apply.

---

## 0. Findings

| # | Severity | Finding | Proof |
|---|---|---|---|
| **B-1** | **BLOCKER** | `20260828120000_ai_provider_administration.sql` **fails to apply**. `cortex.ai_provider_model` declares the constraint name `ai_provider_model_id_format` twice — once on `id` (line 284) and once on `model_id` (line 289). PostgreSQL refuses a duplicate constraint name within one table. | §4.1 |
| **B-2** | **BLOCKER** | Even once B-1 is fixed, **every provider-administration operation fails for `service_role`** — the role the edge function actually runs as. The migration grants no table privileges to `service_role`, and `REVOKE ALL ON FUNCTION … FROM PUBLIC` strips the activation RPC's only `EXECUTE` grant without re-granting it. | §4.2 |
| **M-3** | MEDIUM | The precise root-key-mismatch diagnostic is computed and then **discarded**. `resolver.ts` forwards `error.message` to `onError`, not `error.diagnostics`, so during a root-key incident the deployment logs the generic `"A stored provider credential cannot be read."` — exactly the message `secretCipher.ts` says it exists to avoid. | §3.4 |
| **I-4** | INVARIANT | Safe root-key rotation is **not supported** and no code claims otherwise. 4C can launch under an explicit operational prohibition — see §2. | §2 |

**Why the existing suites did not catch B-1 or B-2.** `tests/database/static_ai_provider_administration_migration.test.ts`
is a **text scan**: it reads the `.sql` file as a string and asserts on its
contents. It never opens a database connection, so it cannot observe that the
file does not parse, and it asserts on the `REVOKE` while having no way to
observe the missing `GRANT`. The file is candid about this — *"a source scan
proves ABSENCE well and behaviour badly"* — and it names the claims it cannot
settle. It simply does not name these two.

---

## 1. `AI_CREDENTIAL_ENCRYPTION_KEY` — proved from source

Everything in this section was executed against
`supabase/functions/server/ai/providers/credentials/secretCipher.ts`. All 45
checks passed.

| Property | Behaviour |
|---|---|
| **Format** | Base64 of exactly **32 bytes** (256 bits). `openssl rand -base64 32`. Surrounding whitespace is trimmed. |
| **Entropy / length** | Exactly 32 bytes required. 16, 24, 31, 33 and 64-byte keys are **refused**, never stretched, padded or truncated. |
| **Validation** | `parseRootKey()`. Non-base64 → `AI_CREDENTIAL_ENCRYPTION_KEY is not valid base64`. Wrong length → `… decodes to N bytes; AES-256-GCM requires exactly 32`. |
| **Absent** | Returns `undefined` and does **not** throw. Bootstrap builds `unavailableSecretCipher()`; the platform starts and serves normally on environment credentials. The one operation that fails is *storing* a managed credential, with a message naming the variable. |
| **Malformed** | Bootstrap catches and logs `[ai] AI_CREDENTIAL_ENCRYPTION_KEY is set but unusable — managed provider credentials cannot be stored in this deployment`, then continues with the unavailable cipher. Loud, not fatal, never a silent downgrade. |
| **Raw key in logs/errors** | **No.** No error message, `diagnostics` field or stack trace produced by any failure path contains the root key or a provider secret. Verified by substring search over every error surface. |
| **HKDF** | `HKDF-SHA256`, **zero-length salt**, two `info` labels: `marq.cortex.credential.v1.aes-gcm` → the AES-256-GCM key; `marq.cortex.credential.v1.hmac` → the HMAC-SHA256 key. The root key is imported non-extractable and used **only** as HKDF input material — never directly as an AES or HMAC key. Derived once per isolate. |
| **Deterministic?** | **No.** Fresh 12-byte (96-bit) IV per record from `crypto.getRandomValues`. 200 seals of the same plaintext produced 200 distinct IVs and 200 distinct ciphertexts. |
| **Authentication** | AES-256-GCM with a 128-bit tag (`ciphertext length = plaintext + 16`). A single flipped bit in either the ciphertext or the IV is refused. |
| **AAD binding** | `marq.cortex.ai.credential.v1\|<provider>\|<scope>\|<organizationId ?? '-'>\|<credentialId>`. A ciphertext moved to a different provider, scope, credential id **or tenant** fails to open. An `alg` downgrade in the stored record is refused before any crypto runs. |
| **Key identity** | `kid = "k_" + first 12 hex of HMAC-SHA256(derived-hmac-key, "marq.cortex.credential.kid")`. Recorded on every row and denormalised into `key_id`, so affected credentials can be found after a rotation **without decrypting anything**. |
| **Fingerprint** | Keyed HMAC, truncated to 16 hex chars. Stable per secret, different per deployment, reveals no plaintext. |

**No homemade cryptography.** Every primitive is `crypto.subtle`. The module
contributes key management and record framing only.

---

## 2. ROOT KEY ROTATION — the operational invariant

> ## ⛔ `AI_CREDENTIAL_ENCRYPTION_KEY` IS A PERSISTENT INFRASTRUCTURE SECRET.
> ## IT MUST NOT BE ROTATED, REGENERATED OR REPLACED.
>
> Not as routine hygiene, not during an environment migration, not while
> recreating an edge-function secret set. Changing this value **breaks every
> managed provider credential that exists at that moment**, and Cortex has no
> mechanism to re-seal them.
>
> This prohibition stands until a controlled root-key migration mechanism is
> designed, built and certified. Rotating **provider credentials** (the vendor
> API keys themselves) is fully supported and unaffected — that is what the
> administration console is for.

Answering the audit's questions directly:

| Question | Answer |
|---|---|
| Do old credentials become undecryptable? | **Yes.** Proved: a record sealed under key A cannot be opened under key B. |
| Is a key version stored with each credential? | **Yes, as an identity — not as a keyring.** Each record carries `kid`, denormalised to the `key_id` column with its own index. It makes the failure *diagnosable* and lets an operator enumerate affected rows. It does **not** enable decryption. |
| Is there a supported re-encryption procedure? | **No.** There is no re-encrypt, rewrap or key-migration path anywhere in the codebase. |
| Can old and new root keys coexist? | **No.** `createSecretCipher` holds exactly one root key. `open()` compares `sealed.kid` against the single current key and refuses on mismatch. There is no keyring, no fallback key, no `PREVIOUS_*` variable. |
| Is rotation atomic? | **Not applicable — there is no rotation operation to be atomic.** Changing the variable is an environment edit that takes effect on the next isolate. |
| Can rotation strand credentials? | **Yes, and it will strand all of them.** Worse than stranding: see the availability note below. |

**The availability consequence, stated plainly.** A rotated root key does *not*
degrade gracefully to the environment variable. The resolver deliberately
**refuses** rather than falling back when a managed credential exists and will
not open — because falling back would mean an operator who rotated a vendor key
kept executing on the old one. So after a root-key change, **every provider
holding a managed credential goes dark**, even though a perfectly good
`OPENAI_API_KEY` is present. Recovery requires operator action (§3).

**Can 4C launch under this constraint?** Yes — the constraint is acceptable and
the blast radius is bounded:

- Production holds **no** managed credentials today, so on the day of deployment
  the invariant protects nothing yet and cannot bite.
- Environment credentials remain a permanently supported source and are entirely
  unaffected by the root key.
- Provider-credential rotation — the operation an operator actually needs — is
  supported, audited, atomic (§4.3) and requires no deploy.
- The failure, if the invariant is ever violated, is loud, non-silent, and
  recoverable without data loss of anything but the sealed secrets themselves.

**This launch condition is contingent on B-1 and B-2 being fixed first.** The
invariant is not what blocks 4C; the migration is.

---

## 3. DISASTER RECOVERY — proved end to end

Executed against the real cipher, resolver and credential store.

### 3.1 If the root key is lost

**What becomes unrecoverable:** the plaintext of `encrypted_secret` in
`cortex.ai_provider_credential`, and nothing else. Those are managed provider
API keys — values that also exist in the vendor's own console, so they are
replaceable rather than lost.

**What is unaffected:** every other Cortex data store. The cipher is constructed
once, in `ai/bootstrap.ts`, and passed to exactly two consumers — the provider
administration service and the credential resolver. No other subsystem seals
anything with this key: not the spend ledger, not the audit trail, not the KV
store, not tenancy, not agent or workflow state. Environment credentials
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are deployment secrets this key never
touched.

**Credential metadata survives:** name, status, `secret_version`, fingerprint,
last four, `key_id`, timestamps and the full administrative trail remain readable.
Only the sealed value is lost.

### 3.2 Two different incidents, two different behaviours

| Incident | Runtime behaviour | Proved |
|---|---|---|
| Root key **unset** (variable removed) | Managed path is inert; resolver **falls back to the environment key**. Providers keep serving. | DR-2 |
| Root key **replaced** with a different value | Managed credential exists and will not open → resolver **refuses**. Provider goes dark. **No** silent fallback. | DR-3 |
| Database/`cortex` schema unreachable | Treated as "nothing learned" → **falls back to the environment**. Pre-4C behaviour, reported not swallowed. | DR-8 |

The distinction is deliberate and correct: an unreachable store teaches the
platform nothing, whereas an unopenable credential is a recorded administrator
decision that cannot be honoured.

### 3.3 Recovery paths (all proved)

1. **Revoke the undecryptable credential** — restores service immediately by
   falling back to the environment key. Critically, **revocation needs no root
   key**: `revokeCredential` touches only metadata and is not behind the
   cipher-availability gate. This is the escape hatch during an incident.
2. **Re-enter the credential** under the new root key through the console —
   fully restores managed administration.
3. **Restore the original root key** — decrypts the original rows **exactly**.
   Loss of the key is not loss of the data: if the old value is recoverable from
   a secret manager or backup, everything comes back.

### 3.4 Finding M-3 — the diagnostic that does not arrive

`secretCipher.open()` produces:

```
sealed under root key k_7530e05f45ae, deployment holds k_820638ddde9f.
The credential must be re-entered under the current key.
```

`resolver.ts` (`resolve`, the `open` catch) forwards `error.message`, not
`error.diagnostics`, so what `bootstrap.ts` actually logs is:

```
[ai] provider credential resolution failed for openai: A stored provider credential cannot be read.
```

The precise reason is computed and thrown away, at the exact moment it is worth
most. Not a security defect — no information leaks, and no wrong credential is
used — but it converts a five-minute diagnosis into a long one during a
root-key incident. Worth fixing alongside B-1/B-2.

### 3.5 Ciphertext without the root key

**Confirmed useless.** The stored record contains neither the plaintext nor the
key. 50 independent wrong 256-bit root keys produced **0** successful
decryptions. Recovering a secret from a stolen row requires brute-forcing a
256-bit key against a GCM tag. A leaked backup, an over-broad service credential
or a support export yields ciphertext and nothing else.

The honest limit, which the source states itself: this does **not** defend
against an attacker holding both the database *and* the edge-function
environment. Nothing that decrypts inside the edge function could.

---

## 4. MIGRATION SAFETY — executed, not read

Method: a disposable PostgreSQL 16 cluster, the repository's own Supabase
platform stub (`tests/database/harness/00_platform_stub.sql`, which creates
`anon`, `authenticated` and `service_role NOLOGIN BYPASSRLS`), then all 17
migrations in filename order.

### 4.1 B-1 — the migration does not apply

The first 16 migrations applied cleanly. The 17th did not:

```
OK   20260821120000_marq_provenance_rls_band.sql
FAIL 20260828120000_ai_provider_administration.sql
ERROR:  check constraint "ai_provider_model_id_format" already exists
```

`cortex.ai_provider_model` names the same constraint on two columns:

```sql
id       TEXT PRIMARY KEY
           CONSTRAINT ai_provider_model_id_format      -- line 284
           CHECK (id ~ '^pvm_[A-Za-z0-9]{1,64}$'),
model_id TEXT NOT NULL
           CONSTRAINT ai_provider_model_id_format      -- line 289  ← duplicate
           CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
```

**Safety consequence:** the file is wrapped in `BEGIN … COMMIT`, so the failure
rolls back completely. Zero tables, zero functions, zero partial state — verified.
Applying it to production would be *safe* but would accomplish *nothing*, and
every subsequent step of the §17 deployment procedure is built on it.

**Fix:** rename the second constraint (e.g. `ai_provider_model_model_id_format`).
With that one change the migration applies cleanly — verified.

### 4.2 B-2 — `service_role` cannot use any of it

With B-1 patched locally, the migration applies. It is then non-functional for
the only role that matters. Simulating what PostgREST does (`SET ROLE service_role`):

```
--- saveConfiguration ---   ERROR: permission denied for table ai_provider_configuration
--- putActiveCredential --- ERROR: permission denied for function ai_provider_credential_activate
--- activeCredential ---    ERROR: permission denied for table ai_provider_credential
```

Two independent causes:

**(a) No table privileges.** The migration revokes from `anon` and `authenticated`
but grants to nobody. Only the owner (`postgres`) holds privileges. Broader:
**no migration in this repository grants table privileges on any `cortex` table
to `service_role`**, and there is no `ALTER DEFAULT PRIVILEGES` anywhere. This
has gone unnoticed because `aiProviderAdministrationStore.ts` is the **first and
only** code in the codebase that reaches the `cortex` schema through PostgREST —
verified: it is the sole `.schema('cortex')` call site.

**(b) No `EXECUTE` on the activation RPC.** A newly created function carries an
implicit `EXECUTE` grant to `PUBLIC`. The migration's
`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` removes it — and
never re-grants it:

```
has_function_privilege('service_role', 'cortex.ai_provider_credential_activate…', 'EXECUTE') → false
```

**This breaks the pattern every other migration in this repository follows.**
`20260711050001`, `20260714050001`, `20260818130000`, `20260820120000` and
`20260821120000` all pair their `REVOKE … FROM PUBLIC` with an explicit
`GRANT EXECUTE … TO service_role`. This one revokes and stops.

**Verified fix** (restores function, preserves the security posture):

```sql
GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_configuration TO service_role;
GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_credential    TO service_role;
GRANT SELECT, INSERT, UPDATE ON cortex.ai_provider_model         TO service_role;
GRANT EXECUTE ON FUNCTION cortex.ai_provider_credential_activate(
  TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;
```

With these applied, the full lifecycle (create configuration → activate → rotate
→ revoke) succeeds as `service_role`, **and `authenticated` remains denied every
row** — confirmed in the same session. `DELETE` is deliberately not granted: no
code path deletes a credential, and the rotation history is meant to be
append-only.

*Residual uncertainty, stated honestly:* this was proved on stock PostgreSQL 16
with the repository's own Supabase role stub. It is conceivable that the hosted
project carries out-of-band grants applied manually. §5 gives the operator a
read-only probe that settles it against the real project. B-1, by contrast, is
pure SQL parsing and holds in every environment.

### 4.3 Everything else in the migration is correct

Verified by execution against the patched schema:

| Check | Result |
|---|---|
| ID types match service-generated ids | **Pass.** `contracts/ids.ts` mints `<kind>_` + `crypto.randomUUID()` with dashes stripped = 32 hex chars. `pvc_4f3c…5f60` is accepted by `^pvc_[A-Za-z0-9]{1,64}$`. `TEXT` is right; `UUID` would have rejected every write. |
| Atomic activation RPC works with those ids | **Pass.** Activation inserted; a second activation superseded the first and inserted the replacement in one transaction. Exactly one `active` row throughout. |
| RLS prevents unauthorized secret-row reads | **Pass.** All three tables: RLS enabled, **forced**, **zero policies**. `authenticated` → `permission denied for table`. `anon` → `permission denied for schema cortex`. `authenticated` calling the RPC directly → `permission denied for function`. |
| No plaintext credential column | **Pass.** 15 columns; the only secret-bearing one is `encrypted_secret JSONB`, constrained to require `v`, `alg`, `kid`, `iv`, `ct` with `alg = 'AES-256-GCM'`. An attempt to write `{"secret":"sk-live-realkey"}` was **rejected by the database**. |
| Organization/platform scope constraints | **Pass.** `platform` + non-null `organization_id` → rejected. `organization` + null → rejected. Both partial unique indexes present. |
| Safe on the current production database | **Qualified pass.** Additive only: three new tables in `cortex`, one function, no `ALTER` of any existing object, no seed row, no backfill. Transactional, so B-1 rolls back cleanly. It is *safe* — it is simply not *functional*. |
| Does **not** copy `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | **Pass.** The file contains no `INSERT` outside the RPC's parameterised body, no seed, no `COPY`, and no reference to either variable except a comment explaining why it does not. Environment secrets are untouched. |
| Rollback | **Pass.** Applied cleanly: 0 remaining 4C tables, 0 remaining 4C functions, the 3 pre-existing `cortex` tables intact. Re-applying the migration afterwards succeeds. Destroys managed credentials (encrypted, unrecoverable, replaceable) and touches nothing else. |

---

## 5. CORTEX SCHEMA PREREQUISITE — operator verification procedure

`supabase/config.toml` declares `schemas = ["public", "cortex"]`, which covers
local and CLI environments only. The hosted project's PostgREST configuration is
separate and **must be verified by a human**. Do not change anything — verify.

### Step 1 — Dashboard (read-only)

Supabase Dashboard → **Settings → API → Exposed schemas**. Confirm `cortex`
appears alongside `public`.

### Step 2 — API probe (definitive; read-only; run *after* the migration applies)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Accept-Profile: cortex" \
  "$SUPABASE_URL/rest/v1/ai_provider_configuration?select=id&limit=1"
```

Run it from a trusted shell; do not paste the service-role key anywhere it will
be recorded.

| Response | Meaning | Action |
|---|---|---|
| `200` (body `[]`) | Schema exposed **and** `service_role` has SELECT. | Prerequisite met. |
| `404` + `PGRST106` | Schema **not** exposed. | Add `cortex` to Exposed schemas. |
| `404` + `PGRST205` | Schema exposed, table absent. | Migration has not applied — expect this while B-1 stands. |
| `401`/`403` + SQLSTATE `42501` | Schema exposed, **grants missing**. | This is **B-2**, confirmed against production. |

### Step 3 — Grant check (SQL Editor, read-only)

```sql
SELECT
  has_schema_privilege('service_role', 'cortex', 'USAGE')                            AS schema_usage,
  has_table_privilege('service_role', 'cortex.ai_provider_credential', 'SELECT')     AS cred_select,
  has_table_privilege('service_role', 'cortex.ai_provider_credential', 'INSERT')     AS cred_insert,
  has_table_privilege('service_role', 'cortex.ai_provider_configuration', 'INSERT')  AS conf_insert,
  has_function_privilege('service_role',
    'cortex.ai_provider_credential_activate(text,text,text,jsonb,text,text,text,integer,timestamptz,timestamptz,text)',
    'EXECUTE')                                                                       AS can_activate;
```

**All five must be `true`.** In the audit's reproduction, `schema_usage` was
`true` and the other four were `false`.

### Step 4 — Confirm the denial still holds

```sql
SELECT count(*) AS policies_that_should_be_zero
FROM pg_policies WHERE schemaname = 'cortex' AND tablename LIKE 'ai_provider%';
```

Must return `0`. A policy here would put ciphertext within reach of a browser
session token.

---

## 6. SECURITY REGRESSION — re-run

`npm run verify:4c` → **120/120 passed**. `npm run test:security` →
**397/397 passed, 68 suites, 0 failed, 0 skipped.**

| Area | Covered by | Result |
|---|---|---|
| Credential encryption | *round-trips through real AES-256-GCM*; *produces a different ciphertext every time*; *refuses a root key of the wrong length rather than stretching it* | Pass |
| Credential storage | *keeps plaintext out of storage, the audit trail and the log*; *the credential table can hold no plaintext*; *declares no column a secret could occupy* | Pass |
| Credential rotation | *retains rotated credentials and keeps exactly one active*; *never asks for the previous credential in order to rotate* | Pass |
| Credential revocation | *makes a revoked credential unresolvable rather than merely hidden*; *will not admit a revoked credential with no record of who revoked it* | Pass |
| Managed → environment fallback | *prefers a managed credential over the deployment environment*; *does not fall back to the environment when a managed credential cannot be opened* | Pass |
| Database/store failure fallback | *falls back to the environment when managed storage is unreachable*; *refuses rather than falling back when a managed credential will not open* | Pass |
| `/ai/metrics` authority | *demands `ai.admin.view` for the metrics route* | Pass |
| `/ai/audit` authority + tenant scope | *demands `ai.admin.audit.read`*; *serves the audit route through the TENANT-SCOPED read*; *reaches no unscoped audit read from any AI route* | Pass |
| `/ai/catalog` authority | *demands `ai.admin.view` for the catalog route* | Pass |
| Platform credential RBAC | *admits the platform operator*; *refuses every provider administration operation to a tenant administrator*; *records every refused credential mutation on the administrative trail* | Pass |
| Plaintext leakage | *never returns the plaintext through any administration response*; *offers no operation that reads a stored credential back*; *keeps the plaintext out of a rejection* | Pass |
| Budget hold = 105,920 µUSD | *holds the certified `cortex.chat` reservation at 105,920 micro-USD* (`openai` / `gpt-4o`) | Pass |

**No new security findings.** B-1 and B-2 are availability and correctness
defects; M-3 is diagnosability. None of them weakens a security control — B-2 in
fact fails *closed*, denying the service role along with everyone else.

---

## 7. Remediation before this gate can be re-run

1. Rename the duplicate constraint in `cortex.ai_provider_model` (B-1).
2. Add the four `service_role` grants (B-2), in the same migration.
3. Forward `error.diagnostics` in the resolver's `open` catch (M-3).
4. Replace the text-scan-only coverage of this migration with one test that
   **applies the migration to a real PostgreSQL instance** and asserts the
   `service_role` privilege set. `scripts/membership-bootstrap-scenarios.mjs`
   already builds a scratch database from the real migration files — the pattern
   exists and this migration is not using it. Either blocker would have been
   caught on the first run.
5. Correct §17 and §19 of `AI-01-BATCH-4C-COMPLETION.md`, whose
   `READY_FOR_4C_PRODUCTION_DEPLOYMENT: YES` is falsified by B-1: step 1,
   "Apply the migration", does not succeed.

Once 1–4 land, re-run this gate. Nothing in §1, §2 or §3 needs redoing — the
cryptographic root of trust is sound and its behaviour is proved.
