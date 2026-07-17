# Read-Mode Configuration Guide (Phase 1)

**Applies to:** `supabase/functions/server/storage/config.ts` (MCV2-S7.2-IMPLEMENT-007)
**Golden rule:** KV-only is the safe default. Nothing in Phase 1 can activate SQL.

---

## Environment variables (Edge secrets — server-side only)

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `STORAGE_DUAL_READ_ENABLED` | `true` \| `false` | `false` | Master gate. `false` forces `kv_only` for every entity (kill switch). |
| `STORAGE_MODE_SUBMISSION` | a read mode | `kv_only` | Configured mode for submission + submission-list reads. |
| `STORAGE_MODE_OUTCOME` | a read mode | `kv_only` | Configured mode for outcome reads. |
| `STORAGE_MODE_REPORT` | a read mode | `kv_only` | Reserved (report reads not migrated in Phase 1). |
| `STORAGE_MODE_LEAD` | a read mode | `kv_only` | Reserved (lead reads not migrated in Phase 1). |
| `STORAGE_READ_TELEMETRY_ENABLED` | `true` \| `false` | `false` | Telemetry toggle. Runtime still uses a no-op sink this phase. |

**Read mode values:** `kv_only`, `kv_primary_shadow_sql`, `sql_primary_kv_fallback`,
`sql_only`, `disabled`. Only `kv_only` is executable in Phase 1.

There is **no** frontend control and **no** request/header/query override. Mode is
resolved entirely server-side. No organization can select SQL this phase.

## Precedence (highest wins)

1. `STORAGE_DUAL_READ_ENABLED=false` → `kv_only` for every entity (kill switch).
2. Missing / unknown / malformed per-entity value → `kv_only` (fail safe).
3. Per-entity `STORAGE_MODE_*` value.
4. Global default `kv_only`.
5. **Phase 1 clamp:** any resolved mode other than `kv_only` is executed as
   `kv_only` (no SQL path exists). The raw value is still visible via
   `readStorageConfig().modeByEntity` for diagnostics.

## Examples

| Env | Executed mode (submission) |
|-----|----------------------------|
| _(unset)_ | `kv_only` |
| `STORAGE_MODE_SUBMISSION=sql_only` (master unset/false) | `kv_only` (kill switch) |
| `STORAGE_DUAL_READ_ENABLED=true`, `STORAGE_MODE_SUBMISSION=kv_primary_shadow_sql` | `kv_only` (Phase 1 clamp) |
| `STORAGE_DUAL_READ_ENABLED=true`, `STORAGE_MODE_SUBMISSION=garbage` | `kv_only` (fail safe) |

## Kill switch

Set `STORAGE_DUAL_READ_ENABLED=false` (or leave unset) to guarantee `kv_only`
everywhere without a code deploy. This is the operational kill switch for all
future phases.

## API surface

```ts
readStorageConfig(env?)          // raw, unclamped config (for diagnostics)
resolveActiveMode(config, entity) // executable mode (Phase 1: always kv_only)
parseReadMode(str)               // string -> ReadMode, fail-safe to kv_only
readRuntimeStorageConfig()       // reads Deno.env (runtime) / process.env (tests)
STORAGE_ENV_KEYS                 // canonical key names
```

## Not in Phase 1

Percentage rollout, internal-user gating, and org allowlists are **designed in
S7.1** (`MCV2-S7.1-DUAL-READ-ROLLOUT-PLAN.md`) but **not implemented** here —
they belong to the phase that first enables shadow reads (S7.3+).

---

*See also: `MCV2-S7.2-STORAGE-GATEWAY-USAGE-GUIDE.md`.*
