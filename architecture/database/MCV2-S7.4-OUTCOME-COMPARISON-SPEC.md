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
| SQL (shadow) | `outcomes` row via `OutcomeRepository.getOutcomeBySubmission` | normalized columns + `value` JSONB |

## Canonical DTO (business-critical, compared)

`submissionId`, `didConvert`, `conversionValue`, `lostReason`,
`recommendationWorked`, `whatWeLearned`, `improvementAreas`, `status`.

- KV → DTO: `normalizeKvOutcome` reads top-level fields.
- SQL → DTO: `projectOutcomeRecord` reads business fields from `value` JSONB
  (backfill target), `submission_id`/`status` from columns.

## Normalization rules

| Concern | Rule |
|---------|------|
| null vs empty string | `null`/`undefined`/`''` → `null` |
| booleans | `true/false/'true'/'false'` → boolean, else `null` |
| numbers | finite number or numeric string → number, else `null` |
| arrays (`improvementAreas`) | mapped to strings and **sorted** (order-independent); `[]` counts as unpopulated |
| status | derived canonical: `converted` / `lost` / `open` |
| ID mapping | join axis = `legacy_kv_key = 'outcome:{submissionId}'`; SQL uuid `id` ignored |
| timestamps | `recorded_at`/`loggedAt` ignored (log metadata) |

## Ignored fields (not compared)

`id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`,
`legacy_kv_key`, `outcome_type`, `recorded_at`/`loggedAt`/`loggedBy`; and KV
denormalized snapshots `industry`, `company`, `aiScore`, `recommendedService`,
`submittedAt`. **No business-critical field is ignored.**

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
