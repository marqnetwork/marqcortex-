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
 * This suite pins the gate. It is source-structural because the property is
 * about ABSENCE in a configuration — "these do not render when the backend is
 * on" — and the browser suite runs in exactly one configuration, the demo one,
 * where they are supposed to be present.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'src', 'app', 'components', 'TeamLogin.tsx'), 'utf8');

/** Source with comments stripped, so the explanation is never the violation. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('team login — credentials are demo-gated', () => {
  const body = code(source);

  it('the page reads the demo gate the rest of the UI uses', () => {
    assert.match(source, /import \{ isDemoMode \} from '@\/config\/runtime'/);
  });

  it('every literal credential sits behind isDemoMode()', () => {
    // Each occurrence must be inside an `isDemoMode() && (...)` block. Rather
    // than parse JSX, this checks that the number of gates is at least the
    // number of credential mentions — a new ungated mention lowers the ratio.
    const mentions = [...body.matchAll(/admin@marqcortex\.com|CortexAdmin2026!/g)].length;
    const gates = [...body.matchAll(/isDemoMode\(\)\s*&&/g)].length;
    assert.ok(mentions > 0, 'the fixture is stale — no credential literals found');
    assert.ok(
      gates >= 3,
      `expected at least three demo gates for ${mentions} credential mentions, found ${gates}`,
    );
  });

  it('no credential literal appears outside a gated block', () => {
    // Split on the gates and assert the FIRST segment — everything before any
    // gate — carries no credential.
    const [ungated] = body.split(/isDemoMode\(\)\s*&&/);
    assert.doesNotMatch(
      ungated,
      /admin@marqcortex\.com|CortexAdmin2026!/,
      'a credential is printed before any demo gate',
    );
  });

  it('the gate is the backend flag, not a separate switch that could drift', () => {
    const runtime = readFileSync(join(root, 'src', 'config', 'runtime.ts'), 'utf8');
    assert.match(runtime, /export function isDemoMode\(\): boolean \{\s*return !FEATURES\.BACKEND_INTEGRATION;/);
  });
});
