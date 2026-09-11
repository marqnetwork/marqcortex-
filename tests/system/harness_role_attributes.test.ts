/**
 * A stubbed platform role must be stubbed with the attributes the real one has.
 *
 * Supabase's `service_role` carries BYPASSRLS, and a large part of this
 * repository's security argument rests on that: the repositories and the
 * migration engine run as `service_role`, which is *why* the per-organization
 * filters in the repositories are load-bearing rather than decorative. The
 * tenancy suite asserts the bypass is real so that claim is evidence rather
 * than folklore, and several fixtures `SET ROLE service_role` to seed
 * RLS-protected tables.
 *
 * Two places create the stub, and they disagreed. `00_platform_stub.sql`
 * created it with BYPASSRLS; `kv_compare_and_swap.test.ts` created it with no
 * attributes at all. Both guard with "if not exists", so on a shared database
 * **whichever ran first won** — and `npm run test:database` runs the kv suite.
 * A clean database then produced:
 *
 *   - `test:database:tenancy` failing on "service_role no longer bypasses RLS",
 *     which reads as a security regression and was a harness artefact; and
 *   - `test:database:diagnostic` failing to seed at all, because the fixture's
 *     INSERT into `organizations` was refused by a policy it was supposed to
 *     bypass.
 *
 * Both suites passed when run against a database where the stub happened to be
 * created correctly first. That is the part worth guarding: the failure was not
 * in the code under test, it was in the ORDER, so it appeared and disappeared
 * depending on what else had run.
 *
 * This check needs no database. It reads every site in the tree that creates
 * the role and asserts each one names BYPASSRLS, so the two sites cannot drift
 * apart again without a named failure.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Every tracked file that mentions creating a role named `service_role`. */
function sitesCreatingServiceRole(): string[] {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts') || f.endsWith('.mjs'));

  return tracked.filter((file) => {
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, file), 'utf8');
    } catch {
      return false;
    }
    return /create\s+role\s+service_role/i.test(text);
  });
}

describe('the service_role stub carries the attributes the real role has', () => {
  it('finds the sites that create it, and there is at least one', () => {
    const sites = sitesCreatingServiceRole();
    assert.ok(
      sites.length > 0,
      'no site creates service_role — this check has lost its subject and must be re-pointed, not deleted',
    );
  });

  it('every CREATE ROLE service_role names BYPASSRLS', () => {
    for (const file of sitesCreatingServiceRole()) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      // Each statement that creates the role, up to the statement terminator.
      const statements = text.match(/create\s+role\s+service_role[^;]*/gi) ?? [];

      for (const statement of statements) {
        assert.match(
          statement,
          /bypassrls/i,
          `${file} creates service_role without BYPASSRLS. Whichever suite runs first ` +
            `on a shared database wins, so this silently degrades the role for every ` +
            `suite after it: the tenancy bypass assertion fails, and fixtures that ` +
            `SET ROLE service_role to seed RLS-protected tables are refused.`,
        );
      }
    }
  });

  it('the platform stub converges the attribute even when the role already exists', () => {
    const stub = readFileSync(
      resolve(ROOT, 'tests/database/harness/00_platform_stub.sql'),
      'utf8',
    );
    // CREATE ROLE is skipped for a pre-existing role, so creation alone cannot
    // repair one another suite made wrong. The ALTER is what makes the stub
    // independent of what ran before it.
    assert.match(
      stub,
      /alter\s+role\s+service_role\s+bypassrls/i,
      'the platform stub must ALTER the role, not only CREATE it: a role that already ' +
        'exists with weaker attributes survives CREATE ... IF NOT EXISTS untouched',
    );
  });
});
