/**
 * Signing in, and telling the backend how to behave.
 *
 * These helpers belong to the `PLAYWRIGHT_FIXTURE_BACKEND=1` run, where the app
 * is built with `VITE_BACKEND_INTEGRATION=true` and points at
 * `tests/helpers/fixture-backend.mjs`. Credentials are the fixture's, not the
 * demo's — the demo does not exist in that build, which is the point of it.
 */

import { expect, type Page } from '@playwright/test';

export const FIXTURE_BACKEND = 'http://127.0.0.1:5199';

export const FIXTURE_LOGIN = {
  email: 'admin@fixture.invalid',
  password: 'fixture-password',
};

/** How the backend answers every data route from now on. */
export type BackendMode = 'populated' | 'empty' | 'error' | 'forbidden';

export async function setBackendMode(mode: BackendMode): Promise<void> {
  const res = await fetch(`${FIXTURE_BACKEND}/__mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  expect(res.ok, `could not switch the fixture backend to "${mode}"`).toBe(true);
}

export async function signIn(page: Page): Promise<void> {
  // Auth answers the same in every mode, deliberately: a signed-out session
  // observes nothing, so an `error` run that could not sign in would report a
  // login failure where the surface under test is a dashboard.
  await setBackendMode('populated');
  await page.goto('/#/team/login');
  await page.locator('#team-email').fill(FIXTURE_LOGIN.email);
  await page.locator('#team-password').fill(FIXTURE_LOGIN.password);
  await page.getByRole('button', { name: /sign in to marq cortex/i }).click();
  await page.waitForURL(/#\/team\/dashboard/, { timeout: 20_000 });
}

/** The destination actually on screen, as the shell reports it. */
export async function shownDestination(page: Page): Promise<string> {
  const main = page.locator('main[data-destination]');
  await expect(main).toBeVisible({ timeout: 20_000 });
  return (await main.getAttribute('data-destination')) ?? '';
}

/**
 * Every destination the running product declares, read off the rendered
 * sidebar — which renders from `NAV_GROUPS`.
 *
 * Not a list written in a test file. Product Reality §7.1 found four ids in the
 * old suite that did not exist, asserted for months, passing the whole time
 * because an unknown id falls back to a Dashboard that renders fine. A list
 * that cannot drift cannot repeat that.
 */
export async function registeredDestinations(page: Page): Promise<string[]> {
  // The sidebar has to be up before it can be read. `signIn` waits for the URL,
  // which the router changes before the shell's lazy chunk has mounted — so
  // reading here too early returned an empty list, and on a loaded machine it
  // did. An empty list would silently mean "this loop asserted nothing", which
  // is the exact failure §7.1 was.
  await expect(page.locator('nav [data-destination]').first()).toBeVisible({ timeout: 20_000 });
  const ids = await page.locator('nav [data-destination]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-destination') ?? ''),
  );
  const unique = [...new Set(ids.filter(Boolean))];
  expect(
    unique.length,
    'the sidebar declared no destinations — this suite would have tested nothing',
  ).toBeGreaterThanOrEqual(10);
  return unique;
}
