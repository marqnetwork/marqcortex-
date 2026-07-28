# MARQ Cortex Documentation Rules

Version: 1.0
Status: Active
Applies To: All Engineering Sprints

---

# Purpose

This document defines the documentation standards for MARQ Cortex.

Documentation is considered part of the implementation. Every engineering change must leave the documentation accurate, synchronized, and production-ready.

No sprint is considered complete until all required documentation has been reviewed and updated.

---

# Rule 1 — Documentation is Mandatory

Every completed sprint must review documentation.

If implementation changes, documentation must be updated before the sprint can be marked complete.

---

# Rule 2 — Update Only What Changed

Only update documentation directly affected by the current sprint.

Do not modify unrelated documents.

Do not rewrite existing documentation unless it has become inaccurate.

---

# Rule 3 — Documentation Must Match Implementation

Documentation must always describe the current implementation.

Never document planned functionality.

Never leave documentation ahead of or behind the codebase.

---

# Rule 4 — Required Documentation Review

Before completing any sprint, determine whether changes affect:

- Architecture
- APIs
- Database
- User Flows
- Business Rules
- Configuration
- Infrastructure
- Deployment
- Testing
- Feature Behaviour

If affected, update the corresponding documentation.

---

# Rule 5 — Standard Documents

Review the following documents when applicable:

- MARQ_CORTEX_ROADMAP.md
- MARQ_CORTEX_STABILIZATION_ROADMAP.md
- Architecture Documentation
- API Documentation
- Database Documentation
- Business Rules
- User Flow Documentation
- Feature Inventory
- Sprint Completion Report

Only update documents impacted by the sprint.

---

# Rule 6 — Sprint Completion Report

Every completed sprint must produce a completion report containing:

- Sprint ID
- Sprint Name
- Objective
- Issues Completed
- Root Cause
- Solution
- Files Modified
- Tests Executed
- Validation Results
- Known Limitations
- Commit SHA
- Branch Name
- Completion Date

---

# Rule 7 — Roadmap Maintenance

After every completed sprint:

- Update sprint status.
- Update issue status.
- Record completion date.
- Record discovered dependencies.
- Keep roadmap synchronized with implementation.

Do not modify future sprint definitions unless required.

---

# Rule 8 — Architecture Documentation

Architecture documentation must only be updated when changes affect:

- System Design
- Component Responsibilities
- Data Flow
- Service Communication
- Storage Strategy
- API Contracts
- Infrastructure
- Security Model

Bug fixes alone do not require architecture updates.

---

# Rule 9 — Documentation Quality

Documentation must always be:

- Accurate
- Technical
- Concise
- Current
- Consistent
- Easy to maintain
- Free from duplication

Avoid unnecessary explanations.

Avoid speculative information.

Avoid outdated content.

---

# Rule 10 — Version History

Major documentation updates must include:

- Date
- Sprint ID
- Summary of Changes

Maintain a clear history for long-term maintenance.

---

# Rule 11 — Documentation Validation

Before marking a sprint complete, verify:

- Documentation matches implementation.
- Roadmaps are updated.
- Completion report exists.
- No outdated documentation remains.
- No duplicate documentation has been introduced.

---

# Rule 12 — Definition of Done

A sprint cannot be marked complete until:

- Implementation is complete.
- Testing Protocol has passed.
- Required documentation has been updated.
- Completion report has been written.
- Roadmap has been updated.
- Commit has been created.
- Changes have been pushed.

Otherwise, the sprint remains **In Progress**.

---

# Engineering Principle

Documentation is a production asset.

Every engineering sprint must leave the codebase and its documentation synchronized, accurate, and ready for future development.

Incomplete documentation is considered an incomplete implementation.