/**
 * The indicators MARQ Cortex actually measures — blueprint §IV-48.
 *
 * Eight, across the four approved categories, and every one of them computed
 * from a signal the platform ALREADY publishes. §IV-48 excludes formulas and
 * dashboards from this phase, so nothing here derives a composite score or
 * weights one indicator against another: each answers one question, in one
 * unit, and names the constitutional dimensions it serves.
 *
 * ── WHY THESE EIGHT ────────────────────────────────────────────────────────
 *
 * Each was chosen because it is measurable today from an existing signal AND
 * because it answers a question the Constitution actually asks. An indicator
 * that needed new collection would be monitoring instrumentation, which §IV-51
 * defers; an indicator that could not name a dimension would be refused by the
 * registry.
 *
 * The one worth reading twice is `quality.deterministic_corrections`. "Math
 * decides; AI narrates" is a constitutional principle (DNA glossary, Art. 6),
 * and the fact-lock counts exactly how often the deterministic engines had to
 * put an authoritative number back after the model moved it. It is the only
 * number on this list that measures the principle rather than the plumbing.
 *
 * NO TARGET IS ATTACHED TO ANY OF THEM. Whether a rising correction count is
 * good or bad is a judgement §IV-48 defers to a later phase, and this file
 * carefully does not make it.
 */

import type { KpiDefinition, KpiMeasurement } from './contracts.ts';
import type { KpiRegistry } from './registry.ts';

/** What a deployment can read, to measure the catalogue. */
export interface KpiSignals {
  /** Estate counts, from the authoritative store. */
  estate(): Promise<{
    submissions: number;
    analyses: number;
    outcomes: number;
    industries: number;
  }>;
  /** Control-plane counters, from the metrics snapshot. */
  ai(): {
    requests: number;
    errors: number;
    failovers: number;
    governanceBlocks: number;
    factLockRestores: number;
  } | null;
}

/** A ratio as whole-number percent, or `null` when the denominator is zero. */
export function ratioPercent(numerator: number, denominator: number): number | null {
  // `null`, not zero: "nothing has happened" and "none of what happened
  // qualified" are different facts, and reporting both as 0% would make an idle
  // platform look like a failing one.
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

interface CatalogEntry {
  readonly definition: KpiDefinition;
  measure(signals: KpiSignals): Promise<{ value: number | null; basis: string }>;
}

const CATALOG: readonly CatalogEntry[] = [
  // ── Strategic: fulfilment of purpose at the enterprise altitude ───────────
  {
    definition: {
      id: 'strategic.outcomes_recorded',
      category: 'strategic',
      name: 'Outcomes recorded',
      question: 'How many engagements has Cortex followed through to a recorded business outcome?',
      unit: 'count',
      serves: ['outcome_delivery', 'durability'],
    },
    async measure(signals) {
      const estate = await signals.estate();
      return {
        value: estate.outcomes,
        basis: 'recorded deal outcomes in the authoritative store',
      };
    },
  },
  {
    definition: {
      id: 'strategic.industries_served',
      category: 'strategic',
      name: 'Industries served',
      question: 'Across how many industries has Cortex applied its general method?',
      unit: 'count',
      serves: ['breadth'],
    },
    async measure(signals) {
      const estate = await signals.estate();
      return {
        value: estate.industries,
        basis: 'distinct industries across recorded submissions',
      };
    },
  },

  // ── Operational: health of running the company and platform ──────────────
  {
    definition: {
      id: 'operational.ai_request_success',
      category: 'operational',
      name: 'AI request success',
      question: 'What proportion of governed AI requests completed without an error?',
      unit: 'ratio_percent',
      serves: ['integrity', 'trust'],
    },
    measure(signals) {
      const ai = signals.ai();
      if (!ai) {
        return Promise.resolve({
          value: null,
          basis: 'the AI control plane published no counters in this isolate',
        });
      }
      return Promise.resolve({
        value: ratioPercent(ai.requests - ai.errors, ai.requests),
        basis: `${ai.requests - ai.errors} of ${ai.requests} governed requests since this isolate started`,
      });
    },
  },
  {
    definition: {
      id: 'operational.provider_failovers',
      category: 'operational',
      name: 'Provider failovers',
      question: 'How often did a request have to be served by a provider other than the first choice?',
      unit: 'count',
      serves: ['integrity'],
    },
    measure(signals) {
      const ai = signals.ai();
      return Promise.resolve(
        ai
          ? { value: ai.failovers, basis: 'failovers since this isolate started' }
          : { value: null, basis: 'the AI control plane published no counters in this isolate' },
      );
    },
  },

  // ── Quality: correctness, evidence discipline, explainability ────────────
  {
    definition: {
      id: 'quality.deterministic_corrections',
      category: 'quality',
      name: 'Deterministic corrections',
      question:
        'How often did the deterministic engines have to restore an authoritative number the model had moved?',
      unit: 'count',
      serves: ['integrity', 'trust', 'outcome_delivery'],
    },
    measure(signals) {
      const ai = signals.ai();
      return Promise.resolve(
        ai
          ? {
              value: ai.factLockRestores,
              // No judgement attached. Whether a rising count is good — the
              // guard working — or bad — the model drifting — is exactly the
              // kind of grading IV-48 defers.
              basis: 'fact-lock restorations since this isolate started; no target is applied',
            }
          : { value: null, basis: 'the AI control plane published no counters in this isolate' },
      );
    },
  },
  {
    definition: {
      id: 'quality.governance_blocks',
      category: 'quality',
      name: 'Governance blocks',
      question: 'How often did the output guard refuse a completion before it reached anybody?',
      unit: 'count',
      serves: ['integrity', 'trust'],
    },
    measure(signals) {
      const ai = signals.ai();
      return Promise.resolve(
        ai
          ? { value: ai.governanceBlocks, basis: 'output-guard blocks since this isolate started' }
          : { value: null, basis: 'the AI control plane published no counters in this isolate' },
      );
    },
  },

  // ── Customer: effortless first value, realized value, trust ──────────────
  {
    definition: {
      id: 'customer.diagnostics_completed',
      category: 'customer',
      name: 'Diagnostics completed',
      question: 'How many businesses have completed a diagnostic and reached a first result?',
      unit: 'count',
      serves: ['effortless_capability'],
    },
    async measure(signals) {
      const estate = await signals.estate();
      return { value: estate.submissions, basis: 'completed diagnostic submissions' };
    },
  },
  {
    definition: {
      id: 'customer.analysis_coverage',
      category: 'customer',
      name: 'Analysis coverage',
      question: 'What proportion of completed diagnostics have received their intelligence?',
      unit: 'ratio_percent',
      serves: ['effortless_capability', 'outcome_delivery'],
    },
    async measure(signals) {
      const estate = await signals.estate();
      return {
        value: ratioPercent(estate.analyses, estate.submissions),
        basis: `${estate.analyses} of ${estate.submissions} submissions carry an analysis`,
      };
    },
  },
];

/** Register the catalogue against a deployment's signals. */
export function registerCortexKpis(registry: KpiRegistry, signals: KpiSignals): void {
  for (const entry of CATALOG) {
    const measurement: KpiMeasurement = {
      id: entry.definition.id,
      measure: () => entry.measure(signals),
    };
    registry.register(entry.definition, measurement);
  }
}

/** The catalogue's definitions, for a suite that wants to inspect them. */
export function cortexKpiDefinitions(): readonly KpiDefinition[] {
  return CATALOG.map((entry) => entry.definition);
}
