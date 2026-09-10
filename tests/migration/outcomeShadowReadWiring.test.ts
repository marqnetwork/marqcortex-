/**
 * MCV2-S7.4 — the shadow read, as WIRED.
 *
 * The unit suite proves the instrument behaves. This one proves the golden rule
 * of the whole migration still holds where it is installed:
 *
 *   **KV remains authoritative until per-domain Phase 5 cutover.**
 *
 * That is a claim about ABSENCE — that no relational row can reach a response
 * body — and absence is what a source assertion proves well and a runtime test
 * proves badly. A test that drove the route with an agreeing relational row
 * would say nothing about the branch that fires when the two disagree.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverDir = join(root, 'supabase', 'functions', 'server');

const indexSource = readFileSync(join(serverDir, 'index.tsx'), 'utf8');
const wiringSource = readFileSync(join(serverDir, 'storage', 'outcomeShadowRead.ts'), 'utf8');
const readerSource = readFileSync(join(serverDir, 'storage', 'shadowReader.ts'), 'utf8');
const barrelSource = readFileSync(join(serverDir, 'storage', 'index.ts'), 'utf8');

/** Source with comments removed, so the explanation is never the violation. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const indexCode = code(indexSource);
const wiringCode = code(wiringSource);

/** The body of the outcome GET route, as the router will run it. */
function outcomeGetRoute(): string {
  const start = indexCode.indexOf('app.get("/make-server-324f4fbe/submissions/:id/outcome"');
  assert.ok(start >= 0, 'the outcome read route was not found');
  const end = indexCode.indexOf('app.get(', start + 10);
  return indexCode.slice(start, end === -1 ? undefined : end);
}

describe('S8.1 wiring — one gated path decides what is served', () => {
  /**
   * The S7.4 form of this suite asserted that KV ALWAYS decides. That was the
   * guarantee until the cutover existed; it is now narrower and stated
   * precisely, because "the relational store can never answer" and "the
   * relational store answers only through one switch-gated call" are different
   * claims and only the second one is true.
   */
  it('reads KV, resolves authority, observes, then responds — in that order', () => {
    const route = outcomeGetRoute();
    const kvRead = route.indexOf('kv.get(`outcome:');
    const resolve = route.indexOf('resolveOutcomeRead(');
    const observe = route.indexOf('observeOutcomeRead(');
    const respond = route.indexOf('c.json({ success: true, outcome })');

    assert.ok(kvRead >= 0, 'the route no longer reads KV');
    assert.ok(resolve > kvRead, 'authority is resolved before the KV answer exists');
    assert.ok(
      observe > resolve,
      'the shadow read must observe the record actually served, so it runs AFTER the authority',
    );
    assert.ok(respond > observe, 'the response is returned after the observation');
    assert.match(route, /const kvOutcome = raw \? JSON\.parse\(raw\) : null;/);
    assert.match(
      route,
      /const outcome = resolved\.record;/,
      'the served record must come from the authority, not from a second source',
    );
  });

  it('reaches the relational store through exactly ONE named call, and no other', () => {
    const route = outcomeGetRoute();
    // The gate itself is allowed. Everything that would bypass it is not.
    assert.ok(route.includes('resolveOutcomeRead('), 'the gated path is missing');
    for (const bypass of ['createOutcomeRepository', 'getOutcomeByLegacyKey', 'from(']) {
      assert.ok(
        !route.includes(bypass),
        `the outcome route reaches the relational store directly via ${bypass}`,
      );
    }
  });

  it('keeps KV as the fallback rather than serving an absence', () => {
    // The record handed to the authority is the KV one, so a relational store
    // that is behind falls back to it instead of presenting a live record as
    // deleted.
    assert.match(outcomeGetRoute(), /resolveOutcomeRead\(submissionId,\s*kvOutcome\)/);
  });

  it('does not import a repository into the router at all', () => {
    // The router's only route to the relational store is the shadow reader,
    // which returns nothing. An import here would be a path a future edit could
    // serve from without anybody deciding to cut over.
    assert.ok(
      !/from\s+["'][^"']*repositories\//.test(indexCode),
      'index.tsx imports a repository — the cutover decision must be explicit, not available',
    );
  });

  it('hands the shadow reader the record the caller was actually served', () => {
    assert.match(outcomeGetRoute(), /observeOutcomeRead\(submissionId,\s*outcome\)/);
  });
});

describe('S8.1 — the cutover is off by default, and its rollback is a switch', () => {
  const authorityCode = code(
    readFileSync(join(serverDir, 'storage', 'outcomeReadAuthority.ts'), 'utf8'),
  );

  it('requires an explicit opt-in, and admits only true or 1', () => {
    assert.match(authorityCode, /readBool\('MCV2_SQL_AUTHORITY_OUTCOMES'\)/);
    assert.match(authorityCode, /raw === 'true' \|\| raw === '1'/);
  });

  it('reads the switch at the point of use, so turning it off is immediate', () => {
    // Captured at module load, a rollback would need a deploy — which is the
    // difference between a switch and an outage.
    assert.doesNotMatch(
      authorityCode,
      /^const\s+\w+\s*=\s*readBool\(/m,
      'the switch is captured at module load',
    );
    assert.match(authorityCode, /function authoritative\(domain: AuthorityDomain\): boolean/);
  });

  it('gates the domain by name, so switching one on does not switch another', () => {
    assert.match(authorityCode, /domain === 'outcome' && readBool\('MCV2_SQL_AUTHORITY_OUTCOMES'\)/);
  });

  it('does not reconstruct the denormalised submission snapshot', () => {
    // Those fields are live on the submission in the relational model. Putting
    // a stale copy back into the body would undo what the cutover is for.
    for (const stale of ['industry', 'company', 'aiScore', 'submittedAt']) {
      assert.ok(
        !new RegExp(`^\\s*${stale}:`, 'm').test(authorityCode),
        `the relational-to-KV shaping reintroduces the stale ${stale} snapshot`,
      );
    }
  });

  it('is the only module in the router\'s reach that can serve a relational record', () => {
    // `index.tsx` imports the storage modules and nothing else that touches a
    // repository. If a second such import appears, the rollout stops being
    // reviewable in one place.
    const storageImports = [...indexCode.matchAll(/from\s+"\.\/storage\/([\w.]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(
      storageImports.sort(),
      ['outcomeReadAuthority.ts', 'outcomeShadowRead.ts', 'submissionShadowRead.ts'],
      'the set of storage modules the router can reach changed — re-review the cutover surface',
    );
  });
});

describe('S7.4 wiring — the reader gives a route nothing to serve', () => {
  it('returns void from the observation entry point', () => {
    assert.match(wiringCode, /export function observeOutcomeRead\([\s\S]*?\): Promise<void>/);
  });

  it('declares observe as returning nothing', () => {
    assert.match(code(readerSource), /observe\(observation: ShadowObservation\): Promise<void>;/);
  });

  it('exports no function that hands back a relational row', () => {
    // The barrel is what a route can reach. Everything it exports is a
    // projection, a comparison or the reader itself.
    for (const forbidden of ['getOutcome', 'findRow', 'readSql', 'fetchRelational']) {
      assert.ok(!barrelSource.includes(forbidden), `the storage barrel exports ${forbidden}`);
    }
  });
});

describe('S7.4 wiring — off by default, and bounded when on', () => {
  it('requires an explicit opt-in', () => {
    // `readBool` admits only 'true' and '1'. An absent variable is off, and so
    // is any other value — a shadow read must not start because somebody wrote
    // `yes`.
    assert.match(wiringCode, /enabled: \(\) => readBool\('MCV2_SHADOW_READ_OUTCOMES'\)/);
    assert.match(wiringCode, /raw === 'true' \|\| raw === '1'/);
  });

  it('reads the switch at the point of use rather than at module load', () => {
    // A captured value would mean an operator turning it off waits for an
    // isolate to recycle.
    assert.ok(
      !/const\s+\w+\s*=\s*readBool\(/.test(wiringCode),
      'the switch is captured once instead of read per call',
    );
  });

  it('bounds the deadline and falls back rather than to zero or infinity', () => {
    assert.match(wiringCode, /DEADLINE_DEFAULT_MS = 250/);
    assert.match(wiringCode, /Math\.min\(DEADLINE_MAX_MS, Math\.max\(DEADLINE_MIN_MS, parsed\)\)/);
    assert.match(wiringCode, /if \(!Number\.isFinite\(parsed\)\) return DEADLINE_DEFAULT_MS;/);
  });

  it('builds the service client lazily', () => {
    // Constructing it at module load would turn "the relational plane is not
    // configured yet" into a startup failure for the whole edge function.
    assert.match(wiringCode, /if \(!client\) client = createServiceClient\(\);/);
    assert.ok(
      !/^const client = createServiceClient\(\)/m.test(wiringCode),
      'the client is constructed at module load',
    );
  });

  it('logs a divergence without a value from either store', () => {
    const logCall = wiringCode.slice(
      wiringCode.indexOf('onDivergence:'),
      wiringCode.indexOf('});', wiringCode.indexOf('onDivergence:')),
    );
    assert.match(logCall, /record\.divergences\.map/);
    for (const leak of ['record.kv', 'observation.kv', 'JSON.stringify(record.kv']) {
      assert.ok(!logCall.includes(leak), `the divergence log carries ${leak}`);
    }
  });
});

describe('S7.7 wiring — the submission route serves KV and observes after', () => {
  function submissionGetRoute(): string {
    const start = indexCode.indexOf('app.get("/make-server-324f4fbe/submissions/:id"');
    assert.ok(start >= 0, 'the submission read route was not found');
    return indexCode.slice(start, indexCode.indexOf('app.patch(', start));
  }

  it('serves the KV record and observes afterwards', () => {
    const route = submissionGetRoute();
    const kvRead = route.indexOf('kv.get(`sub:');
    const observe = route.indexOf('observeSubmissionRead(');
    const respond = route.indexOf('c.json({ success: true, submission })');
    assert.ok(kvRead >= 0, 'the route no longer reads KV');
    assert.ok(observe > kvRead, 'the shadow read runs before the KV answer exists');
    assert.ok(respond > observe, 'the response is returned after the observation');
  });

  it('hands the reader the record the caller was actually served', () => {
    assert.match(submissionGetRoute(), /observeSubmissionRead\(id,\s*submission\)/);
  });

  it('carries its own switch, so an operator can aim the instrument', () => {
    const wiring = code(
      readFileSync(join(serverDir, 'storage', 'submissionShadowRead.ts'), 'utf8'),
    );
    assert.match(wiring, /MCV2_SHADOW_READ_SUBMISSIONS/);
    // One reader, so there is one report and one deadline. Two would be two
    // bounded ledgers to consult and two places for the bound to drift apart.
    assert.match(wiring, /import \{ outcomeShadowReader \}/);
    assert.ok(
      !/createShadowReader\(/.test(wiring),
      'the submission domain built a second reader instead of sharing one',
    );
  });

  it('does not reach the relational store while its switch is off', () => {
    const wiring = code(
      readFileSync(join(serverDir, 'storage', 'submissionShadowRead.ts'), 'utf8'),
    );
    assert.match(
      wiring,
      /if \(!submissionShadowReadEnabled\(\)\) return Promise\.resolve\(\);/,
    );
  });
});

describe('S7.4 wiring — the report is authorised and honest', () => {
  it('requires a verified team caller', () => {
    const start = indexCode.indexOf('app.get("/make-server-324f4fbe/cortex/shadow-read"');
    assert.ok(start >= 0, 'the shadow-read report route was not found');
    const route = indexCode.slice(start, indexCode.indexOf('app.get(', start + 10));
    assert.match(route, /verifyTeamToken\(c\.req\.header\('Authorization'\)\)/);
    assert.match(route, /if \(!userId\) return c\.json\(\{ error: "Unauthorized" \}, 401\)/);
  });

  it('says whether it is switched on, so an empty report is not read as agreement', () => {
    const start = indexCode.indexOf('app.get("/make-server-324f4fbe/cortex/shadow-read"');
    const route = indexCode.slice(start, indexCode.indexOf('app.get(', start + 10));
    assert.match(route, /outcomeShadowReadEnabled\(\)/);
    assert.match(route, /submissionShadowReadEnabled\(\)/);
  });

  it('is a read — there is no route that writes shadow state', () => {
    for (const method of ['post', 'patch', 'put', 'delete']) {
      assert.ok(
        !new RegExp(`app\\.${method}\\("/make-server-324f4fbe/cortex/shadow-read`).test(indexCode),
        `a ${method} on the shadow-read route would make an observation writable`,
      );
    }
  });
});
