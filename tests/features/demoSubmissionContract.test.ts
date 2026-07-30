/**
 * PHASE 1B TASK 21 — demo client profile fixture widened past its contract
 *
 * Two TS2322 diagnostics, one root cause: the `CLIENT_PROFILES` fixture declared
 *
 *     status:   string;
 *     priority: string;
 *
 * but both fields are copied verbatim onto the `Submission` that
 * `getDemoClientSubmission()` returns, and `Submission` declares them as literal
 * unions (`'new' | 'in-review' | 'completed' | 'approved'` and
 * `'low' | 'medium' | 'high'`). A `string` is not assignable to either, so the
 * two spread-through assignments failed.
 *
 * The stored values were correct the whole time — every profile already holds a
 * legal member of each union. Only the fixture's declaration was too wide.
 *
 * The fix uses indexed access (`Submission['status']`, `Submission['priority']`)
 * rather than re-spelling the unions, so the fixture can never drift from the
 * canonical contract again: changing `Submission` now propagates here instead of
 * silently disagreeing.
 *
 * Type-only change: no profile value edited, added or removed.
 *
 * TESTING APPROACH (documented limitation)
 *   demoData.ts is plain .ts and DOES import and run under the test runner —
 *   but it type-imports `Submission` from src/app/lib/api.ts, which is authored
 *   against DOM globals. The node boundary (tsconfig.node.json) sets
 *   `lib: ["ES2022"]` with no DOM, so a static import here pulls api.ts into
 *   that boundary and raises `typecheck:tests` from 10 pre-existing errors to
 *   98. Importing the fixture is therefore not free, and this task will not pay
 *   that price to test itself.
 *
 *   Instead the fixture's real values are read out of the production source and
 *   checked against the canonical unions also read from source. That verifies
 *   the same property the removed diagnostics were about — every stored value is
 *   a legal member — without expanding the node type graph. The assignability
 *   half is already proven where it belongs, by `typecheck:web`.
 *   Assertions are pattern-based, never line-number-based.
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

const DEMO_REL = 'src/app/utils/demoData.ts';
const API_REL = 'src/app/lib/api.ts';

/** The `CLIENT_PROFILES` object literal, from its declaration to its closing brace. */
function clientProfilesBlock(): string {
  const code = readSource(DEMO_REL);
  const start = code.indexOf('const CLIENT_PROFILES');
  assert.notEqual(start, -1, 'CLIENT_PROFILES was renamed or removed');
  const end = code.indexOf('\n};', start);
  assert.notEqual(end, -1, 'could not find the end of the CLIENT_PROFILES literal');
  return code.slice(start, end);
}

/** Read a union's members straight out of the canonical `Submission` interface. */
function submissionUnion(field: 'status' | 'priority'): string[] {
  const api = readSource(API_REL);
  const iface = /export interface Submission\s*\{([\s\S]*?)\n\}/.exec(api);
  assert.ok(iface, 'could not locate the Submission interface');
  const line = new RegExp(`\\n\\s*${field}:\\s*([^;]+);`).exec(iface[1]);
  assert.ok(line, `Submission.${field} is no longer declared`);
  return line[1].split('|').map(s => s.trim().replace(/^'|'$/g, ''));
}

describe('the fixture declaration tracks the canonical contract', () => {
  const block = clientProfilesBlock();

  it('CLIENT_PROFILES types status/priority by indexed access, not a copied union', () => {
    // A re-spelled union would compile today and drift tomorrow, so this guard
    // checks the mechanism rather than only the outcome.
    assert.match(block, /status:\s*Submission\['status'\]\s*;/, "expected `status: Submission['status'];`");
    assert.match(block, /priority:\s*Submission\['priority'\]\s*;/, "expected `priority: Submission['priority'];`");
  });

  it('neither field fell back to a bare string', () => {
    assert.doesNotMatch(block, /\n\s*status:\s*string\s*;/, 'status widened back to `string`');
    assert.doesNotMatch(block, /\n\s*priority:\s*string\s*;/, 'priority widened back to `string`');
  });

  it('Submission is imported as a type by the fixture module', () => {
    assert.match(
      readSource(DEMO_REL),
      /import\s+type\s*\{[^}]*\bSubmission\b[^}]*\}\s*from\s*['"]@\/app\/lib\/api['"]/,
      'demoData no longer type-imports Submission',
    );
  });
});

describe('every stored profile value is a legal member of its union', () => {
  const block = clientProfilesBlock();

  /** Collect the literal values assigned to a field inside the fixture. */
  const valuesOf = (field: 'status' | 'priority'): string[] =>
    [...block.matchAll(new RegExp(`\\n\\s*${field}:\\s*'([^']+)',`, 'g'))].map(m => m[1]);

  it('the fixture still defines its three profiles', () => {
    const ids = [...block.matchAll(/\n\s*'(demo-sub-\d+)':\s*\{/g)].map(m => m[1]);
    assert.deepEqual(
      ids,
      ['demo-sub-001', 'demo-sub-002', 'demo-sub-003'],
      'the demo profile set changed',
    );
  });

  it('every status value is in the Submission status union', () => {
    const legal = submissionUnion('status');
    const found = valuesOf('status');
    assert.equal(found.length, 3, `expected one status per profile, found ${found.length}`);
    for (const value of found) {
      assert.ok(legal.includes(value), `status '${value}' is outside the union ${legal.join(' | ')}`);
    }
  });

  it('every priority value is in the Submission priority union', () => {
    const legal = submissionUnion('priority');
    const found = valuesOf('priority');
    assert.equal(found.length, 3, `expected one priority per profile, found ${found.length}`);
    for (const value of found) {
      assert.ok(legal.includes(value), `priority '${value}' is outside the union ${legal.join(' | ')}`);
    }
  });

  it('the values themselves are unchanged by this task', () => {
    // Pins the data, so a "fix" that made the types compile by editing demo
    // values instead of the declaration would fail here.
    assert.deepEqual(valuesOf('status'), ['completed', 'completed', 'completed']);
    assert.deepEqual(valuesOf('priority'), ['high', 'high', 'medium']);
  });
});

describe('the canonical unions are still where this task read them from', () => {
  it('Submission declares both fields as literal unions', () => {
    assert.deepEqual(submissionUnion('status'), ['new', 'in-review', 'completed', 'approved']);
    assert.deepEqual(submissionUnion('priority'), ['low', 'medium', 'high']);
  });

  it('the fixture is still spread onto the returned Submission', () => {
    // If the return stopped copying these through, the indexed-access types
    // would be describing a relationship that no longer exists.
    const code = readSource(DEMO_REL);
    assert.match(code, /\): Submission \{/, 'getDemoClientSubmission no longer returns Submission');
    assert.match(code, /\n\s*status:\s*profile\.status,/, 'status is no longer copied from the profile');
    assert.match(code, /\n\s*priority:\s*profile\.priority,/, 'priority is no longer copied from the profile');
  });
});
