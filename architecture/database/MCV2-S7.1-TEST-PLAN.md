# MCV2-S7.1 — S7.2 / S7.3 Test Plan

**Sprint:** `MCV2-S7.1-PLAN-006` (tests for `MCV2-S7.2-IMPLEMENT-006` and `MCV2-S7.3-VALIDATE`)
**Status:** Plan only. No tests written this sprint (repo currently has no `*.test.ts` for runtime — known debt).
**Proposed home:** `tests/storage/` · **Proposed command:** `npm run test:storage` (add script mirroring `test:database`/`test:migration`).

---

## Test matrix

| # | Test | File | Type | Asserts |
|---|------|------|------|---------|
| 1 | KV-only behavior unchanged | `readStrategy.modeA.test.ts` | unit | Mode A never calls SQL adapter; returns KV value + `returnedSource=kv` |
| 2 | Shadow read returns KV | `readStrategy.modeB.test.ts` | unit | Mode B returns KV value even when SQL differs; `returnedSource=kv` |
| 3 | SQL failure does not affect KV response | `readStrategy.modeB.test.ts` | unit | SQL adapter throws/timeouts ⇒ response = KV; `error_class` recorded; no throw to caller |
| 4 | Mismatch detection | `normalize.compare.test.ts` | unit | differing field ⇒ `VALUE_MISMATCH`, correct dot-path, no raw value stored |
| 5 | Normalization-only match | `normalize.compare.test.ts` | unit | timestamp-precision / empty-vs-null diffs ⇒ `NORMALIZATION_ONLY`, outcome `normalized_match` |
| 6 | Ordering normalization | `normalize.compare.test.ts` | unit | reordered `answers`/`domain_scores` ⇒ `ORDERING_ONLY` info, checksum equal after sort |
| 7 | Missing SQL row | `readStrategy.modeB.test.ts` | unit | SQL null, KV present ⇒ `TARGET_MISSING`; KV returned |
| 8 | Missing KV row | `readStrategy.modeB.test.ts` | unit | KV null, SQL present ⇒ `SOURCE_MISSING` high; response null (KV authoritative) |
| 9 | Tenant mismatch | `sqlAdapter.tenant.test.ts` | unit/integration | SQL row of other org ⇒ `AUTHORIZATION_MISMATCH` critical; **fail closed**, no fallback |
| 10 | Permission error fail-closed | `readStrategy.fallback.test.ts` | unit | `PERMISSION_DENIED` ⇒ no fallback; error surfaced; recorded critical |
| 11 | Fallback behavior (Mode C) | `readStrategy.fallback.test.ts` | unit | `SQL_TIMEOUT`/`SQL_UNAVAILABLE` ⇒ KV returned, `fallbackUsed=true`, correct reason |
| 12 | Feature-flag precedence | `flags.precedence.test.ts` | unit | master off > surface cap > entity mode > audience; effective = min |
| 13 | Kill switch | `flags.precedence.test.ts` | unit | `STORAGE_DUAL_READ_ENABLED=false` forces Mode A for every entity |
| 14 | Invalid config fail-safe | `flags.invalid.test.ts` | unit | unknown enum / bad csv ⇒ `kv_only` + `INVALID_FLAG`; never SQL |
| 15 | Telemetry emission | `telemetry.emit.test.ts` | unit | Mode B emits event with required fields; sampling honored |
| 16 | No sensitive payloads in telemetry | `telemetry.privacy.test.ts` | unit | event contains no email/answer/report text/token; entity ref hashed; only field paths+categories |
| 17 | Response-envelope regression | `routes.envelope.test.ts` | integration | each wired route returns byte-identical envelope Mode A vs pre-gateway snapshot |
| 18 | Client portal regression | `routes.clientPortal.test.ts` | integration | `client/submission/:id` + `/report` identical shape; `requireClientAccess` unchanged |
| 19 | Latency budget | `readStrategy.latency.test.ts` | unit | Mode B response latency ≈ KV latency (SQL isolated); records `sqlMs` separately |
| 20 | No runtime authority change | `authority.invariant.test.ts` | integration | with all flags default, `returnedSource=kv` for every diagnostic read; writes still KV-only |
| 21 | Unexpected duplicate | `normalize.compare.test.ts` | unit | >1 SQL row per legacy key ⇒ `UNEXPECTED_DUPLICATE` critical |
| 22 | Report derived normalization | `normalize.report.test.ts` | unit | SQL-stored report vs `buildAIClientReport` output ⇒ classified (not raw mismatch) |
| 23 | Demo mode never hits gateway | `routes.demo.test.ts` | integration | `isDemo()` short-circuits before edge; gateway uncalled |

## Coverage mapping to required checklist

Every Stage-15 required item is covered: KV-only (1), shadow returns KV (2), SQL failure isolation (3), mismatch detection (4), normalization-only (5), ordering (6), missing SQL (7), missing KV (8), tenant mismatch (9), permission fail-closed (10), fallback (11), flag precedence (12), kill switch (13), telemetry (15), no-secrets (16), envelope regression (17), client portal (18), latency (19), no authority change (20).

## Commands

```
npm run test:storage        # new — unit + integration for storage/*
npm run test:database       # existing — must stay green (no schema regression except additive telemetry table)
npm run test:migration      # existing — reconciliation prerequisites for Mode B eligibility
```

## S7.3 (validation) additional gates

- Run matrix against **staging** with real backfilled data.
- 7-day mismatch soak report; every mismatch classified (Stage 10 #11).
- Fail-closed and kill-switch exercised live.
- Sign-off recorded before any Mode C proposal.

---

*End of test plan. No tests were added to the repo this sprint.*
