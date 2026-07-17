# MARQ Cortex Constitution

**Version:** 1.1  
**Effective:** 2026-07-14  
**Status:** Canonical — locked operating principles for MARQ Cortex V2

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| **v1.1** | 2026-07-14 | Added **Article 17 — Runtime Authority Protection**. Registered in agent entry points (MCV2-S6.3-VALIDATE-005). |
| **v1.0** | 2026-07-11 | Initial lock from S3 data platform architecture, agent system prompt, and S6.1 migration planning principles. |

---

## Preamble

MARQ Cortex evolves through bounded, verified sprints. Architecture decisions are additive unless explicitly approved. Deterministic engines own math; AI narrates. Data authority changes only after validation, reconciliation, rollback readiness, and human review for high-risk domains.

---

## Article 1 — Evolve, Do Not Rebuild

Cortex evolves incrementally. Rebuilds require explicit approval, rollback plans, and evidence that incremental change cannot achieve the objective safely.

## Article 2 — Provider-Independent Intelligence

Business logic must not hardcode provider names or model IDs. All model access routes through the Intelligence Gateway adapter layer. Normalized contracts must not leak provider-specific fields upstream.

## Article 3 — Frontend Data Gateway

Components import data **only** from `src/app/services/dataService.ts`. HTTP details remain in `api.ts`. Bypassing the gateway is an architecture violation unless a sprint explicitly authorizes a bounded migration path with rollback.

## Article 4 — Phased Data Platform

Supabase/PostgreSQL is the long-term authoritative relational platform. Migration is phased by domain. KV remains authoritative until per-domain Phase 5 cutover passes reconciliation gates.

## Article 5 — Multi-Tenancy and RLS

All relational business data is organization-scoped. Row Level Security is mandatory on tenant and diagnostic tables. Service-role bypass is allowed only for migration, backfill, and platform-admin operations with explicit org scoping in engine logic.

## Article 6 — Deterministic Logic Is Authoritative

Core engines in `src/app/core/` own scoring, ROI, proposals, and execution math. **Math decides priority. LLM only explains decisions.** AI must not override authoritative numbers unless a sprint explicitly authorizes a bounded change.

## Article 7 — Phased KV Migration

KV → SQL migration is never big-bang. Phases: inventory → schema → backfill → dual-read → dual-write → SQL authoritative → KV retirement. Dual-read and dual-write are forbidden until reconciliation passes.

## Article 8 — Human Review for High-Risk Changes

High-risk domains require human review before production cutover:

- Auth, permissions, secrets, client isolation
- RLS policy design
- Production data migration and authority changes
- Provider adapter and shared contract changes

## Article 9 — Sprint Quality Gates

Every sprint requires, at minimum:

1. Architecture compliance check against this Constitution and `ARCHITECT.md`
2. Regression tests for touched domains
3. Security review for auth, secrets, and tenant isolation changes
4. Documentation updates (`ARCHITECT.md`, `system_map.json`, completion report)
5. Rollback path documented and verified where data or schema changes occur

## Article 10 — Evidence Over Assertion

Completion claims require verifiable evidence: file diffs, command output, or observed runtime behavior. Tag findings as PROVEN, LIKELY, SUSPECTED, or MISSING EVIDENCE.

## Article 11 — Idempotent Migration

Backfill operations must be idempotent via `legacy_kv_key` upsert. No silent record drops — quarantine every skipped or invalid source record.

## Article 12 — No Unauthorized Runtime Cutover

Runtime routes, frontend behavior, and API contracts must not change authority during infrastructure or backfill sprints unless the sprint explicitly authorizes cutover and all gates pass.

## Article 13 — Secrets Discipline

Never commit `.env`, service role keys, or credentials. Never store secrets in generated reports or tracked documentation. Use secure runtime environment or platform secret stores only.

## Article 14 — Manifest and Registry

New production files require manifest IDs in `src/system/manifest.ts` before implementation. One canonical manifest; legacy registry utils are orphaned.

## Article 15 — Documentation as Contract

`ARCHITECT.md` is the human map; `architecture/system_map.json` is the machine snapshot. Structural changes update both. Sprint completion reports record status, gaps, and review priorities.

## Article 16 — Scope Discipline

Agents execute only the assigned sprint scope. Do not begin subsequent sprints unless explicitly instructed. Do not expand scope because adjacent code is imperfect.

## Article 17 — Runtime Authority Protection

**Validation precedes authority.**

1. KV (`kv_store_324f4fbe`) remains runtime source of truth until per-domain Phase 5 cutover.
2. No sprint may promote a new source of truth before rollback, telemetry, and reconciliation pass in a production-connected environment.
3. Disposable validation fixtures must use non-colliding prefixes and must be cleaned up after validation.
4. Migration infrastructure writes must not modify existing production KV records.
5. Authority change requires: reconciliation threshold pass, quarantine accounting, rollback verification, and documented human review for the domain.

---

## Authority Order

When sources disagree, resolve in this order:

1. This Constitution (for principles and authority rules)
2. Current sprint acceptance criteria
3. `ARCHITECT.md` golden rules
4. `prompts/MARQ-CLAUDE-AGENT-SYSTEM-PROMPT-v1.0.md`
5. Verified implementation behavior
6. Other documentation

---

## Registration

| Surface | Reference |
|---------|-----------|
| Agent entry | `ARCHITECT.md` § Agent entry points |
| Cursor rule | `.cursor/rules/read-marq-cortex.mdc` |
| Machine snapshot | `architecture/system_map.json` → `constitution` |
| Migration roadmap | `architecture/database/MCV2-S3-MIGRATION-ROADMAP.md` |

---

*End of MARQ Cortex Constitution v1.1*
