# MCV2-S7.4 — Outcome Shadow-Read Rollback Guide

**Sprint:** `MCV2-S7.4-IMPLEMENT-009`
**Key fact:** shadow is disabled by default, so the safe state is the default state. Rollback forces KV-only immediately.

---

## Severity ladder (fastest → most complete)

### 0. Default is already safe
With no flags set, `STORAGE_SHADOW_OUTCOME_ENABLED=false` ⇒ no SQL read, KV-only. Nothing to undo for safety.

### 1. Kill switch (no deploy, instant)
```
STORAGE_FORCE_KV_ONLY=true
```
Forces KV-only and disables the Outcome shadow regardless of other flags. Also:
```
STORAGE_SHADOW_OUTCOME_ENABLED=false
```
Either immediately stops all SQL shadow reads.

### 2. Unwire the SQL port (code, targeted)
In `supabase/functions/server/index.tsx`, revert the gateway construction to:
```ts
const diagnosticStorage = createRuntimeDiagnosticGateway(kv);
```
(remove the `{ sqlOutcomePort: createRuntimeOutcomeSqlPort() }` argument and the `runtimeSqlOutcome` import). With no port wired, eligibility fails closed (`no_sql_port`) → KV-only, even if flags are on.

### 3. Full sprint revert
`git revert <s7.4-sha>`. Removes the SQL adapter, normalization, comparison, shadow config, runtime port, gateway shadow path, and tests. The gateway returns to its S7.2/S7.3 KV-only form. Re-run `npm run test:storage`, `test:database`, `test:migration`, `test:intelligence`.

---

## What rollback does NOT touch

- **KV data / authority** — never modified; always the returned source.
- **API envelope** — `GET /submissions/:id/outcome` returns `{success:true, outcome}` (KV) unchanged.
- **Frontend / dataService / api.ts** — untouched.
- **Auth** — `verifyTeamToken` unchanged and precedes the gateway.
- **DB schema / RLS** — no change; the shadow is read-only against existing `outcomes`.
- **Writes** — KV-only, never through the gateway.
- **Intelligence Gateway / migration tooling** — independent.

## Verification after rollback

1. `npm run test:storage` green (module retained) or absent (full revert).
2. `npm run test:database` / `test:migration` / `test:intelligence` green.
3. `GET /submissions/:id/outcome` returns the KV outcome envelope; no SQL calls in logs.

## Guarantee

At every rung, KV remains authoritative and no SQL data can reach a user. The fastest rung (kill switch) restores KV-only behavior with no deploy.

---

*End of rollback guide.*
