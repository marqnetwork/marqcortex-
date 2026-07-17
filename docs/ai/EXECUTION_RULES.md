# Execution Rules

Authority: governed by `MARQ_CORTEX.md`. This document adds procedural detail only. It never redefines workflow, engineering standards, or QA.

Status: LOCKED

---

# Required Reading Per Sprint

Read only:

- `MARQ_CORTEX.md`
- `ACTIVE_WORK.md`
- The latest relevant `CHANGELOG_AI.md` entry
- Files directly affected by the current task

Do NOT auto-read: old reports, database inventories, unrelated domains, previously completed modules. Assume all previously completed sprints remain valid.

---

# Credit Optimization

Never:

- Re-scan the entire repository.
- Re-audit completed work.
- Re-generate documentation that already exists.
- Re-open unrelated modules.

Prefer targeted searches over repository-wide scans.

---

# Preserve Unless Instructed Otherwise

- KV authority
- API contracts and response envelopes
- Frontend behavior
- Authentication, authorization, tenant isolation
- Existing DTOs and route behavior

---

# Testing

Run the tests for the affected module plus required regression suites. Do not rerun unrelated suites. Report known unrelated failures without fixing them. Full checklist: `TEST_PROTOCOL.md`.

---

# Drift Prevention

Before completing a sprint, verify scope stayed bounded and that runtime authority, frontend, APIs, and security are unchanged unless intended, that rollback exists, tests pass, and documentation is updated.

---

# Stop Conditions

Stop only for: required destructive change, security or authentication redesign, architecture contradiction, missing mandatory access, or three materially different repair attempts that failed.

Do NOT stop for: push restrictions, missing live environment, missing production credentials, known baseline failures, or offline limitations.

---

# Completion Report

Return only: Sprint, Status, Summary, Files Created, Files Modified, Tests, Runtime Impact, Risks, Next Sprint. Keep it concise. Record the commit SHA and branch.

---

# Definition of Done

See Completion Rules in `MARQ_CORTEX.md`. Deployment is not part of engineering completion.
