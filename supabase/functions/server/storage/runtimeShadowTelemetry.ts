/**
 * Runtime durable shadow-telemetry repository — Deno-only
 * (MCV2-S7.4-REMEDIATION · G4)
 *
 * Adapts the Supabase service client to the pure `ShadowTelemetryRepository`
 * port. It calls the atomic upsert-increment RPC `record_shadow_read_telemetry`
 * (see migration 20260727090000_shadow_read_telemetry.sql), so aggregation is
 * cross-instance and restart-safe with no read-modify-write race.
 *
 * Imported ONLY by the edge entrypoint at runtime — never by the storage barrel
 * or tests — so the pure/tested core stays free of Supabase imports.
 *
 * Construction is LAZY and FAIL-SAFE: the client is built on first use inside a
 * try/catch. `record` rejects on any failure, but it is always invoked from the
 * background scheduler, so a rejection never reaches the response or shadow path
 * (structured logs remain as fallback evidence).
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import type { ShadowTelemetryAggregateKey, ShadowTelemetryRepository } from './contracts.ts';

export function createRuntimeShadowTelemetryRepository(): ShadowTelemetryRepository {
  let client: SupabaseClient | null = null;

  function getClient(): SupabaseClient {
    if (!client) {
      const url = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('SUPABASE_URL');
      const key = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(
        'SUPABASE_SERVICE_ROLE_KEY',
      );
      if (!url || !key) {
        throw new Error('Supabase service credentials are not configured for shadow telemetry');
      }
      client = createClient(url, key);
    }
    return client;
  }

  return {
    async record(k: ShadowTelemetryAggregateKey): Promise<void> {
      const { error } = await getClient().rpc('record_shadow_read_telemetry', {
        p_domain: k.domain,
        p_status: k.status,
        p_mismatch_fields: [...k.mismatchFields].sort(),
      });
      if (error) {
        throw new Error(`record_shadow_read_telemetry failed: ${error.message}`);
      }
    },
  };
}
