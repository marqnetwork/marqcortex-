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
const port = releaseBuild ? 4173 : 5173;
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
  testIgnore: releaseBuild ? [] : ['**/release-headers.spec.ts'],
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
    command: releaseBuild
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
