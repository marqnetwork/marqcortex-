/**
 * FEATURE FLAGS
 * 
 * Control which features are enabled/disabled.
 * Use this to toggle between demo mode and production backend integration.
 */

const envFlag = (key: string, fallback: boolean) => {
  const raw = import.meta.env[key];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

export const FEATURES = {
  /**
   * BACKEND_INTEGRATION
   *
   * When true: Reads/writes go through the real Supabase edge function
   *            (authenticated users persist to Postgres — the kv_store_324f4fbe
   *            table and Supabase Auth).
   * When false: Uses demo/seed data exclusively (no API calls, localStorage only).
   *
   * DEFAULT (root cause fix — F1.1):
   *   Production builds (`vite build`, i.e. the deployed Vercel app) default to
   *   the REAL backend so real users persist to Supabase. Local dev (`vite`)
   *   defaults to demo mode so contributors and the demo smoke test do not need
   *   a live backend. Demo mode is therefore isolated to dev / explicit opt-in.
   *
   * Explicit override (either direction) always wins:
   *   VITE_BACKEND_INTEGRATION=true   → force real backend (e.g. staging preview)
   *   VITE_BACKEND_INTEGRATION=false  → force demo mode (e.g. a demo deployment)
   */
  BACKEND_INTEGRATION: envFlag('VITE_BACKEND_INTEGRATION', import.meta.env.PROD),

  /**
   * SHOW_API_ERRORS
   * 
   * When true: Shows error banners when API calls fail
   * When false: Silently falls back to demo data (seamless UX)
   * 
   * Recommended: false for production demos, true for development/debugging
   */
  SHOW_API_ERRORS: envFlag('VITE_SHOW_API_ERRORS', false),

  /**
   * VERBOSE_LOGGING
   * 
   * When true: Logs detailed API call information to console
   * When false: Minimal console output
   * 
   * Useful for debugging API issues
   */
  VERBOSE_LOGGING: envFlag('VITE_VERBOSE_LOGGING', false),
} as const;

/**
 * BACKEND STATUS
 * 
 * Quick reference for backend deployment status and common issues:
 * 
 * ❌ "Failed to fetch" errors = Edge function not deployed or URL incorrect
 * ❌ CORS errors = Edge function deployed but CORS not configured (already configured in code)
 * ❌ 401/403 errors = Authentication issue (check access tokens)
 * ❌ 500 errors = Edge function crashed (check server logs in Supabase dashboard)
 * ✅ 200 responses = Backend working correctly
 * 
 * To deploy the edge function:
 * 1. Install Supabase CLI: https://supabase.com/docs/guides/cli
 * 2. Run: supabase functions deploy make-server-324f4fbe
 * 3. Check deployment in Supabase dashboard > Edge Functions
 * 
 * To test if edge function is deployed:
 * 1. Open browser console
 * 2. Try: fetch('https://tmclwqcgqfcmqwgrogjy.supabase.co/functions/v1/make-server-324f4fbe/ping')
 * 3. Should return: {success: true, message: "pong", ...}
 */
