# Phase 1 Rollback Guide — Runtime Storage Gateway

**Applies to:** MCV2-S7.2-IMPLEMENT-007
**Key fact:** Phase 1 is `kv_only` with no SQL path, so there is nothing unsafe to
"turn off." Rollback is only needed if the gateway itself regresses a read.

---

## Severity ladder (fastest → most complete)

### 0. No action needed for data safety
The gateway already returns KV data and KV is authoritative. There is no SQL read,
shadow read, fallback, or write change to disable. No environment flag needs to be
set to remain safe (default is `kv_only`).

### 1. Configuration kill switch (no deploy)
If future flags were set experimentally, force KV-only everywhere:

```
STORAGE_DUAL_READ_ENABLED=false
```

(In Phase 1 this is already the effective behavior; this step matters once later
phases can enable SQL.)

### 2. Revert the wired routes (targeted code rollback)
If a migrated read misbehaves, restore the direct-KV logic for that route in
`supabase/functions/server/index.tsx`. The three hunks are independent:

- `GET /submissions` (list)
- `GET /submissions/:id`
- `GET /submissions/:id/outcome`

Restore each to its pre-gateway form:

```ts
// GET /submissions/:id
const raw = await kv.get(`sub:${id}`);
if (!raw) return c.json({ error: "Submission not found" }, 404);
return c.json({ success: true, submission: safeJsonParse(raw) });

// GET /submissions/:id/outcome
const raw = await kv.get(`outcome:${submissionId}`);
const outcome = raw ? JSON.parse(raw) : null;
return c.json({ success: true, outcome });

// GET /submissions (list): restore prefix scan + non-array check
//   + parseSubmissions(...).sort(newest-first) + the two 500 envelopes.
```

`safeJsonParse` and `parseSubmissions` remain available as imports from
`./storage/kvParse.ts`, so route reverts compile without restoring the local
copies. (Optionally restore the inline copies and drop the imports for a full
pre-sprint state.)

### 3. Full sprint revert
Revert the whole S7.2 commit:

```
git revert <s7.2-commit-sha>
```

This removes the `storage/` module, the `test:storage` script, the route wiring,
and the docs. Re-run: `npm run test:database`, `npm run test:migration`,
`npm run test:intelligence`.

---

## What a rollback does NOT touch

- **KV data** — never modified by this sprint.
- **Writes** — never routed through the gateway.
- **Frontend / `dataService` / `api.ts`** — unchanged.
- **Auth** — unchanged.
- **SQL / RLS / migrations** — no schema change in Phase 1.

## Verification after rollback

1. `npm run test:storage` (if module retained) or confirm it is gone (level 3).
2. `npm run test:database`, `npm run test:migration`, `npm run test:intelligence` green.
3. Spot-check `GET /submissions`, `/submissions/:id`, `/submissions/:id/outcome`
   return the expected envelopes.

---

*End of Phase 1 rollback guide.*
