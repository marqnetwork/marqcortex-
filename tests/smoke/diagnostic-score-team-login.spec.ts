import { expect, test } from '@playwright/test';

test('diagnostic answers produce score and team login accepts demo credentials', async ({ page }) => {
  await page.goto('/#/diagnostic');

  await expect(page.getByRole('heading', { name: /what industry are you in/i })).toBeVisible();
  await page.getByRole('button', { name: /saas \/ software/i }).click();

  for (let step = 1; step <= 14; step += 1) {
    await expect(page.getByText(`${step} of 14 Questions`)).toBeVisible();
    await page.waitForTimeout(500);
    const activeAnswer = page.getByRole('textbox');
    await activeAnswer.fill(
      `Smoke test answer ${step}: manual handoffs, duplicated data, slow customer follow-up, and automation opportunities.`,
    );
    await expect(activeAnswer).toHaveValue(/Smoke test answer/);

    const nextButton = page.getByRole('button', {
      name: step === 14 ? /complete & get my report/i : /continue/i,
    });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();
  }

  await expect(page).toHaveURL(/#\/score/);
  await expect(page.getByText('Your AI Readiness Score')).toBeVisible();
  await expect(page.getByRole('heading', { name: /here's where you stand/i })).toBeVisible();

  await page.goto('/#/team/login');
  await expect(page.getByRole('heading', { name: /team login/i })).toBeVisible();
  await page.locator('#team-email').fill('admin@marqcortex.com');
  await page.locator('#team-password').fill('CortexAdmin2026!');
  await page.getByRole('button', { name: /sign in to marq cortex/i }).click();

  await expect(page).toHaveURL(/#\/team\/dashboard/);
});
