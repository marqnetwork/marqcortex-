/**
 * The KPI registry — blueprint §IV-48.
 *
 * Registration is where the anti-metric exclusion is enforced, because it is
 * the only moment at which an indicator can be refused. Everything after
 * registration is arithmetic.
 */

import type {
  KpiCategory,
  KpiDefinition,
  KpiMeasurement,
  KpiReading,
  KpiReport,
} from './contracts.ts';
import { KPI_CATEGORIES, NON_SUCCESS_TERMS, SUCCESS_DIMENSIONS } from './contracts.ts';

export class KpiDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KpiDefinitionError';
  }
}

const ID_SHAPE = /^[a-z]+\.[a-z][a-z0-9_]*$/;

/**
 * Validate one definition. Throws, because a bad KPI must not reach a report.
 *
 * Exported so the catalogue's own suite can assert each rule in isolation
 * rather than only observing that registration succeeded.
 */
export function assertValidKpi(definition: KpiDefinition): void {
  if (!ID_SHAPE.test(definition.id)) {
    throw new KpiDefinitionError(
      `KPI id must be <category>.<indicator> in lower snake case: ${definition.id}`,
    );
  }
  const [prefix] = definition.id.split('.');
  if (prefix !== definition.category) {
    throw new KpiDefinitionError(
      `KPI ${definition.id} is filed under ${definition.category} but named for ${prefix}`,
    );
  }
  if (!KPI_CATEGORIES.includes(definition.category)) {
    throw new KpiDefinitionError(`KPI ${definition.id} has no approved category`);
  }
  if (definition.name.trim() === '') {
    throw new KpiDefinitionError(`KPI ${definition.id} has no name`);
  }
  // An indicator whose question cannot be written down is one nobody can state
  // the purpose of, which is how a metrics programme accumulates numbers that
  // reward activity.
  if (!definition.question.trim().endsWith('?')) {
    throw new KpiDefinitionError(
      `KPI ${definition.id} must state the question it answers, as a question`,
    );
  }

  // ── THE BINDING RULE (§IV-48, DNA Ch 33.3) ────────────────────────────────
  if (definition.serves.length === 0) {
    throw new KpiDefinitionError(
      `KPI ${definition.id} names no constitutional success dimension. An indicator ` +
        'that cannot say which dimension it serves is measuring activity for its own sake.',
    );
  }
  for (const dimension of definition.serves) {
    if (!SUCCESS_DIMENSIONS.includes(dimension)) {
      throw new KpiDefinitionError(
        `KPI ${definition.id} claims to serve ${dimension}, which is not one of the nine ` +
          'constitutional success dimensions',
      );
    }
  }

  const haystack = `${definition.id} ${definition.name}`.toLowerCase();
  for (const term of NON_SUCCESS_TERMS) {
    if (haystack.includes(term)) {
      throw new KpiDefinitionError(
        `KPI ${definition.id} is named for ${term}, which DNA Ch 33.3 states is explicitly ` +
          'not success',
      );
    }
  }
}

export interface KpiRegistry {
  register(definition: KpiDefinition, measurement: KpiMeasurement): void;
  list(): readonly KpiDefinition[];
  byCategory(category: KpiCategory): readonly KpiDefinition[];
  /** Take every registered measurement. Never throws. */
  read(isoNow: () => string): Promise<KpiReport>;
  clear(): void;
}

export function createKpiRegistry(): KpiRegistry {
  const definitions = new Map<string, KpiDefinition>();
  const measurements = new Map<string, KpiMeasurement>();

  return {
    register(definition, measurement) {
      assertValidKpi(definition);
      if (definitions.has(definition.id)) {
        throw new KpiDefinitionError(`KPI ${definition.id} is already registered`);
      }
      if (measurement.id !== definition.id) {
        throw new KpiDefinitionError(
          `KPI ${definition.id} was registered with the measurement for ${measurement.id}`,
        );
      }
      definitions.set(definition.id, definition);
      measurements.set(definition.id, measurement);
    },

    list: () => [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id)),
    byCategory: (category) =>
      [...definitions.values()]
        .filter((definition) => definition.category === category)
        .sort((a, b) => a.id.localeCompare(b.id)),

    async read(isoNow) {
      const observedAt = isoNow();
      const readings: KpiReading[] = [];
      const unmeasured: string[] = [];

      for (const definition of this.list()) {
        let value: number | null = null;
        let basis = 'no measurement was registered';
        const measurement = measurements.get(definition.id);
        if (measurement) {
          try {
            const taken = await measurement.measure();
            value = taken.value;
            basis = taken.basis;
          } catch (error) {
            // A KPI whose measurement throws reports `null`, not zero, and says
            // why. Zero would be a number somebody acts on.
            value = null;
            basis = `the measurement failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`;
          }
        }
        if (value === null) unmeasured.push(definition.id);
        readings.push({
          id: definition.id,
          category: definition.category,
          name: definition.name,
          unit: definition.unit,
          serves: definition.serves,
          value,
          basis,
          observedAt,
        });
      }

      return { generatedAt: observedAt, readings, unmeasured, targetsInScope: false };
    },

    clear() {
      definitions.clear();
      measurements.clear();
    },
  };
}
