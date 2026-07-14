# Runtime Storage Gateway — Usage Guide (Phase 1)

**Applies to:** `supabase/functions/server/storage/*` (MCV2-S7.2-IMPLEMENT-007)
**Scope:** diagnostic-domain READS only. KV authoritative. No SQL, no writes.

---

## What it is

One diagnostic-domain gateway that sits between edge route handlers and the KV
helper. Route handlers ask for canonical entities and receive a `ReadResult<T>`
carrying the same business DTO as before — they never see KV vs SQL.

```
Edge route → diagnosticStorage.<method>(id, ctx) → KV adapter → kv_store.tsx (KV)
```

## Construction (already wired in `index.tsx`)

```ts
import { createRuntimeDiagnosticGateway, buildReadContext, DiagnosticEntity } from "./storage/index.ts";
import * as kv from "./kv_store.tsx";

const diagnosticStorage = createRuntimeDiagnosticGateway(kv); // singleton
```

`createRuntimeDiagnosticGateway` reads config from the environment (KV-only,
telemetry off by default) and uses a no-op telemetry sink.

## Calling from a route handler

```ts
const ctx = buildReadContext({
  route: 'GET /submissions/:id',
  entity: DiagnosticEntity.SUBMISSION,
  actor: { kind: 'team', id: userId },   // server-resolved
  organizationId: null,                  // optional; not used by KV reads
});
const result = await diagnosticStorage.getSubmission(id, ctx);
if (!result.found) return c.json({ error: "Submission not found" }, 404);
return c.json({ success: true, submission: result.data });
```

### `ReadResult<T>`

| Field | Meaning |
|-------|---------|
| `data` | the business DTO (identical shape to the pre-gateway value), or `null` |
| `found` | whether the store held a record (`!!raw`) — use for 404 semantics |
| `returnedSource` | always `kv` in Phase 1 |
| `mode` | always `kv_only` in Phase 1 |
| `latency` | internal timing; **do not** serialize into API responses |

## Available methods (Phase 1)

| Method | Replaces | Parse semantics |
|--------|----------|-----------------|
| `getSubmission(id, ctx)` | `kv.get('sub:'+id)` + `safeJsonParse` | `safeJsonParse`; `found=!!raw` |
| `listSubmissions(ctx)` | `kv.getByPrefix('sub:')` + parse + sort | `parseSubmissions` + newest-first; non-array→`[]` |
| `getOutcome(submissionId, ctx)` | `kv.get('outcome:'+id)` + `JSON.parse` | `raw ? JSON.parse(raw) : null` |

## Error handling

KV read failures throw `StorageReadError` with `code` and the original `.cause`.
Route handlers reproduce their existing envelopes by unwrapping `.cause`:

```ts
try {
  const result = await diagnosticStorage.listSubmissions(ctx);
  ...
} catch (kvError) {
  const cause = kvError instanceof StorageReadError ? kvError.cause : kvError;
  return c.json({ error: `Database error: ${(cause as any)?.message || String(cause)}`, details: '...' }, 500);
}
```

`getOutcome` deliberately lets a malformed-JSON `SyntaxError` propagate (matching
the prior inline `JSON.parse`), so the route's generic 500 stays identical.

## Rules for adding a read to the gateway (future phases)

- Reuse `kvParse.ts` helpers; never duplicate parsing.
- Preserve the exact prior parse function per entity (`safeJsonParse` vs `JSON.parse`).
- Keep `found` aligned with the route's missing-record branch.
- Do not add business/scoring logic to the gateway.
- Do not call SQL repositories in Phase 1.

## What NOT to do

- Do not route WRITES through the gateway (Phase 1 is read-only).
- Do not let `latency`/`mode`/`returnedSource` leak into HTTP responses.
- Do not derive `organizationId`/`actor` from client input.
- Do not enable telemetry to a live table (not approved this phase).

---

*See also: `MCV2-S7.2-READ-MODE-CONFIG-GUIDE.md`, `MCV2-S7.2-PHASE1-ROLLBACK-GUIDE.md`.*
