# STABILIZATION — MARQ Cortex

> Narrative record of the stabilization program. Sprint numbering mirrors
> `MARQ_CORTEX_ROADMAP.md.txt`.

## Phase 4 — Runtime Storage Gateway (Shadow Read)

**Goal:** move MARQ Cortex from KV-authoritative reads toward SQL without a
risky big-bang cutover. The Shadow Read strategy runs both stores in parallel
for a period, comparing every read, so drift is caught and eliminated while KV
remains the single source of truth.

### Design

```
        ┌────────────── route handler (KV authoritative) ──────────────┐
        │  value = await kv.get(...)          ← ALWAYS returned          │
        │  await shadowReadX(key, value)      ← best-effort, flag-gated  │
        └───────────────────────────────────────────────────────────────┘
                                   │ (only when SHADOW_READ_* = true)
                                   ▼
                    runtime/gateway.shadowRead
                    ├─ readShadow()  → SQL repository
                    ├─ project both sides → comparable shape
                    ├─ diffProjections() → DriftReport
                    └─ telemetry(report)  (match/drift/missing/shadow_error)
```

**Invariants (enforced by tests):**

1. The KV authority value is returned unchanged, always.
2. When disabled, the shadow read is never invoked.
3. A throwing shadow read is caught and reported as `shadow_error`; it never
   propagates. Enabling backend reads therefore cannot cause a regression.

### Feature flags (edge-function env; all default `false`)

| Flag | Effect |
|------|--------|
| `SHADOW_READ_ENABLED` | Master switch — required for any shadow read |
| `SHADOW_READ_OUTCOMES` | S7.4 Outcome shadow read |
| `SHADOW_READ_LEADS` | S7.6 Lead shadow read |
| `SHADOW_READ_SUBMISSIONS` | S7.7 Submission shadow read |

Both the master switch and the per-domain switch must be `true` for a domain
to shadow-read. Reads stay authoritative from KV
(`RUNTIME_STORAGE_AUTHORITY = 'kv'`) until the Phase 5 SQL cutover.

### Domain projections (KV ⇄ SQL fields compared)

| Domain | Compared fields | KV source | SQL source |
|--------|-----------------|-----------|------------|
| Outcome | `submissionId`, `didConvert`, `conversionValue` | `outcome:<id>` | `outcomes` (`value.*`) |
| Lead | `exists` | `lead_email:<email>` | `leads` (`lookupLeadByEmail`) |
| Submission | `id`, `status`, `companyName`, `contactEmail`, `aiScore` | `sub:<id>` | `submissions` (`legacy_kv_key`) |

## Rollout / cutover sequence (unchanged from roadmap)

1. **Batch 2 (this batch):** Shadow Read implemented, default OFF, validated. ✅
2. Deploy edge function; enable `SHADOW_READ_*` in a non-critical window;
   observe drift telemetry until stable/deterministic. ⏳ (operational)
3. **Batch 3 / Phase 5 (S8.x):** flip read authority to SQL, then retire KV.
   Not started.
