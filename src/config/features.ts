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
   * DEMO_EXPERIENCE
   *
   * The ONE switch that allows fabricated business data to reach a rendered
   * surface. It is off by default and it is deliberately NOT the inverse of
   * BACKEND_INTEGRATION.
   *
   * Before CP-1 the two were the same question: "is the backend off?" meant
   * "serve invented companies, an invented pipeline and an invented team", so
   * a signed-in operator was shown a $3.12M pipeline belonging to nobody and
   * had no way to tell. The product's own audit named 4,492 lines of that.
   *
   * Now they are separate questions:
   *   BACKEND_INTEGRATION — is a real backend configured?
   *   DEMO_EXPERIENCE     — is this an explicitly designated demo?
   *
   * Backend off and demo off — the shipped default — is an authenticated
   * product that says plainly it is not connected. That is the honest answer,
   * and an honest answer is the point of the sprint.
   *
   * The two can never both be on: `isDemoExperience()` in dataService requires
   * BACKEND_INTEGRATION to be false, so a live call that fails can never be
   * papered over with a fixture. Override with VITE_DEMO_EXPERIENCE for a
   * sales demo; every authenticated surface then carries a visible banner
   * saying the data is fabricated.
   */
  DEMO_EXPERIENCE: envFlag('VITE_DEMO_EXPERIENCE', false),

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
