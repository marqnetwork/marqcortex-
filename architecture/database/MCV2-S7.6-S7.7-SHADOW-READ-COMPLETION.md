# MCV2-S7.6 / S7.7 — Lead and Submission Shadow Read

**Status:** S7.7 code complete and verified locally, activation deferred.
**S7.6 is not implementable as specified** — see §1, which is a finding rather
than a blocker.

**Branch:** `claude/marq-cortex-batch-4f-c1hmm0`

---

## 1. S7.6 — Lead Shadow Read: the sprint has no read to shadow

A shadow read observes a RUNTIME READ: it compares the record a caller was
actually served against what the other store holds. The lead domain has no such
read.

`index.tsx` writes leads on two routes — `POST /leads/capture` and
`POST /leads/exit-intent` — and reads `lead_email:` only as a duplicate check
inside the second. **There is no route that serves a lead to anybody.** Leads
reach the console as part of submissions, not as leads.

Two things follow, and neither is "build it anyway":

- **A shadow read wired to a write is not a shadow read.** It would be write
  verification: useful, differently shaped, and not what Phase 3 needs evidence
  for. Phase 3's question is "if we read SQL first, would callers get the same
  answer?", and a domain nobody reads has no such risk to measure.

- **The capability already exists elsewhere.** Comparing every KV lead against
  its relational row is bulk reconciliation, and `npm run migration:reconcile`
  has done exactly that since S6.2 — over the domain whose backfill is the only
  one that has actually run. Building a second one inside the request path would
  be duplicate architecture with worse coverage.

**Recorded, not worked around.** If a lead read route is ever added, this
instrument extends to it the way the submission one did: a projection, a field
set, one call.

---

## 2. S7.7 — Submission Shadow Read

The S7.4 instrument, aimed at the platform's core entity. One new projection,
one switch, one call in the submission read route. No new machinery: the reader,
the comparator, the deadline, the bounded ledger and the report are the ones
S7.4 built, and the submission domain shares the single reader so there is one
report to consult and one deadline that cannot drift.

| | |
|---|---|
| Wired into | `GET /submissions/:id` — after the response body is decided |
| Switch | `MCV2_SHADOW_READ_SUBMISSIONS`, off by default, separate from the outcome one |
| Compared | legacy id, company, contact, email, phone, website, industry, status, priority, three scores, submitted-at |

**Why the switches are separate.** One switch for both domains would mean an
operator who wanted to watch outcomes had to accept the cost on the busiest read
path on the platform, and an operator who found a problem on submissions could
only stop it by blinding themselves to outcomes as well. Per-domain switches
make the instrument something an operator can aim.

---

## 3. The three projection decisions that decide whether the report is worth reading

**Status is canonicalised on both sides.** KV writes the console's vocabulary
(`under-review`, `report-ready`, `approved`); the relational check constraint
requires `under_review`, `report_ready`, `won`. They are the same facts in two
spellings, and the projection maps both sides to the relational vocabulary — the
one the schema will still be using after the cutover.

The mapping is a declared table rather than a hyphen-to-underscore rule, because
the two vocabularies are not mechanically related: `approved` is the console's
word for `won`, and a blanket rule would produce `approved`, which the
constraint rejects. Every converted deal would be quarantined and nobody would
learn why from the comparator.

An unrecognised status projects to **absent**, so it reports as
`missing_in_*` — a mapping gap in this repository — rather than as
`value_mismatch`, which would claim the two stores hold different statuses when
the truth is that we do not know what one of them means.

**Three groups are deliberately not compared.**

- *Presentation.* `submittedDate` is `submittedAt` formatted for a browser and
  `isRead` is a console flag. Comparing a formatted date against a `timestamptz`
  would report drift on every record.
- *The answer map.* `answers` migrates to `diagnostic_answers` as ROWS, not to a
  column. Comparing an object against a table is a different check — a count and
  a per-key comparison — and belongs in its own domain. A report of
  `answers=value_mismatch` tells an operator nothing they can act on.
- *Written placeholders.* The capture route writes the literal `'Not specified'`
  and `'TBD'` where it has no value, and there is no relational column for
  either. Comparing them would report a mismatch no migration could ever fix.

**Absence has one spelling.** `null`, missing, `''` and the placeholders all
project to `undefined`, so a projection read in a failing test is one shape
rather than four.

---

## 4. Verification

```
npm run test:migration        96 pass   (17 new for S7.7, 43 from S7.4)
npm run test:features        726 pass
npm run typecheck:api:pure    clean
npm run typecheck:tests       29 errors — identical to the pre-sprint baseline
```

KV remains authoritative. `index.tsx` still imports no repository, the reader
still returns `void`, and the submission route serves exactly what it always
did — asserted as source, because that is a claim about absence.

---

## 5. Next

Both instruments now report `row_absent` on a real deployment, because neither
backfill has run. That is the correct reading and it is the number the backfill
will be judged by.

The dependency-safe work is the **submission backfill** (Phase 2 for the
submission domain), which S6.2 deferred and which the roadmap flags for human
review on legacy-ID mapping and email uniqueness. The outcome backfill depends
on it: `outcomes.submission_id` is NOT NULL and references `submissions`, so no
outcome row can exist before its submission does.
