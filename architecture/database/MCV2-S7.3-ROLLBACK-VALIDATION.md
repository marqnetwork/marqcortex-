# MCV2-S7.3 — Rollback Validation

**Sprint:** `MCV2-S7.3-VALIDATE-008`
**Validates:** `MCV2-S7.2-PHASE1-ROLLBACK-GUIDE.md`
**Result:** Rollback verified. Phase 1 can be neutralized or reverted with zero impact on KV data, API, frontend, auth, schema, Intelligence Gateway, or migration tooling.

---

## What was validated

| Rollback method | Validation | Verdict |
|-----------------|------------|---------|
| **1. Config force `kv_only`** | Tests prove default and every configured value resolve to `kv_only` (`resolveActiveMode` clamps all modes; kill switch forces it). Setting `STORAGE_DUAL_READ_ENABLED=false` is a no-op relative to current safe state. | ✅ Safe, no deploy |
| **2. Revert the 3 route hunks** | Parity report proves gateway output ≡ legacy inline output for every fixture. Restoring the direct-KV code therefore changes nothing observable. `safeJsonParse`/`parseSubmissions` remain importable from `storage/kvParse.ts`, so reverts compile. | ✅ Behaviorally equivalent |
| **3. Full sprint revert (`git revert`)** | Storage module has no external imports (source scan: no `repositories`, `@supabase`, `jsr:`, `../`), so removing it cannot break other modules. Route hunks are self-contained. | ✅ Isolated |

## Non-impact proof (blast-radius check)

| Surface | Touched by S7.2 gateway? | Rollback impact |
|---------|--------------------------|-----------------|
| KV data (`kv_store_324f4fbe`) | Read-only; never written by gateway | None |
| API routes / envelopes | 3 reads re-sourced, identical output | None |
| Frontend / `dataService` / `api.ts` | Not referenced | None |
| Auth (`verifyTeamToken`, `requireClientAccess`) | Unchanged; precedes gateway | None |
| Database schema / migrations | No schema change in Phase 1 | None |
| Intelligence Gateway (`intelligence/*`) | Independent module | None |
| Migration tooling (`migration/*`, CLI) | Independent module | None |

Source-scan evidence: `tests/storage/validation.test.ts` → "no storage source module references SQL/repositories/Supabase/Deno" and "barrel exports expose no SQL adapter symbol" both pass.

## Exact rollback steps (confirmed)

**Fastest (stay safe, no code change):** nothing required — default is already `kv_only`. If experimental flags were set: `STORAGE_DUAL_READ_ENABLED=false`.

**Targeted (a migrated read misbehaves):** restore that route's pre-gateway block in `supabase/functions/server/index.tsx` (three independent hunks, see rollback guide). Imports remain valid.

**Full:** `git revert <s7.2-sha>`; re-run `npm run test:database`, `npm run test:migration`, `npm run test:intelligence`. (Note: S7.3 added only `tests/storage/validation.test.ts` — no runtime code — so reverting S7.2 alone fully removes the gateway.)

## Verification after any rollback

1. `npm run test:storage` green (if module retained) / absent (full revert).
2. `npm run test:database`, `npm run test:migration`, `npm run test:intelligence` green.
3. Spot-check the three endpoints return the expected envelopes.

---

*End of rollback validation.*
