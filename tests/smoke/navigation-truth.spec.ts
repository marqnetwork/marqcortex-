/**
 * EVERY REGISTERED DESTINATION, DRIVEN.
 *
 * ── THE TWO DEFECTS THIS REPLACES A TEST FOR ────────────────────────────────
 *
 * Product Reality §7 found that the deep-link coverage in
 * `v1-integration-qa.spec.ts` proved almost nothing:
 *
 *   §7.1  Four of its thirteen ids did not exist. It asked for `reviewer-qa`,
 *         `email-queue`, `revenue-intelligence` and `mapping-engine`; the
 *         navigation model declares `reviewer`, `emails`, `revenue`, `mapping`.
 *         An unknown id falls back to the Dashboard, the Dashboard renders
 *         fine, and the assertion — "some content, no console error" — passed.
 *
 *   §7.2  Two ids that DO exist, `execution` and `architecture`, silently
 *         rendered the Dashboard as well, because the shell cannot render them
 *         and fell back rather than redirecting. A bookmark or a reload on
 *         either showed the wrong page.
 *
 * Both failures are the same shape: a gate that cannot detect the failure it
 * names. "Something rendered" is true of the wrong page too.
 *
 * ── HOW THIS FILE AVOIDS REPEATING IT ───────────────────────────────────────
 *
 * 1. THE LIST IS NOT WRITTEN HERE. It is read off the rendered sidebar, which
 *    renders from `NAV_GROUPS`. A destination added to the model is driven by
 *    this suite without anybody editing this file, and an id renamed in the
 *    model is renamed here in the same breath — there is no second copy to
 *    drift. A list that came back empty or short would be the test lying about
 *    its own coverage, so its size is asserted first.
 *
 * 2. IDENTITY, NOT LIVENESS. The shell stamps `data-destination` on `<main>`.
 *    The assertion is that the destination on screen IS the one the URL asked
 *    for. A fallback to the Dashboard fails on `dashboard !== execution`
 *    rather than passing on "the Dashboard rendered some text".
 *
 * 3. THE SIDEBAR MUST AGREE. `aria-current="page"` has to sit on the entry the
 *    URL names. A screen that renders correctly under a sidebar pointing
 *    somewhere else is still telling the operator something untrue.
 *
 * 4. REFRESH. Every destination is reloaded in place, because the URL is only
 *    an address if it survives one.
 *
 * 5. PHONE WIDTH. The sidebar is a drawer below 1024px, and a destination
 *    reachable only on a desktop is not reachable.
 */

import { test, expect } from '@playwright/test';
import {
  registeredDestinations,
  shownDestination,
  signIn,
} from './support/product-session';

const TEAM_ROUTE = '#/team/dashboard';

test.describe('every registered destination resolves to itself', () => {
  test('a deep link lands on the destination it names, and the sidebar agrees', async ({ page }) => {
    await signIn(page);
    const destinations = await registeredDestinations(page);

    const wrong: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);

      const shown = await shownDestination(page);
      if (shown !== id) {
        wrong.push(`?page=${id} rendered "${shown}"`);
        continue;
      }

      // The sidebar entry for this destination must be the current one. A
      // correct screen under a sidebar pointing elsewhere is still a lie.
      const current = await page
        .locator('nav [data-destination][aria-current="page"]')
        .first()
        .getAttribute('data-destination');
      if (current !== id) wrong.push(`?page=${id} left the sidebar on "${current}"`);
    }

    expect(
      wrong,
      `destinations that did not resolve to themselves:\n${wrong.join('\n')}`,
    ).toEqual([]);
  });

  test('a reload keeps every destination where its URL says', async ({ page }) => {
    await signIn(page);
    const destinations = await registeredDestinations(page);

    const lost: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);
      await shownDestination(page);
      const urlBefore = page.url();

      await page.reload();

      const after = await shownDestination(page);
      if (after !== id) lost.push(`${id}: a reload landed on "${after}"`);
      if (page.url() !== urlBefore) {
        lost.push(`${id}: the URL changed on reload — ${urlBefore} became ${page.url()}`);
      }
    }

    expect(lost, `destinations that do not survive a refresh:\n${lost.join('\n')}`).toEqual([]);
  });

  test('no destination silently resolves to the Dashboard', async ({ page }) => {
    // The §7.2 regression, stated as its own assertion so a failure names it.
    await signIn(page);
    const destinations = (await registeredDestinations(page)).filter(id => id !== 'dashboard');

    const swallowed: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);
      if ((await shownDestination(page)) === 'dashboard') swallowed.push(id);
    }

    expect(
      swallowed,
      `these destinations fell back to the Dashboard instead of resolving:\n${swallowed.join(', ')}`,
    ).toEqual([]);
  });

  test('destinations that live at their own route redirect there', async ({ page }) => {
    // `execution` and `architecture` are declared destinations the shell does
    // not render. A URL naming one must GO there, not quietly stay put.
    await signIn(page);

    for (const [id, route] of [
      ['execution', /#\/team\/execution/],
      ['architecture', /#\/architecture/],
    ] as const) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);
      await expect(page, `?page=${id} did not reach its own route`).toHaveURL(route);
      expect(await shownDestination(page)).toBe(id);
    }
  });

  test('an id that does not exist still lands somewhere real', async ({ page }) => {
    // The fallback is correct HERE and only here: the parameter is
    // user-editable, and a typo must not produce an error screen.
    await signIn(page);
    await page.goto(`/${TEAM_ROUTE}?page=not-a-real-destination`);
    expect(await shownDestination(page)).toBe('dashboard');
  });

  test('the command palette reaches every offered destination', async ({ page }) => {
    // CP-2 §6.5. The palette is the third path to the product (Ch. 21.4), and
    // before CP-2 it enumerated the DECLARED list while the sidebar enumerated
    // the offered one — so the two described different products and a
    // withdrawn destination stayed one Cmd-K away.
    await signIn(page);
    const destinations = await registeredDestinations(page);

    const unreachable: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}`);
      await shownDestination(page);

      await page.getByRole('button', { name: /^search$/i }).click();
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible();

      const label = await page
        .locator(`nav [data-destination="${id}"]`)
        .first()
        .getAttribute('aria-label');
      await dialog.locator('input').first().fill(label ?? id);
      await page.waitForTimeout(350);

      if (!(await dialog.innerText()).includes(label ?? id)) {
        unreachable.push(`${id} (searched "${label}")`);
      }
      await page.keyboard.press('Escape');
    }

    expect(
      unreachable,
      `destinations the command palette cannot reach:\n${unreachable.join('\n')}`,
    ).toEqual([]);
  });

  test('every label names the destination it actually goes to', async ({ page }) => {
    // CP-2 §6.9. A label is the promise; the destination is the delivery. This
    // catches a label edited without its id, and an id rewired without its
    // label — the pair drifting apart is how `?page=execution` came to mean the
    // Dashboard in the first place.
    await signIn(page);

    const pairs = await page.locator('nav [data-destination]').evaluateAll(nodes =>
      nodes.map(node => ({
        id: node.getAttribute('data-destination') ?? '',
        label: node.getAttribute('aria-label') ?? '',
      })),
    );

    const mismatched: string[] = [];
    for (const { id, label } of pairs) {
      const entry = page.locator(`nav [data-destination="${id}"]`).first();

      // A group of nothing but platform plumbing is FOLDED until asked for
      // (Ch. 13.1), so its entries are in the DOM and not on the screen. That
      // is a disclosure, not a hiding place — and a disclosure that cannot be
      // opened is its own defect, so opening it is part of the test rather
      // than a way around it.
      if (!(await entry.isVisible())) {
        await page.locator('nav button[aria-expanded="false"]').first().click();
        await expect(entry).toBeVisible();
      }

      await entry.click();
      await expect(page.locator('main[data-destination]')).toHaveAttribute(
        'data-destination', id, { timeout: 20_000 },
      );
      const shown = await shownDestination(page);
      if (shown !== id) mismatched.push(`"${label}" goes to "${shown}", not "${id}"`);
    }
    expect(mismatched, `labels that lie:\n${mismatched.join('\n')}`).toEqual([]);
  });

  test('no destination id is offered twice', async ({ page }) => {
    // CP-2 §6.10. Two entries with one id are two promises that cannot both be
    // kept, and the sidebar's active state would mark both.
    await signIn(page);
    const ids = await page.locator('nav [data-destination]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('data-destination') ?? ''),
    );
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `duplicate destination ids in the sidebar: ${duplicates.join(', ')}`).toEqual([]);
  });

  test('the ids the old suite used do not exist, and would now be caught', async ({ page }) => {
    // Pinning §7.1 itself. If somebody renames a destination TO one of these,
    // this test becomes wrong and says so rather than going quietly green.
    await signIn(page);
    const registered = await registeredDestinations(page);
    for (const stale of ['reviewer-qa', 'email-queue', 'revenue-intelligence', 'mapping-engine']) {
      expect(
        registered,
        `"${stale}" is a real destination now — the deep-link suite's history needs revisiting`,
      ).not.toContain(stale);
    }
  });
});

test.describe('the same destinations at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every destination still resolves, and the drawer can reach them', async ({ page }) => {
    await signIn(page);
    const destinations = await registeredDestinations(page);

    const wrong: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);
      const shown = await shownDestination(page);
      if (shown !== id) wrong.push(`?page=${id} rendered "${shown}" at 390px`);
    }
    expect(wrong, `destinations broken at phone width:\n${wrong.join('\n')}`).toEqual([]);

    // And the drawer is a real way to move between them, not just an address bar.
    await page.goto(`/${TEAM_ROUTE}`);
    await page.getByRole('button', { name: /open navigation|menu/i }).first().click();
    const target = page.locator('nav [data-destination="team"]').first();
    await expect(target).toBeVisible();
    await target.click();
    expect(await shownDestination(page)).toBe('team');
  });

  test('no destination scrolls sideways on a phone', async ({ page }) => {
    await signIn(page);
    const destinations = await registeredDestinations(page);

    const overflowing: string[] = [];
    for (const id of destinations) {
      await page.goto(`/${TEAM_ROUTE}?page=${id}`);
      await shownDestination(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A couple of pixels is sub-pixel rounding; a scrollbar is a defect a
      // phone user meets immediately.
      if (overflow > 2) overflowing.push(`${id}: ${overflow}px`);
    }

    expect(
      overflowing,
      `destinations that scroll horizontally on a phone:\n${overflowing.join('\n')}`,
    ).toEqual([]);
  });
});
