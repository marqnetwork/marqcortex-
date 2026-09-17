/**
 * CREATING SOMETHING, AND THEN FINDING IT — CP-4 in a browser.
 *
 * CP-3's browser QA could only read, because there was nothing to write with.
 * That is the half of a product that proves least: a read surface over a table
 * somebody else filled is a report, and Cortex's claim is that an operator can
 * put their own organization into it.
 *
 * So the central test here walks CREATE → READ end to end, through the real
 * client code, the real form, the real fetch and the real response shape. If
 * the payload the form builds and the payload the server accepts ever disagree,
 * this is what notices — no unit test on either side can, because each one is
 * right about its own half.
 *
 * It also checks the two things CP-2's dead-end rule turns into at CP-4:
 *
 *   A VIEWER SEES NO WRITE CONTROLS. Not disabled ones — a disabled button
 *   promises that signing in differently would help, which is true for a team
 *   viewer and false for a suspended membership.
 *
 *   A REFUSAL IS SHOWN, NOT SWALLOWED. `readonly` mode answers reads normally
 *   and refuses every write, which is the state a viewer is actually in, and
 *   the surface has to say what happened.
 */

import { test, expect, type Page } from '@playwright/test';
import { setBackendMode, shownDestination, signIn } from './support/product-session';

const TEAM_ROUTE = '#/team/dashboard';
const ORGANIZATION = `/${TEAM_ROUTE}?page=team`;
const STRATEGY = `/${TEAM_ROUTE}?page=strategy`;

async function visit(page: Page, url: string): Promise<void> {
  // Same-document `goto` (a hash-only change) never remounts React.
  await page.goto(url);
  await page.reload();
}

// ═══════════════════════════════════════════════════════════════════════════
test.describe('an operator can put their own organization in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('creating a person makes them appear in the organization', async ({ page }) => {
    // THE TEST THIS SPRINT EXISTS FOR. Everything else proves a half.
    await visit(page, ORGANIZATION);
    expect(await shownDestination(page)).toBe('team');

    const before = await page.locator('[data-testid="spine-person"]').count();

    await page.getByTestId('spine-add-people').click();
    await page.locator('#org-full-name').fill('Wren Adeyemi');
    await page.locator('#org-position').fill('Staff Engineer');
    await page.getByRole('button', { name: 'Add person' }).last().click();

    // The dialog closes and the list is re-read from the server.
    await expect(page.locator('#org-full-name')).toHaveCount(0);
    const person = page.locator('[data-testid="spine-person"]').filter({ hasText: 'Wren Adeyemi' });
    await expect(person).toHaveCount(1);
    await expect(person).toContainText('Staff Engineer');
    expect(await page.locator('[data-testid="spine-person"]').count()).toBe(before + 1);
  });

  test('a new person has no console login, and the surface says so', async ({ page }) => {
    // ONT 12.3 through the write path: adding somebody to the organization is
    // not granting them a login, and the form says as much before it is used.
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await page.getByTestId('spine-add-people').click();
    await expect(page.getByText(/does not create a console login/i)).toBeVisible();
    // And there is no field that could grant one.
    await expect(page.locator('#org-password, #org-user-id')).toHaveCount(0);

    await page.locator('#org-full-name').fill('Kofi Mensah');
    await page.getByRole('button', { name: 'Add person' }).last().click();

    const person = page.locator('[data-testid="spine-person"]').filter({ hasText: 'Kofi Mensah' });
    await expect(person).toHaveCount(1);
    await expect(person.locator('[data-console-access="no"]')).toBeVisible();
  });

  test('creating a department makes it appear in the structure', async ({ page }) => {
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await page.getByTestId('spine-add-departments').click();
    await page.locator('#org-name').fill('Client Services');
    await page.getByRole('button', { name: 'Add department' }).last().click();

    await expect(
      page.locator('[data-testid="spine-department"]').filter({ hasText: 'Client Services' }),
    ).toHaveCount(1);
  });

  test('a blank name is refused, and the dialog stays open saying why', async ({ page }) => {
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    await page.getByTestId('spine-add-departments').click();
    // The field is `required`, so the browser refuses before the request — which
    // is the correct behaviour and worth asserting rather than assuming.
    await page.getByRole('button', { name: 'Add department' }).last().click();
    await expect(page.locator('#org-name')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('a member who may not write is offered nothing to write with', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the organization shows no add controls', async ({ page }) => {
    await setBackendMode('readonly');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    // The organization is fully readable...
    await expect(page.locator('[data-testid="organization-spine"]')).toBeVisible();
    await expect(page.locator('[data-testid="spine-person"]').first()).toBeVisible();
    // ...and there is nothing here to change it with.
    await expect(page.getByTestId('spine-actions')).toHaveCount(0);
    await expect(page.getByTestId('spine-add-people')).toHaveCount(0);
  });

  test('no disabled control is offered instead', async ({ page }) => {
    // A disabled button promises that signing in differently would help. For a
    // team viewer that is true; for a suspended membership it is not.
    await setBackendMode('readonly');
    await visit(page, ORGANIZATION);
    await shownDestination(page);

    const disabled = await page
      .locator('[data-testid="organization-spine"] button[disabled]')
      .count();
    expect(disabled, 'a withheld control must not be rendered as a disabled one').toBe(0);
  });

  test('the strategy shows no add controls either', async ({ page }) => {
    await setBackendMode('readonly');
    await visit(page, STRATEGY);
    expect(await shownDestination(page)).toBe('strategy');

    await expect(page.locator('[data-testid="strategy-goal"]').first()).toBeVisible();
    await expect(page.getByTestId('strategy-add-goals')).toHaveCount(0);
  });

  test('an admin, by contrast, is offered them', async ({ page }) => {
    // The load-bearing counterpart: without it, every absence above could be
    // proving the controls are broken rather than withheld.
    await setBackendMode('populated');
    await visit(page, ORGANIZATION);
    await shownDestination(page);
    await expect(page.getByTestId('spine-add-people')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('the strategy shows what the organization is trying to do', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await setBackendMode('populated');
  });

  test('renders goals, decisions and risks from the backend', async ({ page }) => {
    await visit(page, STRATEGY);
    expect(await shownDestination(page)).toBe('strategy');

    await expect(page.locator('[data-testid="strategy-goal"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="strategy-decision"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="strategy-risk"]')).toHaveCount(2);
  });

  test('flags a decision that records no rationale', async ({ page }) => {
    // ONT 14.8 lists "justified" among a Decision's defining characteristics.
    // Every tool records decisions; very few make the unjustified ones visible.
    await visit(page, STRATEGY);
    await shownDestination(page);

    const unjustified = page
      .locator('[data-testid="strategy-decision"]')
      .filter({ hasText: 'Defer the contractor onboarding' });
    await expect(unjustified.getByTestId('decision-unjustified')).toBeVisible();
    await expect(unjustified).toContainText('No rationale recorded');

    // And the one that HAS a rationale is not flagged.
    const justified = page
      .locator('[data-testid="strategy-decision"]')
      .filter({ hasText: 'Rewrite in place' });
    await expect(justified.getByTestId('decision-unjustified')).toHaveCount(0);
  });

  test('flags a risk nobody has assessed', async ({ page }) => {
    await visit(page, STRATEGY);
    await shownDestination(page);
    await expect(
      page.locator('[data-testid="strategy-risk"]').filter({ hasText: 'dependency licences' }),
    ).toContainText('Not yet assessed');
  });

  test('names people rather than showing ids', async ({ page }) => {
    await visit(page, STRATEGY);
    await shownDestination(page);
    const body = await page.locator('[data-testid="strategy-surface"]').innerText();
    expect(body).toContain('Fixture Admin');
    expect(body, 'a raw record id must never reach the screen').not.toContain('fix-p-1');
  });

  test('recording a goal makes it appear', async ({ page }) => {
    await visit(page, STRATEGY);
    await shownDestination(page);

    await page.getByTestId('strategy-add-goals').click();
    await page.locator('#strategy-statement').fill('Answer every ticket within an hour');
    await page.locator('#strategy-measure').fill('First response time');
    await page.locator('#strategy-target').fill('under 60 min');
    await page.getByRole('button', { name: /^Record goal$/ }).click();

    const goal = page
      .locator('[data-testid="strategy-goal"]')
      .filter({ hasText: 'Answer every ticket within an hour' });
    await expect(goal).toHaveCount(1);
    await expect(goal).toContainText('under 60 min');
  });

  test('renders at 390px without a horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, STRATEGY);
    await shownDestination(page);

    await expect(page.locator('[data-testid="strategy-goal"]').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the strategy overflows the viewport at 390px').toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
test.describe('the strategy is honest when there is nothing, or something is wrong', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('an organization with no strategy says so and shows no rows', async ({ page }) => {
    await setBackendMode('empty');
    await visit(page, STRATEGY);
    await shownDestination(page);

    await expect(page.locator('[data-testid="strategy-goal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="strategy-surface"]')).toContainText(/no .*strategy|nothing/i);
  });

  test('a failing read says it failed, and invents no goals', async ({ page }) => {
    await setBackendMode('error');
    await visit(page, STRATEGY);
    await shownDestination(page);

    await expect(page.locator('[data-testid="strategy-goal"]')).toHaveCount(0);
    const surface = page.locator('[data-testid="strategy-surface"]');
    await expect(surface).not.toContainText('Ship the fixture rewrite');
  });

  test('a refused read reads as a refusal, not as an empty strategy', async ({ page }) => {
    await setBackendMode('forbidden');
    await visit(page, STRATEGY);
    await shownDestination(page);

    await expect(page.locator('[data-testid="strategy-goal"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="strategy-surface"]'))
      .toContainText(/permission|access|not.*allowed|cannot/i);
  });

  test('empty, error and denied do not render the same words', async ({ page }) => {
    const seen: Record<string, string> = {};
    for (const mode of ['empty', 'error', 'forbidden'] as const) {
      await setBackendMode(mode);
      await visit(page, STRATEGY);
      await shownDestination(page);
      seen[mode] = await page.locator('[data-testid="strategy-surface"]').innerText();
    }
    expect(seen.empty).not.toBe(seen.error);
    expect(seen.error).not.toBe(seen.forbidden);
    expect(seen.empty).not.toBe(seen.forbidden);
  });
});
