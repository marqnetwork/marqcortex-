/**
 * Runtime Storage Gateway — shared types (MCV2-S7.4 → S7.8)
 *
 * The gateway performs a "shadow read": it returns the KV authority result
 * to the caller unchanged, and — only when shadow reads are enabled —
 * additionally reads the SQL repository, compares the two, and emits drift
 * telemetry. Nothing in this file touches Deno globals so the primitives can
 * be exercised under `node --experimental-strip-types --test`.
 */

/** Domains that currently participate in shadow reads. */
export type ShadowDomain = 'outcome' | 'lead' | 'submission';

/** Storage that is authoritative for reads (KV until Phase 5 SQL cutover). */
export type StorageAuthority = 'kv' | 'sql';

/** A single field that differed between authority and shadow projections. */
export interface DriftField {
  field: string;
  authority: unknown;
  shadow: unknown;
}

/**
 * Outcome of comparing an authority projection against a shadow projection.
 * `status`:
 *   - 'match'        — projections are equal (no drift)
 *   - 'drift'        — projections differ on one or more fields
 *   - 'missing'      — authority present, shadow absent (or vice-versa)
 *   - 'shadow_error' — the shadow read itself threw
 *   - 'skipped'      — shadow reads disabled for this domain
 */
export type DriftStatus = 'match' | 'drift' | 'missing' | 'shadow_error' | 'skipped';

export interface DriftReport {
  domain: ShadowDomain;
  key: string;
  status: DriftStatus;
  fields: DriftField[];
  authorityPresent: boolean;
  shadowPresent: boolean;
  error?: string;
  at: string;
}

/** Telemetry sink — receives one report per shadow read. Never throws. */
export type DriftTelemetry = (report: DriftReport) => void;

/** Normalizes a raw record (KV value or SQL row) into a comparable projection. */
export type Projector<T> = (raw: T) => Record<string, unknown> | null;
