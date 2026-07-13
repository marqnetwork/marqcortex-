# MCV2-S5-VALIDATE-001 — Live Validation Completion Report

**Sprint:** `MCV2-S5-VALIDATE-001`  
**Date:** 2026-07-14  
**Project:** `oqybniefkbppptfatoae` (cortex)  
**Status:** **Completed**

---

## Summary

Applied S5 diagnostic migrations to remote Supabase, ran live schema/RLS/repository validation, hardened anonymous INSERT policies via additive migration, and confirmed all static regression tests pass. KV and runtime routes unchanged.

---

## Migrations Applied

| Migration | Status |
|-----------|--------|
| `20260714050000_cortex_diagnostic_foundation.sql` | Applied |
| `20260714050001_cortex_diagnostic_rls.sql` | Applied |
| `20260714060000_cortex_diagnostic_anon_policy_hardening.sql` | Applied (defect fix) |

Local and remote migration versions match (6 migrations total).

---

## Live Test Results

| Test file | Result |
|-----------|--------|
| `diagnostic_schema.test.sql` | PASS |
| `diagnostic_rls.test.sql` | PASS |
| `diagnostic_live_rls.test.sql` | PASS |
| `diagnostic_anon_policy_review.test.sql` | PASS (post-hardening) |
| `diagnostic_repository_live.test.sql` | PASS |

---

## Defect Found and Fixed

**Issue:** Original `leads_insert_anon` and `submissions_insert_anon` policies only checked `organization_id = cortex.marq_organization_id()`. Anonymous callers could inject privileged `status`, `priority`, scores, and `created_by`.

**Fix:** Additive migration `20260714060000_cortex_diagnostic_anon_policy_hardening.sql` — restricts anon INSERT to funnel-safe field values.

---

## Rollback Readiness

`supabase/migrations/rollbacks/20260714050000_rollback_diagnostic.sql` drops all 13 diagnostic tables, diagnostic permissions, and helper functions. Tenancy + KV unaffected. **Not executed** on remote (validation only).

---

## Recommended Next Sprint

**MCV2-S5-IMPLEMENT-003** — KV backfill scripts for `lead:*` and `sub:*` namespaces.

---

*End of validation report*
