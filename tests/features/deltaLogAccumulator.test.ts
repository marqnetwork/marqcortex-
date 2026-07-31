/**
 * PHASE 1B TASK 27 — ROI delta-log reduce accumulator
 *
 * `ChangeImpactIndicator` picks the most impactful entry in a version's
 * `delta_log` with a reduce whose accumulator is the entry plus a computed
 * `delta`. The seed carried the contract as an inline assertion:
 *
 *     null as (typeof latest.delta_log[0] & { delta: number }) | null
 *
 * With the accumulator type left to inference, TypeScript resolved the reduce
 * overload against the array's own element type and fixed the accumulator as
 * `DeltaLogEntry` — which has no `delta` — so `best?.delta` raised TS2339.
 *
 * The fix supplies the accumulator explicitly as a type argument
 * (`reduce<(DeltaLogEntry & { delta: number }) | null>(…)`), which selects the
 * right overload and lets the seed go back to a plain `null`. The reducer body,
 * the `Math.abs` distance, the numeric type guards, the strict `>` comparison
 * and the rendered output are all untouched.
 *
 * These tests cover the selection algorithm the diagnostic sat on:
 *   - an empty log
 *   - a single numeric entry
 *   - multiple numeric entries
 *   - non-numeric `old` / `new_value` values
 *   - equal-delta tie behaviour
 *
 * TESTING APPROACH (documented limitation — the established pattern in
 * frontendRuntimeDefects.test.ts and teamSessionKeys.test.ts)
 *   ROIExecutiveDashboard is a .tsx component, the repository ships no React
 *   test renderer, and the test runner (`node --experimental-strip-types`)
 *   strips types but does not transform JSX — so the component cannot be
 *   imported here, and the reducer is a local closure inside it in any case.
 *
 *   The reducer is therefore mirrored below as `pickMostChanged`, exercised
 *   against every required case, and then locked to production by a structural
 *   assertion that the mirrored body is character-for-character the reducer that
 *   actually ships (whitespace-collapsed). If the shipped reducer is edited, the
 *   mirror stops matching and this suite fails rather than silently drifting.
 *   Assertions are pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DASHBOARD_REL = 'src/app/components/ROIExecutiveDashboard.tsx';

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Mirror of the shipped reducer
// ---------------------------------------------------------------------------

/** Local mirror of `DeltaLogEntry` (src/app/core/types.ts). Declared here rather
 *  than imported so the node boundary's type graph is not widened. */
interface DeltaLogEntry {
  path: string;
  old: string | number | boolean | null;
  new_value: string | number | boolean;
  reason: string;
}

type MostChanged = (DeltaLogEntry & { delta: number }) | null;

/** Byte-identical to the reducer in `ChangeImpactIndicator`; see the structural
 *  assertion at the bottom of this file, which proves that claim. */
function pickMostChanged(log: DeltaLogEntry[]): MostChanged {
  return log.reduce<MostChanged>(
    (best, d) => {
      const oldVal = typeof d.old === 'number' ? d.old : 0;
      const newVal = typeof d.new_value === 'number' ? d.new_value : 0;
      const delta = Math.abs(newVal - oldVal);
      return delta > (best?.delta ?? 0) ? { ...d, delta } : best;
    },
    null,
  );
}

function entry(
  path: string,
  old: DeltaLogEntry['old'],
  new_value: DeltaLogEntry['new_value'],
): DeltaLogEntry {
  return { path, old, new_value, reason: `changed ${path}` };
}

// ---------------------------------------------------------------------------

describe('delta-log accumulator — selection', () => {
  it('returns null for an empty log', () => {
    assert.equal(pickMostChanged([]), null);
  });

  it('returns the single entry when its delta is non-zero', () => {
    const only = entry('roi.payback_months', 12, 7);
    assert.deepEqual(pickMostChanged([only]), { ...only, delta: 5 });
  });

  it('returns null for a single entry whose delta is zero', () => {
    // The comparison is a strict `>` against a `0` floor, so a no-op change
    // never displaces the null seed. Pre-existing behaviour, preserved.
    assert.equal(pickMostChanged([entry('roi.payback_months', 7, 7)]), null);
  });

  it('picks the largest absolute delta across multiple numeric entries', () => {
    const small = entry('roi.conversion_rate', 2.1, 2.4);
    const large = entry('roi.monthly_revenue', 250_000, 310_000);
    const middle = entry('roi.manual_hours_per_week', 120, 95);

    assert.deepEqual(pickMostChanged([small, large, middle]), { ...large, delta: 60_000 });
    assert.deepEqual(pickMostChanged([large, small, middle]), { ...large, delta: 60_000 });
    assert.deepEqual(pickMostChanged([middle, small, large]), { ...large, delta: 60_000 });
  });

  it('uses absolute distance, so a decrease can win', () => {
    const up = entry('roi.conversion_rate', 2, 5);
    const down = entry('roi.monthly_cost', 28_000, 21_000);
    assert.deepEqual(pickMostChanged([up, down]), { ...down, delta: 7_000 });
  });

  it('carries the whole entry through alongside the computed delta', () => {
    const picked = pickMostChanged([entry('portfolio.roi_12m_percent', 200, 284)]);
    assert.deepEqual(picked, {
      path: 'portfolio.roi_12m_percent',
      old: 200,
      new_value: 284,
      reason: 'changed portfolio.roi_12m_percent',
      delta: 84,
    });
    // `path` is the only field the indicator renders; it must survive the spread.
    assert.equal(picked?.path.split('.').pop()?.replace(/_/g, ' '), 'roi 12m percent');
  });
});

describe('delta-log accumulator — non-numeric values', () => {
  it('treats a non-numeric old value as 0', () => {
    const e = entry('scope.status', 'draft', 40);
    assert.deepEqual(pickMostChanged([e]), { ...e, delta: 40 });
  });

  it('treats a non-numeric new value as 0', () => {
    const e = entry('scope.status', 40, 'approved');
    assert.deepEqual(pickMostChanged([e]), { ...e, delta: 40 });
  });

  it('treats a null old value as 0', () => {
    const e = entry('scope.owner', null, 15);
    assert.deepEqual(pickMostChanged([e]), { ...e, delta: 15 });
  });

  it('treats boolean values as 0 on both sides, yielding no winner', () => {
    assert.equal(pickMostChanged([entry('flags.locked', false, true)]), null);
  });

  it('never lets an all-non-numeric log displace the null seed', () => {
    const log = [
      entry('scope.status', 'draft', 'approved'),
      entry('flags.locked', false, true),
      entry('scope.owner', null, 'unassigned'),
    ];
    assert.equal(pickMostChanged(log), null);
  });

  it('lets a numeric entry win over non-numeric neighbours', () => {
    const numeric = entry('roi.payback_months', 12, 6);
    const log = [entry('scope.status', 'draft', 'approved'), numeric, entry('flags.locked', false, true)];
    assert.deepEqual(pickMostChanged(log), { ...numeric, delta: 6 });
  });
});

describe('delta-log accumulator — ties', () => {
  it('keeps the earlier entry when two deltas are equal', () => {
    const first = entry('roi.a', 0, 50);
    const second = entry('roi.b', 100, 50);
    assert.deepEqual(pickMostChanged([first, second]), { ...first, delta: 50 });
    assert.deepEqual(pickMostChanged([second, first]), { ...second, delta: 50 });
  });

  it('keeps the earlier entry across a run of equal deltas', () => {
    const log = [entry('roi.a', 0, 10), entry('roi.b', 0, 10), entry('roi.c', 0, 10)];
    assert.deepEqual(pickMostChanged(log), { ...log[0], delta: 10 });
  });

  it('a later strictly-larger delta still displaces an earlier tie winner', () => {
    const log = [entry('roi.a', 0, 10), entry('roi.b', 0, 10), entry('roi.c', 0, 11)];
    assert.deepEqual(pickMostChanged(log), { ...log[2], delta: 11 });
  });
});

// ---------------------------------------------------------------------------
// The mirror above must stay identical to what ships
// ---------------------------------------------------------------------------

/** Collapse whitespace so indentation differences never fail the comparison. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The reducer callback body as it appears in the given source. */
function reducerBody(source: string): string {
  const start = source.indexOf('(best, d) => {');
  assert.notEqual(start, -1, 'the delta-log reducer callback was renamed or removed');
  const end = source.indexOf('},', start);
  assert.notEqual(end, -1, 'the delta-log reducer callback body is unterminated');
  return collapse(source.slice(start, end + 1));
}

describe('shipped reducer matches the mirror', () => {
  const shipped = readSource(DASHBOARD_REL);

  it('has a character-identical reducer callback', () => {
    assert.equal(reducerBody(shipped), reducerBody(readSource('tests/features/deltaLogAccumulator.test.ts')));
  });

  it('declares the accumulator as an explicit type argument, not a seed assertion', () => {
    assert.ok(
      shipped.includes('latest.delta_log.reduce<(DeltaLogEntry & { delta: number }) | null>('),
      'the reduce no longer carries an explicit accumulator type argument',
    );
    assert.equal(
      shipped.includes('null as (typeof latest.delta_log[0] & { delta: number }) | null'),
      false,
      'the inline seed assertion is back',
    );
  });

  it('still seeds with a plain null', () => {
    const start = shipped.indexOf('latest.delta_log.reduce<');
    assert.notEqual(start, -1, 'the reduce call was renamed or removed');
    const end = shipped.indexOf('\n  );', start);
    assert.notEqual(end, -1, 'the reduce call is unterminated');
    assert.match(
      collapse(shipped.slice(start, end)),
      /\},\s*null,$/,
      'the seed is no longer a plain null',
    );
  });

  it('still renders only mostChanged.path, behind a null guard', () => {
    assert.ok(shipped.includes('{mostChanged && ('), 'the null guard on the rendered row was removed');
    assert.ok(
      shipped.includes("{mostChanged.path.split('.').pop()?.replace(/_/g, ' ')}"),
      'the rendered "Most impacted" expression changed',
    );
  });
});
