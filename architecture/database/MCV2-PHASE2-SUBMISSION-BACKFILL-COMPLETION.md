# MCV2 Phase 2 — Submission Domain Backfill

**Status:** code complete, verified locally including against a real
PostgreSQL 16. **Not run against any real data** — executing a backfill is a
deployment action and needs human authorisation.

**Branch:** `claude/marq-cortex-batch-4f-c1hmm0`

---

## 1. What this is, and what it is not called

`MCV2-S3-MIGRATION-ROADMAP.md` Part A Phase 2 (Backfill), applied to the second
domain. S6.2 delivered the lead and contact slice and deferred the rest; S6.3
did not take it up.

It is deliberately **not** given a new `S7.x` number. Phase 4 of the roadmap
already spends S7.1 through S7.8, and numbering Phase 2 work as an S7 sprint
would put one piece of work under two schemes.

---

## 2. Three pieces

| | |
|---|---|
| `migration/submissionNormalizer.ts` | Every mapping judgement, as one pure function. No client, no clock. |
| `migration/domains/submissions.ts` | The batch processor and the writer. |
| `migration/orchestrator.ts` | Refactored to run any domain through one loop. |

**One loop, not two.** Paging by key order, checkpointing after every batch,
incrementing run counters, pausing at `--maxBatches` and completing the
checkpoint only when the scan genuinely finished — that is the part of a
migration that must not vary, and a second copy for the second domain would be a
second place for resume semantics to drift. Resume semantics are what a
half-finished production backfill depends on. `runLeadMigration` is now a call
into the shared loop with the lead descriptor; the S6.2 lead suite passes
unmodified.

The domain map erases its context type through a closure rather than a cast —
the kind of cast that stays correct until somebody adds a third domain.

Run it with `--domain=submissions`; the flag defaults to `leads`, which is what
every pre-existing invocation means.

---

## 3. The mapping decisions the roadmap flagged for human review

**Quarantine only where writing would be wrong.** A blob that does not parse; a
payload that is not an object; an absent email (`contact_email` is NOT NULL and
an email is the only way a submission is later matched to its lead); an absent
company (`company_name` is NOT NULL, and a fabricated one would be put in front
of a consultant as fact). **Nothing else.**

A submission that is merely incomplete is migrated, because refusing a real
submission over a vocabulary difference is worse than recording a default — and
**every default is named on the record it was made about**, in
`metadata.backfill_inferred_fields`, so a reconciliation can find every record
the backfill had to guess about.

| Guess | Recorded as |
|---|---|
| unrecognised status → `new` | `status_unrecognised` |
| absent status → `new` | `status_default` |
| unrecognised priority → `medium` | `priority_default` |
| unparseable `submittedAt` → the epoch | `submitted_at_default` |
| a score outside 0–100 → null | `<name>_out_of_range` |
| answer keys that collide when lower-cased | `answers_collapsed` + the dropped keys |

The epoch rather than "now", for the reason the lead normalizer gives: an
invented timestamp would tell a consultant this submission arrived today.

**The status vocabulary is imported from the shadow read's projection, not
restated.** Two copies of a vocabulary mapping is how a backfill and the
instrument that checks it end up disagreeing about what a converted deal is
called.

**A score outside 0–100 is dropped rather than stored.** The columns are plain
`INTEGER` with no check constraint, so a nonsense value would be stored and
shown; a score of 4,300 on a consultant's screen is worse than a blank one.

---

## 4. The writer converges on KV rather than accumulating from it

Upserting the submission and its score row gives idempotency for free. The
answers do not: an answer key removed in KV would otherwise survive forever as a
relational row no re-run could explain and no reconciliation could attribute.

So after upserting the current answers, the writer **retires** the rows whose
`question_key` is no longer present — soft-deleted, because a migration that
permanently removes a row it did not create cannot be reasoned about afterwards.
The empty-answer-set case is handled explicitly: an empty `NOT IN ()` is not a
filter PostgREST accepts, and the sweep must retire everything rather than
nothing.

**The score row is written even when all three scores are null.** Its absence
and a row of nulls mean different things — "never scored" versus "the migration
has not reached it" — and only the second is a reason to look.

**Lead and contact links are enrichment, not a precondition.** Both columns are
nullable and both reference rows the lead backfill creates, so a deployment that
migrates submissions first gets null links and a later re-run fills them in,
rather than a refused batch. Blocking on them would make the order of two
independent backfills load-bearing.

**Both lookups are organization-scoped.** A join on email alone would attach one
tenant's submission to another tenant's contact — the one mistake here that
re-running cannot undo.

---

## 5. Verified against a real PostgreSQL

`npm run test:database:submissions` applies the real tenancy and diagnostic
migrations to a scratch database as `cortex_migration_owner` (NOSUPERUSER, with
BYPASSRLS — a superuser owner sails through checks a deployment's owner has to
pass) and then drives the statements the backfill issues, as `service_role`.

| | |
|---|---|
| SB-1 | the submission round-trips by `legacy_kv_key` |
| SB-2 | the unique index admits exactly one row per KV key — which is what makes a re-run an update |
| SB-3 | **the console vocabulary is refused by the schema** — `under-review`, `approved` and `critical` all raise `check_violation`, so the normalizer's canonicalisation is load-bearing rather than decorative |
| SB-4 | answers respect the lower-case CHECK and the `(submission_id, question_key)` unique index |
| SB-5 | the retirement sweep soft-deletes exactly the keys KV dropped, including all of them |
| SB-6 | one score row per submission, enforced by the database |
| SB-7 | **an outcome cannot exist without its submission** — the FK the whole domain ordering rests on, proved rather than repeated |
| SB-8 | **the schema does NOT prevent a cross-tenant contact link** — so the writer's scoped lookup is the only control there is, and the assertion says so |

SB-8 is written to fail loudly and instructively if the schema ever gains that
constraint: the message says to rewrite the assertion rather than delete it.

A new harness step, `06_platform_public_grants.sql`, supplies what a Supabase
project grants `service_role` on `public` and a bare PostgreSQL does not.
`anon` and `authenticated` are deliberately left alone — handing them blanket
privileges would make every isolation assertion in that directory weaker than
the deployment it models.

---

## 6. Verification

```
npm run test:migration              137 pass  (41 new across the normalizer and domain)
npm run test:database:submissions   8 assertions, real PostgreSQL 16
npm run test:database:4c            passed, real PostgreSQL  (regression)
npm run test:database:4d            passed, real PostgreSQL  (regression)
npm run test:database:scenarios     passed, real PostgreSQL  (regression)
npm run test:database               206 pass, 1 skipped without DATABASE_URL
  with DATABASE_URL set             kv_compare_and_swap 19 pass — a suite that
                                    had never run in this environment
npm run typecheck:api:pure          clean
npm run typecheck:tests             29 errors — identical to the baseline
```

---

## 7. Reconciliation

`migration/submissionReconciliation.ts`, wired onto the domain descriptor, so a
submission backfill reconciles itself and `--mode=reconcile --domain=submissions`
works.

**It compares FIELDS, not only counts.** `MCV2-S5-KV-RELATIONAL-MAPPING.md` asks
for a field-level hash on a sample for this domain, and the difference matters:
a backfill that wrote a row for every KV record and got the status wrong on all
of them passes a count check. A field mismatch fails the threshold here.

**The comparison borrows the shadow read's comparator and projection.** A
reconciliation that agreed and a shadow read that disagreed would send an
operator hunting for a difference between two stores when the real difference
was between two comparators. One comparator cannot disagree with itself.

**The sample is deterministic, not random.** The mapping document says random;
deterministic is better, because a reconciliation is run, a fix is made, and it
is run again to see whether the fix worked — and with a random sample the second
run inspects different records, so an unchanged mismatch count means nothing.
The sample is an evenly spaced walk over the sorted key list: it covers the whole
range, reproduces across runs, and moves only when the data does.

A quarantined record is **not** counted missing: it was deliberately not
written, and counting it would make every reconciliation of a real estate fail
for doing the right thing. An `orphanCount` reports the mirror case — a
relational row whose KV record is gone, which is not a backfill failure but is
the number that says a cutover would serve a record the authoritative store no
longer has.

### A finding about the LEAD reconciliation

`migration/reconciliation.ts` (S6.2, certified) hard-codes
`sampleMismatchCount = 0` and never performs the field comparison its own report
claims, and it computes `missingCount` three times, the first two of which are
overwritten before use. Neither is touched here — it is certified code and this
work does not need it — but a lead reconciliation reports a field-level pass it
never made, and that is worth its own change. Recorded in
`docs/development/AUTONOMOUS_BUILD_PROGRESS.md`.

## 8. The `cortex:` domain

`migration/cortexNormalizer.ts` and `migration/domains/cortexAnalysis.ts`, run
with `--domain=cortex`. `MCV2-S5-KV-RELATIONAL-MAPPING.md` maps
`cortex:{submissionId}` to `diagnostic_scores` + `domain_scores`.

**It enriches; it never overwrites.** `sub:` and `cortex:` both carry an
`aiScore` and a `qualityScore` and they are not always the same number — the
submission's are what the console shows, the analysis's are what the model
returned. KV is authoritative and `sub:` is what the console reads, so the
submission backfill's values stand and this domain writes only what only it has:
the pillar heatmap as domain scores, the bands, and the provenance. A cortex
backfill that also wrote the scores would make the result depend on which domain
ran last, which is the worst property a migration can have.

**Two decisions the mapping document does not make:**

*The heatmap is 0–5 and `domain_scores.score` is 0–100.* Storing 4 for "four out
of five" is **accepted** by the constraint and read as four percent by every
consumer — the database cannot catch it, which is exactly why the scaling has to
happen in the normalizer. The value is scaled onto the column's own scale and
the original is recorded in the row's `metadata`, so the transformation is
auditable and nothing is lost. A pillar outside 0–5 is **dropped, not clamped**:
clamping would record a measurement that was never made.

*The readiness score is a band, not a number.* `readinessScore` is `Low`,
`Medium` or `High`; `diagnostic_scores.readiness_score` is an INTEGER. This
domain does not invent one. Mapping the bands onto 25/50/75 would put three
numbers in the database that no model ever produced and every consumer
downstream would treat them as measured. The band goes into
`diagnostic_scores.metadata`, and the integer column is left alone until
something actually measures it.

**The dependency is per record, not per batch.** An analysis whose submission
has not been migrated is quarantined with `SUBMISSION_NOT_MIGRATED` and the run
finishes. A failed batch tells an operator the migration is broken; a quarantine
record tells them exactly which analyses are waiting on which submissions, and a
re-run after the submission backfill picks them up.

Five more assertions in the real-PostgreSQL harness (`CB-1`–`CB-5`) cover the
0–100 constraint in both directions, the provenance round-trip, the lower-case
`domain_key` check and the one-row-per-pillar index, the foreign key that makes
`SUBMISSION_NOT_MIGRATED` a necessity rather than caution, and the metadata-only
score row that lets a band be recorded without a number.

## 9. What is NOT done

- **No reconciliation for the cortex domain.** The orchestrator therefore
  completes a cortex backfill and says plainly that it did not reconcile.
- **No report backfill.** The client report maps to `reports` +
  `report_versions`; a separate domain.
- **Nothing has been run against real data.** Executing a backfill needs a human
  decision and production credentials.
