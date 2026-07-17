# MCV2-S7.3 — Response Parity Report

**Sprint:** `MCV2-S7.3-VALIDATE-008`
**Scope:** the three diagnostic reads migrated in S7.2. Validation only — no runtime code changed.
**Evidence:** `tests/storage/validation.test.ts` + `tests/storage/gateway.test.ts` (`npm run test:storage` → 44/44).

---

## Method

For each migrated path the pre-gateway (legacy inline) behavior is compared to the gateway behavior across representative fixtures, including edge cases. The legacy parse functions were **moved verbatim** into `storage/kvParse.ts` (S7.2), so parity is validated at the observable-contract level: the gateway output must equal the value the old inline route produced for the same raw KV input.

---

## Path 1 — `GET /submissions/:id`

Legacy: `const raw = await kv.get('sub:'+id); if(!raw) 404; return {success:true, submission: safeJsonParse(raw)}`

| Case | Legacy result | Gateway result | Parity |
|------|---------------|----------------|--------|
| JSON-string record | `safeJsonParse(raw)` object | `data` == same object, `found=true` | ✅ |
| Already-object JSONB value | object returned as-is | same | ✅ |
| Absent key | 404 (`!raw`) | `found=false` → route 404 | ✅ |
| Present-but-null parse | `{submission:null}` | `found=true, data=null` | ✅ |
| Fields / nested `answers` | unchanged | deep-equal | ✅ |
| Status code / envelope | `{success:true, submission}` | identical | ✅ |
| Legacy ID (`SUB-…`) | key `sub:{id}` | same key, no transform | ✅ |

## Path 2 — `GET /submissions` (list)

Legacy: prefix scan → non-array → `{submissions:[],total:0}`; else `parseSubmissions(all).sort(newest-first)`.

| Case | Legacy result | Gateway result | Parity |
|------|---------------|----------------|--------|
| Multiple subs | filtered + newest-first | identical order (`C,B,A`) | ✅ |
| Non-submission entries (email/string, malformed) | filtered out | filtered out | ✅ |
| Non-array KV response | `{submissions:[],total:0}` | `data:[]` → same envelope | ✅ |
| Invalid `submittedAt` | sort tolerant, no throw | identical | ✅ |
| Ordering | newest-first by `submittedAt` | identical comparator | ✅ |
| Pagination | none (full list) | none (full list) | ✅ |
| KV read failure | `Database error` 500 envelope | reproduced via `StorageReadError.cause` unwrap | ✅ |

## Path 3 — `GET /submissions/:id/outcome`

Legacy: `const raw = await kv.get('outcome:'+id); const outcome = raw ? JSON.parse(raw) : null; return {success:true, outcome}`

| Case | Legacy result | Gateway result | Parity |
|------|---------------|----------------|--------|
| JSON-string outcome | `JSON.parse(raw)` | same object | ✅ |
| Absent key | `null` | `null` | ✅ |
| Malformed raw | `JSON.parse` throws → 500 | `SyntaxError` propagates → same 500 | ✅ |
| Envelope | `{success:true, outcome}` | identical | ✅ |

**Note:** outcome deliberately uses `JSON.parse` (not `safeJsonParse`) to preserve exact legacy semantics, including throw-on-malformed.

---

## Cross-cutting parity

| Dimension | Result |
|-----------|--------|
| Null/undefined behavior | Identical (`found=!!raw`; `raw ? … : null`) |
| Missing-record behavior | Identical (404 for submission; null for outcome) |
| Legacy ID handling | KV keys unchanged (`sub:`, `outcome:`) |
| Client visibility | Unchanged — client portal reads NOT migrated |
| Demo/live behavior | Unchanged — `isDemo()` short-circuits in `dataService` before the edge/gateway |
| Auth / status codes | Unchanged — `verifyTeamToken` precedes the gateway call |
| Returned source | Always `kv`; `mode=kv_only` |

---

## Conclusion

**Full response parity confirmed for all three migrated reads.** No behavioral difference found; no fix required. Any KV-failure 500 body on the single-get/outcome paths carries a `StorageReadError`-wrapped message string (generic catch-all, not an externally relied-upon contract); the structured list `Database error` envelope is preserved exactly.

---

*End of parity report.*
