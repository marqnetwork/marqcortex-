import { chromium } from 'playwright';
const B='http://localhost:5173';
export async function open() {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const c = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  return {b,p,errs,B};
}
export async function signIn(p){
  await p.goto(`${B}/#/team/login`,{waitUntil:'networkidle'});
  await p.getByRole('textbox').first().fill('admin@marqcortex.com');
  await p.locator('input[type="password"]').fill('CortexAdmin2026!');
  await p.getByRole('button',{name:/sign in/i}).first().click();
  await p.waitForURL(/team\/dashboard/,{timeout:20000});
  await p.locator('#cortex-main h1').first().waitFor({timeout:20000});
}
export async function unstyled(p, sel='#cortex-main *'){
  return await p.locator(sel).evaluateAll(els => els.filter(e => {
    const cs = getComputedStyle(e); const cl = e.className;
    if (typeof cl !== 'string') return false;
    const resting = cl.split(/\s+/).filter(c => !c.includes(':'));
    if (resting.some(c => c.startsWith('text-cortex-')) && (cs.color==='rgba(0, 0, 0, 0)' || !cs.color)) return true;
    if (resting.some(c => /^bg-cortex-[a-z-]+$/.test(c)) && cs.backgroundColor==='rgba(0, 0, 0, 0)') return true;
    return false;
  }).map(e => e.className.slice(0,90)));
}
