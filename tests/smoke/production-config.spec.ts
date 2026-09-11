/**
 * What the PRODUCTION build renders, in a browser, before any call is made.
 *
 * Every other suite in this directory runs in demo mode, because
 * `VITE_BACKEND_INTEGRATION` defaults to false and that is the configuration a
 * developer and a reviewer run. The consequence is structural rather than
 * accidental: a defect whose shape is an ABSENCE in the other configuration —
 * a demo-only affordance that fails to disappear when the backend is on — could
 * not be observed here at all.
 *
 * That is not hypothetical. The sign-in page shipped a working administrator
 * email and password, ungated, rendering in a production bundle as readily as
 * in the demo one. It was found by driving the page in a browser; no source
 * review had caught it, and no unit test could have, because nothing was wrong
 * with any module. The fix put the literals behind `isDemoMode()`, and the
 * regression that pins it — `tests/features/loginCredentialExposure.test.ts` —
 * says plainly in its own header why it has to read the source instead of the
 * page: "the browser suite runs in exactly one configuration, the demo one,
 * where they are supposed to be present."
 *
 * This is the other configuration. `npm run test:production-config` builds with
 * the backend flag ON and asserts the credentials are not on the page — the
 * claim made about production, checked the way the defect was found rather than
 * the way it was missed.
 *
 * ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not talk to a backend and does not need one. Nothing here submits a
 * form or waits on a response; a page that renders a credential does so before
 * any call. Signing in for real against a deployed Supabase project is a
 * separate, environment-blocked proof and is not what this file claims.
 */

import { test, expect, type Page } from '@playwright/test';

/**
 * The literals. Taken from `src/app/utils/demoData.ts`, which declares them
 * once so the coupling cannot return through a second copy.
 */
const DEMO_EMAIL = 'admin@marqcortex.com';
const DEMO_PASSWORD = 'CortexAdmin2026!';

/** Every credential literal, as a user or a screen reader would encounter it. */
async function renderedText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).trim();
}

/**
 * Text a user cannot see is still text a page can leak: a value attribute, an
 * aria-label, a title, a placeholder. The original defect was found through a
 * BUTTON LABEL, so labels are the part that matters most.
 */
async function accessibleSurfaces(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const node = el as HTMLElement;
      for (const attribute of ['value', 'aria-label', 'title', 'placeholder', 'alt']) {
        const value = node.getAttribute(attribute);
        if (value) parts.push(value);
      }
    }
    return parts.join('\n');
  });
}

test.describe('the production build does not print working credentials', () => {
  test('the build really is backend-configured', async ({ page }) => {
    // A guard on the guard. If the flag failed to reach the bundle this suite
    // would be running against a demo build and would pass by testing nothing —
    // the demo affordances would be present and it would never look for them.
    // The "Demo Credentials" panel is the affordance the flag removes, so its
    // absence is the signal that the flag took effect.
    await page.goto('/#/team/login');
    await expect(page.getByRole('heading', { name: /team login/i })).toBeVisible();

    const text = await renderedText(page);
    expect(
      text,
      'the login page still shows the demo credentials panel — VITE_BACKEND_INTEGRATION ' +
        'did not reach this build, so every assertion below would be vacuous',
    ).not.toMatch(/demo credentials/i);
  });

  test('the team login page shows neither the demo email nor the demo password', async ({ page }) => {
    await page.goto('/#/team/login');
    await expect(page.getByRole('heading', { name: /team login/i })).toBeVisible();

    const text = await renderedText(page);
    expect(text, 'the demo administrator email is rendered in a production build').not.toContain(
      DEMO_EMAIL,
    );
    expect(text, 'the demo administrator password is rendered in a production build').not.toContain(
      DEMO_PASSWORD,
    );

    const attributes = await accessibleSurfaces(page);
    expect(
      attributes,
      'the demo administrator email appears in an attribute — this is how it was found the ' +
        'first time, as the accessible name of a quick-fill button',
    ).not.toContain(DEMO_EMAIL);
    expect(attributes, 'the demo administrator password appears in an attribute').not.toContain(
      DEMO_PASSWORD,
    );
  });

  test('no control on the login page fills the form with a credential', async ({ page }) => {
    await page.goto('/#/team/login');
    await expect(page.locator('#team-email')).toBeVisible();

    // The quick-fill buttons were the original defect. Clicking every button on
    // the page and checking the fields stay empty covers them however they are
    // labelled — including a relabelled one this test does not know the name of.
    const buttons = page.locator('button:not([type="submit"])');
    const count = await buttons.count();

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim();
      // Submitting is not what this test is about, and a real sign-in attempt
      // would reach for a backend that is deliberately not here.
      if (/sign in/i.test(name)) continue;
      await button.click({ timeout: 5_000 }).catch(() => undefined);
    }

    await expect(
      page.locator('#team-email'),
      'a control on the page filled in the email field',
    ).toHaveValue('');
    await expect(
      page.locator('#team-password'),
      'a control on the page filled in the password field',
    ).toHaveValue('');
  });

  test('the client portal shows no demo client identities', async ({ page }) => {
    await page.goto('/#/client/login');
    await page.waitForLoadState('networkidle');

    const text = await renderedText(page);
    const attributes = await accessibleSurfaces(page);

    // From DEMO_CLIENTS in src/app/utils/demoData.ts. A client address is a
    // weaker credential than the admin password but it is still an identity the
    // portal recognises, and the portal's own gate is the same one.
    for (const identity of ['client@company.com', 'john@business.com', 'sarah@startup.io']) {
      expect(text, `${identity} is rendered in a production build`).not.toContain(identity);
      expect(attributes, `${identity} appears in an attribute in a production build`).not.toContain(
        identity,
      );
    }
  });
});
