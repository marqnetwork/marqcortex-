/**
 * The administrator bootstrap — S-7.
 *
 * The seeder read `TEAM_ADMIN_PASSWORD` from the environment and, when it was
 * not set, used a literal written into this repository. That literal created a
 * PLATFORM ADMINISTRATOR: the top of the authority model, `app_metadata` and
 * all.
 *
 * The same string was also in the browser bundle. Three chunks of it — the
 * login route, the app shell and the registry viewer — because the login screen
 * offered to type the password for you and the registry documented it as "the
 * default credentials". Anyone who loaded the page could read it.
 *
 * So on a deployment that had not set the secret, the console had a publicly
 * known administrator. Not a weak password, a published one.
 *
 * There is no safe default for this and the fix is not a better default. A
 * fixed one is a published password; a random one is an account nobody can sign
 * in to and nobody knows to replace. The seeder creates NOTHING without the
 * secret and logs what to set. A deployment with no administrator is
 * recoverable in one step. A deployment with a known administrator password is
 * not recoverable at all, because you cannot tell who used it.
 *
 * What remains is a demo fixture: demo mode has no server and no database, so
 * the account it signs you into owns nothing. The tests below hold the line
 * between the two — one literal, in one file, reachable only through demo mode.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const SERVER = new URL('supabase/functions/server/', ROOT);
const SRC = new URL('src/', ROOT);

async function sources(dir: URL, skip: readonly string[] = []): Promise<URL[]> {
  const found: URL[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || skip.includes(entry.name)) continue;
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) found.push(...(await sources(child, skip)));
    else if (/\.tsx?$/.test(entry.name)) found.push(child);
  }
  return found;
}

/** Comments explain the removed value by name; only code can reintroduce it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the seeder has no password of its own', () => {
  it('creates no account when TEAM_ADMIN_PASSWORD is unset', async () => {
    const source = await readFile(new URL('index.tsx', SERVER), 'utf8');
    const start = source.indexOf('async function seedAdminUser()');
    assert.notEqual(start, -1, 'the seeder is gone');
    const body = withoutComments(source.slice(start, source.indexOf('\n}\n', start)));

    assert.match(
      body,
      /const adminPassword = Deno\.env\.get\('TEAM_ADMIN_PASSWORD'\);/,
      'the password is read with a fallback again',
    );
    assert.ok(
      !/TEAM_ADMIN_PASSWORD'\)\s*\|\|/.test(body),
      'TEAM_ADMIN_PASSWORD has a fallback — there is no safe default for this',
    );
    assert.match(
      body,
      /if \(!adminPassword\) \{[\s\S]*?return;/,
      'the seeder no longer refuses to run without the secret',
    );

    // The refusal must come BEFORE anything is created.
    const refusal = body.indexOf('if (!adminPassword)');
    const create = body.indexOf('auth.admin.createUser');
    assert.ok(refusal !== -1 && create !== -1 && refusal < create, 'the guard runs after the create');
  });

  it('no deployed server source carries a credential literal', async () => {
    const offenders: string[] = [];
    for (const file of await sources(SERVER, ['__tests__'])) {
      const source = withoutComments(await readFile(file, 'utf8'));
      // A password-shaped assignment to anything credential-named.
      // `[\w$]*` before the word on purpose. The first version anchored on
      // `\bsecret`, so `fallbackSecret = 're_live_...'` slipped past it — the
      // name a credential is given is never the bare noun in real code.
      const pattern = /\b[\w$]*(?:password|secret|api_?key|credential|token)\s*[:=]\s*['"`][^'"`\n]{6,}['"`]/gi;
      for (const hit of source.matchAll(pattern)) {
        // Reading one from the environment is the point; naming one is not.
        if (/Deno\.env|process\.env|\$\{/.test(hit[0])) continue;
        // `console.log('... from token:', x ? 'valid' : 'invalid')` matched the
        // first version of this scan: the word was INSIDE a string, and the
        // quote it found was that string's own closing one. An odd number of
        // quotes before the match on its line means exactly that.
        const lineStart = source.lastIndexOf('\n', hit.index!) + 1;
        const before = source.slice(lineStart, hit.index!);
        const quotes = (before.match(/(?<!\\)['"`]/g) ?? []).length;
        if (quotes % 2 === 1) continue;
        // A DOTTED LOWERCASE NAMESPACE is a permission name, not a secret —
        // `providerSetCredential: 'providers.credentials.set'`. Nothing else is
        // excused: `sk_live_abc123` has no dots and stays a finding.
        const value = /['"`]([^'"`\n]{6,})['"`]/.exec(hit[0])?.[1] ?? '';
        if (/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(value)) continue;
        offenders.push(`${file.pathname.slice(ROOT.pathname.length)}: ${hit[0].slice(0, 60)}`);
      }
    }
    assert.deepEqual(offenders, [], 'these hard-code a credential in the deployed server');
  });
});

describe('the demo fixture is a fixture and nothing else', () => {
  it('the demo password exists in exactly one place', async () => {
    const declaration = await readFile(new URL('app/utils/demoData.ts', SRC), 'utf8');
    const match = /export const DEMO_TEAM_LOGIN = \{[\s\S]*?password: '([^']+)'/.exec(declaration);
    assert.ok(match, 'DEMO_TEAM_LOGIN is gone');
    const password = match[1];

    const copies: string[] = [];
    for (const file of await sources(SRC)) {
      if (file.pathname.endsWith('/app/utils/demoData.ts')) continue;
      const source = await readFile(file, 'utf8');
      if (source.includes(password)) copies.push(file.pathname.slice(ROOT.pathname.length));
    }

    assert.deepEqual(
      copies,
      [],
      'the demo password is copied elsewhere — a second literal is how the ' +
        'server fallback and the demo fixture became the same string',
    );
  });

  it('nothing in the front end describes a production default', async () => {
    const offenders: string[] = [];
    for (const file of await sources(SRC)) {
      const source = await readFile(file, 'utf8');
      // Prose in the registry that tells a reader what the live password is.
      if (/default credentials\s*:/i.test(source)) {
        offenders.push(file.pathname.slice(ROOT.pathname.length));
      }
    }
    assert.deepEqual(offenders, [], 'these document a default administrator credential');
  });

  it('the login screen shows the fixture only in demo mode', async () => {
    const source = await readFile(new URL('app/components/TeamLogin.tsx', SRC), 'utf8');

    /**
     * The balanced extent of every `isDemoMode() && ( ... )` branch.
     *
     * The first version of this test looked BACKWARDS a fixed number of
     * characters for `isDemoMode() &&`, which is not containment: deleting the
     * guard on one branch still left the guard on a NEARBY branch inside the
     * window, and the mutation went undetected. A range either holds an offset
     * or it does not.
     */
    const guarded: Array<[number, number]> = [];
    const guard = /isDemoMode\(\)\s*&&\s*\(/g;
    for (let match = guard.exec(source); match !== null; match = guard.exec(source)) {
      let i = match.index + match[0].length;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === '(') depth++;
        else if (source[i] === ')') depth--;
        i++;
      }
      guarded.push([match.index, i]);
    }
    assert.ok(guarded.length >= 2, `expected demo-mode branches, found ${guarded.length}`);

    let mentions = 0;
    for (let at = source.indexOf('DEMO_TEAM_LOGIN'); at !== -1; at = source.indexOf('DEMO_TEAM_LOGIN', at + 1)) {
      const line = source.slice(source.lastIndexOf('\n', at) + 1, source.indexOf('\n', at));
      if (line.startsWith('import ')) continue;
      mentions++;
      assert.ok(
        guarded.some(([from, to]) => at > from && at < to),
        `a fixture credential is rendered outside every demo-mode branch:\n  ${line.trim()}`,
      );
    }
    assert.ok(mentions >= 2, `expected the autofill and the hint panel, found ${mentions}`);
  });
});
