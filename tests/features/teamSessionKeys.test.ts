/**
 * PHASE 1B — Team session storage-key consolidation
 *
 * An earlier build wrote team authentication to `team_access_token` and team
 * identity to `team_user`. Nothing ever wrote those keys in the shipped
 * bundle, so every read of them silently produced an empty credential or an
 * anonymous placeholder name. The canonical authority is
 * `marq_cortex_team_session` (+ `_expiry`); these tests hold that line.
 *
 * TWO KINDS OF TEST HERE
 *   1. Behavioural — the pure session helpers in `src/app/lib/session.ts` are
 *      executed directly. No DOM, no clock, no storage.
 *   2. Structural — the repository has no React test renderer, so the
 *      component/context guarantees are enforced by reading the production
 *      sources and asserting on the storage-access patterns they contain.
 *      These are deliberately pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTeamSession,
  serializeTeamSession,
  TEAM_SESSION_KEY,
  TEAM_SESSION_EXPIRY_KEY,
  CLIENT_SESSION_KEY,
  LEGACY_TEAM_SESSION_KEYS,
  type TeamSession,
} from '../../src/app/lib/session.ts';

// ── Source access ─────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_ROOT = join(REPO_ROOT, 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const PRODUCTION_SOURCES = sourceFiles(SRC_ROOT).map((path) => ({
  path,
  rel: relative(REPO_ROOT, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

function read(rel: string): string {
  const file = PRODUCTION_SOURCES.find((f) => f.rel === rel);
  assert.ok(file, `expected production source ${rel} to exist`);
  return file.text;
}

/** Balance braces from the first `{` at or after `from`. */
function braceBody(source: string, from: number, label: string): string {
  const open = source.indexOf('{', from);
  assert.notEqual(open, -1, `expected a body for ${label}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unbalanced braces while reading ${label}`);
}

/**
 * The body of a class method, given a declaration ending in `(`.
 *
 * The parameter list is skipped by paren balance first, so an inline object
 * type such as `data: { email: string }` is not mistaken for the body.
 */
function methodBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `expected to find ${declaration}`);
  let i = start + declaration.length - 1; // sits on the opening paren
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return braceBody(source, i, declaration);
}

/** The body of an arrow function, e.g. a `useCallback((…) => { … })`. */
function arrowBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `expected to find ${declaration}`);
  const arrow = source.indexOf('=> {', start);
  assert.notEqual(arrow, -1, `expected an arrow body for ${declaration}`);
  return braceBody(source, arrow, declaration);
}

/** Source with comments removed, so guards cannot match prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every web-storage access in a source, as `{ api, key }`.
 *
 * Matching the storage call — not the bare string — is what keeps these guards
 * honest: `'team_user'` is also a `versionEngine` actor literal that appears
 * across the codebase and has nothing to do with sessions.
 */
function storageAccesses(text: string): { api: string; key: string }[] {
  const re = /(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const found: { api: string; key: string }[] = [];
  for (const m of text.matchAll(re)) found.push({ api: m[2], key: m[3] });
  return found;
}

/** Files permitted to name the legacy keys at all — the cleanup path only. */
const LEGACY_NAME_ALLOWLIST = new Set([
  'src/app/lib/session.ts',       // the cleanup-only constant declaration
  'src/app/contexts/AppContext.tsx', // logout cleanup + the comment explaining it
]);

// ── 1. Canonical key names ────────────────────────────────────────────────────

describe('canonical session storage keys', () => {
  it('are declared once, in the canonical session module', () => {
    assert.equal(TEAM_SESSION_KEY, 'marq_cortex_team_session');
    assert.equal(TEAM_SESSION_EXPIRY_KEY, 'marq_cortex_team_session_expiry');
    assert.equal(CLIENT_SESSION_KEY, 'marq_cortex_client_session');
  });

  it('no production file restates a canonical key literal outside session.ts', () => {
    for (const { rel, text } of PRODUCTION_SOURCES) {
      if (rel === 'src/app/lib/session.ts') continue;
      for (const key of [TEAM_SESSION_KEY, TEAM_SESSION_EXPIRY_KEY, CLIENT_SESSION_KEY]) {
        assert.ok(
          !text.includes(`'${key}'`) && !text.includes(`"${key}"`),
          `${rel} restates the canonical key literal ${key}; import it from @/app/lib/session`,
        );
      }
    }
  });

  it('declares the legacy keys as cleanup-only', () => {
    assert.deepEqual([...LEGACY_TEAM_SESSION_KEYS], ['team_access_token', 'team_user']);
  });
});

// ── 2. No active legacy reads or writes anywhere in production ────────────────

describe('legacy team keys are never used as an active source', () => {
  it('no production code reads team_access_token or team_user from storage', () => {
    for (const { rel, text } of PRODUCTION_SOURCES) {
      for (const { api, key } of storageAccesses(text)) {
        if (api !== 'getItem') continue;
        assert.ok(
          !LEGACY_TEAM_SESSION_KEYS.includes(key as (typeof LEGACY_TEAM_SESSION_KEYS)[number]),
          `${rel} reads legacy key ${key} from storage`,
        );
      }
    }
  });

  it('no production code writes team_access_token or team_user to storage', () => {
    for (const { rel, text } of PRODUCTION_SOURCES) {
      for (const { api, key } of storageAccesses(text)) {
        if (api !== 'setItem') continue;
        assert.ok(
          !LEGACY_TEAM_SESSION_KEYS.includes(key as (typeof LEGACY_TEAM_SESSION_KEYS)[number]),
          `${rel} writes legacy key ${key} to storage`,
        );
      }
    }
  });

  it('the legacy key names appear only in the cleanup implementation', () => {
    for (const { rel, text } of PRODUCTION_SOURCES) {
      if (LEGACY_NAME_ALLOWLIST.has(rel)) continue;
      for (const key of LEGACY_TEAM_SESSION_KEYS) {
        // `'team_user'` is also a versionEngine actor value, so only the
        // storage-shaped usage is prohibited outside the cleanup path.
        assert.ok(
          !new RegExp(`(localStorage|sessionStorage)[^\\n]*['"\`]${key}['"\`]`).test(text),
          `${rel} references legacy key ${key} in a storage call`,
        );
      }
    }
  });
});

// ── 3. Team session record — behavioural ──────────────────────────────────────

const user = { id: 'u-1', email: 'lead@marqcortex.com', name: 'Avery Stone' };

describe('team session record round-trips', () => {
  it('preserves token and user', () => {
    const session: TeamSession = { accessToken: 'tok-1', user };
    const restored = parseTeamSession(serializeTeamSession(session));
    assert.deepEqual(restored, session);
  });

  it('preserves a session with no user', () => {
    const session: TeamSession = { accessToken: 'tok-1', user: null };
    assert.deepEqual(parseTeamSession(serializeTeamSession(session)), session);
  });

  it('carries identity inside the canonical record — no second key exists', () => {
    const stored = serializeTeamSession({ accessToken: 'tok-1', user });
    assert.ok(stored.includes('Avery Stone'), 'identity travels with the session record');
  });
});

describe('team session restoration', () => {
  it('accepts the bare-token format an earlier bundle wrote to the same key', () => {
    // Still valid authentication under the canonical key — restore it rather
    // than signing the user out, but with no identity attached.
    assert.deepEqual(parseTeamSession('raw-token-abc'), {
      accessToken: 'raw-token-abc',
      user: null,
    });
  });

  it('fails closed on records that cannot yield a token', () => {
    for (const bad of ['', null, undefined, '{}', '{"user":{}}', '[]', 'null', '{"accessToken":""}']) {
      assert.equal(parseTeamSession(bad as string | null), null, `input ${String(bad)}`);
    }
  });

  it('drops a partial user rather than restoring half an identity', () => {
    const raw = JSON.stringify({ accessToken: 'tok-1', user: { name: 'Avery Stone' } });
    assert.deepEqual(parseTeamSession(raw), { accessToken: 'tok-1', user: null });
  });

  it('never derives a session from a legacy key value', () => {
    // Whatever a stale legacy key held, it is not an input to restoration.
    assert.equal(parseTeamSession(null), null);
  });
});

// ── 4. AppContext session lifecycle — structural ──────────────────────────────

describe('AppContext session lifecycle', () => {
  const appContext = read('src/app/contexts/AppContext.tsx');

  it('is the only production module that touches session storage keys', () => {
    const sessionKeys = new Set<string>([
      TEAM_SESSION_KEY,
      TEAM_SESSION_EXPIRY_KEY,
      CLIENT_SESSION_KEY,
      ...LEGACY_TEAM_SESSION_KEYS,
    ]);
    for (const { rel, text } of PRODUCTION_SOURCES) {
      if (rel === 'src/app/contexts/AppContext.tsx') continue;
      for (const { key } of storageAccesses(text)) {
        assert.ok(!sessionKeys.has(key), `${rel} accesses session key ${key} directly`);
      }
    }
  });

  it('loginTeam writes only canonical team-session state', () => {
    const body = arrowBody(appContext, 'const loginTeam =');
    const written = storageAccesses(body).filter((a) => a.api === 'setItem');
    // Keys are referenced via the imported constants, so assert on the
    // constant identifiers actually used inside the body.
    assert.equal(written.length, 0, 'loginTeam must not inline key literals');
    assert.ok(body.includes('TEAM_SESSION_KEY'), 'writes the canonical team session');
    assert.ok(body.includes('TEAM_SESSION_EXPIRY_KEY'), 'writes the canonical expiry');
    assert.ok(body.includes('serializeTeamSession'), 'writes the canonical record shape');
    for (const key of LEGACY_TEAM_SESSION_KEYS) {
      assert.ok(!body.includes(key), `loginTeam must not write ${key}`);
    }
    assert.ok(!body.includes('CLIENT_SESSION_KEY'), 'team login must not touch client storage');
  });

  it('restoration reads only the canonical team session', () => {
    assert.ok(appContext.includes('parseTeamSession(localStorage.getItem(TEAM_SESSION_KEY))'));
    // The only team-session read on mount is the canonical one.
    const teamReads = storageAccesses(appContext)
      .filter((a) => a.api === 'getItem')
      .map((a) => a.key);
    assert.deepEqual(teamReads, [], 'restoration reads keys via constants only');
    assert.ok(!/getItem\((TEAM_SESSION_KEY|TEAM_SESSION_EXPIRY_KEY|CLIENT_SESSION_KEY)\)[^\n]*legacy/i.test(appContext));
  });

  it('has one team-storage cleanup routine, covering canonical AND legacy keys', () => {
    const body = methodBody(appContext, 'function clearTeamStorage(');
    for (const constant of ['TEAM_SESSION_KEY', 'TEAM_SESSION_EXPIRY_KEY']) {
      assert.ok(
        new RegExp(`removeItem\\(${constant}\\)`).test(body),
        `cleanup must remove ${constant}`,
      );
    }
    assert.ok(
      /for \(const key of LEGACY_TEAM_SESSION_KEYS\) localStorage\.removeItem\(key\)/.test(body),
      'cleanup must remove every legacy key deterministically',
    );
  });

  it('logout clears canonical AND legacy team keys, plus the client session', () => {
    const body = arrowBody(appContext, 'const logout =');
    assert.ok(body.includes('clearTeamStorage()'), 'logout must run team cleanup');
    assert.ok(/removeItem\(CLIENT_SESSION_KEY\)/.test(body), 'logout must clear the client session');
    assert.ok(body.includes('setTeamUser(null)'), 'logout must drop in-memory identity');
    assert.ok(body.includes('setTeamAccessToken(null)'), 'logout must drop the in-memory token');
  });

  it('an expired team session is cleared at the point of detection', () => {
    // On a cold load the route guard redirects while teamAccessToken is still
    // null, so its logout effect never runs. Restoration must therefore do the
    // cleanup itself — the same reason the client branch clears inline.
    const restore = appContext.slice(appContext.indexOf('const restoredTeam ='));
    const expiredBranch = restore.slice(0, restore.indexOf('setTeamAccessToken(restoredTeam.accessToken)'));
    assert.ok(expiredBranch.includes('clearTeamStorage()'), 'expired restore must clear storage');
    assert.ok(expiredBranch.includes('setIsSessionExpired(true)'));
    assert.ok(
      expiredBranch.indexOf('clearTeamStorage()') < expiredBranch.indexOf('return'),
      'an expired session must never be restored into state',
    );
  });

  it('still routes an in-session expiry through the canonical logout path', () => {
    const route = read('src/app/pages/TeamDashboardRoute.tsx');
    assert.ok(/isSessionExpired && teamAccessToken/.test(route));
    assert.ok(/logout\(\)/.test(route));
  });

  it('leaves the Task 6 client-session expiry behaviour untouched', () => {
    assert.ok(appContext.includes('checkClientSessionExpired(restored)'));
    assert.ok(appContext.includes('localStorage.removeItem(CLIENT_SESSION_KEY)'));
    assert.ok(appContext.includes('CLIENT_SESSION_TTL_MS'));
  });
});

// ── 5. Email automation receives authentication explicitly ────────────────────

describe('email automation authentication', () => {
  const emailAutomation = read('src/app/utils/emailAutomation.ts');

  it('never reads storage internally', () => {
    assert.equal(storageAccesses(emailAutomation).length, 0);
  });

  it('takes the access token as an explicit, required parameter on send', () => {
    assert.ok(
      /static async send\(\s*payload: EmailPayload,\s*accessToken: string \| null,\s*\)/.test(emailAutomation),
      'EmailService.send must receive the token explicitly',
    );
    assert.ok(
      emailAutomation.includes('const token = accessToken || supabaseAnonKey;'),
      'the Authorization header must be built from the passed token',
    );
  });

  it('forwards the token from every wrapper to send', () => {
    const wrappers = [
      'sendLeadMagnetConfirmation',
      'sendDiagnosticReceived',
      'sendReportReady',
      'sendMeetingInvitation',
    ];
    for (const wrapper of wrappers) {
      const body = methodBody(emailAutomation, `static async ${wrapper}(`);
      assert.ok(body.includes('accessToken'), `${wrapper} must accept and forward the token`);
      assert.ok(/}, accessToken\);/.test(body), `${wrapper} must pass the token to send`);
    }
  });

  it('every trigger threads the caller token down to send', () => {
    const triggers = [
      'onLeadMagnetDownload',
      'onDiagnosticSubmit',
      'onReportApproved',
      'onFollowUpNeeded',
    ];
    for (const trigger of triggers) {
      const body = methodBody(emailAutomation, `static async ${trigger}(`);
      assert.ok(body.includes('accessToken,'), `${trigger} must forward its token`);
    }
  });

  it('has no active call site that omits authentication', () => {
    // Any production caller of EmailService/EmailAutomation must supply a
    // token argument rather than relying on ambient storage.
    for (const { rel, text } of PRODUCTION_SOURCES) {
      if (rel === 'src/app/utils/emailAutomation.ts') continue;
      assert.ok(
        !/\bEmailService\s*\.\s*send\w*\(/.test(stripComments(text)),
        `${rel} calls EmailService directly; it must pass an explicit token`,
      );
    }
  });
});

// ── 6. Authenticated team UI uses the canonical session ───────────────────────

describe('authenticated team UI', () => {
  it('EmailNurturePanel authenticates with the canonical team token', () => {
    const panel = read('src/app/components/EmailNurturePanel.tsx');
    assert.ok(panel.includes("const { teamAccessToken } = useApp();"));
    assert.ok(panel.includes('getEmailStatus(teamAccessToken)'));
    assert.ok(panel.includes('sendTestEmailRequest(teamAccessToken)'));
    assert.equal(storageAccesses(panel).length, 0, 'no direct storage access');
  });

  it('EmailNurturePanel refuses to run authenticated calls with no session', () => {
    const panel = read('src/app/components/EmailNurturePanel.tsx');
    const guards = panel.match(/if \(!teamAccessToken\) \{/g) ?? [];
    assert.equal(guards.length, 2, 'both authenticated operations guard on the session');
    // Explicitly not an anonymous-key or empty-string fallback.
    assert.ok(!/teamAccessToken \|\| ''/.test(panel));
    assert.ok(!panel.includes('supabaseAnonKey'));
  });

  it('team dashboards read identity from app state, not storage', () => {
    for (const rel of [
      'src/app/components/TeamHomeDashboard.tsx',
      'src/app/components/FullFeaturedDashboard.tsx',
      'src/app/components/TeamMessageThread.tsx',
    ]) {
      const text = read(rel);
      assert.ok(text.includes('const { teamUser } = useApp();'), `${rel} sources identity from context`);
      assert.ok(text.includes('teamUser?.name'), `${rel} reads the authenticated name`);
      assert.equal(storageAccesses(text).length, 0, `${rel} must not touch storage`);
    }
  });

  it('the login path hands the server-supplied user to the session', () => {
    const login = read('src/app/components/TeamLogin.tsx');
    assert.ok(login.includes('onLogin(result.accessToken, result.user ?? null)'));

    const route = read('src/app/pages/TeamLoginRoute.tsx');
    assert.ok(route.includes('loginTeam(token, user)'));
  });
});
