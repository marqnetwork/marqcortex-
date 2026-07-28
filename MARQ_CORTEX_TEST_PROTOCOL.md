MARQ_CORTEX_TEST_PROTOCOL.md
Purpose

This document defines the mandatory testing and validation protocol for every engineering sprint. No sprint may be marked complete unless all applicable checks pass.

1. General Rules
Every code change must be tested before completion.
Test only the affected modules first.
Then run regression tests for dependent modules.
Never assume a fix works without verification.
If a test fails, the sprint is not complete.
2. Root Cause Validation

Before writing code:

Identify the exact root cause.
Verify the root cause with code evidence.
Do not guess.
Do not implement speculative fixes.
Fix the cause, not the symptom.
3. Build Validation

Every sprint must:

Build successfully.
Produce zero build errors.
Produce zero TypeScript errors.
Produce zero lint errors (where applicable).
Produce no new runtime warnings.
4. Functional Testing

Verify the feature behaves correctly.

Confirm:

Primary functionality works.
Expected user flow completes.
No broken interactions.
No infinite loading.
No duplicate actions.
5. Regression Testing

Verify related functionality still works.

Regression testing must include:

Parent module.
Child module.
Shared components.
Shared services.
Related API endpoints.
Related hooks.
Related state management.

Never modify one feature without checking connected features.

6. Data Validation

When data is involved:

Confirm:

No dummy data.
Correct database values.
Correct API responses.
Persistence after refresh.
Persistence after logout/login.
Empty states handled correctly.
Loading states handled correctly.
Error states handled correctly.
7. API Validation

For every affected API:

Verify:

Correct request.
Correct response.
Correct HTTP status.
Proper error handling.
No duplicate requests.
No unnecessary requests.
No breaking contract changes.
8. UI Validation

Every sprint must verify:

No unintended UI movement.
No spacing regressions.
No alignment regressions.
No responsive regressions.
No dark/light theme regressions.
No accessibility regressions.

Fixes must preserve the existing design unless the sprint specifically targets UI.

9. Browser Validation

Check:

Browser console contains no new errors.
Browser console contains no new warnings.
Network requests complete successfully.
No failed requests.
No unnecessary requests.
10. Performance Validation

Ensure:

No unnecessary renders.
No render loops.
No API loops.
No memory leaks.
No event listener leaks.
No timer leaks.
No excessive re-renders.
11. Documentation Validation

If implementation changes:

Update:

Relevant roadmap.
Relevant completion report.
Relevant architecture documentation.
Relevant engineering documentation.

Documentation must always match implementation.

12. Git Validation

Before completion:

Review changed files.
Ensure only intended files changed.
Remove debug code.
Remove temporary logs.
Remove commented-out code.
Commit using project conventions.
Push to the correct branch.
13. Sprint Completion Criteria

A sprint is complete only when:

Root cause resolved.
Feature works.
Build passes.
Tests pass.
Regression passes.
No console errors.
No unintended UI changes.
Documentation updated.
Changes committed.
Changes pushed.
Roadmap updated.

Otherwise:

The sprint remains In Progress.

14. Failure Handling

If any validation fails:

Stop progression.
Investigate the failure.
Apply the smallest safe fix.
Re-run all affected tests.
Repeat until every validation passes.

Never continue to the next sprint with unresolved failures.

15. Final Engineering Principle

A sprint is considered complete only when the implementation, testing, documentation, and repository state all satisfy this protocol. Code that compiles but is not fully validated is not production-ready.