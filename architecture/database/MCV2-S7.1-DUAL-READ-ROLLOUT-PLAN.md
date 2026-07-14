# MCV2-S7.1 — Dual-Read Feature Flags & Rollout Plan

**Sprint:** `MCV2-S7.1-PLAN-006`
**Status:** Plan only. No flags added to production code. No SQL/shadow reads enabled. KV authoritative.
**Companion:** `MCV2-S7.1-RUNTIME-STORAGE-GATEWAY-ARCHITECTURE.md`.

---

## Stage 5 — Feature flags

### Principle
**No single global switch.** Per-domain + per-entity flags resolved server-side (Edge env), mirroring the established Intelligence Gateway pattern (`INTELLIGENCE_USE_GATEWAY_*` in `ARCHITECT.md §12`). KV-only is the safe default for every flag.

### Flag surface (Edge env — designed, not created in S7.1)

| Flag | Type | Default | Scope | Purpose |
|------|------|---------|-------|---------|
| `STORAGE_DUAL_READ_ENABLED` | bool | `false` | global master gate | Off ⇒ everything Mode A. Master kill switch. |
| `STORAGE_MODE_SUBMISSION` | enum | `kv_only` | per-entity | mode for submission reads |
| `STORAGE_MODE_OUTCOME` | enum | `kv_only` | per-entity | outcome reads |
| `STORAGE_MODE_REPORT` | enum | `kv_only` | per-entity | derived report reads |
| `STORAGE_MODE_SCORE` | enum | `kv_only` | per-entity | cortex/score reads |
| `STORAGE_MODE_LEAD` | enum | `kv_only` | per-entity | lead reads |
| `STORAGE_MODE_SUBMISSION_CHILDREN` | enum | `kv_only` | per-entity | answers/sections/domain-scores |
| `STORAGE_MODE_CLIENT_PORTAL` | enum | `kv_only` | per-surface override | client-facing reads (submission/report) — extra guard |
| `STORAGE_DUAL_READ_SAMPLE_PCT` | int 0–100 | `0` | telemetry sampling | shadow-read sample rate |
| `STORAGE_DUAL_READ_INTERNAL_ONLY` | bool | `true` | audience | restrict shadow to internal team actors first |
| `STORAGE_DUAL_READ_ORG_ALLOWLIST` | csv | `` (empty) | tenant allowlist | org ids eligible for shadow/SQL-primary |

Enum values: `kv_only | kv_primary | sql_primary | sql_only | disabled`.

### Config precedence (highest wins)

1. `STORAGE_DUAL_READ_ENABLED=false` ⇒ **force Mode A everywhere** (hard kill switch, ignores all else).
2. Per-surface override (`STORAGE_MODE_CLIENT_PORTAL`) caps the client path — cannot exceed the per-entity mode.
3. Per-entity `STORAGE_MODE_*`.
4. Audience gates (`INTERNAL_ONLY`, `ORG_ALLOWLIST`, `SAMPLE_PCT`) can only **downgrade** an actor/request to Mode A, never upgrade.
5. Global default `kv_only`.

Effective mode = `min(entity_mode, surface_cap)` filtered by audience; audience miss ⇒ Mode A.

### Other rules

| Rule | Value |
|------|-------|
| Environment scope | Independent values per env (local/staging/prod). Prod defaults hardest (all `kv_only`, sample 0). |
| Percentage rollout | `SAMPLE_PCT` gates *shadow execution + telemetry*, not the returned value (KV always returned in Mode B). |
| Internal-user rollout | `INTERNAL_ONLY=true` ⇒ only `actor.kind==='team'` with internal membership triggers shadow. |
| Org allowlist | Empty ⇒ no org eligible for SQL-primary. Shadow (Mode B) may run for default org once allowlisted. |
| Kill switch | `STORAGE_DUAL_READ_ENABLED=false` reverts to KV-only with no deploy (env flip). Auto-tripped on `MISMATCH_THRESHOLD`/`critical`. |
| Invalid config | Unknown enum / malformed csv ⇒ **fail safe to `kv_only`** + emit `error_class=INVALID_FLAG` telemetry + warn. Never fail open to SQL. |
| Default safety | Every unset flag ⇒ `kv_only`. Absence of config = current production behavior. |

---

## Stage 9 — Production rollout plan (staged, with gates)

Each stage has an **entry gate** (must be true to start) and **exit gate** (must be true to advance). No stage may be skipped. Human approval required at stages marked 🔒 (Art. 8).

| # | Stage | Entry gate | Exit gate |
|---|-------|-----------|-----------|
| 1 | Local/mock validation | Contracts + gateway implemented (S7.2); unit tests green | KV-only path unchanged; Mode B logic proven against fixtures; all Stage-15 unit tests pass |
| 2 | Staging shadow (no audience) | Stage 1 exit; staging has backfilled data | Gateway deployed staging; envelopes identical; no error-rate change |
| 3 | Internal team users (`INTERNAL_ONLY`) | Stage 2 exit; telemetry table live | Shadow runs for internal team reads on **outcome** entity; telemetry flowing; 0 critical mismatches 48h |
| 4 | One low-risk entity (Outcome), Mode B | Stage 3 exit; outcome backfill+reconciliation complete | Unexplained mismatch rate = 0 over 72h; p95 SQL latency within budget |
| 5 | KV-primary shadow expands to Submission (single) | Stage 4 exit; submission backfill (S6.3) complete | Same gates as stage 4 for submission-single |
| 6 | Measure mismatch & latency (soak) | Stage 5 exit | 7-day staging soak: mismatch < 0.1%, all classified; latency delta within budget |
| 7 | Expand by entity (list, scores, report) | Stage 6 exit per entity | Each entity: reconciliation complete + soak pass; report normalization baseline documented |
| 8 | 🔒 SQL-primary (Mode C) for selected **internal** reads | Stage 7 exit; fallback + rollback tested; **human approval** | Mode C stable for internal outcome/submission; fail-closed verified live; 0 unexplained mismatch |
| 9 | 🔒 Organization allowlist (Mode C, real tenants) | Stage 8 exit; tenant isolation tested live; **human approval** | Allowlisted org(s) stable 14d; client portal validated |
| 10 | Wider rollout (Mode C default per entity) | Stage 9 exit | Fleet-wide Mode C stable; error/latency within SLO |
| 11 | 🔒 SQL authority approval (Mode D) | **All Stage-10 cutover criteria met**; **recorded human review** | Per-entity authority flip; KV writes still on (Phase 4 separate) |
| 12 | KV retirement (later) | Phase 6 roadmap; 30-day soak | Out of S7 scope — Sprint 12 |

Stages 1–7 are **Mode A/B only** (KV authoritative throughout) and fall within S7.2/S7.3 read scope. Stages 8+ require separate authority and human sign-off; **not** authorized by S7.

---

## Stage 10 — Cutover criteria (before SQL may become authoritative)

Objective, binary criteria — **no vague confidence score.** All must be TRUE, evidence recorded, per entity:

| # | Criterion | Measurement |
|---|-----------|-------------|
| 1 | Migration/backfill complete | reconciliation count KV == SQL (± documented) for the entity |
| 2 | Reconciliation complete | `migration_reconciliation_log` pass; quarantine accounted |
| 3 | Unexplained mismatch rate = 0 | telemetry: non-`NORMALIZATION_ONLY` mismatch count = 0 over soak window |
| 4 | Expected normalization-only rate documented | baseline `NORMALIZATION_ONLY` rate recorded + explained per entity |
| 5 | SQL error rate below threshold | < 0.5% over 7 days |
| 6 | Latency acceptable | p95 SQL ≤ p95 KV + agreed budget |
| 7 | Fallback tested | Mode C fallback exercised for each approved `FallbackReason` |
| 8 | Rollback tested | kill switch → Mode A verified in prod-like env |
| 9 | Tenant isolation tested live | cross-tenant read denied; `AUTHORIZATION_MISMATCH`=0 |
| 10 | Client portal validated | report/submission client reads byte-compatible |
| 11 | No unclassified records | every telemetry mismatch has a category |
| 12 | Telemetry operational | events flowing, alerts wired, dashboards live |
| 13 | Human approval recorded | named reviewer sign-off per Art. 8 (auth/isolation domain) |

Any criterion FALSE ⇒ entity stays ≤ Mode B. Cutover is **per entity**, never global.

---

*End of rollout plan. No flags were added to runtime code in this sprint.*
