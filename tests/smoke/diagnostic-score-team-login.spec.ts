import { expect, test } from '@playwright/test';

test('diagnostic answers produce score and team login opens a demo session', async ({ page }) => {
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
  // Demo mode (VITE_DEMO_MODE=true, set via .env.development) mints a
  // passwordless session — any non-secret placeholder input is accepted.
  await page.locator('#team-email').fill('demo@local');
  await page.locator('#team-password').fill('demo');
  await page.getByRole('button', { name: /sign in to marq cortex/i }).click();

  await expect(page).toHaveURL(/#\/team\/dashboard/);
});
