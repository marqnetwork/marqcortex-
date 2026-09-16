# MARQ Cortex V1 — Production Readiness

The go-live plan: what to apply, in what order, with what flags, how to tell it
worked, and how to undo each step.

**Nothing in this document has been executed.** Every production action is
withheld pending explicit human approval, which is the one required stop.

Prepared against main **`d3fc9f1`** — the current certified release candidate,
and the SHA every step below assumes. Companion to
`V1_COMPLETION_CHECKLIST.md` (what is done) and `AUTONOMOUS_BUILD_PROGRESS.md`
(how each item was closed).

**Before following this plan, confirm `main` carries no code change after the SHA
above:**

```
git diff --name-only d3fc9f1..origin/main | grep -v '^docs/'
```

**Empty → this document still describes what you are about to deploy.** Anything
listed → **stop and re-certify**: the migration census, the flag table and the
deploy order are claims about a specific tree, not standing facts. Documentation
commits land on top of a certified candidate routinely — including the one that
added this paragraph — so "is it the literal tip of `main`" is the wrong
question and would halt a rollout over a typo fix.

This header has been stale before — it read `2d0f8ae2` while the pre-flight in
§11 had been run against `0fae2d6` — which is exactly the class of defect an
operator acts on without noticing.

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
table before discarding the other tenants'. `tests/database/tenant_list_indexes.test.ts`
asserts the query PLAN on a populated table — an index that exists is not an
index that is used.

**For an operator with a large existing estate:** `CREATE INDEX` holds an ACCESS
EXCLUSIVE lock for the build. These tables are empty or near-empty at V1, so it
is instantaneous; against millions of rows, build them with `CREATE INDEX
CONCURRENTLY` outside a transaction instead. The migration cannot do that itself
because it runs inside one.

### Rollback

Thirteen of the twenty-one forward migrations have a rollback under
`supabase/migrations/rollbacks/`, including the new one. (This said *twelve*
until the pre-flight counted them: the prose was updated when the thirteenth
was added and the number was not. Every rollback file maps to a forward
migration — there are no orphans.) **Roll back in reverse dependency order** — each file
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
| `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_NAME`, `TEAM_ADMIN_PASSWORD` | Seeds the first team account — **creates it when absent, and changes nothing when it already exists.** This is not a rotation mechanism; see §10.2. |
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

### 5.0 Required before any health check — the production origins

**These are not recorded anywhere in this repository, and nothing below can be
run until an operator fills them in.** The repository knows the Supabase project
ref (`supabase/config.toml`, `utils/supabase/info.tsx`) and it knows the health
*paths*; it has never known where the application is actually served from.
`vercel.json` configures the host but names no deployment, and there is no
`.vercel/` project link in the tree.

Fill these in, in this document, as part of §10.3 step 0. An operator who
reaches §6 without them will improvise an origin, and a smoke run against the
wrong origin is worse than no smoke run — it reports green for something nobody
is about to ship.

| Field | Value | Where it comes from |
|---|---|---|
| **Production application origin** | `__________________` **(REQUIRED — unset)** | Vercel project **`marq-networks-projects/marqcortex`** → Settings → Domains → the production domain. Scheme + host, no trailing slash. The project was identified from the deployment status the Vercel GitHub integration posts on every pull request; the *domain* still has to be read from the dashboard, and a deployment inspector URL is not it. |
| **Production Edge Function origin** | `https://oqybniefkbppptfatoae.supabase.co/functions/v1` | derived from the project ref; confirm against the project before use |
| **Production Supabase project ref** | `oqybniefkbppptfatoae` (name: `cortex`) | `supabase/config.toml`, `utils/supabase/info.tsx`, `.env.example` |

Two rules about that first row:

- **Do not infer it.** Not from `vercel.json`, not from a branch preview URL, not
  from a Supabase dashboard link. A preview deployment answers `200` on every
  check in this section while being an entirely different build.
- **Confirm the origin serves the certified build before trusting a green
  result** — smoke item 6 (response headers) and smoke item 1 (the
  demo-credential panel) are the two cheapest ways to catch that you are
  pointed somewhere else.

`__________________` above is deliberately not a placeholder that parses. A
reader must notice it is missing.

### 5.1 The checks

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

**Prerequisite: the production application origin is recorded in §5.0.** If that
field is still blank, stop — there is nothing to point `baseURL` at, and
guessing is the failure mode §5.0 exists to prevent.

Automated, against the deployed URL:

```
PLAYWRIGHT_CHROMIUM_EXECUTABLE=<browser> npx playwright test
```

21 tests: sign-in, all thirteen destinations as deep links with a clean
console, reload-preserves-destination, unknown-page-parameter, signed-out
denial for both the console and the client portal, an unknown client email
refused, phone-width layout with no horizontal scroll, four hand-written
accessibility checks, and an **axe-core audit over WCAG 2.1 A and AA** across
every destination and every public page. Point `baseURL` at the deployment.

Note what changes when `baseURL` points at a live deployment rather than the
demo build: the suites here assert demo-mode behaviour, so a live run will
legitimately differ on anything demo data drives. The parts that hold in both
configurations are the deep links, the reload, the signed-out denials and the
accessibility audit.

Manual, five minutes, because a person notices what an assertion does not:

1. Sign in. The **demo-credential panel must be absent** in a live build — its
   presence means `BACKEND_INTEGRATION` is not actually on. `npm run
   test:production-config` already proves this against a backend-configured
   *build*; this step confirms the *deployment* was built with the flag on,
   which is a different claim and the one a wrong build setting breaks.
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

Nothing here is blocked on code that could be written in this environment. Each
row needs production authorisation, real traffic, a human decision, or scope V1
does not include — and says which.

| Item | Classification | Note |
|---|---|---|
| Phase 2 backfill execution | **PRODUCTION_EXECUTION_PENDING** | Code complete, proven against real PostgreSQL, **never run**. Procedure and stop conditions: §10.4. D1. |
| S8.1 read-authority rollout | **PRODUCTION_EXECUTION_PENDING** | Both switches off. Rollback is the switch and is rehearsed, including a second cutover after one. §10.5. |
| S7.5 / S7.8 shadow validation | **EXTERNAL_ENVIRONMENT_BLOCKED** | A mismatch rate needs real traffic. Instrumented, not a code gap. |
| Real backend integration QA (D2) | **EXTERNAL_ENVIRONMENT_BLOCKED** | No credentials, no CLI, no `.env` here. Everything not depending on it was completed: 25 browser tests against the release artifact under the real headers, and 4 more against a **backend-configured build** (`npm run test:production-config`) — what a production bundle renders before any call is made no longer rests on reading source. What remains genuinely needs a deployed project: signing in against real GoTrue, a real PostgREST round trip, and the mismatch rate. |
| S8.2 authority validation | **EXTERNAL_ENVIRONMENT_BLOCKED** | Then a human decision. |
| S8.3 KV retirement | **HUMAN_DECISION_REQUIRED** | A one-way door. |
| Four ORPHANED components | **HUMAN_DECISION_REQUIRED** | `DiagnosticQuestion`, `ProgressModal`, `SubmissionsListPage`, `QuickActions`. The manifest no longer misreports them; wiring or deleting is a product call. H5. |
| Rotate the old admin password | **HUMAN_DECISION_REQUIRED** | Out of bounds here, and required. **The procedure in §10.2 was wrong until Checkpoint A and has been rewritten** — setting `TEAM_ADMIN_PASSWORD` and restarting does not rotate an existing account. Follow §10.2 as it now reads, not from memory. |
| Production access for the rollout itself | **EXTERNAL_ENVIRONMENT_BLOCKED** | Checkpoint A: no Supabase CLI, no credentials, and `*.supabase.co` refused by egress policy. The rollout cannot be driven from this environment at all. §12. |
| Production application origin | **HUMAN_INPUT_REQUIRED** | Not recorded anywhere in this repository. §5 and §6 cannot run until it is. §5.0. |
| Production pre-mutation baseline | **PRODUCTION_EXECUTION_PENDING** | Refusal precheck not run, ledger unread, row counts not captured. The backfill has nothing to reconcile against until they are. §12.2. |
| Erasure path for a submission | **HUMAN_DECISION_REQUIRED** | No route deletes one. Operable today via the runbook in §9; whether V1 ships without a self-service path is a product and legal call. S-11. |
| Marketing type ramp | **EXPLICITLY_POST_V1** | Deferred deliberately in UI Sprint 8. H2. |
| S7.6 lead shadow read | **EXPLICITLY_POST_V1** | Not buildable as specified: no route serves a lead, so there is nothing to shadow. |
| `cortex_analysis` read cutover | **EXPLICITLY_POST_V1** | Canon names no shadow-read sprint for it. |
| G4 AI Workforce runtime | **EXPLICITLY_POST_V1** | Not built. Post-V1 by canon. |
| G6 external integrations | **EXPLICITLY_POST_V1** | CRM gated on credentials; e-sign and scheduling specified only. |
| G8 maturity stages | **EXPLICITLY_POST_V1** | Approved, explicitly not V1. |
| ~~Submission read cutover~~ | **COMPLETE** | D3 answered; wired, switch off, 18 live scenarios. |
| ~~Chip contrast~~ | **COMPLETE** | The recorded 4.17:1 case did not exist. Two real failures did, both fixed and now measured on every run. |
| ~~Final security certification~~ | **COMPLETE** | Twelve findings, all closed. §8. |
| ~~Accessibility audit~~ | **COMPLETE** | axe-core across all thirteen destinations, the landing page, the team login and the client portal, WCAG 2.1 A and AA. Two serious violations found and fixed; the suite runs under the real CSP in `test:release`. |

### On security certification

The campaign HAS now been run, in three passes, and section 8 is its result. The
earlier text here said it had not been; that is superseded.

Two of the twelve findings were BLOCKERs and neither was subtle once looked at
directly: posting an email address returned a working client-portal session, and
a deployment that had not set `TEAM_ADMIN_PASSWORD` got a platform administrator
whose password was in the shipped bundle. Both had survived every prior pass
because the prior passes asked whether the guards worked rather than who was
allowed past them — the G2 audit proved a client token cannot reach another
client's data, which was true, and says nothing about who can obtain a token.

**No known BLOCKER or HIGH release vulnerability remains.**

The third pass adds a caution the first two could not. S-12 was not a defect in
the product; it was a defect in the evidence — a scanner that had been reading
96% of the file it certifies since the day it was written. It was found only
because CORS was checked against the list of release requirements and turned out
to have no test, and writing that test could not see the middleware. **A guard
that has never failed is not the same as a guard that works**, and the remedy
that generalises is the one applied here: `tests/security/scannerIntegrity.test.ts`
checks the checkers, and names each middleware it expects to remain visible
rather than measuring a percentage — a ratio passes while the one region that
matters is missing.

New required secret: `TEAM_ADMIN_PASSWORD` has no default, and `RESEND_API_KEY`
is now a hard dependency of the client portal rather than an optional nicety —
without it no sign-in code can be delivered. Both belong in the go-live secret
checklist.

**One required human action before release:** a deployment that ever ran with
the old `TEAM_ADMIN_PASSWORD` fallback still holds an account whose password was
public. Rotating it is a production credential change and is out of bounds for
this work. It must be done, and it cannot be verified from here — there is no
way to tell whether the published password was used.

**Follow §10.2 for the procedure.** Setting the secret and restarting is *not* a
rotation — the seeder creates an account, it never changes an existing one — and
because the credential was public, rotation alone may not be enough: outstanding
sessions issued under it must be revoked as well. §10.2 covers both.

---

## 8. The security campaign — twelve findings, all closed

Performed over three passes. The second pass is why there were eleven rather
than nine: it found one leak the first pass's scanner was too narrow to see, and
one gap that is not a vulnerability at all. The third pass is S-12, and it did
not audit the code — it audited the auditors, after CORS turned out to be the
one release requirement with no test behind it.

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
| S-12 | MEDIUM *(control failure)* | Every static scanner stripped comments with a regex, which does not know `/*` inside a string is not a comment. The middleware is mounted on the literal path `"/*"`, so **4,146 characters of `index.tsx` were deleted before every scan** — the CORS policy, the edge rate limiter, its rate-limit headers and its 429 body. The S-1/S-10 error-disclosure guard could not see the rate limiter at all, and 1 of 232 response literals never reached it. | `tests/helpers/stripComments.ts` — a string-, template-, regex- and comment-aware pass. With the region restored the scanner reports **nothing**, so nothing there was disclosing: this is a guard that was not guarding, not a live leak. `tests/security/scannerIntegrity.test.ts` checks the checkers. Blast radius measured across every non-test source file: this was the only one. |

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

**CORS was the exception, and finding that is what produced S-12.** It was named
in the release requirements, the configuration was correct, and nothing tested
it. `tests/security/corsPolicy.test.ts` now pins the invariant the wildcard
origin rests on: `origin: '*'` is defensible here for exactly one reason — this
function sets no authentication cookie, so a browser attaches no ambient
authority to a cross-origin request, and a page on another origin cannot read
the bearer token out of the app origin's storage to send one. That premise lived
in a comment. It is now checked: credentials are never enabled, the origin is
never reflected from the caller's own `Origin` header, `CORS_ALLOWED_ORIGINS`
still exists as the deployment-time narrowing, and the server sets no cookie.

**The credential gate is now proven in the configuration it is claimed for.**
`tests/features/loginCredentialExposure.test.ts` states its own limit — it reads
source because "the browser suite runs in exactly one configuration, the demo
one, where they are supposed to be present". `npm run test:production-config`
builds with `VITE_BACKEND_INTEGRATION=true` and drives that artifact: the team
login renders neither the demo email nor the demo password, in visible text or
in `value`/`aria-label`/`title`/`placeholder`/`alt`; no control on the page
fills either field; and the client portal shows none of the three demo client
identities. Run against a demo build all four fail, so the proof discriminates.

### What the release actually ships

`vite build` prints a chunk-size warning on every successful run, which is a
warning nobody reads. Measured instead, and pinned:

| | Raw | Gzipped |
|---|---|---|
| Entry chunk (`index-*.js`) — downloaded before anything renders | 145 kB | **47 kB** |
| Largest lazy chunk (`CortexDashboard`) | 1,217 kB | **299 kB** |
| Whole bundle, 86 chunks | 4,398 kB | **1,221 kB** |

`npm run test:bundle` builds and enforces a ceiling over each of these. It is a
**ratchet, not a target**: the budgets sit above what ships today with room for
ordinary growth, and exist to catch the step change — a heavy library pulled
into the entry chunk, a lazy route that stops being lazy, a dependency bump that
doubles a vendor bundle. Those reach a user as a blank screen on a slow link and
are invisible in a diff.

**`CortexDashboard` is deliberately not being split for V1.** It was checked
rather than assumed: no heavy charting, PDF or date library is bundled into it
that is not already lazily routed — it is genuine application code, loaded on
demand, behind authentication, after the entry chunk has rendered. At 47 kB
gzipped the entry cost is the number that governs first paint, and it is
healthy. Restructuring the dashboard chunk is a refactor with regression risk
and the end of a release cycle is the wrong time for it; the budget makes the
size a recorded fact that cannot drift silently, which is the part that belongs
before a release.

### One unreproduced browser failure, recorded rather than dismissed

During the post-merge regression on `1ceb665`, one of the 25 release-artifact
browser tests failed **once**. It has not reproduced, and its identity was lost:
the run's output was piped through a filter that kept only the pass/fail counts,
and Playwright wipes `test-results/` at the start of each run, so the next run
destroyed the trace and error context before they were read. That is a mistake
in how the run was captured, not a property of the suite, and it is written down
because "it passed when I ran it again" is not a root cause.

What was then tried, each a full run of the same 25 tests against the same
artifact:

| Attempt | Result |
|---|---|
| Before the merge, suite alone | **25 passed** |
| After the merge, suite alone | **25 passed** |
| Under deliberate CPU saturation (4 busy loops on 4 cores) | **25 passed** (7.0m vs 6.2m) |
| Under the exact concurrent database battery the failing run had alongside it | **25 passed** |

Then, rather than accumulate more undifferentiated green, the two specs most
capable of producing an intermittent failure were stressed directly. Both use a
30-second settle poll, and one drives thirteen destinations in a single test:

| Attempt | Result |
|---|---|
| `accessibility-audit.spec.ts`, release build, `--repeat-each=3` | **6 passed** |
| the deep-link reload test, release build, `--repeat-each=5` | **5 passed** |

**Five full runs of the gate and eleven targeted executions of its most
timing-sensitive tests, with no recurrence.**

The observation stays on the record because a failure that cannot be named
cannot be called fixed, and "it passed when I ran it again" is not a root cause.
It is **not treated as blocking**: it is a single unexplained event on a gate
that has since passed everything asked of it, and the alternative — withholding
indefinitely on an unidentifiable one-off — would not be proportionate. A
reviewer should weigh it knowing exactly that much.

If it recurs, the run must be captured in full: do not pipe it through a
counting filter, and read `test-results/` before running anything else. That is
what lost this one.

### Response headers

`vercel.json` carries the policy; `scripts/serve-release.mjs` serves `dist/` with
it so it is tested rather than asserted. `npm run test:release` runs the whole
browser suite against the release artifact under the real headers — 25 tests,
including one that injects an inline script and proves it does not run, and the
axe-core accessibility audit under the real Content-Security-Policy.

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

**And the network policy closes the question independently of the credentials.**
Checkpoint A (§12) established that `*.supabase.co` and `supabase.com` are both
refused at the egress proxy — `CONNECT tunnel failed, response 403`, so no
request reaches production at all. Installing the CLI or supplying a key would
change nothing on its own. Either the policy is widened for this environment, or
the plan below is executed from an operator machine that already has both.

### 10.1 Secrets that must exist before the first cold start

Names only. No value belongs in this repository or in any log.

| Secret | Why it is required | What happens without it |
|---|---|---|
| `SUPABASE_URL` | every KV and relational call | the function throws on its first request, naming the variable |
| `SUPABASE_SERVICE_ROLE_KEY` | same | same |
| `SUPABASE_ANON_KEY` | token verification | sign-in fails |
| **`TEAM_ADMIN_PASSWORD`** | **new (S-7).** Has no default and no fallback. Governs account **creation only** — §10.2 | **no administrator account is created**, and the log says exactly that. Recoverable in one step; a known password is not recoverable at all |
| **`RESEND_API_KEY`** | **now a hard dependency (S-6).** The client portal signs in by emailed code | the code is written to the server log instead and the portal is unusable to a client. Deployment-blocking |
| `EMAIL_FROM` | sender identity | falls back to the Resend sandbox sender |
| `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_NAME` | optional | sensible defaults |
| `CORS_ALLOWED_ORIGINS` | optional | wildcard, which is the current behaviour |

Everything under `AI_*` stays at its default. `AI_ALLOW_REAL_REQUESTS` is **off**
and must stay off until a human decides otherwise.

### 10.2 One required action this work could not perform — administrator password rotation

A deployment that ever ran with the old `TEAM_ADMIN_PASSWORD` fallback still
holds an account whose password was published in the browser bundle. **Rotate
it.** It is a production credential change and out of bounds here, and there is
no way to tell from outside whether the published password was ever used — which
is the reason to rotate rather than to check.

#### Setting the secret does NOT rotate an existing account

**Read this before following §10.3.** An earlier revision of this document let
steps 2–3 be read as "set `TEAM_ADMIN_PASSWORD`, restart, sign in with the new
password". **That does not rotate anything, and on the exact deployment this
section is about it fails silently.**

`seedAdminUser()` (`supabase/functions/server/index.tsx`) is a *seeder*, not a
rotator. It branches on existence:

- account absent → it is **created** with the current `TEAM_ADMIN_PASSWORD`;
- account present → it logs `✅ Admin user already exists` and **returns without
  touching the password**.

So on a deployment that already seeded an administrator under the published
fallback, changing the secret and restarting leaves the old password live.
Worse, the verification in §10.3 step 3 would then *succeed* — against the old
credential — and the operator would record a rotation that never happened.
There is no password-change route anywhere in the Edge Function; the
`updateUserById` calls in `index.tsx` write roles and names, never passwords.

The secret still matters, for two reasons: it is what a *cold* project uses to
create the account in the first place, and leaving it at the old published value
means any future re-seed — a new project, a restored database with no auth user
— recreates the compromised credential. **Rotate the stored secret as well as
the live account. Neither substitutes for the other.**

#### The supported rotation procedure

Rotation is an out-of-band Supabase Auth action. Pick one path; both require
production authority this repository does not and should not hold.

**Path A — Supabase Dashboard (recommended; no tooling, fully audited).**

1. Take the recovery precautions below **first**.
2. Dashboard → project `oqybniefkbppptfatoae` → **Authentication → Users**.
3. Find the account at `TEAM_ADMIN_EMAIL` (default `admin@marqcortex.com`).
4. Update its password to a newly generated value.
5. Store that value in the approved secret store, then set it as the Edge
   Function secret `TEAM_ADMIN_PASSWORD` (Edge Functions → Secrets) so a future
   cold start cannot resurrect the old one.
6. Verify per the checklist below.

**Path B — Auth Admin API, with the service-role key.**

`supabaseAdmin.auth.admin.updateUserById(<userId>, { password: <new> })`, run
from an operator machine that already holds `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Then do step 5 above.

Never put the value in this repository, in a commit, in a shell history that is
retained, in a CI log, or in a support ticket. Generate it in the secret manager
if the secret manager can generate it.

#### Before you rotate — recovery precautions

Rotation is the one step in this plan whose failure mode is **losing the ability
to perform any of the other steps**. Establish the way back first:

- **Confirm a second route into the project exists** — a Supabase *project*
  owner/member login is not the same account as the application's
  `TEAM_ADMIN_EMAIL` user, and it is what lets you undo a bad rotation. If the
  only way into either is the account being rotated, stop and fix that first.
- **Confirm the mailbox at `TEAM_ADMIN_EMAIL` is monitored and reachable**, so
  a password-recovery email is an available fallback.
- **Have the new value stored before you set it**, not after. A rotation
  completed with a value nobody recorded is an outage.
- Rotation writes to `auth.users` only. It does not touch
  `public.organization_memberships`, `app_metadata`, or any application row, so
  the account's team role and membership survive it.

#### Verification — after rotation, in this order

1. Sign in at the production sign-in page with the **new** password. It must
   succeed.
2. Attempt a sign-in with the **old** published password. It must be refused
   with `401`. **This is the step that actually proves rotation happened**, and
   it is the one the previous procedure omitted — a successful sign-in with the
   new password proves nothing on its own if the old one still works too.
3. Confirm the account still resolves as a team admin (the console renders the
   team surfaces, and an AI request does not fail `ORGANIZATION_REQUIRED`) —
   i.e. `app_metadata` and the membership row are intact.
4. Record the rotation date and the operator. Do not record the value.

#### Session and token invalidation — assume nothing

**This is not documented by this repository and must be established against the
deployment rather than assumed.** A GoTrue password update does not
automatically revoke refresh tokens already issued in every configuration, so an
attacker holding a live session from the published credential may survive a
password change. Treat a *compromised* credential as requiring both:

- rotate the password, **and**
- revoke outstanding sessions for that user — Dashboard → the user → sign out /
  revoke sessions, or the Auth admin sign-out endpoint.

Verify which of these the project's GoTrue version actually does before relying
on either, and write the answer into this section once it is known.

#### Rollback / recovery if rotation loses access

- The new value is known but sign-in fails → re-set the password through the
  same path; `auth.users` has no lockout that a project owner cannot clear.
- The new value is lost → set another one through Path A or B. Rotation is
  idempotent and repeatable.
- Access to the *project* is lost as well → this is why the second route above
  is a precondition, not a nicety. Recovery is then a Supabase organization
  owner restoring project access, which is outside this plan.
- Nothing here is rolled back by reverting code or re-running a migration. The
  credential lives in Supabase Auth, not in this repository.

### 10.3 Deploy order

0. **Record the production application origin** in §5 before anything else. The
   health checks and the smoke plan cannot be run without it.
1. Apply migrations (§1). Stop if `20260910120000` refuses — that refusal is
   data, not a fault. Run the read-only precheck first, not the migration.
2. Set the secrets above. Restart so `seedAdminUser` runs. **On a cold project
   this creates the administrator. On a project that already has one it does
   not change its password** — see §10.2.
3. Confirm the administrator exists. **If the account already existed, rotate
   its password out of band per §10.2 and verify with the two-part check there
   — new password accepted AND old password refused.** Do not treat a
   successful sign-in as evidence of rotation on its own.
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

**Three different things are called "rollback" in this plan. They are not
interchangeable, and reaching for the wrong one during an incident is the
failure this table exists to prevent.** An earlier revision of this section
pointed the backfill rollback at `supabase/migrations/rollbacks/`, which holds
no backfill rollback at all — that directory undoes *schema*, and running one of
those files to undo *data* would drop the tables rather than the rows.

| What you are undoing | Mechanism | Where it lives |
|---|---|---|
| **Schema** — a forward migration's DDL | 13 SQL rollback files, applied in reverse dependency order, each stating its own ordering constraint in its header | `supabase/migrations/rollbacks/` |
| **Data** — rows a backfill run wrote | the migration CLI's `rollback` mode, targeted at one run id | `scripts/migration/cli.ts` → `supabase/functions/server/migration/rollback.ts` |
| **Behaviour** — which store answers a read | the environment switch itself; effective on the next read, no deploy and no data movement | §10.5 |

##### Data/backfill rollback — the actual procedure

**There is no `npm run migration:rollback` script.** The mode is reached through
the CLI directly — invoke it as written below, not by appending
`--mode=rollback` to one of the other `migration:*` scripts, which would leave
two conflicting `--mode` flags on one command line.

**First, preview. It writes nothing, and needs neither gate:**

```
node --experimental-strip-types scripts/migration/cli.ts \
  --mode=rollback --runId=<uuid> --dry-run
```

`--dry-run` returns the rollback preview — what that run wrote, and what would
be deleted — and returns before the `--confirm` and `MIGRATION_ROLLBACK_ENABLED`
checks are reached. Read it before executing.

**Then, to execute:**

```
MIGRATION_ROLLBACK_ENABLED=true \
node --experimental-strip-types scripts/migration/cli.ts \
  --mode=rollback --runId=<uuid> --confirm
```

Three things gate it, deliberately, and they are checked in this order:

- **`--runId=<uuid>` is required** — the CLI exits `1` with `rollback requires
  --runId` if it is absent. Rollback is scoped to the rows tagged with one
  migration run; it is not a "delete the relational copy" button. Take the run
  id from the backfill's own output, or from `public.migration_runs`.
- **`--confirm` is required** — without it: `Rollback requires --confirm flag`.
- **`MIGRATION_ROLLBACK_ENABLED=true` is required** — unset, or any other value:
  `MIGRATION_ROLLBACK_ENABLED=true is required for live rollback`. A destructive
  data operation does not run because somebody mistyped a mode.

It also needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and it records
itself in `public.migration_runs` with `mode: 'rollback'` and the target run id
in its metadata — so a rollback is as auditable as the backfill it undoes.

It deletes only rows that run wrote. It does not touch KV, which is why the
recovery position in §10.6 holds: until a read-authority switch is on, a wrong
relational row is a row nobody reads.

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

## 11. The production pre-flight — executed 2026-09-14 against main `0fae2d6`

**Read-only. No production system was contacted.** Every check below ran against
a local PostgreSQL 16 built from the repository's own migrations, or against the
source, or against a locally built release artifact.

### 11.1 The migration path, from an empty database

| Check | Documented | Measured |
|---|---|---|
| Migrations applied in filename order | 21 | **21, all clean** |
| Tables (`public` + `cortex`, excluding the auth stub a real project supplies) | 30 | **30** |
| Indexes (same scope) | 96 | **96** |
| Composite `(id, organization_id)` foreign keys | 14 | **14** |
| RLS enabled on `public` tables | all | **24 of 24**, 57 policies |
| `service_role` bypasses RLS | yes | **yes** |

### 11.2 The one migration that can refuse — proven on dirty data, not asserted

`20260910120000_cortex_tenancy_composite_keys` is the single highest-risk step
in the deploy order, because it is the only one whose outcome depends on
production's existing data. The whole operator path was driven:

1. **It refuses.** With one cross-tenant report planted, the migration aborts:
   `cortex_tenancy_composite_keys: existing rows already cross a tenant boundary.`
2. **It names what to fix** — `reports.submission_id -> submissions: 1 row(s)
   whose organization differs from their parent's`.
3. **It reports EVERY violating relationship in one attempt.** A second
   violation planted in `outcomes` produced both lines together, so an operator
   fixes the whole estate once rather than discovering it a table at a time.
   The guard loops all fourteen relationships and accumulates.
4. **The abort is clean.** 0 composite keys afterwards, the violating row still
   present and **still in its own organization** — not silently reassigned.
5. **The documented remedy works.** After fixing the two rows, re-applying
   succeeded and produced all 14 composite keys.

### 11.3 Rollback round trips

| Rollback | Round trip |
|---|---|
| `20260910120000_rollback_tenancy_composite_keys` | 14 composite keys → **0** → **14** |
| `20260911120000_rollback_tenant_list_indexes` | 79 indexes → **77** → **79** |

The index migration is also **idempotent**: applying it a second time leaves 79,
so a re-run deploy is safe.

### 11.4 Fail-closed behaviour, verified in the code rather than in prose

- **All seven switches §2 says must ship off are off when unset.** The three
  `MCV2_*` storage switches read `raw === 'true' || raw === '1'`, so absent or
  any other value is off; the four `AI_*` switches use `readBool(env, name,
  false)`, which also falls back to false on an unrecognised value.
- `kv_store` throws naming the missing variable (`SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY`) and never the value — the second is the
  service-role key.
- Without `TEAM_ADMIN_PASSWORD` the seeder creates **no** account and logs
  exactly what to set.
- The diagnostics route reports `outcomesAuthoritative`,
  `submissionsAuthoritative` and both shadow-read switches, behind team auth —
  the §5 health values an operator reads at go-live.

**One operator note.** The two flag parsers accept different vocabularies: the
`AI_*` switches take `yes`/`on`/`1`/`true`, the `MCV2_*` switches take only
`true`/`1`. Setting `MCV2_SQL_AUTHORITY_OUTCOMES=on` leaves it **off**. That
errs in the safe direction and §4 already specifies `=true` literally, so it is
not a defect — but during a sequenced cutover it would look like a switch that
did nothing. Use `true`.

### 11.5 Regression, at pre-flight

typecheck **0** across web, api and tests · features **1225** · security **954**
· system **177** · migration **244** · database **245** · lifecycle **241** ·
diagnostic **176** · AI **2183** · boundaries **107** · bundle **5** ·
`npm audit` **0** production and dev — **0 skipped anywhere**.

Real PostgreSQL 16, from a dropped and recreated database: membership scenarios
✓ · backfill ✓ · reconciliation **21** · tenancy **27** · cutover **10** ·
submission cutover **18** · rehearsal **8 stages** ✓.

Browser: smoke **21** · release artifact under real headers **25** ·
backend-configured build **4**.

### 11.6 New evidence on the open observation in §8

The unreproduced browser failure recorded in §8 has a material new data point.
Run with the machine to itself, the smoke suite finished in **1.1 minutes** and
the release suite in **1.0 minutes**. The runs around the original failure took
**8–10 minutes** — the same tests, roughly nine times slower, because that
session was running a database battery alongside them.

This still does not identify the failing test, and it is not offered as one: it
is circumstantial. But a suite starved to nine times its normal duration is a
materially more plausible place for a timeout to trip than a healthy one, and
the observation should be read with that in mind. It remains **recorded and
non-blocking**, on the same terms as before.

---

## 12. Checkpoint A — access and baseline, 2026-09-16, against main `d3fc9f1`

**Read-only. Production was not contacted.** The question this checkpoint asked
was not "is the code ready" — §11 answered that — but "can this environment
actually perform the rollout, and what is production's state before it starts".

**Result: BLOCKED. `PRODUCTION_MUTATION_NOT_AUTHORIZED`.**

### 12.1 What was established

| | |
|---|---|
| Source | `origin/main` == `d3fc9f1`, working tree clean, zero drift from the certified candidate |
| Supabase CLI | **ABSENT** |
| Supabase / Vercel credentials | **ABSENT** — presence-checked only, no value read |
| Egress to `*.supabase.co`, `supabase.com` | **REFUSED** by network policy (403 at proxy CONNECT). Not worked around |
| Production project | `oqybniefkbppptfatoae` (`cortex`) — identified from repository configuration, **not contacted** |
| Production application origin | **not recorded anywhere in this repository** → §5.0 |

### 12.2 What could NOT be captured, and why it matters

Every item below is a Checkpoint A exit criterion, and every one of them fails
for the same root cause — no production access:

- **Migration ledger** — applied / pending / out-of-band: **UNKNOWN.**
- **The refusal precheck for `20260910120000`: NOT RUN.** Neither `PASS` nor
  `REFUSAL_EXPECTED` can be asserted. **This alone blocks the first step of
  §10.3.** The precheck itself is read-only and is reproduced from the
  migration's own step 0 — fourteen child→parent pairs under
  `c.organization_id IS DISTINCT FROM p.organization_id` — and writes nothing.
- **Pre-mutation row counts: NOT CAPTURED.** The BEFORE leg of
  BEFORE → BACKFILL → RECONCILIATION → CUTOVER does not exist, so the backfill
  in §10.4 currently has nothing to reconcile against.
- **Effective production flag state: UNAVAILABLE.** Every switch in §2 was
  verified to *default* off at source, with strict `=== 'true' || === '1'`
  readers — but a default is not a reading. **No dangerous flag was observed ON;
  that is not the same claim as "they are OFF in production", and this document
  does not make the second one.**
- **Deployed commit, Edge Function version, production health: UNKNOWN /
  UNREACHABLE.**

### 12.3 Rollback capability, separated honestly

| Capability | Status |
|---|---|
| Schema migration rollback | **PROVEN LOCALLY** — 13 files, no orphans, composite-FK round trip 14 → 0 → 14 |
| Data/backfill rollback | **PROVEN LOCALLY** — §10.4, gated three ways |
| Authority-switch rollback | **PROVEN LOCALLY** — rehearsed, including a second cutover after a rollback |
| Backfill / reconciliation stop conditions | **AVAILABLE** — §10.4 |
| Database snapshot & recovery | **UNVERIFIED IN PRODUCTION** — §10.6 delegates to the Supabase project's own backup facility; its existence, retention and PITR window have not been confirmed |
| Previous application deployment rollback | **UNVERIFIED IN PRODUCTION** |
| Edge Function rollback / redeploy | **UNVERIFIED IN PRODUCTION** |

Nothing above is claimed as a production capability on the strength of a local
pass.

### 12.4 What must be resolved before Checkpoint A can return READY

1. Egress to `*.supabase.co` and `supabase.com`, **or** an operator machine that
   already has it. Requires a human; the policy is not to be circumvented.
2. Supabase CLI — installable, but useless before (1).
3. Authenticated project access: a CLI access token and a read-capable database
   credential. **Requires a human login; this is the boundary the work stops
   at.**
4. The production application origin → §5.0.
5. Then: run the precheck, capture the ledger, the schema/RLS/FK state and the
   row counts, and read the effective flag state.

### 12.5 Defects this checkpoint found in *this document*

Documentation defects, all corrected in the same change that added this section:

| Defect | Where | Correction |
|---|---|---|
| The rotation procedure was a **silent no-op** on an existing account — and its verification step would have *passed* against the old credential | §10.2, §10.3 | rewritten: `seedAdminUser` creates, it does not rotate; out-of-band procedure, recovery precautions, and a two-part verification that checks the **old** password is refused |
| Backfill rollback pointed at `supabase/migrations/rollbacks/`, which contains no backfill rollback — following it would drop tables instead of rows | §10.4 | three rollback kinds separated; the real CLI invocation, its dry-run preview, and all three gates documented |
| No production application origin recorded anywhere | §5 | §5.0 added as a required, deliberately unfillable-by-accident field; §6 gated on it |
| Header read `2d0f8ae2` while the §11 pre-flight had run against `0fae2d6` | header | set to `d3fc9f1` with a standing instruction to stop if it is stale |

The first two are the significant ones: both are procedures an operator would
have followed confidently, during a production rollout, and both would have done
something other than what the operator believed.

---

## 13. The required stop

No production migration, backfill, deployment, data mutation, secret change,
credential rotation, or AI spending enablement has been performed, and none
will be without explicit approval.
