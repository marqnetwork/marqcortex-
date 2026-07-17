# Test Protocol

Authority: governed by `MARQ_CORTEX.md`. This is the detailed QA checklist behind the Verification Standard. No sprint is complete unless all applicable checks pass.

---

# 1. Root Cause

Identify and verify the exact root cause with code evidence before writing any fix. Fix the cause, not the symptom.

# 2. Build

Zero build errors. Zero TypeScript errors. Zero lint errors. No new runtime warnings.

# 3. Functional

Primary functionality works. Expected user flow completes. No broken interactions, infinite loading, or duplicate actions.

# 4. Regression

Verify parent module, child module, shared components, shared services, related endpoints, hooks, and state. Never change one feature without checking connected features.

# 5. Data

No dummy data. Correct database values and API responses. Persistence after refresh and after logout/login. Empty, loading, and error states handled.

# 6. API

Correct request, response, and HTTP status. Proper error handling. No duplicate or unnecessary requests. No breaking contract changes.

# 7. UI

No unintended movement, spacing, alignment, responsive, theme, or accessibility regressions. Preserve existing design unless the sprint targets UI.

# 8. Browser

No new console errors or warnings. All network requests complete. No failed requests.

# 9. Performance

No unnecessary renders, render loops, API loops, memory leaks, or listener/timer leaks.

# 10. Documentation

If implementation changed, update the affected documentation so it matches implementation. See `DOCUMENTATION_RULES.md`.

# 11. Git

Only intended files changed. No debug code, temporary logs, or commented-out code. Commit and push to the correct branch.

---

# Completion Criteria

Complete only when: root cause resolved, feature works, build passes, tests pass, regression passes, no console errors, no unintended UI changes, documentation updated, changes committed and pushed.

# Failure Handling

If any validation fails: stop, investigate, apply the smallest safe fix, re-run affected tests, repeat until all pass. Never continue with unresolved failures.
