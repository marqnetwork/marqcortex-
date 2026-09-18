# MARQ Cortex — Engineering Operating Rules

**Status:** DERIVED OPERATIONAL DOCUMENT — NOT A SOURCE OF TRUTH  
**Authority:** `MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md` remains the canonical implementation authority.  
**Purpose:** Consolidates the sprint-level operating details formerly split across `MARQ_CORTEX_DOCUMENTATION_RULES.md`, `MARQ_CORTEX_EXECUTION_RULES.md`, and `MARQ_CORTEX_TEST_PROTOCOL.md`.

If this document conflicts with the Cortex authority order, the higher-authority document wins.

---

## 1. Sprint Scope Discipline

- Work only on the approved sprint/task scope.
- Prefer the smallest safe, reversible change.
- Do not refactor unrelated modules or expand scope without approval.
- Do not re-audit completed work unless the current task requires it.
- If an older defect is discovered, fix it only when it blocks the current scope; otherwise record it as technical debt.
- Preserve runtime authority, API contracts, authentication, authorization, tenant isolation, DTOs, response envelopes, and route behavior unless the task explicitly changes them.
- Avoid speculative abstractions and duplicate logic.

## 2. Evidence and Root Cause

Before implementation:

- identify the exact root cause;
- verify it with code/runtime evidence;
- do not guess;
- fix the cause rather than the symptom.

Completion claims require verifiable evidence such as file changes, test output, runtime observations, or other reproducible proof.

## 3. Targeted Context Reading

For normal sprint execution:

- read the current task and the files directly affected;
- use targeted searches before broad repository scans;
- consult the latest relevant status/current-state record when needed;
- do not automatically re-read historical completion reports, old audits, or unrelated architecture material.

Repository-wide scans are appropriate only when the task itself is a repository-wide audit, architecture reconciliation, cleanup, or migration assessment.

## 4. Testing Order

Every code change must be tested before completion.

Use this order:

1. affected unit/module tests;
2. dependent regression tests;
3. build/type/lint validation where applicable;
4. functional/runtime validation;
5. browser/UI validation for user-facing work;
6. API/data validation for service or persistence work;
7. security/tenant validation when authority or sensitive data is touched;
8. performance checks when the change can affect rendering, requests, loops, timers, listeners, memory, or throughput.

Known unrelated baseline failures are reported rather than silently repaired outside scope.

## 5. Build and Functional Validation

Applicable sprints must verify:

- successful build;
- no new TypeScript errors;
- no new lint errors where lint is enforced;
- no new runtime warnings attributable to the change;
- primary functionality completes;
- expected user flow completes;
- no broken interactions;
- no infinite loading or duplicate actions.

## 6. Data and API Validation

When data is involved, verify as applicable:

- no fabricated/dummy production data is presented as real;
- database values are correct;
- API responses are correct;
- persistence survives refresh and session transitions when expected;
- loading, empty, and error states are truthful;
- request/response contracts and status codes are correct;
- error handling is explicit;
- no unnecessary or duplicate requests are introduced;
- breaking API changes require explicit approval and migration planning.

## 7. UI and Browser Validation

For user-facing work, verify as applicable:

- no unintended layout movement;
- spacing and alignment remain coherent;
- responsive behavior remains correct;
- theme behavior is not regressed;
- accessibility is not regressed;
- browser console contains no new relevant errors or warnings;
- expected network requests succeed and unnecessary requests are not introduced.

UI fixes preserve the approved experience unless the task explicitly changes the design.

## 8. Performance Validation

Check for new:

- render loops;
- API loops;
- excessive re-renders;
- memory leaks;
- event-listener leaks;
- timer leaks;
- avoidable repeated requests or expensive work.

Performance validation should be proportional to the touched surface.

## 9. Documentation as Part of Implementation

Documentation is a production asset.

For every implementation change, determine whether the change affects:

- architecture;
- APIs;
- data/database;
- user flows;
- business rules;
- configuration;
- infrastructure;
- deployment;
- testing;
- feature behavior.

Update only documentation actually affected by the change. Do not rewrite unrelated documents or create duplicate sources of truth.

Documentation must be accurate, current, technical, concise, maintainable, and synchronized with implementation.

Canonical future-state documents may describe approved future capability by design. Derived current-state documents must clearly distinguish implemented, partial, missing, and future states.

## 10. Architecture Documentation

Architecture documentation is updated when changes alter system design, component responsibilities, data flow, service communication, storage strategy, API contracts, infrastructure, security model, or another architectural boundary.

Routine bug fixes do not require architecture rewrites when structure is unchanged.

## 11. Roadmap and Current-State Tracking

When a task is part of an active execution plan:

- update the relevant sprint/status record;
- record completion date and discovered dependencies where the active plan requires it;
- do not silently modify future scope;
- distinguish engineering completion, live verification, and production deployment.

Historical sprint reports are evidence, not authority.

## 12. Git Hygiene

Before completion:

- review changed files;
- confirm only intended files changed;
- remove temporary debug code/logging and dead commented-out code;
- use the correct branch;
- commit and push when the approved workflow requires it;
- record commit SHA/branch in the completion record where applicable.

A transport or environment restriction that prevents push/deployment must be reported accurately; it does not convert unverified deployment into a successful deployment.

## 13. Drift Prevention

Before closing a task, verify:

- scope remained bounded;
- no unrelated modules changed;
- runtime/data authority changed only if intended;
- API and frontend behavior changed only if intended;
- security and tenant isolation were preserved or deliberately changed under review;
- rollback/reversal exists when the change requires one;
- applicable tests passed;
- documentation is synchronized;
- no duplicate authority/documentation source was introduced.

## 14. Stop / Escalation Conditions

Escalate rather than improvise when the task requires:

- an unapproved destructive change;
- a material security or authentication redesign;
- an unresolved architecture/canonical contradiction;
- mandatory access that is unavailable;
- a high-consequence authority change without the required human review;
- repeated materially different repair attempts that still fail.

Missing production credentials, offline execution, blocked live environments, or known unrelated baseline failures should be reported as limitations rather than disguised as completion.

## 15. Definition of Done

A task/sprint is complete only when all applicable conditions are satisfied:

- approved scope is implemented;
- root cause is resolved where the task is a defect fix;
- functional behavior is verified;
- required build/tests/regressions pass;
- no unintended UI/API/data/security drift is introduced;
- documentation/current-state records are updated where required;
- rollback or reversal is documented where appropriate;
- repository state is clean and reviewable;
- commit/push requirements of the active workflow are satisfied or accurately reported as externally blocked.

Deployment is a separate state unless the task explicitly includes deployment and live verification.

---

## Source Lineage

This derived document consolidates the operational content of the former root-level:

- `MARQ_CORTEX_DOCUMENTATION_RULES.md`
- `MARQ_CORTEX_EXECUTION_RULES.md`
- `MARQ_CORTEX_TEST_PROTOCOL.md`

The canonical engineering principles remain in `MARQ_CORTEX_IMPLEMENTATION_GUIDE_v1.0.md`; this file exists only to provide one concise sprint-operating reference without creating another competing source of truth.
