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

These are not engineering tasks. Nothing below can proceed past the step it
gates until a person decides.

| # | Decision | Why it cannot be decided here |
|---|---|---|
| **D1** | Run the Phase 2 backfill against production data | Code complete and proven against PostgreSQL 16; running it writes to customer data. |
| **D2** | Turn `BACKEND_INTEGRATION` on — the demo→live cutover | It changes every data path in the product at once. |
| **D3** | **H7** — may the submission response body change? | The relational round-trip turns KV's `phone: 'Not specified'` into `null`. Proven, not assumed. Canon does not say whether that is allowed. Gates the submission half of S8.1 only. |

---

## 1. Migration order

Twenty migrations, applied in filename order. This exact sequence is verified
on every run of `test:database:tenancy`, `:cutover`, `:reconciliation`,
`:diagnostic`, `:scenarios`, `:4c` and `:4d`, each of which builds a scratch
database from them.

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
20260910120000_cortex_tenancy_composite_keys      ← new in this cycle
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

### Rollback

Eleven forward migrations have a rollback under `supabase/migrations/rollbacks/`,
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
3. Open the client portal as a real client. Confirm only that client's data.
4. Check the tab icon renders — no `/favicon.ico` 404 in the console.
5. Visit AI Control Plane. Confirm real requests are **off**.

---

## 7. What is NOT ready, stated plainly

| Item | Status |
|---|---|
| Submission read cutover | **Blocked on D3 (H7)**, then code. |
| Phase 2 backfill execution | Code complete, **never run**. D1. |
| S7.5 / S7.8 validation | Needs real traffic. Not a code gap. |
| Final security certification | **Not performed.** See below. |
| G4 AI Workforce runtime | Not built. Post-V1 by canon. |
| G6 external integrations | CRM gated on credentials; e-sign and scheduling specified only. |
| Chip contrast (4.17:1) and the marketing type ramp | Human design decisions, H1/H2. |
| `DiagnosticQuestion` / `ProgressModal` | Marked LIVE, unreferenced. H5. |

### On security certification

A **comprehensive final security campaign has not been run**, and this document
does not claim one. Canon puts it after functional V1 closure, and V1 is not
functionally closed while D1, D2 and D3 are open.

What HAS been done this cycle is narrower and worth stating exactly: the G2
tenancy audit enumerated every organization-authority path from request to
database, classified each, found and closed a fourteen-relationship gap in the
schema, and left no caller-controlled authority path unverified. Integration QA
then found and fixed ungated administrator credentials on the public sign-in
page. Neither is a substitute for the certification.

---

## 8. The required stop

No production migration, backfill, deployment, data mutation, secret change,
credential rotation, or AI spending enablement has been performed, and none
will be without explicit approval.
