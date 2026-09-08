import { chromium } from '@playwright/test';
const SHOT = process.env.SHOT_DIR;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5173/#/team/login', { waitUntil: 'networkidle' });
await page.fill('input[type=email]', 'admin@marqcortex.com');
await page.fill('input[type=password]', 'CortexAdmin2026!');
await page.click('button[type=submit]');
await page.waitForTimeout(2500);

async function report(name) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector('#cortex-main');
    return {
      docScrollW: doc.scrollWidth, docClientW: doc.clientWidth,
      mainScrollW: main?.scrollWidth ?? 0, mainClientW: main?.clientWidth ?? 0,
    };
  });
  console.log(name, JSON.stringify(overflow), 'H-OVERFLOW:', overflow.mainScrollW > overflow.mainClientW + 1);
}
await report('dashboard');
await page.screenshot({ path: `${SHOT}/30-mobile-dashboard.png`, fullPage: false });

for (const [label, page_id] of [['analytics','Analytics'], ['team','Team'], ['settings','Settings']]) {
  await page.locator('header button[aria-label="Open navigation"]').click();
  await page.waitForTimeout(400);
  await page.locator(`aside button[aria-label="${page_id}"]`).click();
  await page.waitForTimeout(2000);
  await report(label);
  await page.screenshot({ path: `${SHOT}/31-mobile-${label}.png` });
}
console.log('errors:', errs.length ? errs.join('|') : '(none)');
await browser.close();
