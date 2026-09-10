/**
 * The Phase 5 cutover mechanism (MCV2-S8.1), invariant by invariant.
 *
 * This is the ONLY module by which a relational record can reach a response
 * body, so its failure modes are the cutover's failure modes. Each invariant
 * below is stated in `readAuthority.ts` and asserted here, including the ones
 * that only matter when something has gone wrong — a store that is behind, a
 * read that hangs, credentials that are absent — because those are the states a
 * rollout actually happens in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createReadAuthority,
  type AuthorityDomain,
  type ReadAuthority,
} from '../../supabase/functions/server/storage/readAuthority.ts';
import type { FieldSpec } from '../../supabase/functions/server/storage/contracts.ts';

interface Outcome {
  submissionId: string;
  converted: boolean;
  conversionValue: number | null;
}

const FIELDS: readonly FieldSpec[] = [
  { field: 'submissionId', rule: 'text' },
  { field: 'converted', rule: 'exact' },
  { field: 'conversionValue', rule: 'numeric' },
];

const KV_RECORD: Outcome = { submissionId: 's1', converted: true, conversionValue: 1000 };

function project(record: Outcome) {
  return {
    submissionId: record.submissionId,
    converted: record.converted,
    conversionValue: record.conversionValue,
  };
}

function makeAuthority(
  on: boolean | ((domain: AuthorityDomain) => boolean),
  { deadlineMs = 50, notices }: { deadlineMs?: number; notices?: unknown[] } = {},
): ReadAuthority {
  let clock = 0;
  return createReadAuthority({
    authoritative: typeof on === 'function' ? on : () => on,
    deadlineMs: () => deadlineMs,
    now: () => (clock += 1),
    isoNow: () => '2026-01-01T00:00:00.000Z',
    ...(notices ? { onNotice: (record) => notices.push(record) } : {}),
  });
}

function resolve(authority: ReadAuthority, loadSql: () => Promise<unknown>, kv = KV_RECORD) {
  return authority.resolve<Outcome>({
    domain: 'outcome',
    key: 'outcome:s1',
    kv,
    fields: FIELDS,
    loadSql,
    toRecord: (row) => row as Outcome,
    projectKv: project,
    projectSql: (row) => project(row as Outcome),
  });
}

describe('read authority — invariant 1: off is unchanged', () => {
  it('returns the KV record BY IDENTITY when the domain is not authoritative', async () => {
    const authority = makeAuthority(false);
    const result = await resolve(authority, () => {
      throw new Error('the relational store must not be touched when the switch is off');
    });
    assert.equal(result.source, 'kv');
    assert.equal(
      result.record,
      KV_RECORD,
      'the record must be the same object — not re-projected or round-tripped',
    );
  });

  it('does not read the relational store at all when off', async () => {
    let reads = 0;
    const authority = makeAuthority(false);
    await resolve(authority, async () => {
      reads += 1;
      return null;
    });
    assert.equal(reads, 0);
  });

  it('records nothing when off, so the report cannot imply a rollout that is not happening', async () => {
    const authority = makeAuthority(false);
    await resolve(authority, async () => null);
    assert.deepEqual(authority.report().domains, []);
    assert.deepEqual(authority.report().recent, []);
  });

  it('switches per domain, independently', async () => {
    const authority = makeAuthority((domain) => domain === 'submission');
    assert.equal(authority.authoritative('outcome'), false);
    assert.equal(authority.authoritative('submission'), true);
  });

  it('reads the switch at the point of use, so it takes effect on the next read', async () => {
    let on = false;
    const authority = makeAuthority(() => on);
    assert.equal((await resolve(authority, async () => ({ ...KV_RECORD }))).source, 'kv');
    on = true;
    assert.equal((await resolve(authority, async () => ({ ...KV_RECORD }))).source, 'sql');
    on = false;
    assert.equal(
      (await resolve(authority, async () => ({ ...KV_RECORD }))).source,
      'kv',
      'turning the switch off is the rollback, and it is immediate',
    );
  });
});

describe('read authority — invariant 2: it never fails a request', () => {
  it('falls back to KV when the relational read throws', async () => {
    const notices: unknown[] = [];
    const authority = makeAuthority(true, { notices });
    const result = await resolve(authority, () => Promise.reject(new Error('no credentials')));
    assert.equal(result.source, 'fallback_error');
    assert.equal(result.record, KV_RECORD);
    assert.equal(notices.length, 1, 'a fallback is a notice an operator needs');
  });

  it('falls back when the relational read throws synchronously', async () => {
    const authority = makeAuthority(true);
    const result = await resolve(authority, () => {
      throw new Error('driver blew up before returning a promise');
    });
    assert.equal(result.source, 'fallback_error');
    assert.equal(result.record, KV_RECORD);
  });

  it('never carries the failure text into the record', async () => {
    const authority = makeAuthority(true);
    await resolve(authority, () => Promise.reject(new Error('customer@example.com not found')));
    const serialized = JSON.stringify(authority.report().recent);
    assert.doesNotMatch(serialized, /customer@example\.com/);
    assert.doesNotMatch(serialized, /not found/);
  });

  it('falls back when the relational store has no row yet', async () => {
    const authority = makeAuthority(true);
    const result = await resolve(authority, async () => null);
    assert.equal(result.source, 'fallback_missing');
    assert.equal(
      result.record,
      KV_RECORD,
      'a store that is behind must not present a live record as deleted',
    );
  });

  it('treats undefined the same as null', async () => {
    const authority = makeAuthority(true);
    assert.equal((await resolve(authority, async () => undefined)).source, 'fallback_missing');
  });
});

describe('read authority — invariant 3: it never runs unbounded', () => {
  it('falls back to KV when the relational read misses the deadline', async () => {
    const authority = makeAuthority(true, { deadlineMs: 10 });
    const result = await resolve(
      authority,
      () => new Promise((settle) => setTimeout(() => settle({ ...KV_RECORD }), 200)),
    );
    assert.equal(result.source, 'fallback_timeout');
    assert.equal(result.record, KV_RECORD);
  });

  it('serves the relational row when it arrives inside the deadline', async () => {
    const authority = makeAuthority(true, { deadlineMs: 200 });
    const row = { ...KV_RECORD };
    const result = await resolve(authority, () => new Promise((settle) => setTimeout(() => settle(row), 5)));
    assert.equal(result.source, 'sql');
    assert.equal(result.record, row);
  });
});

describe('read authority — invariant 4: it records who answered, never the value', () => {
  it('serves the relational record when SQL is authoritative and has the row', async () => {
    const authority = makeAuthority(true);
    const row: Outcome = { submissionId: 's1', converted: true, conversionValue: 1000 };
    const result = await resolve(authority, async () => row);
    assert.equal(result.source, 'sql');
    assert.equal(result.record, row, 'the relational row is what the caller gets');
  });

  it('checks every SQL-served answer against what KV would have said', async () => {
    const notices: unknown[] = [];
    const authority = makeAuthority(true, { notices });
    await resolve(authority, async () => ({ ...KV_RECORD, conversionValue: 2500 }));

    const [record] = authority.report().recent;
    assert.equal(record.source, 'sql');
    assert.equal(record.agreedWithKv, false);
    assert.deepEqual(record.divergentFields, ['conversionValue']);
    assert.equal(notices.length, 1, 'a divergence on a served answer is a notice');
  });

  it('records agreement without a notice when the two stores match', async () => {
    const notices: unknown[] = [];
    const authority = makeAuthority(true, { notices });
    await resolve(authority, async () => ({ ...KV_RECORD }));

    const [record] = authority.report().recent;
    assert.equal(record.agreedWithKv, true);
    assert.deepEqual(notices, [], 'agreement is the expected case and must not be noise');
  });

  it('keeps customer values out of the record entirely', async () => {
    const authority = makeAuthority(true);
    await resolve(authority, async () => ({
      submissionId: 's1',
      converted: false,
      conversionValue: 987654,
    }));
    const serialized = JSON.stringify(authority.report().recent);
    assert.doesNotMatch(serialized, /987654/);
    assert.match(serialized, /outcome:s1/, 'the KEY is an identifier and is kept');
  });
});

describe('read authority — the rollout report', () => {
  it('counts what an operator needs to decide whether the cutover is ready', async () => {
    const authority = makeAuthority(true);
    await resolve(authority, async () => ({ ...KV_RECORD }));
    await resolve(authority, async () => ({ ...KV_RECORD }));
    await resolve(authority, async () => ({ ...KV_RECORD, conversionValue: 1 }));
    await resolve(authority, async () => null);
    await resolve(authority, () => Promise.reject(new Error('x')));

    const [summary] = authority.report().domains;
    assert.equal(summary.domain, 'outcome');
    assert.equal(summary.total, 5);
    assert.equal(summary.servedBySql, 3);
    assert.equal(summary.servedByKv, 2);
    assert.equal(summary.fallbackMissing, 1);
    assert.equal(summary.fallbackError, 1);
    assert.equal(summary.sqlAgreed, 2);
    assert.equal(summary.sqlDiverged, 1);
  });

  it('summarises each domain separately', async () => {
    const authority = makeAuthority(true);
    await resolve(authority, async () => ({ ...KV_RECORD }));
    await authority.resolve<Outcome>({
      domain: 'submission',
      key: 'sub:s1',
      kv: KV_RECORD,
      fields: FIELDS,
      loadSql: async () => null,
      toRecord: (row) => row as Outcome,
      projectKv: project,
      projectSql: (row) => project(row as Outcome),
    });

    const domains = authority.report().domains.map((entry) => entry.domain);
    assert.deepEqual(domains, ['outcome', 'submission'], 'sorted, so the report reads the same every time');
  });

  it('bounds what it retains', async () => {
    const authority = createReadAuthority({
      authoritative: () => true,
      deadlineMs: () => 50,
      now: () => 0,
      isoNow: () => '2026-01-01T00:00:00.000Z',
      capacity: 3,
    });
    for (let index = 0; index < 10; index += 1) {
      await resolve(authority, async () => ({ ...KV_RECORD }));
    }
    assert.equal(authority.report().recent.length, 3);
    assert.equal(authority.report().domains[0].total, 3);
  });

  it('reset clears the rollout history', async () => {
    const authority = makeAuthority(true);
    await resolve(authority, async () => ({ ...KV_RECORD }));
    authority.reset();
    assert.deepEqual(authority.report().domains, []);
  });
});
