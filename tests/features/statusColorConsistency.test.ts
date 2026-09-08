/**
 * UI SPRINT 7 — one status, one colour, on every screen.
 *
 * THE DEFECT
 *   Four surfaces of the same console each declared their own submission-status
 *   palette, and they did not agree:
 *
 *   * `completed` was CYAN on the submission list, the pipeline snapshot and the
 *     home dashboard's funnel — and BLUE on the analytics panel. The same status,
 *     two colours, on two screens a user moves between in one session.
 *   * `low` priority was NEUTRAL GREY on the analytics panel and CYAN on the
 *     lead list, so it read as "nothing to see" on one screen and as an
 *     informational tag on the next.
 *   * `SubmissionsListPage.getStatusColor` HAD NO `approved` CASE AT ALL. An
 *     approved submission fell through to the default and rendered in the
 *     neutral "we do not recognise this" grey — on the very page whose own
 *     Approve button produces that status.
 *
 *   A colour that means two things means nothing, and colour is how a dense
 *   pipeline view is read at a glance.
 *
 * WHAT IS GUARDED
 *   That `SUBMISSION_STATUS_COLOR` and `PRIORITY_COLOR` in the token layer are
 *   the only place these are decided, and that no surface re-declares them.
 *   Tailwind's arbitrary-value classes must be literal at build time, so a
 *   class string genuinely cannot be derived from a runtime token — a surface
 *   that needs one produces inline style from the token instead, which is what
 *   the shared `StatusBadge` does and what these surfaces now do.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { SUBMISSION_STATUS_COLOR, PRIORITY_COLOR } from '../../src/app/lib/tokens.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The surfaces that render a submission status or a priority. */
const SURFACES = [
  'src/app/components/AnalyticsDashboard.tsx',
  'src/app/components/FullFeaturedDashboard.tsx',
  'src/app/components/SubmissionsListPage.tsx',
];

describe('the status vocabulary is complete', () => {
  it('colours every status the domain declares', () => {
    // `Submission['status']` in `api.ts`. A status the domain has and the map
    // does not is a status that renders as "unrecognised".
    const api = read('src/app/lib/api.ts');
    const declared = api.match(/status: '(new)' \| '(in-review)' \| '(completed)' \| '(approved)';/);
    assert.ok(declared, "Submission['status'] has changed shape — update this test and the token map together");
    assert.deepEqual(
      Object.keys(SUBMISSION_STATUS_COLOR).sort(),
      ['approved', 'completed', 'in-review', 'new'],
    );
  });

  it('colours every priority the domain declares', () => {
    const api = read('src/app/lib/api.ts');
    assert.match(api, /priority: 'low' \| 'medium' \| 'high';/);
    assert.deepEqual(Object.keys(PRIORITY_COLOR).sort(), ['high', 'low', 'medium']);
  });
});

describe('no surface re-declares a status palette', () => {
  for (const rel of SURFACES) {
    it(`${rel.split('/').pop()} reads the token maps`, () => {
      const source = read(rel);
      assert.ok(
        source.includes('SUBMISSION_STATUS_COLOR'),
        `${rel} does not read the canonical status colours`,
      );
      assert.ok(
        source.includes('PRIORITY_COLOR'),
        `${rel} does not read the canonical priority colours`,
      );
    });
  }

  it('the analytics panel no longer disagrees on completed', () => {
    const analytics = stripComments(read('src/app/components/AnalyticsDashboard.tsx'));
    assert.ok(
      !/completed:\s*BLUE/.test(analytics),
      'the analytics panel is drawing `completed` in blue again while the rest of the console draws it in cyan',
    );
    // And the canonical answer, so the test states the value it is defending.
    assert.equal(SUBMISSION_STATUS_COLOR.completed, '#06D7F6');
  });

  it('the lead list no longer disagrees on low priority', () => {
    const dash = stripComments(read('src/app/components/FullFeaturedDashboard.tsx'));
    assert.ok(
      !/low:\s*\{ bg: 'bg-\[#06D7F6\]/.test(dash),
      'low priority is cyan again here and grey on the analytics panel',
    );
    assert.equal(PRIORITY_COLOR.low, '#70707C');
  });

  it('the submission list colours approved instead of falling through to grey', () => {
    const list = stripComments(read('src/app/components/SubmissionsListPage.tsx'));
    // The switch that had no `approved` case is gone; a Record lookup replaced
    // it, so a missing key is explicit rather than accidental.
    assert.ok(
      !/case 'completed':\s*return \{ bg: 'rgba\(6, 215, 246/.test(list),
      'the hand-written status switch is back',
    );
    assert.match(list, /SUBMISSION_STATUS_COLOR\[status as keyof typeof SUBMISSION_STATUS_COLOR\]/);
    assert.equal(SUBMISSION_STATUS_COLOR.approved, '#10B981');
  });
});

describe('every status colour is distinguishable from every other', () => {
  it('uses a different colour for each status', () => {
    const values = Object.values(SUBMISSION_STATUS_COLOR);
    assert.equal(new Set(values).size, values.length);
  });

  it('shares no colour between a status and a priority', () => {
    // Two vocabularies on the same row of the same table: a submission's
    // status and its priority sit side by side, and a colour appearing in both
    // would make one unreadable as the other.
    const shared = Object.entries(PRIORITY_COLOR)
      .filter(([, colour]) => Object.values(SUBMISSION_STATUS_COLOR).includes(colour))
      .map(([key]) => key);
    assert.deepEqual(shared, [], `a priority shares a status colour: ${shared.join(', ')}`);
  });

  it('records that the two ambers are close, and that neither was changed here', () => {
    // `in-review` is #FB923C and `medium` priority is #F59E0B. They are near
    // neighbours, and telling them apart at a glance in a dense list is
    // genuinely hard. That is a real observation, and it is NOT fixed here:
    // both are colours the product already renders, and changing one is a
    // design decision rather than a convergence. This assertion exists so the
    // fact is recorded at the place a future change would land, rather than
    // being rediscovered.
    assert.equal(SUBMISSION_STATUS_COLOR['in-review'], '#FB923C');
    assert.equal(PRIORITY_COLOR.medium, '#F59E0B');
    assert.notEqual(SUBMISSION_STATUS_COLOR['in-review'], PRIORITY_COLOR.medium);
  });
});
