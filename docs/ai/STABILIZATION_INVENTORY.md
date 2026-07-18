# STABILIZATION INVENTORY — MARQ Cortex

> Inventory of data sources and their read authority. Used to track which
> surfaces still rely on demo/mock/fallback data vs. the real backend, and
> which now have a Shadow Read validating the backend.

## Read-authority legend

- **KV** — Supabase KV store is authoritative (edge function serves KV).
- **Demo** — client serves `demoData.ts` seed (frontend `BACKEND_INTEGRATION=false`).
- **Shadow** — SQL repository read runs in parallel for drift detection only
  (flag-gated, non-authoritative).

## Frontend data access

All component data flows through `src/app/services/dataService.ts`, which
switches on `FEATURES.BACKEND_INTEGRATION`:

- `false` (default): demo/seed data, no API calls.
- `true`: calls the edge function (`src/app/lib/api.ts`).

This binary switch is **unchanged** in Batch 2 (backward compatibility
preserved — no demo implementation replaced).

## Backend read surfaces & Shadow Read status

| Surface | Route | Authority | Shadow Read | Sprint |
|---------|-------|-----------|-------------|--------|
| Outcome (single) | `GET /submissions/:id/outcome` | KV | ✅ wired (`SHADOW_READ_OUTCOMES`) | S7.4 |
| Outcome (map) | `GET /cortex/outcomes` | KV | — (single-read covers domain) | S7.4 |
| Lead (existence) | `POST /leads/exit-intent` | KV | ✅ wired (`SHADOW_READ_LEADS`) | S7.6 |
| Submission (single) | `GET /submissions/:id` | KV | ✅ wired (`SHADOW_READ_SUBMISSIONS`) | S7.7 |
| Submission (list) | `GET /submissions` | KV | — (single-read covers domain) | S7.7 |

## SQL repositories (backend, ready but non-authoritative)

Present under `supabase/functions/server/repositories/`; used by the Shadow
Read path and the S6 migration engine. **Not** yet the read authority for any
route:

- `outcomeRepository` · `leadRepository` · `submissionRepository`
- `contactRepository` · `reportRepository` · `tenancyRepository`

## Runtime gateway package (added Batch 2)

`supabase/functions/server/runtime/`

- `gateway.ts` — `shadowRead` / `shadowReadWithReport` primitive (pure).
- `drift.ts` — `diffProjections` + per-domain projectors (pure).
- `types.ts` — shared types (pure).
- `config.ts` — env flag resolution (Deno-only).
- `shadowReads.ts` — route wiring helpers (Deno-only).
- `index.ts` — barrel.

Tests: `tests/runtime/shadowRead.test.ts` (`npm run test:runtime`).
