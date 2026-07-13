/**
 * Supabase client for migration CLI (Node-safe) — MCV2-S6.2-IMPLEMENT-004
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MigrationEngineError } from './types.ts';

export function createMigrationClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    throw new MigrationEngineError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for migration CLI',
      'MISSING_CREDENTIALS',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function resolveMarqOrganizationId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc('marq_organization_id');
  if (error) {
    const { data: org, error: orgError } = await client
      .from('organizations')
      .select('id')
      .eq('slug', 'marq')
      .is('deleted_at', null)
      .maybeSingle();
    if (orgError || !org?.id) {
      throw new MigrationEngineError(
        `Cannot resolve MARQ organization: ${error?.message ?? orgError?.message ?? 'not found'}`,
        'ORG_NOT_FOUND',
      );
    }
    return org.id as string;
  }
  if (!data) {
    throw new MigrationEngineError('MARQ organization_id is null', 'ORG_NOT_FOUND');
  }
  return data as string;
}

export function throwOnError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new MigrationEngineError(`${context}: ${error.message}`, 'DATABASE_ERROR');
  }
}
