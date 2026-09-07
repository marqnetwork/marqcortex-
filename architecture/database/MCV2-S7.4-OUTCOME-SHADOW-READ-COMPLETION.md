# MCV2-S7.4 — Outcome Shadow Read

**Status:** code complete, verified locally. **Activation deferred** — the
switch is off by default and turning it on in production is a deployment
decision.

**Branch:** `claude/marq-cortex-batch-4f-c1hmm0`

---

## 1. What the sprint is

The migration roadmap's Phase 3 is dual-read: serve from one store, read the
other alongside it, and measure whether they agree. A **shadow** read is the
strictly weaker half — the half that is safe to run while KV is still
authoritative — and S7.4 builds it for the first domain, `outcome:`.

Its output is the instrument S7.5 validates against, and the evidence Phase 3
proper needs before anything reads SQL first.

**The golden rule is untouched:** KV remains authoritative. Nothing in this
sprint can change a response.

---

## 2. The four invariants

Stated in `storage/contracts.ts`, held by `storage/shadowReader.ts`, and tested
both as behaviour and as source.

| | |
|---|---|
| **It never changes what is served** | The KV answer is decided, the reader is handed it, and the reader returns `void`. No exported function hands a relational row to a route, and `index.tsx` imports no repository at all — so serving from SQL is a decision somebody has to make, not one an edit can drift into. |
| **It never fails a request** | Every error — a missing table, a revoked grant, a malformed row, a client that cannot be constructed — is caught and RECORDED. A measurement that can take a route down is not a measurement. |
| **It never runs unbounded** | The relational read is raced against a deadline (250 ms default, 10–2000 bounded). A late result is discarded and its rejection absorbed, so it cannot surface after the response has gone. |
| **It never records a customer value** | A record carries the field name, the divergence kind, the KV key and integers. Asserted by serialising the whole report and scanning it. |

It is **off by default** (`MCV2_SHADOW_READ_OUTCOMES`), read at the point of use
so an operator turning it off stops the next read rather than the next deploy.

---

## 3. The comparator is deliberately boring

The failure mode of a dual-read comparator is not missing drift. It is reporting
drift that is really an encoding difference, burying three real divergences
under ten thousand false ones — and a comparator nobody trusts gets switched
off, leaving the migration with no instrument at all.

So each field declares a rule, and each rule exists because the two stores
genuinely encode that fact differently:

| Rule | Exists because |
|---|---|
| `timestamp` | A `timestamptz` round-trip does not preserve the millisecond an ISO string carried. Compared at **second** precision. |
| `numeric` | PostgreSQL `numeric` arrives as the string `"1500.00"`. |
| `text` | KV writes `''` where the column is NULL. Trimmed; `null`, `undefined` and `''` are one absence. |
| `exact` | Booleans and identifiers, strictly. |

`type_mismatch` and `value_mismatch` are separate kinds because they are
separate bugs: the first is a mapping defect in this repository, the second is
real drift in the data, and an operator sent to the wrong one wastes exactly the
time the instrument exists to save.

The comparator walks the **declared field set**, never the keys it happens to
find — otherwise a mapping that dropped a field would report perfect agreement
for the rest of the migration.

---

## 4. The outcome projection

Both stores project to one flat shape, so the comparison is made on the fact
rather than on either store's spelling of it.

- `didConvert` (KV boolean) and `outcome_type` (relational enum) both project to
  `converted: boolean | null`. `engagement` — the column default — projects to
  **absent**, not to `false`: projecting it as `false` would report every
  un-migrated row as a lost deal.
- The relational identity is read from `legacy_kv_key`, not from the row's UUID.
- The **denormalised submission snapshot is deliberately not compared.** KV
  carries company, industry and score as they were when the outcome was logged;
  the relational model carries them live. A company that renamed itself would
  report as drift forever, and the correct answer to that divergence is not a
  migration fix.
- Both projections are total: a malformed record projects to `{}` rather than
  throwing. The Phase 0 inventory documented double-encoded and partial records.

---

## 5. `missing_in_sql` is a result, not a fault

The outcome backfill has not been written — S6.2 delivered the lead and contact
slice and deferred the rest. So on the day this ships, a shadow read of a real
deployment reports `row_absent` for essentially every record. That is the
**correct** answer, and it is the number the backfill will be judged by.

The report therefore:

- counts `rowAbsent`, `timeouts` and `errors` separately from `diverged`;
- computes `mismatchRatePercent` over reads where a comparison was **possible**,
  and reports `null` when none were — counting an absent row as agreement would
  report a migration as healthy precisely when the instrument had nothing to
  read;
- carries `enabled`, so an empty report is never mistaken for agreement.

---

## 6. Surface

| | |
|---|---|
| Wired into | `GET /submissions/:id/outcome` — after the response body is decided |
| Report | `GET /cortex/shadow-read` — team auth, read-only, no customer value |
| Not wired into | `GET /cortex/outcomes`, deliberately. It is a prefix scan over every outcome; shadow-reading each would issue N relational reads on one request. Bulk reconciliation belongs in the migration CLI, where it already lives. |

---

## 7. Verification

```
npm run test:migration        79 pass   (43 new)
npm run test:features        726 pass
npm run test:system          170 pass
npm run typecheck:api:storage clean     new deno boundary, registry-free
npm run typecheck:tests       29 errors — identical to the pre-sprint baseline
```

A new `storage` type-check boundary was added for the pure modules: they take no
`jsr:` or Deno-only import, so they check cleanly without a module registry and a
regression in them is a blocker rather than a note lost inside the `server`
boundary, which this environment cannot reach at all (jsr.io is not routable
here — an egress restriction, pre-existing and unrelated to this work).

---

## 8. Next

**S7.5 — Outcome Shadow Read Validation** needs a deployment: the exit condition
is a mismatch rate measured over real traffic, which cannot be produced locally.
It is blocked on switching `MCV2_SHADOW_READ_OUTCOMES` on in staging, which is a
human decision.

The dependency-safe work that does not need it is the **outcome backfill**
(Phase 2 for this domain), which S6.2 deferred and which this instrument exists
to measure.
