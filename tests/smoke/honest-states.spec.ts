/**
 * NO AUTHENTICATED SURFACE SHOWS FABRICATED BUSINESS DATA. EVER.
 *
 * This is the assertion CP-1 exists to make, driven in a real browser against a
 * real data path.
 *
 * ── WHAT MAKES IT POSSIBLE TO TEST AT ALL ───────────────────────────────────
 *
 * Product Reality §10 recorded that empty states in MARQ Cortex were "rarely
 * reachable; demo data is always present". That is not only a UX finding — it
 * meant the EMPTY and ERROR states of every authenticated surface had never
 * been seen by anyone, so nothing was known about them and nothing could be.
 *
 * `tests/helpers/fixture-backend.mjs` answers the edge function's routes and
 * can be told, at runtime, to behave in four ways: populated, empty, 500, 403.
 * That is what makes the four states drivable. A live backend does not fail on
 * request, and this environment cannot reach one in any case (the network
 * policy answers 403 to a CONNECT for `*.supabase.co`), so nothing here is live
 * verification and nothing here is reported as it. What it proves is the
 * wiring and the states, which is what the sprint changed.
 *
 * ── THE FABRICATED NAMES ────────────────────────────────────────────────────
 *
 * Every assertion below checks for the specific invented companies the audit
 * named. They are the load-bearing part: a surface can render a perfectly good
 * empty state and STILL have a fallback one code path away, and the only way
 * to know is to make the backend fail and look for the fixtures by name.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  registeredDestinations,
  setBackendMode,
  shownDestination,
  signIn,
} from './support/product-session';

const TEAM_ROUTE = '#/team/dashboard';

/**
 * The invented businesses, people and figures the audit found on authenticated
 * screens. Not a sample — these are the names a reader of §9 would look for.
 */
const FABRICATIONS = [
  'Manufacturing Pro',
  'RetailMax Inc',
  'TechCorp Solutions',
  'CloudServe Ltd',
  'HealthFirst',
  'FinanceHub',
  'Acme Fashion',
  'TechFlow SaaS',
  'ExampleCo',
  'High Engagement Co',
  'Active Prospect Inc',
  'Demo Company',
  'Marcus Chen',
  'Priya Sharma',
  'James Wilson',
  '$3.12M',
];

async function assertNothingFabricated(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const found = FABRICATIONS.filter(name => text.includes(name));
  expect(
    found,
    `${where} is showing fabricated business data: ${found.join(', ')}`,
  ).toEqual([]);
}

/**
 * Nothing from the workspace is on screen.
 *
 * Stronger than "no invented company", and the assertion that actually closes
 * the regression: when a request fails or is refused, the rows from the LAST
 * successful load must be gone too. Data that is merely stale is still data the
 * operator will read as current, and a surface showing an error banner above a
 * populated table is the same lie in a politer font.
 */
async function assertNoRowsAtAll(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(
    text.includes('Fixture Industries'),
    `${where} is still showing rows from an earlier load`,
  ).toBe(false);
}

/**
 * Go to a destination and make sure it actually re-fetched.
 *
 * `page.goto` to a URL that differs only in its hash is a SAME-DOCUMENT
 * navigation: React never remounts and no request is made. A test that switched
 * the backend to `error` and then "navigated" to the page it was already on
 * would therefore be looking at the data loaded at sign-in, and would pass or
 * fail for reasons that have nothing to do with the mode it set. Caught while
 * capturing screenshots for this sprint — the "error" capture showed a
 * populated dashboard.
 */
async function visit(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.reload();
}

/** Wait for the surface to stop being a skeleton before judging it. */
async function settled(page: Page): Promise<void> {
  await shownDestination(page);
  await expect
    .poll(
      async () => page.locator('[data-product-data-state="loading"]').count(),
      { timeout: 20_000, message: 'the surface never left its loading state' },
    )
    .toBe(0);
}

test.describe('populated — the product shows what the backend returned', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('the dashboard shows the workspace, and nothing that is not in it', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);

    // The fixture's own records, by name — proof the live path is what rendered.
    await expect(page.locator('body')).toContainText('Fixture Industries');
    await assertNothingFabricated(page, 'the dashboard');
  });

  test('no destination shows an invented company, at any point', async ({ page }) => {
    const destinations = await registeredDestinations(page);
    for (const id of destinations) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      await settled(page);
      await assertNothingFabricated(page, `destination "${id}"`);
    }
  });
});

test.describe('empty — a real workspace with nothing in it', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('empty');
  });

  test('the dashboard says so, rather than filling itself in', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);

    // Reachable for the first time. Until CP-1 a signed-in operator could not
    // see this state at all, because seed data guaranteed content.
    await assertNoRowsAtAll(page, 'the empty dashboard');
    await assertNothingFabricated(page, 'the empty dashboard');
    // And it is EMPTY, not failed: a 200 carrying nothing is a working backend.
    await expect(page.locator('[data-testid="product-data-error"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="product-data-denied"]')).toHaveCount(0);
  });

  test('every destination renders an empty workspace without inventing one', async ({ page }) => {
    const destinations = await registeredDestinations(page);
    for (const id of destinations) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      await settled(page);
      await assertNothingFabricated(page, `destination "${id}" with an empty workspace`);
      await assertNoRowsAtAll(page, `destination "${id}" with an empty workspace`);
      // And it is still the destination asked for — an empty answer must not
      // bounce anybody back to the Dashboard either.
      expect(await shownDestination(page)).toBe(id);
    }
  });
});

test.describe('error — the backend fails', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('error');
  });

  test('the dashboard reports the failure and shows no rows', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);

    await expect(
      page.locator('[data-testid="product-data-error"]').first(),
      'a 500 produced no visible failure state',
    ).toBeVisible();
    await assertNothingFabricated(page, 'the dashboard under a 500');
    await assertNoRowsAtAll(page, 'the dashboard under a 500');
  });

  test('no destination answers a failure with fabricated data', async ({ page }) => {
    // THE CENTRAL REGRESSION. Eleven components used to have a `catch` that
    // substituted demo rows, so a broken backend and a healthy one looked
    // identical — including on the client-facing portal.
    const destinations = await registeredDestinations(page);
    for (const id of destinations) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      await settled(page);
      await assertNothingFabricated(page, `destination "${id}" under a 500`);
      await assertNoRowsAtAll(page, `destination "${id}" under a 500`);
    }
  });

  test('a failure is announced, not merely drawn', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);
    // `role="alert"` is what makes a failure reach somebody using a screen
    // reader, who otherwise has no way to know the page changed.
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
  });
});

test.describe('permission denied — the backend refuses', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('forbidden');
  });

  test('a 403 reads as a refusal, not as an empty workspace', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);

    // "You do not have access to this" and "you have no submissions" are
    // different facts, and an operator acts differently on each. The classifier
    // carries the status so the surface can tell them apart.
    await expect(
      page.locator('[data-testid="product-data-denied"]').first(),
      'a 403 produced no visible refusal state',
    ).toBeVisible();
    await expect(page.locator('body')).toContainText(/do not have access|not authorized|access/i);
    await assertNothingFabricated(page, 'the dashboard under a 403');
    await assertNoRowsAtAll(page, 'the dashboard under a 403');
  });

  test('no destination answers a refusal with data', async ({ page }) => {
    const destinations = await registeredDestinations(page);
    for (const id of destinations) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      await settled(page);
      await assertNothingFabricated(page, `destination "${id}" under a 403`);
      await assertNoRowsAtAll(page, `destination "${id}" under a 403`);
    }
  });
});

test.describe('recovery — a surface that failed can be retried', () => {
  test('the dashboard comes back when the backend does', async ({ page }) => {
    await signIn(page);

    await setBackendMode('error');
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);
    await expect(page.locator('[data-testid="product-data-error"]').first()).toBeVisible();

    await setBackendMode('populated');
    await page.reload();
    await settled(page);
    await expect(page.locator('body')).toContainText('Fixture Industries');
    await expect(page.locator('[data-testid="product-data-error"]')).toHaveCount(0);
  });
});

test.describe('the demo is not in this build', () => {
  test('the sign-in page advertises no credentials', async ({ page }) => {
    await page.goto('/#/team/login');
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('admin@marqcortex.com');
    expect(text).not.toContain('CortexAdmin2026!');
    expect(text).not.toMatch(/demo credentials/i);
  });

  test('no authenticated surface carries the demo banner', async ({ page }) => {
    await signIn(page);
    await visit(page, `/${TEAM_ROUTE}`);
    await settled(page);
    // The banner is honest when it appears. It must not appear here: this build
    // has a backend, so by construction it can never serve a fixture.
    await expect(page.locator('[data-testid="demo-experience-banner"]')).toHaveCount(0);
  });
});

test.describe('the same four states on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('populated, empty, failed and refused all render at 390px', async ({ page }) => {
    await signIn(page);

    for (const mode of ['populated', 'empty', 'error', 'forbidden'] as const) {
      await setBackendMode(mode);
      await visit(page, `/${TEAM_ROUTE}`);
      await settled(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `the "${mode}" state scrolls sideways on a phone`).toBeLessThanOrEqual(2);

      const text = (await page.locator('body').innerText()).trim();
      expect(text.length, `the "${mode}" state rendered nothing at phone width`).toBeGreaterThan(40);
      await assertNothingFabricated(page, `the "${mode}" state at 390px`);
    }
  });
});
