/**
 * CORTEX DATA SERVICE — CORTEX-specific data layer
 *
 * Wraps mockCortexData + cortexDataGenerator so CortexDashboard.tsx
 * imports from a service layer, not directly from utils.
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

// ── Mock lead list (demo mode) ───────────────────────────────────────────────
export { getMockLeads, getMockCortexLeadData } from '@/app/utils/mockCortexData';

// ── Submission → CortexLeadData converter (deterministic core) ───────────────
export { generateCortexData } from '@/app/utils/cortexDataGenerator';
