/**
 * Shared Supabase service client for repositories (server-side only).
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.49.8';
import { DiagnosticRepositoryError } from './diagnosticTypes.ts';

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new DiagnosticRepositoryError(
      'Supabase service credentials are not configured',
      'DATABASE_ERROR',
    );
  }
  return createClient(url, key);
}

export function mapRow<T>(row: Record<string, unknown> | null): T | null {
  return row ? (row as unknown as T) : null;
}

export function throwOnError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new DiagnosticRepositoryError(`${context}: ${error.message}`, 'DATABASE_ERROR');
  }
}
