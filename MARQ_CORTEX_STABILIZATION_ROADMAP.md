# MARQ Cortex — Stabilization Roadmap

**Status: SUPERSEDED. Closed on V1 closure.**

This file was zero bytes. Documentation Rule 5 names it as a standard document
to review each sprint, so an empty file was not a harmless gap — it was a
standing instruction to consult a document that said nothing, which is how a
review step becomes a formality.

It is not deleted, because Rule 5 names it and this repository's rules forbid
rewriting canon to suit the work. Instead it says what is true.

## What replaced it

Stabilization was tracked as a separate axis while the platform was being
brought from the Figma Make scaffold to a coherent product. That axis closed:
the work it tracked is now either complete, or carried under a named gate in the
V1 documents, which are more specific and are kept current.

| For | Read |
|---|---|
| What is complete, partial, missing or deferred, with evidence | `docs/development/V1_COMPLETION_CHECKLIST.md` |
| What must happen to go live, in order, and what must not | `docs/development/V1_PRODUCTION_READINESS.md` |
| How each closure was reached, and what was wrong before it | `docs/development/AUTONOMOUS_BUILD_PROGRESS.md` |
| Sprint and phase status as canon records it | `MARQ_CORTEX_ROADMAP.md` |

## The one thing worth carrying forward

Stabilization's original premise — that the scaffold made claims the code did not
honour — outlived the axis. Four separate closures this cycle were corrections to
a document rather than to code:

- The roadmap's "Next Sprint" named reconciliation that already existed.
- `tsconfig.node.json`'s missing `strict` was the real cause of a boundary
  failure attributed to a TypeScript version difference.
- Four manifest nodes were marked LIVE with nothing importing them.
- The G2 audit's class-E rating for the client portal rested on a fallback that
  should not have existed at all.

Each was found by checking the claim against the code, and each is now pinned by
a test rather than by a promise. That is the practice the axis existed to
establish, and it belongs in the sprint routine, not in a roadmap.

---

Post-V1 stabilization, if it is wanted again, starts from the V1 checklist's
PARKING LOT and HUMAN DECISIONS sections rather than from this file.
