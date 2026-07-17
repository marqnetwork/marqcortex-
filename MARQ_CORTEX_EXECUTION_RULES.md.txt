# MARQ Cortex Execution Rules

Version: 1.0
Status: LOCKED

---

# Purpose

This document is the permanent execution contract for all future MARQ Cortex engineering sprints.

Every sprint must follow these rules unless the user explicitly overrides them.

Do not repeat these rules in every sprint prompt.

---

# Core Principles

- Minimize token and credit usage.
- Never re-audit completed work unless explicitly requested.
- Read only the files required for the current sprint.
- Preserve existing architecture unless the sprint requires a change.
- Prefer small, incremental changes over large refactors.
- Keep runtime behavior unchanged unless the sprint explicitly changes it.
- Every sprint must be independently reviewable and reversible.

---

# Required Reading

Always read:

- This document
- Latest sprint completion report
- Files directly affected by the sprint

Do NOT automatically read:

- Old sprint reports
- Database architecture documents
- Large inventories
- Previous implementation reports
- Unrelated domains

Only read additional files when absolutely necessary.

---

# Credit Optimization Rules

Never:

- Rebuild architecture documents
- Re-read completed implementation reports
- Re-scan the entire repository
- Re-open unrelated modules
- Re-generate documentation that already exists
- Audit completed work twice

Prefer targeted searches over repository-wide scans.

Reuse existing documentation whenever possible.

---

# Engineering Rules

Preserve unless explicitly instructed otherwise:

- KV authority
- API contracts
- Frontend behavior
- Authentication
- Authorization
- Tenant isolation
- Existing DTOs
- Existing response envelopes
- Existing route behavior

---

# Implementation Rules

Only implement the scope of the current sprint.

Never expand scope without approval.

Avoid speculative abstractions.

Avoid unnecessary refactoring.

Avoid duplicate logic.

---

# Testing Rules

Run only the tests affected by the sprint plus the required regression suites.

Do not rerun unrelated test suites.

If a known unrelated failure already exists, report it without attempting to fix it.

---

# Documentation Rules

Only update:

- Files directly affected
- Architecture index
- System map
- Sprint completion report

Avoid rewriting stable documentation.

---

# Git Rules

Do not commit unless requested.

Do not push unless requested.

Git push failures caused by environment policy are NOT sprint failures.

Treat them as deployment limitations.

---

# Drift Prevention

Before completing every sprint verify:

- Scope remained bounded.
- No unrelated modules changed.
- Runtime authority unchanged unless intended.
- Frontend unchanged unless intended.
- APIs unchanged unless intended.
- Security unchanged unless intended.
- Rollback exists.
- Tests pass.
- Documentation updated.

---

# Stop Conditions

Stop only if:

- Destructive change required
- Security redesign required
- Authentication redesign required
- Architecture contradiction
- Missing mandatory access
- Three materially different repair attempts failed

Do NOT stop because of:

- GitHub push restrictions
- Missing live environment
- Missing production credentials
- Known baseline failures
- Offline execution limitations

---

# Completion Report

Return only:

- Sprint
- Status
- Executive Summary
- Files Created
- Files Modified
- Tests
- Runtime Impact
- Risks
- Next Sprint

Keep reports concise.

---

# Definition of Done

A sprint is complete when:

- Scope completed
- Tests passed
- Documentation updated
- Rollback documented
- No unintended drift
- Runtime behavior matches sprint objective

Deployment is NOT part of engineering completion.


# Context Memory Rules

Treat this document as permanent memory.

Do not repeat these rules in future sprints.

At the beginning of every sprint:

1. Read this document.
2. Read only the latest sprint completion report.
3. Read only files directly affected by the current task.

Assume all previous approved sprints remain valid.

Never re-audit completed work unless explicitly requested.

Never regenerate existing documentation unless the sprint specifically requires updating it.

When additional information is needed, search only the affected module instead of the whole repository.

Every sprint should build only on the immediately previous sprint.

Avoid repository-wide scans unless explicitly requested.   

## Git Workflow

At the end of every completed sprint:

1. Run all required tests.
2. Commit the sprint.
3. Push the branch to GitHub.
4. Verify the push succeeded.
5. Include the commit SHA and branch name in the completion report.

Do not open a Pull Request unless explicitly requested or a roadmap milestone has been completed.

A sprint is considered fully complete only after:
- Engineering is complete.
- Tests pass.
- Documentation is updated.
- Changes are successfully pushed to GitHub.
# Sprint Discipline

Every sprint must begin by confirming:

- Current roadmap position from `MARQ_CORTEX_ROADMAP.md`
- Latest completed sprint
- Current sprint objective

Work only on the approved sprint.

Do not:
- Skip ahead to future sprints.
- Expand the scope beyond the approved sprint.
- Refactor unrelated code.
- Re-audit completed modules.
- Re-open previously approved architecture decisions.

If a defect from a previous sprint is discovered:

- Fix it only if it directly blocks the current sprint.
- Otherwise document it as technical debt and continue.

Before marking a sprint complete, verify:

- Scope completed exactly as requested.
- No unrelated files modified.
- No architectural drift.
- Tests passed.
- Documentation updated.
- Commit created.
- Changes pushed to GitHub.
- Roadmap updated.