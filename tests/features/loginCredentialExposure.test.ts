/**
 * The sign-in page must not print working credentials in a live build.
 *
 * It did. The team login page carried an administrator email and password
 * three times — two quick-fill buttons and a "Demo Credentials" panel — with
 * NO gate at all, so they rendered in a production bundle as readily as in the
 * demo one. Found by driving the real page in a browser, not by reading it:
 * the tab order walked from the email field onto a button whose label was the
 * admin address.
 *
 * ── WHAT CP-1 CHANGED, AND WHY THIS FILE IS STRICTER NOW ────────────────────
 *
 * The first repair added an `isDemoMode() && (…)` gate around each mention.
 * That fixed the RENDER and not the BUNDLE: `DEMO_TEAM_LOGIN` was still a
 * static import, so the literals shipped in every build and the gate only
 * decided whether they were painted. A string in a bundle is a string anybody
 * can read, and until S-7 the deployed server accepted this one.
 *
 * And the gate itself was `!FEATURES.BACKEND_INTEGRATION` — "the backend is
 * off" — which is the SHIPPED default. So the shipped product advertised the
 * password on its own sign-in page.
 *
 * Both are closed. The literals live behind the demo boundary, are fetched
 * through `getDemoSignInHints()`, and that function answers `null` unless the
 * build is an explicitly designated demo.
 *
 * This suite is source-structural because the property is about ABSENCE in a
 * configuration, and the browser suite runs in one configuration at a time.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const teamLogin = read('src', 'app', 'components', 'TeamLogin.tsx');
const clientLogin = read('src', 'app', 'components', 'ClientLogin.tsx');
const runtime = read('src', 'config', 'runtime.ts');
const features = read('src', 'config', 'features.ts');
const dataService = read('src', 'app', 'services', 'dataService.ts');

/** Source with comments stripped, so the explanation is never the violation. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CREDENTIAL = /admin@marqcortex\.com|CortexAdmin2026!/;

describe('team login — no credential literal is in the module at all', () => {
  const body = code(teamLogin);

  it('prints no credential literal, gated or otherwise', () => {
    // Stronger than "every literal sits behind a gate". There is no literal.
    assert.doesNotMatch(
      body,
      CREDENTIAL,
      'a credential literal is back in the login page — it ships in every bundle, gate or no gate',
    );
  });

  it('does not import the demo fixtures', () => {
    assert.doesNotMatch(body, /DEMO_TEAM_LOGIN/, 'the static fixture import is back');
    assert.doesNotMatch(
      body,
      /from '@\/app\/demo\//,
      'the login page reaches the demo boundary directly',
    );
  });

  it('asks for the hints instead, through the one gated accessor', () => {
    assert.match(body, /import \{ teamLogin, getDemoSignInHints \} from '@\/app\/services\/dataService'/);
    assert.match(body, /void getDemoSignInHints\(\)\.then\(hints => \{ if \(live\) setDemoHints\(hints\); \}\)/);
  });

  it('renders every credential block only when the hints came back', () => {
    // `demoHints` is `null` in any build that is not a designated demo, so the
    // blocks have nothing to render from rather than being merely hidden.
    const gates = [...body.matchAll(/\{demoHints && /g)].length;
    assert.ok(gates >= 3, `expected at least three hint-gated blocks, found ${gates}`);
    assert.doesNotMatch(body, /isDemoMode\(\)/, 'the old render-only gate is back');
  });
});

describe('client login — the same', () => {
  const body = code(clientLogin);

  it('does not import the demo client list', () => {
    assert.doesNotMatch(body, /DEMO_CLIENTS/, 'the static client fixture import is back');
    assert.doesNotMatch(body, /from '@\/app\/demo\//);
  });

  it('reads its hints through the gated accessor', () => {
    assert.match(body, /getDemoSignInHints/);
    assert.match(body, /\{demoHints && /);
  });
});

describe('the accessor answers nothing unless this is a designated demo', () => {
  it('getDemoSignInHints returns null outside a demo experience', () => {
    assert.match(
      code(dataService),
      /export async function getDemoSignInHints\(\)[\s\S]{0,400}?if \(!isDemoExperience\(\)\) return null;/,
      'the hint accessor no longer refuses outside a demo',
    );
  });

  it('and reaches the fixtures only through the demo boundary', () => {
    assert.match(code(dataService), /return demoBackend\(b => b\.getSignInHints\(\)\)/);
  });
});

describe('the gate is a demo flag, not the backend flag it used to be', () => {
  it('isDemoMode requires DEMO_EXPERIENCE, and requires the backend to be OFF', () => {
    // The old definition was `!FEATURES.BACKEND_INTEGRATION`, which is the
    // shipped default — so the shipped build was "demo mode" and advertised
    // the password. Both halves matter: the first stops a disconnected product
    // being treated as a demo, the second stops a connected one ever reaching
    // a fixture.
    assert.match(
      runtime,
      /export function isDemoMode\(\): boolean \{\s*return FEATURES\.DEMO_EXPERIENCE && !FEATURES\.BACKEND_INTEGRATION;/,
    );
  });

  it('DEMO_EXPERIENCE is off unless a build asks for it', () => {
    assert.match(features, /DEMO_EXPERIENCE: envFlag\('VITE_DEMO_EXPERIENCE', false\)/);
  });

  it('dataService applies the identical rule, so the two cannot drift apart', () => {
    assert.match(
      code(dataService),
      /function isDemoExperience\(\): boolean \{\s*return FEATURES\.DEMO_EXPERIENCE && !FEATURES\.BACKEND_INTEGRATION;/,
    );
  });
});
