/**
 * CLIENT PORTAL — StatusView runtime regression.
 *
 * `StatusView` referenced `clientAuth` as a free variable while the value was
 * only ever created inside `ClientPortal`. The repository transpiles without
 * type checking, so nothing failed at build time and the portal default view
 * threw `ReferenceError: clientAuth is not defined` in the browser instead.
 *
 * This spec exercises the real path: sign in as a client, land on the default
 * Status view, and assert the portal actually painted with no ReferenceError
 * reaching the console.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const DEMO_CLIENT = { email: 'client@company.com', companyName: 'Acme Fashion Co.' };

/** Collect console errors plus uncaught exceptions for the lifetime of the page. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(`${err.name}: ${err.message}`));
  return errors;
}

const assertNoClientAuthReferenceError = (errors: string[]) => {
  const referenceErrors = errors.filter(e => /clientAuth is not defined|ReferenceError/.test(e));
  expect(referenceErrors, `unexpected ReferenceError(s): ${referenceErrors.join(' | ')}`).toEqual([]);
};

test('client portal default StatusView renders without a clientAuth ReferenceError', async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto('/#/client/login');
  await expect(page.getByRole('heading', { name: /client portal/i })).toBeVisible();

  await page.getByPlaceholder('you@company.com').fill(DEMO_CLIENT.email);
  await page.getByRole('button', { name: /access my results/i }).click();

  await expect(page).toHaveURL(/#\/client\/portal/);

  // The default view is 'status' — StatusView must actually paint.
  await expect(
    page.getByRole('heading', { name: new RegExp(`welcome back, ${DEMO_CLIENT.companyName}`, 'i') }),
  ).toBeVisible();
  await expect(page.getByText('What happens next')).toBeVisible();

  // EngagementActivityFeed is the component that consumed the unbound value.
  // It renders its shell first, then a list or the empty state.
  await expect(page.getByText('Your Activity')).toBeVisible();

  assertNoClientAuthReferenceError(errors);
});

test('client portal survives a reload on the status view', async ({ page }) => {
  const errors = collectPageErrors(page);

  await page.goto('/#/client/login');
  await page.getByPlaceholder('you@company.com').fill(DEMO_CLIENT.email);
  await page.getByRole('button', { name: /access my results/i }).click();
  await expect(page).toHaveURL(/#\/client\/portal/);

  await page.reload();

  // The persisted (non-expired) client session must restore straight back into
  // the portal rather than bouncing to /client/login.
  await expect(page).toHaveURL(/#\/client\/portal/);
  await expect(
    page.getByRole('heading', { name: new RegExp(`welcome back, ${DEMO_CLIENT.companyName}`, 'i') }),
  ).toBeVisible();
  await expect(page.getByText('Your Activity')).toBeVisible();

  assertNoClientAuthReferenceError(errors);
});
