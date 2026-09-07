/**
 * The health roll-up — §IV-51.
 *
 * Pure but for the clock and the sources it is handed. Worst-wins within a
 * dimension, worst-wins across dimensions, and `unknown` is never treated as
 * agreement.
 */

import type {
  DimensionHealth,
  EnterpriseHealth,
  HealthDimension,
  HealthSignal,
  HealthSignalSource,
  HealthState,
} from './contracts.ts';
import { HEALTH_DIMENSIONS, HEALTH_SEVERITY } from './contracts.ts';

/** The worse of two states, by `HEALTH_SEVERITY`. */
export function worse(left: HealthState, right: HealthState): HealthState {
  return HEALTH_SEVERITY[left] >= HEALTH_SEVERITY[right] ? left : right;
}

/**
 * Roll a dimension's signals into one state.
 *
 * A dimension with NO signals is `unknown` and not observable — never
 * `healthy`. An empty list is the absence of evidence, and the whole point of
 * this module is that the two are not the same.
 */
export function rollUpDimension(
  dimension: HealthDimension,
  signals: readonly HealthSignal[],
): DimensionHealth {
  if (signals.length === 0) {
    return {
      dimension,
      state: 'unknown',
      observable: false,
      signals: [],
    };
  }
  let state: HealthState = 'healthy';
  for (const signal of signals) state = worse(state, signal.state);
  return {
    dimension,
    state,
    // A dimension whose every signal is `unknown` is not being observed either,
    // however many probes are wired: a probe that never answers measures
    // nothing, and an operator reading four unknowns needs to be told that
    // rather than left to work it out.
    observable: signals.some((signal) => signal.state !== 'unknown'),
    signals,
  };
}

/**
 * Collect every source and roll the answers up.
 *
 * A source that throws becomes an `unknown` signal naming itself. That is the
 * backstop for the contract in `HealthSignalSource.collect`: a health framework
 * that can be taken down by one misbehaving probe is a health framework that
 * goes dark exactly when something is wrong.
 */
export async function buildEnterpriseHealth(
  sources: readonly HealthSignalSource[],
  isoNow: () => string,
): Promise<EnterpriseHealth> {
  const byDimension = new Map<HealthDimension, HealthSignal[]>();
  for (const dimension of HEALTH_DIMENSIONS) byDimension.set(dimension, []);

  for (const source of sources) {
    let signal: HealthSignal;
    try {
      signal = await source.collect();
    } catch (error) {
      signal = {
        name: source.name,
        state: 'unknown',
        detail: `the probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
    byDimension.get(source.dimension)?.push(signal);
  }

  const dimensions = HEALTH_DIMENSIONS.map((dimension) =>
    rollUpDimension(dimension, byDimension.get(dimension) ?? []),
  );

  let state: HealthState = 'healthy';
  for (const dimension of dimensions) state = worse(state, dimension.state);

  return {
    state,
    generatedAt: isoNow(),
    dimensions,
    unobservedDimensions: dimensions
      .filter((dimension) => !dimension.observable)
      .map((dimension) => dimension.dimension),
  };
}
