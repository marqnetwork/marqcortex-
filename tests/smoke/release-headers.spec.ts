/**
 * The release artifact's response headers, in a browser that obeys them.
 *
 * `vercel.json` declares a Content-Security-Policy and the usual companions. A
 * policy that is wrong fails in exactly one place — the deployed site, in a real
 * browser — and it fails QUIETLY: a refused script is a console message and a
 * blank panel, not an exception anybody catches. So the policy has to be served
 * over the real bundle and the page has to be watched for violations.
 *
 * `vite dev` cannot be that test. It serves inline scripts and uses `eval` for
 * hot reload, so a policy strict enough to be worth having breaks development
 * and would simply be loosened until it stopped mattering.
 *
 * These tests therefore only run against the release build:
 *
 *     npm run build && PLAYWRIGHT_RELEASE_BUILD=1 npx playwright test
 *
 * Under the dev server they FAIL rather than skip. A skip reads as a pass in a
 * summary line, and a security check that silently does not run is worse than
 * one that is absent — this repository has been bitten by exactly that before.
 */
import { expect, test, type Page } from '@playwright/test';

const RELEASE = process.env.PLAYWRIGHT_RELEASE_BUILD === '1';

/** Every CSP violation the page reports, for the lifetime of the page. */
function collectViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply|frame)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on('pageerror', (error) => {
    if (/Content Security Policy/i.test(error.message)) violations.push(error.message);
  });
  return violations;
}

test.describe('release headers', () => {
  test('the policy and its companions are actually served', async ({ page }) => {
    expect(
      RELEASE,
      'these run against the release build only — see the note at the top of this file',
    ).toBe(true);

    const response = await page.goto('/');
    expect(response, 'no response for /').not.toBeNull();
    const headers = response!.headers();

    const policy = headers['content-security-policy'];
    expect(policy, 'no Content-Security-Policy on the release artifact').toBeTruthy();

    // The directives that decide whether an injected script can run, where a
    // stolen value can be sent, and whether the console can be framed.
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy, "'unsafe-eval' defeats script-src").not.toContain("'unsafe-eval'");
    expect(
      /script-src[^;]*'unsafe-inline'/.test(policy),
      "script-src allows inline script, which is most of what a policy is for",
    ).toBe(false);

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');
  });

  test('the app boots under the policy with no violation', async ({ page }) => {
    expect(RELEASE, 'release build only').toBe(true);
    const violations = collectViolations(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // It painted. A policy that blocked the entry chunk leaves an empty root
    // and no error anybody sees, so the assertion is that something is there.
    const text = await page.locator('body').innerText();
    expect(text.length, 'the page rendered nothing under the policy').toBeGreaterThan(40);
    expect(violations, `CSP violations on the landing page:\n${violations.join('\n')}`).toEqual([]);
  });

  test('the signed-in console runs under the policy with no violation', async ({ page }) => {
    expect(RELEASE, 'release build only').toBe(true);
    const violations = collectViolations(page);

    // The same ids and button name `v1-integration-qa` uses. Inventing a
    // selector when a working suite already has one is how an earlier spec in
    // this repository came to look for a form that was not there and pass by
    // skipping.
    await page.goto('/#/team/login');
    await page.waitForLoadState('networkidle');
    await page.locator('#team-email').fill('admin@marqcortex.com');
    await page.locator('#team-password').fill('CortexAdmin2026!');
    await page.getByRole('button', { name: /sign in to marq cortex/i }).click();

    await page.waitForURL(/#\/team\/dashboard/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');

    const text = await page.locator('body').innerText();
    expect(text.length, 'the dashboard rendered nothing under the policy').toBeGreaterThan(100);
    expect(violations, `CSP violations in the console:\n${violations.join('\n')}`).toEqual([]);
  });

  test('the policy refuses an injected script', async ({ page }) => {
    expect(RELEASE, 'release build only').toBe(true);
    const violations = collectViolations(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The proof that the policy is ENFORCED rather than merely present. A
    // header that a browser ignores looks identical to one that works, right up
    // until somebody needs it.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__cspEscaped = true;';
      document.head.appendChild(script);
    });

    const escaped = await page.evaluate(() => (window as unknown as Record<string, unknown>).__cspEscaped);
    expect(escaped, 'an inline script executed — script-src is not being enforced').toBeUndefined();
    expect(violations.length, 'the injected script was refused without a violation report').toBeGreaterThan(0);
  });
});
