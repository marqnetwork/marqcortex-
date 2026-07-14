# MCV2-S7.4 — Outcome KV↔SQL Comparison Spec

**Sprint:** `MCV2-S7.4-IMPLEMENT-009`
**Scope:** Outcome entity only. Comparison is diagnostic telemetry — it never affects the user response.
**Modules:** `storage/outcomeNormalize.ts`, `storage/outcomeCompare.ts`.

---

## Sources

| Source | Key / table | Shape |
|--------|-------------|-------|
| KV (authoritative) | `outcome:{submissionId}` (JSON string) | flat business fields + denormalized context |
| SQL (shadow) | `outcomes` row via `OutcomeRepository.getOutcomeBySubmission` | normalized columns + `value` JSONB |

## Canonical DTO (business-critical, compared)

`submissionId`, `didConvert`, `conversionValue`, `lostReason`, `recommendationWorked`, `whatWeLearned`, `improvementAreas`, `status`.

- KV → DTO: read from top-level fields.
- SQL → DTO: read business fields from `value` JSONB (backfill target), `submission_id`/`status` from columns.

## Normalization rules

| Concern | Rule |
|---------|------|
| null vs empty string | `null`/`undefined`/`''` → `null` |
| booleans | `true/false/'true'/'false'` → boolean, else `null` |
| numbers | finite number or numeric string → number, else `null` |
| arrays (`improvementAreas`) | mapped to strings and **sorted** (order-independent) |
| status | derived canonical: `converted` / `lost` / `open` (from explicit SQL status or `didConvert`) |
| ID mapping | join axis = `legacy_kv_key = 'outcome:{submissionId}'`; SQL uuid `id` ignored |
| timestamps | `recorded_at`/`loggedAt` ignored (log-time metadata, not outcome content) |

## Ignored fields (explicitly not compared)

`id` (uuid), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (audit/soft-delete); `legacy_kv_key` (join axis); `outcome_type` (SQL categorization); `recorded_at`/`loggedAt`/`loggedBy` (log metadata); KV denormalized snapshots copied from other entities: `industry`, `company`, `aiScore`, `recommendedService`, `submittedAt`. **No business-critical field is ignored.**

## Comparison outcomes (precedence: most severe first)

| Outcome | Meaning | Severity |
|---------|---------|----------|
| `authorization_mismatch` | SQL row `organization_id` ≠ effective tenant | **critical** |
| `schema_mismatch` | SQL `value` present but not an object | high |
| `source_missing` | KV missing, SQL present | high |
| `relationship_mismatch` | `submission_id` / `legacy_kv_key` linkage differs | high |
| `value_mismatch` | business field(s) differ after normalization | high |
| `target_missing` | SQL missing, KV present (expected pre-backfill) | low |
| `normalization_only_match` | equal after normalization; raw differed | info |
| `match` | identical (or both missing) | info |
| `error` | SQL read failed/timed out | high |

**Authorization takes precedence over value** — a tenant defect is never downgraded to a harmless value mismatch.

## Result payload (no raw values)

`OutcomeComparison`: `outcome`, `requestId`, `organizationId`, `entityType='outcome'`, `entityRefHash` (FNV-1a hash of submissionId — non-reversible), `kvMs`, `sqlMs`, `mismatchCount`, `mismatchFields` (paths only), `severity`, `comparisonTimestamp`, `sqlErrorClass?`. **No raw outcome payload, email, or PII is ever stored.**

---

*End of comparison spec.*
