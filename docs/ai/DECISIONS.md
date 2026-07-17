# Architectural Decisions

Permanent record of architectural decisions. One entry per decision. Reasons only — no implementation details (those live in code and `ARCHITECT.md`).

Status: Accepted · Superseded · Deprecated

---

## D1 — KV remains authoritative until per-domain SQL cutover

Decision: KV (`kv_store_324f4fbe`) stays the runtime source of truth until each domain passes Phase 5 reconciliation gates.
Reason: Validation must precede authority; a big-bang cutover risks data loss and irreversible drift.
Status: Accepted
Date: 2026-07-11
Related files: `docs/ai/MARQ_CORTEX.md`, `docs/ai/ROADMAP.md`

## D2 — Provider-independent intelligence gateway

Decision: All model access routes through the Intelligence Gateway adapter layer; no provider names or model IDs in business logic.
Reason: Keeps the system portable across Claude, GPT, Gemini, and future providers without touching business logic.
Status: Accepted
Date: 2026-07-11
Related files: `docs/ai/MARQ_CORTEX.md`

## D3 — Deterministic engines are authoritative; the LLM only explains

Decision: Engines in `src/app/core/` own scoring, ROI, proposals, and execution math. The LLM narrates but never overrides numbers.
Reason: Deterministic math is reproducible and auditable; AI output is not.
Status: Accepted
Date: 2026-07-11
Related files: `docs/ai/MARQ_CORTEX.md`

## D4 — Single authoritative AI documentation system

Decision: `docs/ai/MARQ_CORTEX.md` is the only master control document. All other AI docs are subordinate and never redefine workflow, engineering, QA, or execution rules.
Reason: One source of truth eliminates duplicate and conflicting instructions and minimizes AI context usage.
Status: Accepted
Date: 2026-07-17
Related files: `AI_START_HERE.md`, `docs/ai/MARQ_CORTEX.md`
