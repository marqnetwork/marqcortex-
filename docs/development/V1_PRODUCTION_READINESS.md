# MARQ Cortex V1 — Production Readiness

The go-live plan: what to apply, in what order, with what flags, how to tell it
worked, and how to undo each step.

**Nothing in this document has been executed.** Every production action is
withheld pending explicit human approval, which is the one required stop.

Prepared against main **`2d0f8ae2`**. Companion to
`V1_COMPLETION_CHECKLIST.md` (what is done) and `AUTONOMOUS_BUILD_PROGRESS.md`
(how each item was closed).

---

## 0. The three decisions that gate go-live

**All three have now been decided.** Two of them remain gates on *execution*
rather than on code, and this document records what each answer obliges.

| # | Decision | Answer, and what it obliges |
|---|---|---|
| **D1** | Run the Phase 2 backfill against production data | **Not yet — PRODUCTION_EXECUTION_PENDING.** Code complete and proven against PostgreSQL 16. The exact procedure, ordering and stop conditions are §10.4; production has not been touched. |
| **D2** | Turn `BACKEND_INTEGRATION` on — the demo→live cutover | **Not blindly.** Real backend verification needs an environment with credentials, and this one has none — no Supabase CLI, no keys, no `.env`. That verification is **EXTERNAL_ENVIRONMENT_BLOCKED**; everything not depending on it was completed. |
| **D3** | **H7** — may the submission response body change? | **Yes — approved as a response-contract normalization.** Missing or placeholder-only values are NULL; the relational representation is authoritative for semantic absence, and `'Not specified'` is not preserved as fake domain data. Presentation may render an empty state; it must not write the placeholder back. **Closed**, with live regression coverage — see the checklist's H7 row. |

---

## 1. Migration order

Twenty-one migrations, applied in filename order. This exact sequence is
verified on every run of `test:database:tenancy`, `:cutover`,
`:reconciliation`, `:diagnostic`, `:scenarios`, `:4c` and `:4d`, each of which
builds a scratch database from them — and once more, end to end, from a
genuinely empty database: all 21 apply cleanly given only the platform stub,
producing 30 tables and 96 indexes.

```
20260711050000_cortex_tenancy_foundation
20260711050001_cortex_tenancy_rls_and_seed
20260713000000_kv_store_foundation
20260713184931_migration_infrastructure
20260713184943_migration_infrastructure_rls
20260714050000_cortex_diagnostic_foundation
20260714050001_cortex_diagnostic_rls
20260714060000_cortex_diagnostic_anon_policy_hardening
20260803120000_kv_compare_and_swap
20260803130000_kv_compare_and_swap_guarded_version
20260804120000_kv_compare_and_swap_field
20260818120000_marq_team_membership_bootstrap
20260818130000_marq_membership_lifecycle
20260819120000_marq_authority_recovery
20260820120000_marq_authority_provenance
20260821120000_marq_provenance_rls_band
20260828120000_ai_provider_administration
20260901120000_ai_customer_byok
20260903120000_ai_self_hosted_providers
20260910120000_cortex_tenancy_composite_keys
20260911120000_cortex_tenant_list_indexes         ← new in this cycle
```

**A Supabase project supplies two things no migration here does:** the API role
grants on `public`, and the `auth` schema. A bare PostgreSQL needs
`tests/database/harness/00_platform_stub.sql` and `06_platform_public_grants.sql`
to stand in; a real project does not.

### The one migration that can refuse

`20260910120000_cortex_tenancy_composite_keys` **validates before it alters**.
If production already holds a child row whose organization differs from its
parent's, it aborts and names the table and the row count.

That is the designed behaviour, not a fault. Fix or remove those rows, then
re-apply — it will not silently reassign a row to another organization. The
count it reports is also the answer to "did the tenancy hole ever actually get
used", which is worth recording either way.

### The new one is additive

`20260911120000_cortex_tenant_list_indexes` creates two partial indexes and
nothing else. It changes no row, no constraint and no policy, so there is no
state in which it can refuse.

It exists because `listOutcomes` and `listReports` were the only two repository
queries filtering on `organization_id` alone, and both read every row in their
table before discarding the other tenants'. `tests/database/tenant_list_indexes`
asserts the query PLAN on a populated table — an index that exists is not an
index that is used.

**For an operator with a large existing estate:** `CREATE INDEX` holds an ACCESS
EXCLUSIVE lock for the build. These tables are empty or near-empty at V1, so it
is instantaneous; against millions of rows, build them with `CREATE INDEX
CONCURRENTLY` outside a transaction instead. The migration cannot do that itself
because it runs inside one.

### Rollback

Twelve forward migrations have a rollback under `supabase/migrations/rollbacks/`,
including the new one. **Roll back in reverse dependency order** — each file
states its own ordering constraint in its header.

`20260910120000_rollback_tenancy_composite_keys` is round-trip proven: forward
gives 14 composite keys, the rollback restores all 14 single-column keys and
leaves 0 composite, and forward again returns to 14. Its header states plainly
what rolling back costs — the tenancy invariant returns to being enforced
nowhere in the database — so it reads as a remedy for a deployment problem
rather than a way to make unexpected data acceptable.

---

## 2. Feature-flag state at go-live

**Everything that changes behaviour ships off.** The product goes live in the
configuration it has been tested in, and each switch is turned on deliberately,
one at a time, with its own verification.

### Frontend (`VITE_*`, build-time)

| Flag | Go-live | Note |
|---|---|---|
| `VITE_BACKEND_INTEGRATION` | **false → D2** | The demo↔live switch. While false the app serves demo data, makes no backend call, **and the sign-in page's demo credentials are hidden** — that gating is new this cycle and is what makes `true` the safe-looking state rather than the dangerous one. |
| `VITE_SHOW_API_ERRORS` | `false` | Silent fallback. Turn on only while diagnosing. |
| `VITE_VERBOSE_LOGGING` | `false` | — |

### Edge Function — required

| Variable | Note |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Absent, `kv_store` now throws naming the missing variable rather than failing obscurely on the first KV call. |
| `SUPABASE_ANON_KEY` | — |
| `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_NAME`, `TEAM_ADMIN_PASSWORD` | Seeds the first team account. |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Required before any BYOK credential is stored. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Absent, email no-ops by design. |

### Edge Function — the switches that must start off

| Variable | Go-live | What turning it on does |
|---|---|---|
| `AI_ALLOW_REAL_REQUESTS` | **off** | Until then no vendor is called and no money is spent. |
| `MCV2_SHADOW_READ_OUTCOMES` | **off** | On, reads the relational row alongside KV and records agreement. Changes nothing served. **This is the first switch of the Phase 5 sequence.** |
| `MCV2_SHADOW_READ_SUBMISSIONS` | **off** | Same, for submissions. |
| `MCV2_SQL_AUTHORITY_OUTCOMES` | **off** | **The only switch in the repository that changes which store answers a customer.** See §4. |
| `AI_DIAGNOSTIC_REVIEW_ENABLED` | **off** | Registers the certified diagnostic capability. |
| `AI_SELF_HOSTED_PROVIDERS_ENABLED` | **off** | Batch 4E. |
| `AI_ALLOW_DEFAULT_ORGANIZATION` | **off** | On, a caller with no verified membership resolves to a default organization. Off is what makes tenancy fail closed. |

Budget, retry, circuit-breaker, routing and audit variables have documented
defaults and need no go-live value.

---

## 3. Deployment order

1. **Apply migrations** (§1), in order, as the migration owner — not as a
   superuser. If the composite-keys migration refuses, stop and fix the data.
2. **Set Edge Function variables** (§2), with every optional switch off.
3. **Deploy the Edge Function.**
4. **Health check** (§5) before any traffic is pointed at it.
5. **Deploy the frontend** with `VITE_BACKEND_INTEGRATION=false`.
6. **Smoke** (§6).
7. **D2** — flip `VITE_BACKEND_INTEGRATION` to `true` and redeploy the
   frontend. Re-run §6 against live data.

Steps 1–6 are reversible without data loss. Step 7 is the first one customers
see behave differently.

---

## 4. Phase 5 — the KV→SQL sequence, after go-live

This is a separate programme and must not be folded into the launch.

| Step | Switch | Exit condition |
|---|---|---|
| 1 | `MCV2_SHADOW_READ_OUTCOMES=true` | A mismatch rate measured over real traffic. **S7.5, and the reason it is BLOCKED rather than unbuilt.** |
| 2 | `MCV2_SHADOW_READ_SUBMISSIONS=true` | As above (S7.8). |
| 3 | **D1** — run the backfill | Reconciliation reports `thresholdPassed` for every domain. |
| 4 | `MCV2_SQL_AUTHORITY_OUTCOMES=true` | The read-authority report shows SQL serving with `sqlDiverged: 0` and falling back rarely. |
| 5 | Submission read authority | **Blocked on D3 (H7)**, and then on code — its cutover is an aggregate read across five tables, not a projection. |
| 6 | S8.2 authority validation, S8.3 KV retirement | Human decision. |

**Rollback at step 4 is the switch.** Set `MCV2_SQL_AUTHORITY_OUTCOMES` to
anything but `true`/`1`; the next read is KV again. No deploy, no migration, no
data movement — proven live, including that the relational row is still sitting
untouched in the database afterwards.

The mechanism also fails safe on its own: a missing row, a refused connection,
a slow read, or an unset credential each fall back to KV and are counted rather
than failing the request.

---

## 5. Health checks

| Check | How | Healthy |
|---|---|---|
| Edge Function alive | `GET /make-server-324f4fbe/health` | 200 |
| Operational roll-up | `GET /make-server-324f4fbe/health/enterprise` (team auth) | 200, no source reporting failure |
| Migrations applied | The composite keys exist: `SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_organization\_fkey'` | **14** |
| Tenancy holds | `npm run test:database:tenancy` against a scratch copy of the production schema | 27 pass |
| KV reachable | Any authenticated console read returns data | — |
| Shadow read | The diagnostics route reports `enabled: false` | matches §2 |
| Read authority | Same route reports `outcomesAuthoritative: false` | matches §2 |

---

## 6. Smoke plan

Automated, against the deployed URL:

```
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<browser> npx playwright test
```

17 tests: sign-in, all thirteen destinations as deep links with a clean
console, reload-preserves-destination, unknown-page-parameter, signed-out
denial for both the console and the client portal, an unknown client email
refused, phone-width layout with no horizontal scroll, and four accessibility
checks. Point `baseURL` at the deployment.

Manual, five minutes, because a person notices what an assertion does not:

1. Sign in. The **demo-credential panel must be absent** in a live build — its
   presence means `BACKEND_INTEGRATION` is not actually on.
2. Open a submission, then reload. The URL and the page must agree.
3. Open the client portal as a real client. Enter the address, **receive the
   code by email**, enter it, and confirm only that client's data. If no code
   arrives, `RESEND_API_KEY` is not set and the portal is unusable — that is now
   a hard dependency, not a nicety.
4. Check the tab icon renders — no `/favicon.ico` 404 in the console.
5. Visit AI Control Plane. Confirm real requests are **off**.
6. Check the response headers on the deployed site: `Content-Security-Policy`,
   `X-Frame-Options`, `Strict-Transport-Security`. `npm run test:release` proves
   them against the artifact; this confirms the host is actually sending them.

---

## 7. What is NOT ready, stated plainly

| Item | Status |
|---|---|
| Submission read cutover | **Blocked on D3 (H7)**, then code. |
| Phase 2 backfill execution | Code complete, **never run**. D1. |
| S7.5 / S7.8 validation | Needs real traffic. Not a code gap. |
| Final security certification | **Performed.** Eleven findings, all closed. Section 8. |
| G4 AI Workforce runtime | Not built. Post-V1 by canon. |
| G6 external integrations | CRM gated on credentials; e-sign and scheduling specified only. |
| Chip contrast (4.17:1) and the marketing type ramp | Human design decisions, H1/H2. |
| `DiagnosticQuestion` / `ProgressModal` | Marked LIVE, unreferenced. H5. |

### On security certification

The campaign HAS now been run, in two passes, and section 8 is its result. The
earlier text here said it had not been; that is superseded.

Two of the eleven findings were BLOCKERs and neither was subtle once looked at
directly: posting an email address returned a working client-portal session, and
a deployment that had not set `TEAM_ADMIN_PASSWORD` got a platform administrator
whose password was in the shipped bundle. Both had survived every prior pass
because the prior passes asked whether the guards worked rather than who was
allowed past them — the G2 audit proved a client token cannot reach another
client's data, which was true, and says nothing about who can obtain a token.

**No known BLOCKER or HIGH release vulnerability remains.**

New required secret: `TEAM_ADMIN_PASSWORD` has no default, and `RESEND_API_KEY`
is now a hard dependency of the client portal rather than an optional nicety —
without it no sign-in code can be delivered. Both belong in the go-live secret
checklist.

**One required human action before release:** a deployment that ever ran with
the old `TEAM_ADMIN_PASSWORD` fallback still holds an account whose password was
public. Rotating it is a production credential change and is out of bounds for
this work. It must be done, and it cannot be verified from here — there is no
way to tell whether the published password was used.

---

## 8. The security campaign — eleven findings, all closed

Performed this cycle, in two passes. The second pass is why there are eleven
rather than nine: it found one leak the first pass's scanner was too narrow to
see, and one gap that is not a vulnerability at all.

Every finding follows the same shape — reproduce, classify, fix, pin with a
regression, then mutate the fix and confirm the regression fails. Mutation
counts are in the commit for each.

| # | Severity | Finding | Closed by |
|---|---|---|---|
| S-1 | HIGH | 67 routes interpolated the caught error into their 500 body; one returned a stack trace. PostgREST errors name tables, columns and constraints. | `failureResponse()` — full detail to the log against a short reference, `{error, reference}` to the caller. |
| S-2 | MEDIUM | `clientIp` in the provider-administration **audit trail** came from the caller-written half of `X-Forwarded-For`. An arbitrary string was recorded as the forensic origin of a privileged mutation. | `security/clientAddress.ts` — read from the right of the chain, parsed as an address, absent rather than fabricated. |
| S-3 | MEDIUM | The edge rate limiter keyed its bucket on the same caller-written value. Rotating the header gave every request a fresh bucket, so the only guard in front of the unauthenticated routes never bound. | `security/requestRateLimit.ts` — derived key, swept and capped map, isolate-wide ceiling. |
| S-4 | HIGH | The AI chat rendered every message through `dangerouslySetInnerHTML` with only `**bold**` transformed. A public diagnostic answer, quoted back by the assistant, executed in an operator's authenticated console. | `renderEmphasis` returns nodes. The sink is gone, not guarded. |
| S-5 | LOW | The proposal exporter interpolated `ann.color` raw into a `style` attribute; the print fallback `document.write`s into a same-origin window. | `safeColor` — six hex digits or the palette default. |
| S-6 | **BLOCKER** | `POST /auth/client/verify` returned a submission id, a company name and an **eight-hour session token** for any email address posted to it. `requireClientAccess` accepted `?email=` in place of a token on eight read routes. | `security/clientChallenge.ts` — a one-time code, hashed and salted per address, five attempts, ten minutes. The email fallback is gone. |
| S-7 | **BLOCKER** | The seeder created a **platform administrator** with a password hard-coded in this repository — and shipped in three chunks of the browser bundle, documented in the registry as the default and offered by the login screen as click-to-fill. | No fallback. Without `TEAM_ADMIN_PASSWORD` the seeder creates nothing and says so. |
| S-8 | MEDIUM | Invite temporary passwords came from `Math.random()`, whose outputs the same isolate publishes in ordinary responses (notification, message and lead ids). | `security/randomSecret.ts` — `crypto.getRandomValues`, rejection-sampled, ~139 bits. |
| S-9 | MEDIUM | Three unauthenticated write routes read an unbounded, untyped body and stored it. 120 requests a minute × whatever the sender chose. | `security/inputLimits.ts` — the request stream is bounded as it arrives, not by a declared length that can be a lie. |
| S-10 | MEDIUM | The **unauthenticated** health endpoint returned `String(err)` — the KV driver's message, naming host and table. Missed by the S-1 sweep because that scanner knew only `${err}`. | Removed, and the standing scanner widened to every spelling plus a pass over the eight public routes. |
| S-11 | *not a vulnerability* | There is **no route to delete a submission**. An erasure request cannot be honoured through the product. | Runbook below. The product capability is a **HUMAN_DECISION_REQUIRED** item, not a defect. |

### Areas swept with nothing found

Authentication and session lifecycle on the team side (`app_metadata` is re-read
from GoTrue on every request, so a revoked member loses access on their next
call); RBAC and rank guards on invite, role change and removal; RLS and tenant
isolation (G2, 27 adversarial scenarios against real PostgreSQL); service-role
boundaries; SQL injection (no string-built SQL anywhere — every database call is
PostgREST or a named RPC); SSRF on self-hosted provider endpoints
(`endpointPolicy.ts` covers link-local, IMDS, IPv4-mapped IPv6 and redirect
chains); BYOK, provider configuration, AI routing, spend and real-request gates
(2,183 tests); secrets in logs (lengths and validity flags, never values);
secrets in the bundle; files and object storage (none used); dependency supply
chain (`npm audit --omit=dev`: **0**, and 0 including dev after the vite bump);
migration safety and rollback (round-trip proven against real PostgreSQL).

### Response headers

`vercel.json` carries the policy; `scripts/serve-release.mjs` serves `dist/` with
it so it is tested rather than asserted. `npm run test:release` runs the whole
browser suite against the release artifact under the real headers — 23 tests,
including one that injects an inline script and proves it does not run.

`connect-src` is `'self' https:` because the Supabase project URL is
deployment-configured. Narrowing it to the project host is a deployment-time
improvement, not a code change.

---

## 9. Erasure runbook (S-11)

Until the product grows a deletion path, an erasure request is an operator task.
These are every place a data subject's details are held. Delete in this order —
indexes last, so a partial run leaves no dangling pointer.

**KV (`kv_store_324f4fbe`), by key:**

| Key | Holds |
|---|---|
| `sub:<id>` | the submission: contact name, email, phone, website, answers |
| `cortex:<id>`, `outcome:<id>`, `review:<id>` | analyses derived from it |
| `proposal:<id>`, `annotation:<id>` | proposal and its annotations |
| `msg:<id>:*`, `msg_read:<id>:*` | the message thread |
| `escalation:<id>`, `blockreg:<id>` | escalations raised on it |
| `lead:<leadId>` | a lead capture: name, email, phone, website |
| `booking:<id>` | a booking: contact email and scheduled time |
| `client_session:<token>` | any live portal session (expires in 8h regardless) |
| `sub_email:<email>`, `lead_email:<email>`, `booking_email:<email>` | **the indexes — delete last** |

**Relational:** `submissions`, `diagnostic_answers`, `diagnostic_scores`,
`domain_scores`, `submission_sections`, `reports`, `report_versions`,
`outcomes`, `contacts`, `contact_methods`, `leads`, `lead_sources`, `lead_tags`.
The composite foreign keys carry `ON DELETE SET NULL (column_list)`, so deleting
a parent does **not** cascade — each table is deleted explicitly, children first.

**Not to be deleted:** `cortex.membership_lifecycle_log`,
`cortex.membership_bootstrap_log`, `cortex.team_roster_stamp_log` and the AI
audit records. Those are the record of *administrative actions*, not of the data
subject, and they are append-only by design.

Verify with: no row in any table above matches the address, and
`kv_store_324f4fbe` holds no key whose value contains it.


---

## 10. The production execution plan

Written to be followed by a human with production authorisation. **None of it
has been run.** This environment cannot run it: the Supabase CLI is absent, no
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`TEAM_ADMIN_PASSWORD`, `RESEND_API_KEY` or any AI provider key is present, there
is no `.env` file, and the only outbound target configured is the git remote.
Checked for presence only; nothing was invoked against production.

### 10.1 Secrets that must exist before the first cold start

Names only. No value belongs in this repository or in any log.

| Secret | Why it is required | What happens without it |
|---|---|---|
| `SUPABASE_URL` | every KV and relational call | the function throws on its first request, naming the variable |
| `SUPABASE_SERVICE_ROLE_KEY` | same | same |
| `SUPABASE_ANON_KEY` | token verification | sign-in fails |
| **`TEAM_ADMIN_PASSWORD`** | **new (S-7).** Has no default and no fallback | **no administrator account is created**, and the log says exactly that. Recoverable in one step; a known password is not recoverable at all |
| **`RESEND_API_KEY`** | **now a hard dependency (S-6).** The client portal signs in by emailed code | the code is written to the server log instead and the portal is unusable to a client. Deployment-blocking |
| `EMAIL_FROM` | sender identity | falls back to the Resend sandbox sender |
| `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_NAME` | optional | sensible defaults |
| `CORS_ALLOWED_ORIGINS` | optional | wildcard, which is the current behaviour |

Everything under `AI_*` stays at its default. `AI_ALLOW_REAL_REQUESTS` is **off**
and must stay off until a human decides otherwise.

### 10.2 One required action this work could not perform

A deployment that ever ran with the old `TEAM_ADMIN_PASSWORD` fallback still
holds an account whose password was published in the browser bundle. **Rotate
it.** It is a production credential change and out of bounds here, and there is
no way to tell from outside whether the published password was ever used — which
is the reason to rotate rather than to check.

### 10.3 Deploy order

1. Apply migrations (§1). Stop if `20260910120000` refuses — that refusal is
   data, not a fault.
2. Set the secrets above. Restart so `seedAdminUser` runs.
3. Confirm the administrator exists and **sign in with the rotated password**.
4. Deploy the function, then the static site.
5. Confirm the response headers are actually being served (§6 smoke item 6).
6. Walk the smoke plan (§6).

### 10.4 The Phase 2 backfill — PRODUCTION_EXECUTION_PENDING

Code complete, proven against real PostgreSQL, **never run anywhere but a test
database**. Decision D1 holds it.

It is idempotent and checkpointed, so it may be stopped and resumed. Run it
**after** the deploy is healthy and **before** any read-authority switch, in
this order, one domain at a time:

```
npm run migration:inventory                 # counts only, writes nothing
npm run migration:simulate                  # full dry run, writes nothing
npm run migration:backfill -- --domain=submissions
npm run migration:reconcile -- --domain=submissions
npm run migration:backfill -- --domain=cortex
npm run migration:reconcile -- --domain=cortex
npm run migration:backfill -- --domain=outcomes
npm run migration:reconcile -- --domain=outcomes
npm run migration:backfill -- --domain=leads
npm run migration:reconcile -- --domain=leads
```

**Reconcile after each domain, not once at the end.** A mismatch found after all
four have run does not tell you which run introduced it.

#### Stop conditions — halt and do not continue to the next domain

| Condition | Why it stops the run |
|---|---|
| `migration:simulate` reports any quarantined record | the normalizer could not read a KV document. Read `migration_quarantine` before writing anything |
| reconciliation reports **any** field mismatch | the relational copy disagrees with KV. The reconciler reports the field and the row; it never rounds to zero |
| a row count differs from `migration:inventory` | something was skipped or duplicated |
| `backfill_dropped_answer_keys` is non-empty on any row | answers were lost. The read authority already refuses to serve such a row, but the backfill should not have produced one |
| any KV write occurs | the backfill is read-only against KV by design. A write means something other than the backfill is running |
| the run takes materially longer per row than the simulation | investigate before continuing; it is the signature of a missing index or a lock |

#### Rollback

The backfill **adds relational rows and changes no KV document**, so rolling it
back is deleting what it wrote — and KV remains the authority throughout,
because neither read-authority switch is on. Nothing a user sees changes at any
point in this procedure. That is the property that makes it safe to run in
production before the cutover, and it is why the switches stay off until §10.5.

Per-domain rollback scripts are under `supabase/migrations/rollbacks/`.

### 10.5 The read-authority cutover — after a mismatch rate, not before

Both switches default **off**, and off returns the KV record by identity without
reading the relational store at all.

```
MCV2_SHADOW_READ_OUTCOMES=true        # S7.5 — compare, KV still answers
MCV2_SHADOW_READ_SUBMISSIONS=true     # S7.7
                                       # then WAIT. Read the mismatch rate.
MCV2_SQL_AUTHORITY_OUTCOMES=true      # S8.1 — SQL answers
MCV2_SQL_AUTHORITY_SUBMISSIONS=true
```

**The rollback is the switch**, takes effect on the next read, and does not burn
the estate — stage 7 of the local rehearsal cuts over a *second* time after a
rollback, precisely so that a rollback is not a one-way door.

Do not turn on an authority switch until the shadow read has produced a mismatch
rate over real traffic that a human has looked at. The whole point of the shadow
stage is that it costs nothing to be wrong in it.

### 10.6 Backup and recovery

Before the migrations and again before the backfill, take a snapshot through the
Supabase project's own backup facility. This repository does not manage backups
and should not: a backup taken by the thing being changed is not a backup.

The recovery position is worth stating plainly, because it is better than it
looks: **KV is the authority throughout everything above**. Until an authority
switch is turned on, the worst case of a failed migration or a failed backfill is
relational rows that are wrong and that nobody reads. That is the reason the
order in §10.4 and §10.5 is the order it is.


---

## 11. The required stop

No production migration, backfill, deployment, data mutation, secret change,
credential rotation, or AI spending enablement has been performed, and none
will be without explicit approval.
