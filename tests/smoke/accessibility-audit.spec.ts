/**
 * Accessibility, measured by an engine rather than by hand.
 *
 * `v1-integration-qa.spec.ts` already checks four things a keyboard and a
 * screen reader need, and it found real defects. But it checks what someone
 * thought to check, on the two pages they thought to check it on: the login
 * page and the dashboard. Eleven of the thirteen destinations had never been
 * audited at all, and the rules it applies are a hand-written subset of WCAG.
 *
 * This runs axe-core — the same engine behind most accessibility tooling —
 * across every canonical destination, the landing page, the login page and the
 * client portal, against WCAG 2.1 A and AA.
 *
 * ── WHY THE RESULT IS A LIST AND NOT A COUNT ───────────────────────────────
 *
 * A failing run names the rule, the impact and the element, so the output is
 * something to fix rather than a number to argue with. Violations are gathered
 * across all pages and reported together: fixing accessibility one page per run
 * wastes the run.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED ──────────────────────────────────────
 *
 * `color-contrast` is excluded HERE and nowhere else. It is measured against
 * the design tokens by `tests/features/contrastAudit.test.ts`, which computes
 * every one of the pairings the product actually uses and is the check that
 * found the two real AA failures nobody had recorded. axe measures only what is
 * on screen at the moment it runs, so a token used on a surface this run did
 * not open would silently go unchecked — a weaker claim than the one already
 * being made, dressed as a stronger one. Duplicating it here would also make
 * every token change fail in two places with different numbers.
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TEAM_ROUTE = '#/team/dashboard';

/** The thirteen canonical destinations, as `navigationModel.ts` declares them. */
const DESTINATIONS = [
  'dashboard', 'reviewer-qa', 'email-queue', 'cortex', 'analytics',
  'revenue-intelligence', 'execution', 'mapping-engine', 'control-plane',
  'operations', 'team', 'settings', 'architecture',
] as const;

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/** See the header: contrast is owned by the token audit, which measures more. */
const OWNED_ELSEWHERE = ['color-contrast'];

type Finding = { page: string; rule: string; impact: string; help: string; nodes: string[] };

async function audit(page: Page, label: string): Promise<Finding[]> {
  const result = await new AxeBuilder({ page })
    .withTags([...WCAG])
    .disableRules(OWNED_ELSEWHERE)
    .analyze();

  return result.violations.map((violation) => ({
    page: label,
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
}

function report(findings: Finding[]): string {
  return findings
    .map(
      (f) =>
        `  [${f.impact}] ${f.page} — ${f.rule}: ${f.help}\n` +
        f.nodes.map((n) => `      at ${n}`).join('\n'),
    )
    .join('\n');
}

/** Settle on rendered content, not on the network. See v1-integration-qa.spec.ts. */
async function settled(page: Page, selector: string): Promise<void> {
  const region = page.locator(selector);
  await expect(region).toBeVisible({ timeout: 20_000 });

  let previous = '';
  await expect
    .poll(
      async () => {
        const current = (await region.innerText()).trim();
        const stable = current.length > 40 && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 30_000, intervals: [500], message: `${selector} never settled` },
    )
    .toBe(true);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/#/team/login');
  await page.locator('#team-email').fill('admin@marqcortex.com');
  await page.locator('#team-password').fill('CortexAdmin2026!');
  await page.getByRole('button', { name: /sign in to marq cortex/i }).click();
  await page.waitForURL(/#\/team\/dashboard/, { timeout: 20_000 });
}

test.describe('accessibility — WCAG 2.1 AA, measured by axe-core', () => {
  test('the public pages have no WCAG A or AA violation', async ({ page }) => {
    const findings: Finding[] = [];

    await page.goto('/');
    await settled(page, 'body');
    findings.push(...(await audit(page, 'landing')));

    await page.goto('/#/team/login');
    await expect(page.locator('#team-email')).toBeVisible();
    findings.push(...(await audit(page, 'team login')));

    await page.goto('/#/client/login');
    await page.waitForLoadState('networkidle');
    findings.push(...(await audit(page, 'client portal login')));

    expect(findings, `accessibility violations:\n${report(findings)}`).toEqual([]);
  });

  test('every canonical destination has no WCAG A or AA violation', async ({ page }) => {
    test.slow();
    await signIn(page);

    const findings: Finding[] = [];
    for (const destination of DESTINATIONS) {
      await page.goto(`/${TEAM_ROUTE}?page=${destination}`);
      await settled(page, '#cortex-main');
      findings.push(...(await audit(page, destination)));
    }

    expect(findings, `accessibility violations:\n${report(findings)}`).toEqual([]);
  });
});
