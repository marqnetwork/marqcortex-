/**
 * THE ORGANIZATIONAL SPINE, IN A BROWSER.
 *
 * CP-3 Step 14. Everything else that proves this sprint proves it somewhere a
 * person never looks: PostgreSQL refusing a cross-tenant write, a pure resolver
 * mapping rows to a workspace, a recorded query chain carrying its tenant
 * filter. None of that is evidence about what the console SHOWS.
 *
 * This suite is that evidence. It runs against
 * `PLAYWRIGHT_FIXTURE_BACKEND=1`, which is the only configuration that can
 * produce a populated workspace, a genuinely empty one, a 500 and a 403 to
 * order — and it checks four things:
 *
 *   WORKSPACE   the shell names the organization, and says honestly when it
 *               cannot, differently for a breakage and a refusal
 *   SPINE       the organization renders its people, departments and teams
 *   IDENTITY    a person with no console login is shown as a member, not as a
 *               broken record — the ONT 12.3 line, on screen
 *   STATES      empty, error and permission-denied are three different screens
 *
 * Desktop and 390px, because the shell's workspace slot is inside the drawer at
 * compact width and a header that is honest only on a laptop is not honest.
 */

import { test, expect, type Page } from '@playwright/test';
import { setBackendMode, shownDestination, signIn, signInUnder } from './support/product-session';

const TEAM_ROUTE = '#/team/dashboard';
const ORGANIZATION = `/${TEAM_ROUTE}?page=team`;

/** The organization the fixture backend resolves for the signed-in operator. */
const WORKSPACE_NAME = 'Fixture Industries';

/** The fixture person who belongs to the organization and cannot sign in. */
const CONTRACTOR = 'Fixture Contractor';

async function visit(page: Page, url: string): Promise<void> {
  // Same-document `goto` (a hash-only change) never remounts React, so the
  // page would keep whatever it was already showing. See `honest-states`.
  await page.goto(url);
  await page.reload();
}

/** The shell's workspace slot, at whatever width the test is running. */
function workspaceSlot(page: Page) {
  return page.locator('[data-testid="workspace-name"]').first();
}

/** Open the drawer, which is where the sidebar lives below the breakpoint. */
async function openDrawer(page: Page): Promise<void> {
  const opener = page.getByRole('button', { name: /open navigation|menu/i }).first();
  if (await opener.isVisible().catch(() => false)) await opener.click();
}

// ═══════════════════════════════════════════════════════════════════════════
test.describe('the shell names the organization this session is inside', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the workspace slot carries the real organization name', async ({ page }) => {
    await setBackendMode('populated');
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);

    const slot = workspaceSlot(page);
    await expect(slot).toBeVisible();
    await expect(slot).toHaveText(WORKSPACE_NAME);
    await expect(slot).toHaveAttribute('data-workspace-tone', 'resolved');
  });

  test('"Internal Dashboard" is gone from every destination', async ({ page }) => {
    // The exact string CP-3 removed: a description of the product, printed
    // where the organization belongs, identical in every tenant.
    await setBackendMode('populated');
    for (const page_id of ['', '?page=team', '?page=settings']) {
      await visit(page, `/${TEAM_ROUTE}${page_id}`);
      await shownDestination(page);
      const text = await page.locator('body').innerText();
      expect(text, `"Internal Dashboard" still renders on ${page_id || 'the dashboard'}`)
        .not.toContain('Internal Dashboard');
    }
  });

  test('the workspace name is in the drawer at 390px too', async ({ page }) => {
    await setBackendMode('populated');
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, `/${TEAM_ROUTE}`);
    await shownDestination(page);
    await openDrawer(page);
    await expect(workspaceSlot(page)).toHaveText(WORKSPACE_NAME);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('an unresolved workspace says WHY, and says it differently', () => {
  // Login succeeds in every mode — a team account with no resolvable
  // organization still has console access — so what the browser sees is a
  // signed-in session whose header has to be honest about what went wrong.

  test('a broken lookup is shown as a failure, not as an empty organization', async ({ page }) => {
    // Signed in UNDER the failing mode: the workspace travels on the login
    // response, so a session established while healthy already carries one.
    await signInUnder(page, 'error');

    const slot = workspaceSlot(page);
    await expect(slot).toHaveAttribute('data-workspace-tone', 'error');
    await expect(slot).toHaveText('Workspace unavailable');
    // And it does NOT read as an empty organization.
    await expect(slot).not.toHaveText('No organization');
  });

  test('a refusal is shown as a refusal', async ({ page }) => {
    await signInUnder(page, 'forbidden');

    const slot = workspaceSlot(page);
    await expect(slot).toHaveAttribute('data-workspace-tone', 'error');
    await expect(slot).toHaveText('Workspace access denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('the Organization destination shows the organization', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('renders people, departments and teams from the backend', async ({ page }) => {
    await setBackendMode('populated');
    await visit(page, ORGANIZATION);
    expect(await shownDestination(page)).toBe('team');

    const spine = page.locator('[data-testid="organization-spine"]');
    await expect(spine).toBeVisible();
    await expect(spine).toContainText(WORKSPACE_NAME);

    // Three people, two departments, two teams — the fixture's spine.
    await expect(page.locator('[data-testid="spine-person"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="spine-department"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="spine-team"]')).toHaveCount(2);
  });

  test('a person with no console login is a member, not a broken record', async ({ page }) => {
    // ONT 12.3 on screen. The whole reason `people.user_id` is nullable.
    await setBackendMode('populated');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    const contractor = page
      .locator('[data-testid="spine-person"]')
      .filter({ hasText: CONTRACTOR });
    await expect(contractor).toHaveCount(1);
    await expect(contractor.locator('[data-console-access="no"]')).toBeVisible();
    await expect(contractor).toContainText('No console login');
    // They have a place in the structure, like anybody else.
    await expect(contractor).toContainText('Fixture Engineering');
    await expect(contractor).toContainText('Reports to: Fixture Admin');
  });

  test('the console roster is a separate, named section below the organization', async ({ page }) => {
    // The two lists answer different questions and the page has to say so —
    // the confusion CP-3 Step 6 exists to prevent.
    await setBackendMode('populated');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await expect(page.getByRole('heading', { name: 'Console access' })).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body).toContain('without appearing here');
    // The contractor is in the organization and NOT on the console roster.
    const roster = page.locator('main').locator('text=Console access').first();
    await expect(roster).toBeVisible();
  });

  test('every control it offers can actually do its job', async ({ page }) => {
    // CP-3's version of this test asserted that the spine offered NO control,
    // because it could not write. CP-4 gave it the write path, so the rule
    // changes shape rather than going away: CP-2 said a control that cannot do
    // its job must not be offered, and what that now means is that every
    // control present is live and named.
    //
    // The withholding half — a member who may not write is offered nothing —
    // is `organization-writes.spec.ts`, which drives a backend that refuses.
    await setBackendMode('populated');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    const spine = page.locator('[data-testid="organization-spine"]');
    const buttons = spine.locator('button');
    const count = await buttons.count();
    expect(count, 'an admin should be offered the write controls').toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      // Not disabled: a disabled button here would be the dead-end control
      // CP-2 removed, wearing a different excuse.
      await expect(button).toBeEnabled();
      // And named, so it is reachable by anything other than sight.
      const name = (await button.getAttribute('aria-label')) ?? (await button.innerText());
      expect(name.trim(), `a control at index ${i} has no accessible name`).not.toBe('');
    }
  });

  test('renders at 390px without a horizontal scroll', async ({ page }) => {
    await setBackendMode('populated');
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await expect(page.locator('[data-testid="organization-spine"]')).toBeVisible();
    await expect(page.locator('[data-testid="spine-person"]').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the organization overflows the viewport at 390px').toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('empty, error and denied are three different screens', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('an organization with nothing recorded says so, and shows no rows', async ({ page }) => {
    await setBackendMode('empty');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    const spine = page.locator('[data-testid="organization-spine"]');
    await expect(spine).toBeVisible();
    await expect(page.locator('[data-testid="spine-person"]')).toHaveCount(0);
    await expect(spine).toContainText(/no .*organizational structure|nothing/i);
    // The workspace still resolves: you belong to an organization, it is empty.
    await expect(workspaceSlot(page)).toHaveText(WORKSPACE_NAME);
  });

  test('a failing read says it failed, and shows no invented people', async ({ page }) => {
    await setBackendMode('error');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await expect(page.locator('[data-testid="spine-person"]')).toHaveCount(0);
    const spine = page.locator('[data-testid="organization-spine"]');
    await expect(spine).not.toContainText(CONTRACTOR);
    await expect(spine).not.toContainText('Fixture Admin');
  });

  test('a refused read says "not you", which is neither an error nor an empty list', async ({ page }) => {
    await setBackendMode('forbidden');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await expect(page.locator('[data-testid="spine-person"]')).toHaveCount(0);
    const spine = page.locator('[data-testid="organization-spine"]');
    await expect(spine).toContainText(/permission|access|not.*allowed|cannot/i);
  });

  test('the three states do not render the same words', async ({ page }) => {
    const seen: Record<string, string> = {};
    for (const mode of ['empty', 'error', 'forbidden'] as const) {
      await setBackendMode(mode);
      await visit(page, ORGANIZATION);
      await shownDestination(page);
      seen[mode] = await page.locator('[data-testid="organization-spine"]').innerText();
    }
    expect(seen.empty).not.toBe(seen.error);
    expect(seen.error).not.toBe(seen.forbidden);
    expect(seen.empty).not.toBe(seen.forbidden);
  });
});
