# MCV2-S7.4 — Outcome Shadow-Read Rollout & Config

**Sprint:** `MCV2-S7.4-IMPLEMENT-009`
**State:** Disabled by default. KV authoritative. SQL never returned to users.

---

## Environment flags (server-side only; no frontend/request control)

| Flag | Values | Default | Effect |
|------|--------|---------|--------|
| `STORAGE_SHADOW_OUTCOME_ENABLED` | `true`\|`false` | `false` | Master toggle for the Outcome shadow read. |
| `STORAGE_FORCE_KV_ONLY` | `true`\|`false` | `false` | **Kill switch.** `true` forces KV-only and disables all shadow. |
| `STORAGE_SHADOW_OUTCOME_ORG_ALLOWLIST` | csv of org ids | empty | If non-empty, only these orgs are eligible. Empty = no org restriction (still gated by ENABLED). |
| `STORAGE_SHADOW_DEFAULT_ORG_ID` | org uuid | none | Tenant scope used when the request has no resolved org. Required for the team outcome route (which passes no org). |
| `STORAGE_SHADOW_SQL_TIMEOUT_MS` | int | `250` (cap 2000) | Hard SQL read timeout. |
| `STORAGE_ENVIRONMENT` | string | none | Telemetry environment label. |

Invalid/missing values resolve to the safe (disabled) state. No request parameter or frontend control can activate shadow.

## Eligibility (fails closed)

Shadow executes only when **all** hold: `ENABLED=true` · kill switch off · an SQL port is wired · an effective org resolvable (`request org` ?? `DEFAULT_ORG_ID`) · (allowlist empty **or** effective org allowlisted). Entity must be Outcome. Any uncertainty → KV-only.

> Note: the team outcome route (`GET /submissions/:id/outcome`) passes **no** org, so `STORAGE_SHADOW_DEFAULT_ORG_ID` MUST be set for shadow to run there. Without it → KV-only (fail closed).

## Behavior when enabled

1. Read Outcome from KV → this is the authoritative response (returned immediately).
2. Launch a bounded SQL read (timeout `STORAGE_SHADOW_SQL_TIMEOUT_MS`) in the **background** — not awaited by the response path.
3. Normalize + compare KV vs SQL.
4. Emit one telemetry event (`configuredMode=kv_primary_shadow_sql`, `returnedSource=kv`, comparison outcome).
5. SQL timeout/error/mismatch never change the response. KV is always returned.

**Background execution choice:** the shadow promise is attached to the read result but not awaited by the route, so user-path latency overhead is ~0 (measured ~0.003 ms even with a 5 ms SQL read). In edge runtimes background work after response is best-effort; telemetry capture is therefore best-effort. A future sprint may adopt a `waitUntil`-style API for guaranteed capture. No duplicate KV read; exactly one SQL read.

## Rollout order (per S7.3 readiness plan)

1. Local/mock (this sprint — offline tested).
2. Staging with `DEFAULT_ORG_ID` set, internal only.
3. Internal team users, small sample.
4. Org allowlist (one low-risk org).
5. Measure mismatch/latency → widen only after exit gates (S7.3 plan).

## Entry gate before enabling live

- Outcome backfill + reconciliation complete for the target org (`outcomes.value` populated).
- Supabase + `SUPABASE_SERVICE_ROLE_KEY` available in the environment.
- `STORAGE_SHADOW_DEFAULT_ORG_ID` set to the real org uuid.

## Exit gate before expanding beyond Outcome

Unexplained (non-`normalization_only`) mismatch rate = 0 over soak; documented normalization baseline; SQL error/latency within budget; kill switch + rollback exercised; no unclassified mismatches.

---

*See also: `MCV2-S7.4-OUTCOME-COMPARISON-SPEC.md`, `MCV2-S7.4-ROLLBACK-GUIDE.md`.*
