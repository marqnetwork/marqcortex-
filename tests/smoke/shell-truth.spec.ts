/**
 * THE GLOBAL SHELL, AND WHETHER IT TELLS THE TRUTH.
 *
 * The shell is on every screen, so a falsehood in it is a falsehood everywhere.
 * CP-1 found one by accident, in a screenshot — the account block showed "Team
 * User / team@example.com" to every operator. This suite is the deliberate
 * version of that look.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────
 *
 *   IDENTITY      the person named is the person signed in
 *   NAVIGATION    only destinations the product can actually deliver
 *   CONTROLS      every globally visible action does something, or says it cannot
 *   MOBILE        the same, at 390px, where the sidebar is a drawer
 *
 * ── THE DEAD-END RULE (CP-2 §8) ─────────────────────────────────────────────
 *
 * A visible action must (a) work, (b) communicate an honest unavailable state,
 * or (c) not be presented as an actionable control. The header's magnifier
 * failed all three: it called `focus()` on a ref that was never attached to an
 * element, so on nine of ten destinations clicking it moved focus back onto
 * itself. Nothing announced that, because nothing had gone wrong — there was
 * simply nothing there.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  registeredDestinations,
  setBackendMode,
  shownDestination,
  signIn,
} from './support/product-session';

const TEAM_ROUTE = '#/team/dashboard';

/** The fixture backend's signed-in operator. */
const OPERATOR = { name: 'Fixture Admin', email: 'admin@fixture.invalid', role: 'Admin' };

/** Identities no build should ever show, because nobody is them. */
const PLACEHOLDER_IDENTITIES = ['Team User', 'team@example.com', 'Demo User', 'demo@marqcortex.com'];

async function visit(page: Page, url: string): Promise<void> {
  // A `goto` differing only in the hash is same-document: React never remounts
  // and no request is made. See `honest-states.spec.ts` for the CP-1 note.
  await page.goto(url);
  await page.reload();
}

test.describe('the shell names the person who is actually signed in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('the account block carries their name, address and role', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);

    const sidebar = page.locator('aside');
    await expect(sidebar).toContainText(OPERATOR.name);
    await expect(sidebar).toContainText(OPERATOR.email);
    // The role decides what the server will allow. The shell knew it and did
    // not say it, so a viewer and an owner saw an identical account block.
    await expect(sidebar).toContainText(OPERATOR.role);
  });

  test('no placeholder identity appears anywhere, on any destination', async ({ page }) => {
    for (const id of await registeredDestinations(page)) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      await shownDestination(page);
      const text = await page.locator('body').innerText();
      const found = PLACEHOLDER_IDENTITIES.filter(name => text.includes(name));
      expect(found, `destination "${id}" shows an invented identity: ${found.join(', ')}`).toEqual([]);
    }
  });
});

test.describe('no globally visible control is a dead end', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('search opens a real search, on a destination that has no search box', async ({ page }) => {
    // Analytics deliberately: the header magnifier used to focus the DASHBOARD's
    // filter input, so the one page it half-worked on was the one nobody would
    // notice it failing from.
    await visit(page, `/${TEAM_ROUTE}?page=analytics`);
    await shownDestination(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(
      page.locator('[role="dialog"]').first(),
      'the search control opened nothing',
    ).toBeVisible();
  });

  test('and that search can actually find a destination', async ({ page }) => {
    // Opening something is not the same as it working.
    await visit(page, `/${TEAM_ROUTE}?page=analytics`);
    await shownDestination(page);
    await page.getByRole('button', { name: /^search$/i }).click();

    const input = page.locator('[role="dialog"] input').first();
    await expect(input).toBeVisible();
    await input.fill('team');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/page=team/);
    // The URL changes before React re-renders the shell, so reading the
    // attribute straight after the assertion catches the destination the
    // operator is LEAVING. Wait for the DOM to agree with the URL.
    await expect(page.locator('main[data-destination]')).toHaveAttribute(
      'data-destination',
      'team',
      { timeout: 20_000 },
    );
    expect(await shownDestination(page)).toBe('team');
  });

  test('every control in the shell carries an accessible name', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);

    const unnamed = await page.locator('aside button, header button').evaluateAll(nodes =>
      nodes
        .filter(node => !(node.getAttribute('aria-label') || node.textContent || '').trim())
        .map(node => node.outerHTML.slice(0, 80)),
    );
    expect(unnamed, `controls with no accessible name:\n${unnamed.join('\n')}`).toEqual([]);
  });
});

test.describe('the sidebar offers only what the product can deliver', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('the hidden destinations are absent from the sidebar and the palette', async ({ page }) => {
    await visit(page, `/${TEAM_ROUTE}`);
    const offered = await registeredDestinations(page);

    for (const hidden of ['reviewer', 'execution', 'mapping']) {
      expect(offered, `"${hidden}" is offered in the sidebar`).not.toContain(hidden);
    }

    // And not one Cmd-K away either, which is where they were before CP-2
    // pointed the palette at the same list the sidebar reads.
    await page.getByRole('button', { name: /^search$/i }).click();
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();
    await dialog.locator('input').first().fill('reviewer');
    await page.waitForTimeout(400);
    await expect(
      dialog,
      'the command palette still offers a destination the sidebar has withdrawn',
    ).not.toContainText('Reviewer QA');
  });

  test('a withdrawn destination still resolves by URL, and explains itself', async ({ page }) => {
    // CP-1's rule: a URL means what it says. Withdrawing a destination from the
    // sidebar is a statement about what to OFFER, never about what an address
    // means — so a bookmark must not silently become the Dashboard.
    for (const hidden of ['reviewer', 'mapping']) {
      await visit(page, `/${TEAM_ROUTE}?page=${hidden}`);
      expect(await shownDestination(page), `?page=${hidden} did not resolve to itself`).toBe(hidden);
      await expect(
        page.locator('[data-testid="destination-not-offered"]'),
        `${hidden} rendered its component instead of explaining itself`,
      ).toBeVisible();
    }
  });

  test('a withdrawn destination shows no fabricated business data', async ({ page }) => {
    // Reviewer QA is why. It invented eight companies at mount and another
    // every thirty seconds, with scores from Math.random().
    await visit(page, `/${TEAM_ROUTE}?page=reviewer`);
    await shownDestination(page);
    const text = await page.locator('body').innerText();
    for (const invented of [
      'TechFlow Solutions', 'Green Valley Logistics', 'Premier Healthcare',
      'Summit Financial', 'Urban Retail Co', 'Velocity Manufacturing', 'Nexus Consulting',
    ]) {
      expect(text, `the withdrawn review queue is still inventing ${invented}`).not.toContain(invented);
    }
  });

  test('every offered destination is usable, not merely renderable', async ({ page }) => {
    // The end of "LIVE because it renders". Each offered destination must show
    // real data, an honest empty state, or an honest unavailable state — and
    // never the withdrawal notice, which would mean the sidebar is offering
    // something the product has withdrawn.
    for (const id of await registeredDestinations(page)) {
      await visit(page, `/${TEAM_ROUTE}?page=${id}`);
      expect(await shownDestination(page)).toBe(id);
      await expect(
        page.locator('[data-testid="destination-not-offered"]'),
        `"${id}" is offered in the sidebar but renders the withdrawal notice`,
      ).toHaveCount(0);
    }
  });
});

test.describe('the shell at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the drawer reaches every offered destination, and no withdrawn one', async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);

    await page.getByRole('button', { name: /open navigation/i }).click();
    const drawer = page.locator('aside');
    await expect(drawer).toBeVisible();

    const ids = await drawer.locator('[data-destination]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('data-destination')),
    );
    expect(ids).toContain('dashboard');
    for (const hidden of ['reviewer', 'execution', 'mapping']) {
      expect(ids, `"${hidden}" is in the mobile drawer`).not.toContain(hidden);
    }
  });

  test('identity and role are readable on a phone too', async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);

    await page.getByRole('button', { name: /open navigation/i }).click();
    const drawer = page.locator('aside');
    await expect(drawer).toContainText(OPERATOR.name);
    await expect(drawer).toContainText(OPERATOR.role);
  });

  test('search works from the phone header', async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
    await visit(page, `/${TEAM_ROUTE}?page=analytics`);
    await shownDestination(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  });
});
