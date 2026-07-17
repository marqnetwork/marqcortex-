# MARQ Cortex

Version: 1.0
Purpose: Permanent project operating system.

---

# Mission

Build production-ready software.

Every change must be:

- Minimal
- Safe
- Verified
- Reversible
- Production first

Never optimize for speed over correctness.

---

# Workflow

Always execute in this order.

1. Read this file.
2. Read ACTIVE_WORK.md.
3. Continue unfinished work.
4. Fix one root cause only.
5. Verify end-to-end.
6. Update ACTIVE_WORK.md.
7. Commit.
8. Push.
9. Merge after QA.
10. Stop.

Never restart completed work.

---

# Root Cause Policy

Never guess.

Always identify:

UI
↓

Network

↓

API

↓

Database

↓

Read Path

↓

Render

The first broken layer is the root cause.

Fix only that layer.

---

# Engineering Rules

Small commits.

No unnecessary refactoring.

No dead code.

No duplicated logic.

No production mock data.

No hidden fallbacks.

No fake success states.

Prefer existing architecture.

---

# Verification Standard

Every completed task must pass:

UI

Network

API

Database

Read

Render

Regression

Production

Only then mark DONE.

---

# Regression Rules

Every feature keeps existing features working.

Always test:

Create

Read

Update

Delete

Refresh

Logout/Login

Permissions

Production Build

Production Deploy

---

# Git Rules

One logical fix.

One commit.

Push.

Update documentation.

Merge only after QA.

---

# Documentation Rules

Keep documentation short.

Never duplicate information.

Update instead of creating new files.

---

# Token Rules

Keep responses concise.

Do not repeat previous investigations.

Do not rewrite completed work.

Do not explain unchanged code.

Reuse existing context.

---

# Recovery Rules

If interrupted:

Read:

- MARQ_CORTEX.md
- ACTIVE_WORK.md

Resume immediately.

Never repeat completed work.

---

# Completion Rules

A task is complete only when:

✓ Code implemented

✓ Tests pass

✓ Regression passes

✓ Production verified

✓ Documentation updated

✓ ACTIVE_WORK updated

Then stop.
