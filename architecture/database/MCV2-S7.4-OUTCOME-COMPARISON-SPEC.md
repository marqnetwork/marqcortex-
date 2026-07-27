# MCV2-S7.4 — Outcome KV↔SQL Comparison Spec

**Sprint:** `MCV2-S7.4-IMPLEMENT-009` (remediation · G3)
**Scope:** Outcome entity only. Comparison is diagnostic telemetry — it never
affects the user response. KV is authoritative.
**Modules:** `storage/outcomeNormalize.ts`, `storage/outcomeCompare.ts`.

---

## Sources

| Source | Key / table | Shape |
|--------|-------------|-------|
| KV (authoritative) | `outcome:{submissionId}` (JSON string) | flat business fields + denormalized context |
| SQL (shadow) | `outcomes` row via `OutcomeRepository.getOutcomeByLegacyKey` | normalized columns + `value` JSONB |

## Join axis (single, canonical)

```
legacy_kv_key = `outcome:${submissionId}`
```

This is the **only** correlation key between KV and SQL. KV submission ids are
TEXT (`SUB-<ts>-<rand>`); `outcomes.submission_id` is a generated UUID, so the
raw KV id can never be used as a SQL lookup value. `legacy_kv_key` is TEXT and
has a dedicated unique index (`outcomes_legacy_kv_key_uidx`) for this join.

The legacy-key lookup is globally unique and **not** tenant-scoped at the query
level, so tenancy is enforced **fail-closed** in `compareOutcome`: the row's
`organization_id` must equal the requesting org exactly, or the comparison is a
**critical** authorization mismatch. A null/absent `organization_id` also fails
closed.

## Canonical DTO (business-critical, compared)

`didConvert`, `conversionValue`, `lostReason`, `recommendationWorked`,
`whatWeLearned`, `improvementAreas`, `conversionStatus`.

- KV → DTO: `normalizeKvOutcome` reads top-level fields.
- SQL → DTO: `projectOutcomeRecord` reads business fields from `value` JSONB
  (backfill target); `conversionStatus` from `outcome_type` with a
  `value.didConvert` fallback.
- `submissionId` is a **relationship axis, not a compared value** (KV holds
  `SUB-…`, SQL holds a UUID).

## Status: two distinct axes — never diffed against each other

| Axis | Source | Vocabulary | Compared? |
|------|--------|-----------|-----------|
| **Conversion** (`conversionStatus`) | KV `didConvert`; SQL `outcome_type` ('won'/'lost') with `value.didConvert` fallback | `converted` / `lost` / `null` | **yes** |
| **Lifecycle** (`status` column) | SQL `outcomes.status`, `NOT NULL DEFAULT 'open'`, `CHECK IN ('open','closed','archived')` | `open` / `closed` / `archived` | **no** — no KV equivalent |

Comparing these two axes directly caused every `closed`/`archived` row to report
a false high-severity `mismatch`, and — because the lifecycle column is
`NOT NULL` and therefore always "populated" — forced incomplete rows into
`mismatch` instead of `partial`. SQL `outcome_type` values that carry no
conversion signal (`engagement`, `nurture`, `other`) resolve to `null`, so a row
without conversion data reads as unpopulated and classifies as `partial`.

## Normalization rules

| Concern | Rule |
|---------|------|
| null vs empty string | `null`/`undefined`/`''` → `null` |
| booleans | `true/false/'true'/'false'` → boolean, else `null` |
| numbers | finite number or numeric string → number, else `null` |
| arrays (`improvementAreas`) | mapped to strings and **sorted** (order-independent); `[]` counts as unpopulated |
| `conversionStatus` | derived canonical: `converted` / `lost` / `null` (see the two-axis table above) |
| ID mapping | join axis = `legacy_kv_key = 'outcome:{submissionId}'`; SQL uuid `id` and `submission_id` ignored |
| timestamps | `recorded_at`/`loggedAt` ignored (log metadata) |
| degenerate `value` | absent / `null` / non-object / `{}` / `[]` ⇒ all business fields null ⇒ `partial` |

## Ignored fields (not compared)

`id`, `submission_id`, `created_at`, `updated_at`, `created_by`, `updated_by`,
`deleted_at`, `legacy_kv_key`, `status` (SQL lifecycle),
`recorded_at`/`loggedAt`/`loggedBy`; and KV denormalized snapshots `industry`,
`company`, `aiScore`, `recommendedService`, `submittedAt`. **No business-critical
field is ignored.** (`outcome_type` is not ignored — it is the SQL-side input to
`conversionStatus`.)

## Canonical statuses (mutually exclusive)

| Status | Meaning | Severity |
|--------|---------|----------|
| `mismatch` (authorization) | SQL row `organization_id` ≠ effective tenant | **critical** |
| `mismatch` (value) | a field populated on BOTH sides differs | high |
| `missing_kv` | KV missing, SQL present | high |
| `error` | SQL read failed / timed out | high |
| `partial` | SQL row present, but a field KV populated is null/absent in SQL | low |
| `missing_sql` | SQL row missing, KV present (expected pre-backfill) | low |
| `match` | both present and every populated field agrees (or both missing) | info |
| `skipped` | shadow ineligible / not executed | info |

**Precedence when both rows are present (most severe first):** authorization
conflict → value conflict (`mismatch`) → `partial` → `match`. An authorization
defect is never downgraded; an incomplete SQL row is never `match`.

### `partial` vs `mismatch` (the key distinction, G3)

For each comparable field, comparing KV value `k` and SQL value `s`:

- `k == s` → agree.
- `k` populated, `s` null/absent → **partial field** (SQL incomplete).
- `k` and `s` both populated but differ, **or** `s` populated where `k` is empty
  → **conflict field**.

Any conflict field ⇒ `mismatch`. Else any partial field ⇒ `partial`. Else
`match`. (`populated` = not null and, for arrays, non-empty.)

## Result payload (no raw values)

`OutcomeComparison`: `status`, `requestId`, `organizationId`,
`entityType='outcome'`, `entityRefHash` (FNV-1a hash of submissionId —
non-reversible), `kvMs`, `sqlMs`, `mismatchCount`, `mismatchFields` (paths
only), `severity`, `comparisonTimestamp`, `sqlErrorClass?`. **No raw outcome
payload, email, or PII is ever stored or logged.**

---

*End of comparison spec.*
