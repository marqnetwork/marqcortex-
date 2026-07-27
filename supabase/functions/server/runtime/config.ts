/**
 * Runtime storage gateway configuration.
 *
 * MCV2-S7.4. Shadow reads are OFF by default so production runtime behavior is
 * unchanged — KV stays the sole authority — until an operator opts in per domain
 * via server-side Edge secrets. No frontend env vars are introduced.
 */
import { readEnvBool } from './env.ts';

export interface RuntimeConfig {
  /** When true, the outcome read route also performs a non-authoritative SQL shadow read. */
  outcomeShadowReadEnabled: boolean;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    outcomeShadowReadEnabled: readEnvBool('RUNTIME_SHADOW_READ_OUTCOME', false),
  };
}

export function isOutcomeShadowReadEnabled(): boolean {
  return getRuntimeConfig().outcomeShadowReadEnabled;
}
