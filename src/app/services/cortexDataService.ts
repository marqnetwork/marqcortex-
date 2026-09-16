/**
 * CORTEX DATA SERVICE — CORTEX-specific data layer
 *
 * Wraps cortexDataGenerator so CortexDashboard.tsx imports from a service
 * layer, not directly from utils.
 *
 * WHY NOT IN dataService.ts?
 *   cortexDataGenerator.ts imports `Submission` from dataService.ts.
 *   Adding these re-exports into dataService.ts would create a circular
 *   dependency (A → B → A). This sibling service file breaks the cycle
 *   while keeping all components pointing at a service layer.
 *
 *   Import chain:
 *     CortexDashboard.tsx  → cortexDataService.ts  → mockCortexData.ts
 *                                                  → cortexDataGenerator.ts
 *                                                      → dataService.ts (types only)
 *
 * SLA STATUS: All CORTEX components now source data exclusively through
 * a service layer file. Zero direct @/app/utils imports remain in .tsx.
 */

// ── Re-export CORTEX types so callers only need this file ────────────────────
export type { Lead, CortexLeadData, LeadStatus } from '@/app/types/cortex-types';

// ── The mock lead list used to be re-exported here ───────────────────────────
//
// `export { getMockLeads, getMockCortexLeadData } from '…/mockCortexData'`.
// `CortexDashboard` read both: `getMockLeads()` when the backend was off, when
// the pipeline came back empty, AND inside the `catch`; and
// `getMockCortexLeadData(leadId)` for any lead it could not find — a function
// that returns the FIRST fixture for an unrecognised id, so a stale link showed
// a complete, confident diagnostic belonging to a company that does not exist.
//
// The fixtures are still there, behind `@/app/demo`. Nothing in the
// authenticated product reaches them, and `tests/features/demoIsolation.test.ts`
// is what keeps that true.

// ── Submission → CortexLeadData converter (deterministic core) ───────────────
export { generateCortexData } from '@/app/utils/cortexDataGenerator';
