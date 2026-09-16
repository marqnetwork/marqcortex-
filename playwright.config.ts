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

/**
 * Run against a REAL DATA PATH, backed by a controlled stand-in.
 *
 * `PLAYWRIGHT_FIXTURE_BACKEND=1` serves the app with
 * `VITE_BACKEND_INTEGRATION=true` and points it at
 * `tests/helpers/fixture-backend.mjs`, which speaks the edge function's routes.
 *
 * This is the configuration CP-1 is about, and it is the only way to drive the
 * states that matter in a browser: a POPULATED workspace, a genuinely EMPTY
 * one, a 500 and a 403. A live backend does not produce the last three to
 * order, and this environment cannot reach one in any case — the network policy
 * answers 403 to a CONNECT for `*.supabase.co`. Nothing run here is live
 * verification and nothing here is reported as such.
 */
const fixtureBackend = process.env.PLAYWRIGHT_FIXTURE_BACKEND === '1';

/** Both build modes test a BUILT artifact, so both are served by the release server. */
const serveDist = releaseBuild || productionConfigBuild;
const port = serveDist ? 4173 : fixtureBackend ? 5174 : 5173;
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
       '**/accessibility-audit.spec.ts', '**/navigation-truth.spec.ts',
       '**/honest-states.spec.ts']
    : fixtureBackend
    ? // The real-data run. The demo suites are excluded because this build has
      // no demo — that is the point of it.
      ['**/v1-integration-qa.spec.ts', '**/client-portal-status-view.spec.ts',
       '**/diagnostic-score-team-login.spec.ts', '**/release-headers.spec.ts',
       '**/production-config.spec.ts', '**/accessibility-audit.spec.ts']
    : [
        '**/production-config.spec.ts',
        // These two need a backend to be about anything, and the default run
        // has none. `npm run test:product` is what runs them.
        '**/navigation-truth.spec.ts',
        '**/honest-states.spec.ts',
        ...(releaseBuild ? [] : ['**/release-headers.spec.ts']),
      ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  /**
   * The fixture-backend run is SERIAL, and has to be.
   *
   * `fullyParallel: false` still lets Playwright run different spec FILES in
   * different workers, and `tests/helpers/fixture-backend.mjs` has one global
   * mode that every test switches over HTTP. Two workers therefore fight over
   * it: a spec that set `empty` reads a populated dashboard because a spec in
   * the other worker set `populated` a moment earlier. Observed as three
   * honest-state failures that passed when either file was run alone — the
   * worst kind, because "it passes on its own" reads as flakiness rather than
   * as a suite that cannot see what it claims to.
   */
  workers: fixtureBackend ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: serveDist
      ? `node scripts/serve-release.mjs --port ${port}`
      : fixtureBackend
      ? `node scripts/serve-with-fixture-backend.mjs --port ${port} --backend-port 5199`
      // The default run is the DEMO experience, explicitly asked for. Before
      // CP-1 it did not have to be asked for — demo data was what an unset
      // backend flag meant — and these suites were written against that, so
      // they are the demo's own coverage and this is where it is turned on.
      : 'npm run dev -- --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The default and release runs exercise the DEMO experience, which CP-1
    // made something a build has to ask for. `test:release` passes the same
    // flag to its `vite build`, because a served `dist/` was configured at
    // build time and no server env can change it afterwards.
    env: serveDist || fixtureBackend ? undefined : { VITE_DEMO_EXPERIENCE: 'true' },
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
