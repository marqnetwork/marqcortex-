/**
 * Enterprise KPIs — blueprint §IV-48.
 *
 * Named indicators per approved category, computed from signals the platform
 * already publishes, carrying NO target, threshold or grade. §IV-48 puts
 * numeric targets in a later phase, and an indicator that graded itself would
 * be making a decision nobody has taken.
 */

export type {
  KpiCategory,
  KpiDefinition,
  KpiMeasurement,
  KpiReading,
  KpiReport,
  KpiUnit,
  SuccessDimension,
} from './contracts.ts';
export { KPI_CATEGORIES, NON_SUCCESS_TERMS, SUCCESS_DIMENSIONS } from './contracts.ts';
export { KpiDefinitionError, assertValidKpi, createKpiRegistry } from './registry.ts';
export type { KpiRegistry } from './registry.ts';
export { cortexKpiDefinitions, ratioPercent, registerCortexKpis } from './catalog.ts';
export type { KpiSignals } from './catalog.ts';
