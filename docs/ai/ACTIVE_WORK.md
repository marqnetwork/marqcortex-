# Active Work

## Current: Stabilization Batch 3 — Demo → Backend Migration

**Branch:** `claude/marq-cortex-batch-3-xwya9f`
**Date:** 2026-07-18
**State:** COMPLETE — awaiting approval before Batch 4.

### What was done
Reconciled the remaining demo/mock/gated surface identified in
`src/system/manifest.ts` (13 DEMO + 3 GATED).

- Flipped **7 already-wired nodes** to `LIVE` (frontend already calls the real
  backend/service in backend mode; manifest was stale):
  `MQC-COMP-046` GlobalAIChat, `MQC-COMP-047` CortexChatPanel,
  `MQC-COMP-048` CopilotPanel, `MQC-COMP-052` CortexModulesNew,
  `MQC-COMP-053` CortexProposalModule, `MQC-COMP-057` EngagementIntelligence,
  `MQC-SVC-002` cortexDataService.
- Documented **6 DEMO nodes** left untouched — no consumable backend endpoint:
  `MQC-COMP-021` ProposalSectionCopilot, `MQC-COMP-049` AIAssistant,
  `MQC-COMP-050` InlineAITrigger, `MQC-COMP-051` ObjectionHandlerPanel,
  `MQC-COMP-054` CortexReviewerModule, `MQC-COMP-056` RevenueIntelligenceDashboard.
- Documented **3 GATED nodes** left untouched — external prerequisites:
  `MQC-COMP-059` ABTestingPanel, `MQC-COMP-061` LearningLoopPanel,
  `MQC-COMP-067` CRMSyncPanel.

### Files touched
- `src/system/manifest.ts` — status + notes reconciliation, header meta.
- `docs/ai/STABILIZATION_INVENTORY.md` — new.
- `docs/ai/STABILIZATION.md` — new.
- `docs/ai/ACTIVE_WORK.md` — new (this file).
- `docs/ai/CHANGELOG_AI.md` — new.

No application/runtime source behavior changed. `BACKEND_INTEGRATION` global flag
left at its existing default (out of scope to flip).

### Verification
- `vite build` green.
- Tests: intelligence 8/8, migration 36/36, database static 19/19.
- Manifest validation: no new errors/warnings vs. baseline.

### Blocked / needs Batch 4 (backend build, not a demo swap)
- Section-level proposal copilot endpoint (for ProposalSectionCopilot).
- Objection-escalation + reviewer-decision persistence endpoints.
- Revenue snapshot analytics endpoint (nightly aggregation).
- CRM sync webhook + credentials; A/B + learning-loop data-volume gates.
