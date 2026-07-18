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
   * When true: Attempts to connect to Supabase backend
   * When false: Uses demo/seed data exclusively (no API calls)
   * 
   * Set to false for demos, presentations, or when backend isn't deployed yet.
   * Set to true when Supabase edge functions are deployed and ready.
   * Override via VITE_BACKEND_INTEGRATION in .env.local
   */
  BACKEND_INTEGRATION: envFlag('VITE_BACKEND_INTEGRATION', false),

  /**
   * DEMO_MODE
   *
   * Development-only flag that enables a passwordless demo session for team
   * login when BACKEND_INTEGRATION is off. It exists SOLELY to let developers
   * and presenters explore the dashboard locally without a live backend.
   *
   * When true: team login mints a throwaway demo session for any input —
   *   no credential is checked and no secret is stored in source.
   * When false (the default, and the value in every production build): the
   *   demo session path is disabled and team login requires the real backend.
   *
   * Set VITE_DEMO_MODE=true in .env.development / .env.local for local demos.
   * NEVER set it in a production build, and NEVER pair it with a frontend
   * credential — demo mode is intentionally passwordless.
   */
  DEMO_MODE: envFlag('VITE_DEMO_MODE', false),

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
 * 2. Try: fetch('https://oqybniefkbppptfatoae.supabase.co/functions/v1/make-server-324f4fbe/ping')
 * 3. Should return: {success: true, message: "pong", ...}
 */
