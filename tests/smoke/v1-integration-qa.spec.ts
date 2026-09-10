/**
 * V1 integration QA — the canonical journeys, in a real browser.
 *
 * The unit and contract suites argue about modules. This drives the product the
 * way a person does: sign in, reach every destination, reload on one, resize to
 * a phone, tab through the login, and try to reach things a signed-out visitor
 * must not.
 *
 * ── WHAT "FAILS" HERE MEANS ────────────────────────────────────────────────
 *
 * Every test asserts something a user would notice. A page that renders an
 * empty shell, a deep link that lands somewhere else after a reload, a console
 * error that only appears on one route, a control with no accessible name —
 * these are the defects a green unit suite does not see, and they are the
 * reason this file exists rather than another set of assertions about source
 * text.
 *
 * ── DEMO MODE ──────────────────────────────────────────────────────────────
 *
 * `FEATURES.BACKEND_INTEGRATION` is false by default, so the app serves demo
 * data and makes no backend call. That is the configuration every reviewer and
 * every developer runs, so it is the one under test. Where a journey would
 * differ against a live backend the test says so rather than pretending to
 * cover it.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const TEAM_ROUTE = '#/team/dashboard';

/** The thirteen canonical destinations, as `navigationModel.ts` declares them. */
const DESTINATIONS = [
  'dashboard', 'reviewer-qa', 'email-queue', 'cortex', 'analytics',
  'revenue-intelligence', 'execution', 'mapping-engine', 'control-plane',
  'operations', 'team', 'settings', 'architecture',
] as const;

/**
 * Console errors worth failing on.
 *
 * A blanket "no console errors" assertion fails on things nobody can act on —
 * a favicon 404, a devtools notice, a third-party warning. These are the ones
 * that mean the page is broken.
 */
function isRealError(message: ConsoleMessage): boolean {
  if (message.type() !== 'error') return false;
  const text = message.text();
  if (/favicon|Download the React DevTools|net::ERR_/i.test(text)) return false;
  return true;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (isRealError(message)) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/**
 * Sign in, the way `diagnostic-score-team-login.spec.ts` already proves works.
 *
 * The route, the credentials and the button label are taken from that suite
 * rather than guessed: a QA file that invents its own login tests the login it
 * imagined instead of the one that ships.
 *
 * Note the id locators. `getByLabel(/password/i)` also matches the reveal
 * button, whose `aria-label` is "Show password" — good accessibility, and an
 * ambiguous selector.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/#/team/login');
  await page.locator('#team-email').fill('admin@marqcortex.com');
  await page.locator('#team-password').fill('CortexAdmin2026!');
  await page.getByRole('button', { name: /sign in to marq cortex/i }).click();
  await page.waitForURL(/#\/team\/dashboard/, { timeout: 20_000 });
}

test.describe('canonical journey — a team member signs in and works', () => {
  test('the landing page renders and the console is clean', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(40);
    expect(errors, `console errors on the landing page:\n${errors.join('\n')}`).toEqual([]);
  });

  test('signing in reaches the dashboard', async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page);
    await expect(page).toHaveURL(/#\/team\/dashboard/);
    // Something the dashboard actually renders, not just a mounted shell.
    await expect(page.locator('body')).toContainText(/dashboard|submission/i);
    expect(errors, `console errors after sign-in:\n${errors.join('\n')}`).toEqual([]);
  });

  test('every canonical destination renders as a deep link, with no console error', async ({ page }) => {
    await signIn(page);
    const broken: string[] = [];

    for (const destination of DESTINATIONS) {
      const errors = collectErrors(page);
      await page.goto(`/${TEAM_ROUTE}?page=${destination}`);
      // The lazy chunk has to arrive before the page can be judged.
      await page.waitForLoadState('networkidle');
      const text = (await page.locator('body').innerText()).trim();

      if (text.length < 40) broken.push(`${destination}: rendered ${text.length} characters`);
      if (errors.length > 0) broken.push(`${destination}: ${errors.join(' | ')}`);
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
    }

    expect(broken, `destinations that did not render cleanly:\n${broken.join('\n')}`).toEqual([]);
  });
});

test.describe('deep links and refresh', () => {
  test('a reload keeps you on the destination you deep-linked to', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${TEAM_ROUTE}?page=operations`);
    await page.waitForLoadState('networkidle');
    const before = await page.locator('body').innerText();

    await page.reload();
    await page.waitForLoadState('networkidle');

    // The URL is the authority. A reload that silently returns to the dashboard
    // is the failure this asserts against — a deep link nobody can share.
    await expect(page).toHaveURL(/page=operations/);
    const after = await page.locator('body').innerText();
    expect(after.length, 'the page rendered nothing after a reload').toBeGreaterThan(40);
    expect(
      after.slice(0, 200),
      'a reload landed somewhere other than where the URL points',
    ).toBe(before.slice(0, 200));
  });

  test('an unknown page parameter does not produce a blank screen', async ({ page }) => {
    const errors = collectErrors(page);
    await signIn(page);
    await page.goto(`/${TEAM_ROUTE}?page=not-a-real-destination`);
    await page.waitForLoadState('networkidle');

    const text = (await page.locator('body').innerText()).trim();
    expect(text.length, 'an unknown destination rendered a blank page').toBeGreaterThan(40);
    expect(errors, `an unknown destination threw:\n${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('permissions — what a signed-out visitor cannot reach', () => {
  test('a deep link into the console does not serve the console', async ({ page }) => {
    // No sign-in. The URL names a team destination directly.
    await page.goto(`/${TEAM_ROUTE}?page=settings`);
    await page.waitForLoadState('networkidle');

    const text = await page.locator('body').innerText();
    // Either the login is presented or the route refuses; what must NOT happen
    // is the settings surface rendering for somebody who never signed in.
    const signedOut =
      /sign in|log in|team login|password/i.test(text) || !/settings/i.test(text);
    expect(signedOut, 'a signed-out visitor reached the team console by URL').toBe(true);
  });

  test('the client portal does not admit an unknown client', async ({ page }) => {
    // `#/client/login`, as `App.tsx` declares it. The route matters: an earlier
    // version of this test guessed `#/client-portal`, found no form, and
    // skipped — a cross-tenant assertion that never ran.
    await page.goto('/#/client/login');
    await page.waitForLoadState('networkidle');

    const email = page.locator('input[type="email"]').first();
    await expect(email, 'the client login form was not found').toBeVisible();
    await email.fill('nobody@example.invalid');
    await page.getByRole('button', { name: /access|continue|sign in|view|portal/i }).first().click();
    await page.waitForTimeout(2000);

    // The portal must not open for an address it does not know.
    await expect(page).not.toHaveURL(/client\/portal/);
    const text = await page.locator('body').innerText();
    expect(
      /not found|no submission|couldn'?t find|unable|invalid|no diagnostic/i.test(text),
      `an unknown client email produced no refusal. Page said:\n${text.slice(0, 400)}`,
    ).toBe(true);
  });

  test('the client portal is not reachable by URL without a session', async ({ page }) => {
    await page.goto('/#/client/portal');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    // Either it redirects to the login or it refuses; what must not happen is a
    // client's report rendering for a visitor who never identified themselves.
    expect(
      /sign in|log in|email|access your|not found|no submission/i.test(text),
      `the portal rendered without a session. Page said:\n${text.slice(0, 400)}`,
    ).toBe(true);
  });
});

test.describe('responsive — the shell at phone width', () => {
  test('the dashboard is usable at 390x844 and does not scroll sideways', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${TEAM_ROUTE}?page=dashboard`);
    await page.waitForLoadState('networkidle');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // A little slack for sub-pixel rounding; a real horizontal scrollbar is a
    // layout defect a phone user meets immediately.
    expect(overflow, 'the page scrolls horizontally on a phone').toBeLessThanOrEqual(2);

    const text = (await page.locator('body').innerText()).trim();
    expect(text.length, 'the dashboard rendered nothing at phone width').toBeGreaterThan(40);
  });

  test('a primary destination is still reachable at phone width', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${TEAM_ROUTE}?page=cortex`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/page=cortex/);
    expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(40);
  });
});

test.describe('accessibility — the parts a keyboard and a screen reader need', () => {
  test('the login page has a heading and a labelled form', async ({ page }) => {
    await page.goto('/#/team/login');
    await expect(page.getByRole('heading', { name: /team login/i })).toBeVisible();

    await expect(page.locator('#team-email')).toBeVisible();
    await expect(page.locator('#team-password')).toBeVisible();
    // Both inputs must be reachable BY THEIR LABEL, which is what a screen
    // reader uses — the id locator above only proves they exist.
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^password$/i })).toBeVisible();
    const headings = await page.getByRole('heading').count();
    expect(headings, 'the page has no heading at all').toBeGreaterThanOrEqual(1);
  });

  test('the login form can be completed from the keyboard alone', async ({ page }) => {
    await page.goto('/#/team/login');
    await page.locator('#team-email').focus();
    await page.keyboard.type('admin@marqcortex.com');

    // Tab until the password field has focus, rather than assuming it is one
    // press away. In the demo build a quick-fill button sits between the two,
    // which is a legitimate affordance and NOT a tab-order defect — what
    // matters is that a keyboard user reaches the field at all, and soon.
    let reached = false;
    for (let press = 0; press < 4 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'team-password');
    }
    expect(reached, 'the password field is not reachable by Tab from the email field').toBe(true);

    await page.keyboard.type('CortexAdmin2026!');
    await expect(page.locator('#team-password')).toHaveValue('CortexAdmin2026!');
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/team\/dashboard/, { timeout: 20_000 });
  });

  test('every image on the dashboard carries alt text', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${TEAM_ROUTE}?page=dashboard`);
    await page.waitForLoadState('networkidle');

    const missing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((image) => !image.hasAttribute('alt'))
        .map((image) => image.getAttribute('src') ?? '(no src)'),
    );
    expect(missing, `images with no alt attribute:\n${missing.join('\n')}`).toEqual([]);
  });

  test('no interactive control is left without an accessible name', async ({ page }) => {
    await signIn(page);
    await page.goto(`/${TEAM_ROUTE}?page=dashboard`);
    await page.waitForLoadState('networkidle');

    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
        .filter((element) => {
          const el = element as HTMLElement;
          if (el.offsetParent === null) return false; // not visible
          const name =
            el.getAttribute('aria-label') ??
            el.getAttribute('title') ??
            el.textContent ??
            '';
          return name.trim() === '';
        })
        .map((element) => (element as HTMLElement).outerHTML.slice(0, 120)),
    );
    expect(unnamed, `controls with no accessible name:\n${unnamed.join('\n')}`).toEqual([]);
  });
});
