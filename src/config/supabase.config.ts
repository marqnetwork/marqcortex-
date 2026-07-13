/**
 * Supabase connection config.
 *
 * Prefer VITE_* env vars (see .env.example). Falls back to utils/supabase/info.tsx
 * for Figma Make bundles that ship baked-in credentials.
 */
import { projectId as bundledProjectId, publicAnonKey as bundledAnonKey } from '/utils/supabase/info';

function parseProjectIdFromUrl(url: string): string | null {
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const envProjectId = import.meta.env.VITE_SUPABASE_PROJECT_ID?.trim();

export const supabaseProjectId =
  envProjectId || (envUrl ? parseProjectIdFromUrl(envUrl) : null) || bundledProjectId;

/** Browser-safe key (legacy JWT anon key or new sb_publishable_* key). */
export const supabaseAnonKey = envAnonKey || bundledAnonKey;

export const supabaseUrl =
  envUrl || `https://${supabaseProjectId}.supabase.co`;

export const edgeFunctionName =
  import.meta.env.VITE_SUPABASE_EDGE_FUNCTION?.trim() || 'make-server-324f4fbe';

export const edgeFunctionBaseUrl = `${supabaseUrl}/functions/v1/${edgeFunctionName}`;

/** True when env overrides the bundled Figma Make placeholder credentials. */
export const hasCustomSupabaseConfig = Boolean(envUrl || envAnonKey || envProjectId);
