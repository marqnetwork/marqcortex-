/**
 * Browser Supabase client for the Vite SPA.
 * (Next.js server/middleware helpers from @supabase/ssr are not used in this stack.)
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '@/config/supabase.config';

let browserClient: ReturnType<typeof createSupabaseClient> | null = null;

export function createClient() {
  if (!browserClient) {
    browserClient = createSupabaseClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}

/** Singleton used across the app. */
export const supabase = createClient();
