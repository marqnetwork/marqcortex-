/**
 * Outcome shadow dry-run harness test — MCV2-S7.5-VALIDATE-010
 *
 * Locks in the offline reconciliation harness: every comparison category is
 * exercised end-to-end, KV is always the returned source, SQL is never
 * returned, and telemetry stays clean. This is the CI guard for the pipeline
 * that the live reconciliation run will reuse.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOutcomeShadowDryRun } from '../../scripts/storage/outcome-shadow-dryrun.ts';

describe('S7.5 outcome shadow dry-run', () => {
  it('classifies every comparison category; KV always returned; SQL never returned', async () => {
    const s = await runOutcomeShadowDryRun();
    assert.equal(s.total, 9);
    assert.equal(s.expectedMatches, 9, `mismatched classifications: ${JSON.stringify(s.rows.filter((r) => !r.ok))}`);
    assert.equal(s.kvAlwaysReturned, true);
    assert.equal(s.sqlEverReturned, false);
    // all nine distinct categories present exactly once
    assert.equal(Object.keys(s.byOutcome).length, 9);
    for (const c of Object.values(s.byOutcome)) assert.equal(c, 1);
    // authorization mismatch surfaces as critical (never masked)
    assert.equal(s.maxSeverity, 'critical');
  });
});
