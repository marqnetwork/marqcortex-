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

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
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
