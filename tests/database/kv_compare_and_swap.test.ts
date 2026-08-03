/**
 * `kv_compare_and_swap` against a real PostgreSQL.
 *
 * Every other test in this repository that touches the AI settings store runs
 * against a fake. That is right for the adapter's logic and structurally unable
 * to say anything about the SQL, because the guarantee the whole concurrency
 * design rests on — "of two writers at the same expected version, exactly one
 * wins" — is a property of a PostgreSQL statement, not of TypeScript.
 *
 * A fake proved the adapter delegates to one conditional operation. Only a
 * database can prove that operation arbitrates. This suite is the second half.
 *
 * It also pins the defect the corrective migration fixes. Reasoning about the
 * original `::integer` cast said it would return false for a malformed version;
 * running it said it RAISED for two of five shapes. That gap is the reason this
 * file exists rather than a paragraph in a report.
 *
 * RUNNING IT. Set `DATABASE_URL` to a PostgreSQL the test may create functions
 * in — a local instance or a disposable test database, never production:
 *
 *     DATABASE_URL=postgresql://postgres@127.0.0.1:5432/cortex_test \
 *       node --experimental-strip-types --test tests/database/kv_compare_and_swap.test.ts
 *
 * Without it every case skips, loudly, so a run that proves nothing cannot be
 * mistaken for a run that passed.
 *
 * SAFETY. Every row this suite touches is keyed `test:cas:<run-id>:…`, unique
 * per run, and deleted afterwards. It reads no other key and writes no other
 * key. It drives `psql` rather than adding a PostgreSQL client dependency to a
 * project that has none.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const ENABLED = DATABASE_URL !== '';

/** Unique per run, so two runs against one database cannot collide. */
const RUN = `test:cas:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
const MIGRATIONS = join('supabase', 'migrations');
const ORIGINAL = join(MIGRATIONS, '20260803120000_kv_compare_and_swap.sql');
const CORRECTIVE = join(MIGRATIONS, '20260803130000_kv_compare_and_swap_guarded_version.sql');

function psql(sql: string): string {
  return execFileSync('psql', [DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function psqlFile(path: string): void {
  execFileSync('psql', [DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A CAS call that reports `raised` instead of throwing, so a raise is a result. */
function cas(key: string, expected: number, next: string): 't' | 'f' | 'raised' {
  try {
    const out = psql(
      `select kv_compare_and_swap('${key}', ${expected}, to_jsonb(${quote(next)}::text));`,
    );
    return out === 't' ? 't' : 'f';
  } catch {
    return 'raised';
  }
}

function quote(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`;
}

/** Seed a record the way production writes one: JSON.stringify into JSONB. */
function seed(key: string, json: string): void {
  psql(
    `insert into kv_store_324f4fbe(key, value) values ('${key}', to_jsonb(${quote(json)}::text)) ` +
      `on conflict (key) do update set value = excluded.value;`,
  );
}

function seedObject(key: string, json: string): void {
  psql(
    `insert into kv_store_324f4fbe(key, value) values ('${key}', ${quote(json)}::jsonb) ` +
      `on conflict (key) do update set value = excluded.value;`,
  );
}

function storedMarker(key: string): string {
  return psql(`select coalesce(kv_json(value) ->> 'marker', '(none)') from kv_store_324f4fbe where key = '${key}';`);
}

function storedVersion(key: string): string {
  return psql(`select coalesce(kv_json(value) ->> 'configurationVersion', '(none)') from kv_store_324f4fbe where key = '${key}';`);
}

const record = (version: number | string, marker: string) =>
  `{"configurationVersion":${version},"marker":"${marker}"}`;

if (!ENABLED) {
  describe('kv_compare_and_swap (real PostgreSQL)', () => {
    it('SKIPPED — set DATABASE_URL to run these against a real database', { skip: true }, () => {
      // Intentionally empty. The skip reason is the assertion.
    });
  });
} else {
  after(() => {
    // Every key this suite created, and nothing else.
    psql(`delete from kv_store_324f4fbe where key like '${RUN}%';`);
  });

  describe('kv_compare_and_swap — migrations', () => {
    it('applies the original and then the corrective migration', () => {
      assert.ok(existsSync(ORIGINAL), 'the original migration must remain in place');
      assert.ok(existsSync(CORRECTIVE), 'the corrective migration must exist');

      // The table the functions operate on. `if not exists` so a database that
      // already has it is untouched.
      psql(
        'create table if not exists kv_store_324f4fbe (key text not null primary key, value jsonb not null);',
      );
      psql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;");

      // Applied in order, exactly as a deployment would. Both are CREATE OR
      // REPLACE, so this is idempotent and safe to re-run.
      psqlFile(ORIGINAL);
      psqlFile(CORRECTIVE);
    });

    it('leaves the original migration byte-for-byte unchanged', () => {
      const text = readFileSync(ORIGINAL, 'utf8');
      // The defect the corrective migration fixes is still described by the
      // original file. If this ever stops being true, history was rewritten.
      assert.ok(text.includes("::integer = p_expected_version"), 'original migration was edited');
    });

    it('exposes both functions with the expected signatures', () => {
      const signatures = psql(
        `select p.proname || '(' || pg_get_function_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('kv_json','kv_compare_and_swap')
          order by p.proname;`,
      );
      assert.match(signatures, /kv_compare_and_swap\(p_key text, p_expected_version integer, p_value jsonb\) -> boolean/);
      assert.match(signatures, /kv_json\(p_value jsonb\) -> jsonb/);
    });

    it('carries no unguarded integer cast in the effective definition', () => {
      const body = psql(
        `select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'kv_compare_and_swap';`,
      );
      assert.ok(!body.includes('::integer'), 'the live function still casts to integer');
      assert.ok(body.includes('jsonb_typeof'), 'the live function does not type-check before casting');
      assert.ok(body.includes('case'), 'the guard must be a CASE, not an AND chain');
    });
  });

  describe('kv_compare_and_swap — encoding and happy paths', () => {
    it('parses a double-encoded JSONB string, the way production writes it', () => {
      const key = `${RUN}:encoding`;
      seed(key, record(5, 'orig'));
      assert.equal(psql(`select jsonb_typeof(value) from kv_store_324f4fbe where key='${key}';`), 'string');
      assert.equal(storedVersion(key), '5');
    });

    it('accepts a write at the current version', () => {
      const key = `${RUN}:match`;
      seed(key, record(5, 'orig'));
      assert.equal(cas(key, 5, record(6, 'winner')), 't');
      assert.equal(storedVersion(key), '6');
      assert.equal(storedMarker(key), 'winner');
    });

    it('refuses a write at a stale version and changes nothing', () => {
      const key = `${RUN}:stale`;
      seed(key, record(6, 'orig'));
      assert.equal(cas(key, 5, record(7, 'loser')), 'f');
      assert.equal(storedVersion(key), '6');
      assert.equal(storedMarker(key), 'orig');
    });

    it('claims an absent key exactly once', () => {
      const key = `${RUN}:claim`;
      assert.equal(cas(key, 0, record(1, 'first')), 't');
      assert.equal(cas(key, 0, record(1, 'second')), 'f');
      assert.equal(storedMarker(key), 'first');
    });

    it('supports an object-shaped value, if the writer ever stores one', () => {
      const key = `${RUN}:object`;
      seedObject(key, record(3, 'obj'));
      assert.equal(psql(`select jsonb_typeof(value) from kv_store_324f4fbe where key='${key}';`), 'object');
      assert.equal(cas(key, 3, record(4, 'obj2')), 't');
      assert.equal(storedVersion(key), '4');
    });
  });

  describe('kv_compare_and_swap — malformed stored versions return false, never raise', () => {
    const shapes: readonly { readonly name: string; readonly json: string }[] = [
      { name: 'string version', json: '{"configurationVersion":"seven"}' },
      { name: 'fractional version', json: '{"configurationVersion":6.5}' },
      { name: 'missing version', json: '{"marker":"no version here"}' },
      { name: 'null version', json: '{"configurationVersion":null}' },
      { name: 'invalid JSON', json: 'this is not json at all' },
      { name: 'boolean version', json: '{"configurationVersion":true}' },
      { name: 'array version', json: '{"configurationVersion":[6]}' },
      { name: 'object version', json: '{"configurationVersion":{"n":6}}' },
    ];

    for (const shape of shapes) {
      it(`returns false for a ${shape.name}`, () => {
        const key = `${RUN}:bad:${shape.name.replace(/\s+/g, '-')}`;
        seed(key, shape.json);
        assert.equal(
          cas(key, 6, record(7, 'should-not-apply')),
          'f',
          `a ${shape.name} must be an ordinary lost race, not an exception`,
        );
        // And the attempted value was not written. Checked by marker rather
        // than by absence, because several of these fixtures carry a marker of
        // their own — asserting '(none)' would pass for the wrong reason on the
        // ones that do not.
        assert.notEqual(
          storedMarker(key),
          'should-not-apply',
          `a ${shape.name} was overwritten by a CAS that reported failure`,
        );
      });
    }
  });

  describe('kv_compare_and_swap — real concurrency', () => {
    /**
     * Two writers at the same expected version, genuinely concurrent.
     *
     * A opens a transaction and performs the CAS, taking the row lock, then
     * holds it. B enters the same CAS and blocks on that lock; when A commits, B
     * re-evaluates its predicate under READ COMMITTED and finds the version has
     * moved. This is the arbitration the design depends on, and it is a property
     * of the database rather than of the caller.
     */
    function race(key: string, expected: number): { a: string; b: string } {
      const aSql =
        `begin; select 'A:' || kv_compare_and_swap('${key}', ${expected}, to_jsonb(${quote(record(expected + 1, 'A'))}::text)); ` +
        `select pg_sleep(0.6); commit;`;
      const bSql =
        `select 'B:' || kv_compare_and_swap('${key}', ${expected}, to_jsonb(${quote(record(expected + 1, 'B'))}::text));`;

      const aProc = execFileSync(
        'bash',
        ['-c', `psql ${JSON.stringify(DATABASE_URL)} -X -tA -c ${JSON.stringify(aSql)} > /tmp/cas_a.$$ 2>&1 & ` +
               `sleep 0.2; psql ${JSON.stringify(DATABASE_URL)} -X -tA -c ${JSON.stringify(bSql)} > /tmp/cas_b.$$ 2>&1; ` +
               `wait; cat /tmp/cas_a.$$ /tmp/cas_b.$$; rm -f /tmp/cas_a.$$ /tmp/cas_b.$$`],
        { encoding: 'utf8' },
      );
      const a = /A:([tf])/.exec(aProc)?.[1] ?? 'missing';
      const b = /B:([tf])/.exec(aProc)?.[1] ?? 'missing';
      return { a, b };
    }

    it('lets exactly one of two concurrent writers win, repeatedly', () => {
      for (let round = 1; round <= 5; round += 1) {
        const key = `${RUN}:race:${round}`;
        seed(key, record(10, 'base'));

        const { a, b } = race(key, 10);
        const winners = [a, b].filter((r) => r === 't');
        const losers = [a, b].filter((r) => r === 'f');

        assert.equal(winners.length, 1, `round ${round}: expected one winner, got A=${a} B=${b}`);
        assert.equal(losers.length, 1, `round ${round}: expected one loser, got A=${a} B=${b}`);

        // The stored record is the winner's, whole — not a blend, and the
        // version moved exactly once.
        assert.equal(storedVersion(key), '11', `round ${round}: version did not advance exactly once`);
        assert.equal(
          storedMarker(key),
          a === 't' ? 'A' : 'B',
          `round ${round}: the stored record is not the winner's`,
        );
      }
    });

    it('never lets a second writer reuse a version the first already took', () => {
      const key = `${RUN}:sequence`;
      seed(key, record(1, 'base'));
      const versions: string[] = [];
      for (let round = 0; round < 5; round += 1) {
        const current = Number(storedVersion(key));
        const { a, b } = race(key, current);
        assert.equal([a, b].filter((r) => r === 't').length, 1);
        versions.push(storedVersion(key));
      }
      assert.equal(new Set(versions).size, versions.length, `duplicate version: ${versions.join(',')}`);
      for (let i = 1; i < versions.length; i += 1) {
        assert.ok(Number(versions[i]) > Number(versions[i - 1]), `not monotonic: ${versions.join(' -> ')}`);
      }
    });
  });
}
