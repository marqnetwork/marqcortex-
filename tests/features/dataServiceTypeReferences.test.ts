/**
 * PHASE 1B TASK 22 — a re-exported type used as if it were imported
 *
 * One TS2304 ("Cannot find name 'LeadCapturePayload'"): `saveLead` annotated its
 * parameter with a bare `LeadCapturePayload`, but dataService never imports that
 * name. It only RE-EXPORTS it:
 *
 *     export type { …, LeadCapturePayload, … } from '@/app/lib/api';
 *
 * `export … from` is a pure re-export. It forwards the binding to consumers and
 * deliberately does NOT introduce the name into the re-exporting module's own
 * scope, so the annotation referenced a name that does not exist here.
 *
 * dataService already has the right idiom and uses it everywhere else — it does
 * `import * as api from '@/app/lib/api'` and writes `api.SubmissionPayload`
 * (createSubmission), `api.CreateBookingPayload` (createBooking), and so on.
 * `saveLead` was the lone signature that dropped the qualifier. The fix restores
 * it: `data: api.LeadCapturePayload`.
 *
 * Annotation-only change: same type, same value, same call forwarded to
 * `api.captureLead(data)` untouched.
 *
 * TESTING APPROACH (documented limitation)
 *   dataService cannot be imported here. It reaches src/app/lib/api.ts, which is
 *   authored against DOM globals, while the node boundary (tsconfig.node.json)
 *   sets `lib: ["ES2022"]` with no DOM — a static import would add ~88 errors to
 *   `typecheck:tests`. Following the established pattern, the guarantees are
 *   enforced structurally against the production source. Assertions are
 *   pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Blank out string and template literals, so an identifier sweep cannot be
 * fooled by prose inside them — `title: 'New Diagnostic Submission'` is not a
 * reference to the `Submission` type.
 */
function stripStringLiterals(text: string): string {
  return text
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const DATA_SERVICE_REL = 'src/app/services/dataService.ts';

/** The `export type { … } from '@/app/lib/api'` block, and the names in it. */
function apiReExportedNames(code: string): { block: string; names: string[] } {
  const match = /export type \{([\s\S]*?)\} from '@\/app\/lib\/api';/.exec(code);
  assert.ok(match, "could not find the `export type { … } from '@/app/lib/api'` block");
  const names = match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[A-Z]\w*$/.test(s));
  assert.ok(names.length > 20, `expected the full re-export list, parsed ${names.length}`);
  return { block: match[0], names };
}

describe('dataService — api types are referenced through the namespace import', () => {
  const code = stripComments(readSource(DATA_SERVICE_REL));

  it('the namespace import that makes qualified references work is present', () => {
    assert.match(
      code,
      /import \* as api from '@\/app\/lib\/api';/,
      'dataService no longer imports the api namespace',
    );
  });

  it('saveLead annotates its parameter as api.LeadCapturePayload', () => {
    assert.match(
      code,
      /export async function saveLead\(data: api\.LeadCapturePayload\)/,
      'expected `saveLead(data: api.LeadCapturePayload)`',
    );
  });

  it('saveLead still forwards the untouched value to api.captureLead', () => {
    // Annotation-only task: the call it guards must be byte-identical.
    assert.match(code, /return api\.captureLead\(data\);/, 'saveLead no longer forwards to api.captureLead');
    assert.match(
      code,
      /if \(isDemo\(\)\) \{\s*log\('Save lead \(demo mode\):', data\.email\);/,
      'the saveLead demo branch changed',
    );
  });

  it('no re-exported api type is referenced bare anywhere in the module', () => {
    // The real invariant. `export … from` forwards a binding without binding it
    // locally, so ANY bare use of one of these names is a TS2304 — this one was
    // simply the only one that had slipped in. A sweep catches the next one.
    const { block, names } = apiReExportedNames(code);
    const body = stripStringLiterals(code.replace(block, ''));

    const offenders: string[] = [];
    for (const name of names) {
      // Bare use as a type: not preceded by `.` (so `api.Foo` is excluded) and
      // not part of a longer identifier.
      const bare = new RegExp(`(?<![.\\w])${name}(?![\\w])`);
      if (bare.test(body)) offenders.push(name);
    }

    assert.deepEqual(
      offenders,
      [],
      `these api types are re-exported but referenced without the \`api.\` qualifier: ${offenders.join(', ')}`,
    );
  });

  it('LeadCapturePayload is still re-exported for downstream consumers', () => {
    // The fix must not have "solved" the error by deleting the re-export, which
    // would break every component that imports the type from dataService.
    const { names } = apiReExportedNames(code);
    assert.ok(names.includes('LeadCapturePayload'), 'LeadCapturePayload is no longer re-exported');
  });

  it('the qualified idiom this fix restored is the module-wide convention', () => {
    // Sibling signatures that already did it correctly, pinned so the fix
    // stays consistent with them rather than becoming the odd one out.
    assert.match(code, /createSubmission\(payload: api\.SubmissionPayload\)/, 'createSubmission convention changed');
    assert.match(code, /createBooking\(payload: api\.CreateBookingPayload\)/, 'createBooking convention changed');
  });
});

describe('the source of the type is unchanged', () => {
  it('api.ts still exports LeadCapturePayload and captureLead takes it', () => {
    const api = stripComments(readSource('src/app/lib/api.ts'));
    assert.match(api, /export interface LeadCapturePayload \{/, 'LeadCapturePayload was removed from api.ts');
    assert.match(
      api,
      /export async function captureLead\(payload: LeadCapturePayload\)/,
      'captureLead no longer takes a LeadCapturePayload',
    );
  });
});
