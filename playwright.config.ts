import { defineConfig, devices } from '@playwright/test';

const localBrowserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? (process.env.CI ? undefined : 'chrome');

/**
 * A browser that is already on the machine.
 *
 * Playwright refuses to launch when the installed browser build does not match
 * the one its own version expects, which is the ordinary state of a sandbox or
 * image that pre-installs browsers on a different cadence to this repository's
 * `@playwright/test`. Re-downloading is not always possible and is never
 * desirable there, so an environment may name the binary instead.
 *
 * Unset — which is every developer machine and CI as configured today — nothing
 * changes and Playwright resolves the browser exactly as it did before.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

/**
 * Run against the RELEASE ARTIFACT instead of the dev server.
 *
 * `PLAYWRIGHT_RELEASE_BUILD=1` serves `dist/` through `scripts/serve-release.mjs`,
 * which applies the response headers from `vercel.json` — the ones the deployed
 * site actually gets. `vite dev` cannot stand in for that: it serves inline
 * scripts and uses `eval` for hot reload, so a Content-Security-Policy strict
 * enough to be worth having breaks development and is never exercised. Until
 * something serves the real headers over the real bundle, the policy is
 * untested, and a policy that is wrong fails only on the deployed site.
 *
 * Unset — the ordinary case — nothing changes.
 */
const releaseBuild = process.env.PLAYWRIGHT_RELEASE_BUILD === '1';

/**
 * Run against a build configured the way PRODUCTION is configured.
 *
 * Every other suite here runs in demo mode, because that is what a developer
 * and a reviewer run and `VITE_BACKEND_INTEGRATION` defaults to false. The
 * consequence is that anything whose defect is an ABSENCE in the other
 * configuration — a demo-only affordance that fails to disappear — has never
 * been observed in a browser at all. `tests/features/loginCredentialExposure.test.ts`
 * says so in its own header, and settles for reading the source instead.
 *
 * `npm run test:production-config` builds with the backend flag ON and runs the
 * one spec that needs it. It does not talk to a backend and does not need one:
 * what it checks is what the production BUILD renders before any call is made.
 */
const productionConfigBuild = process.env.PLAYWRIGHT_PRODUCTION_CONFIG === '1';
/** Both modes test a BUILT artifact, so both are served by the release server. */
const serveDist = releaseBuild || productionConfigBuild;
const port = serveDist ? 4173 : 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/smoke',
  /**
   * The release-header checks need the built artifact and the real response
   * headers, which only `PLAYWRIGHT_RELEASE_BUILD=1` provides. Routing them here
   * keeps the ordinary run green without the file skipping itself — a skip reads
   * as a pass in a summary line. `npm run test:release` is what runs them, and
   * the spec still fails loudly if it is invoked directly without the flag.
   */
  testIgnore: productionConfigBuild
    ? // The other suites assert demo-mode behaviour, which this build does not
      // have. Running them here would report failures that are the flag working.
      ['**/v1-integration-qa.spec.ts', '**/client-portal-status-view.spec.ts',
       '**/diagnostic-score-team-login.spec.ts', '**/release-headers.spec.ts',
       '**/accessibility-audit.spec.ts']
    : [
        '**/production-config.spec.ts',
        ...(releaseBuild ? [] : ['**/release-headers.spec.ts']),
      ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: serveDist
      ? `node scripts/serve-release.mjs --port ${port}`
      : 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: localBrowserChannel ?? 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(localBrowserChannel ? { channel: localBrowserChannel } : {}),
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
