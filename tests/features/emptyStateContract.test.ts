/**
 * EMPTY STATES — UI Sprint 5.
 *
 * Product Experience Ch. 9 asks every surface to reduce uncertainty. An empty
 * list is where a surface has the least to say and the most chance of saying
 * something wrong — and the wrong thing had one specific shape across Cortex:
 *
 *   NOTHING EXISTS YET and NOTHING MATCHES YOUR FILTERS ARE DIFFERENT STATES,
 *   and four panels rendered one message for both.
 *
 *     ReviewerDashboard      "No submissions match your filters"
 *     EmailNurturePanel      "No emails match your filters
 *                             Try adjusting the filter or search terms."
 *     SubmissionsListPage    "No submissions found matching your criteria"
 *     TeamManagement         "No team members found"
 *
 *   A reviewer opening an empty queue, having set no filter and typed no
 *   search, was told their filters were the problem and sent to fix something
 *   they had never touched — while the actual situation, that there is nothing
 *   to review, went unsaid. TeamManagement's is the same error in the other
 *   direction: "found" describes a search that nobody performed.
 *
 * The two states have different causes and different next actions, so they are
 * now different components. <NoResultsState> also says HOW MANY exist behind
 * the filter, which is the whole point of distinguishing them: "there are 42,
 * and the current filters exclude all of them" tells the operator both that the
 * filter is the cause and that clearing it will show something.
 *
 * WHAT THIS SUITE WILL NOT LET BACK IN
 *   A filter-blaming message rendered on a genuinely empty collection. Each
 *   panel is checked for the specific shape: the empty branch must test the
 *   UNFILTERED collection, not the filtered one.
 *
 * TESTING APPROACH (documented limitation)
 *   All five modules are `.tsx` and the runner strips types but does not
 *   transform JSX, so none can be imported and rendered here. Following the
 *   established pattern, each guarantee is enforced structurally against the
 *   production source, with pattern-based assertions rather than line numbers.
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

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SHARED = 'src/app/components/EmptyState.tsx';
const shared = stripComments(readSource(SHARED));

/**
 * The panels that render a filtered list, with the collection each filters and
 * the noun each is about.
 */
const FILTERED_PANELS = [
  {
    file: 'src/app/components/ReviewerDashboard.tsx',
    filtered: 'filteredSubmissions',
    collection: 'submissions',
    noun: 'submissions',
  },
  {
    file: 'src/app/components/EmailNurturePanel.tsx',
    filtered: 'filtered',
    collection: 'queue',
    noun: 'emails',
  },
  {
    file: 'src/app/components/SubmissionsListPage.tsx',
    filtered: 'filteredSubmissions',
    collection: 'submissions',
    noun: 'submissions',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// THE SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('the two empty states are two components', () => {
  it('exports both, distinctly', () => {
    assert.match(shared, /export function EmptyState\(/);
    assert.match(shared, /export function NoResultsState\(/);
  });

  it('EmptyState never blames a filter', () => {
    const fn = shared.match(/export function EmptyState\([\s\S]*?\n\}/);
    assert.ok(fn, 'expected EmptyState');
    for (const term of ['filter', 'search', 'criteria', 'match']) {
      assert.ok(
        !new RegExp(term, 'i').test(fn[0]),
        `EmptyState is for a collection that is genuinely empty — it must not mention ${term}`,
      );
    }
  });

  it('NoResultsState requires the count behind the filter', () => {
    assert.ok(
      /totalCount: number;/.test(shared),
      'the count is the point — it says the filter is the cause and clearing it will help',
    );
    assert.ok(
      /onClear: \(\) => void;/.test(shared),
      'naming the cause without offering the remedy is half an answer',
    );
    const fn = shared.match(/export function NoResultsState\([\s\S]*?\n\}/);
    assert.ok(fn, 'expected NoResultsState');
    assert.ok(/Clear filters/.test(fn[0]));
    assert.ok(
      /totalCount === 1/.test(fn[0]),
      'the singular case must read correctly too',
    );
  });

  it('both announce themselves to assistive technology', () => {
    assert.equal(
      (shared.match(/role="status"/g) ?? []).length, 2,
      'a list that becomes empty must be announced, not silently blank',
    );
  });

  it('both hide their decorative icon from assistive technology', () => {
    assert.equal((shared.match(/aria-hidden="true"/g) ?? []).length, 2);
  });

  it('the action is optional, because many lists fill themselves', () => {
    assert.ok(/action\?: \{ label: string; onClick: \(\) => void \};/.test(shared));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PANELS
// ─────────────────────────────────────────────────────────────────────────────

describe('no panel blames a filter for an empty collection', () => {
  for (const panel of FILTERED_PANELS) {
    const name = panel.file.split('/').pop();
    const code = stripComments(readSource(panel.file));

    it(`${name} branches on the UNFILTERED collection`, () => {
      // The defect in one line: the empty branch tested the filtered array and
      // then explained the emptiness with the filter.
      assert.ok(
        new RegExp(`${panel.collection}\\.length === 0 \\?`).test(code),
        `${name} must ask whether anything exists at all before blaming the filter`,
      );
    });

    it(`${name} renders EmptyState when nothing exists`, () => {
      assert.match(code, /import \{[^}]*EmptyState[^}]*\} from '@\/app\/components\/EmptyState'/);
      assert.ok(/<EmptyState/.test(code));
    });

    it(`${name} renders NoResultsState when the filter is the cause`, () => {
      assert.ok(/<NoResultsState/.test(code));
      assert.ok(
        new RegExp(`noun="${panel.noun}"`).test(code),
        `${name} must name what is being filtered`,
      );
      assert.ok(
        new RegExp(`totalCount=\\{${panel.collection}\\.length\\}`).test(code),
        `${name} must report how many exist behind the filter`,
      );
    });

    it(`${name} offers a clear that resets every filter it applies`, () => {
      const clear = code.match(/onClear=\{\(\) => \{([^}]*)\}\}/);
      assert.ok(clear, `${name} must offer to clear the filters`);
      // Both a status filter and a search term are applied; clearing one and
      // leaving the other would leave the list still empty.
      assert.ok(
        /[Ff]ilter/.test(clear[1]) && /[Ss]earch/.test(clear[1]),
        `${name} must clear BOTH the filter and the search term`,
      );
    });

    it(`${name} keeps no hand-rolled filter-blaming message`, () => {
      for (const phrase of [
        'match your filters',
        'matching your criteria',
        'Try adjusting the filter',
      ]) {
        assert.ok(
          !code.includes(phrase),
          `${name} still hand-renders "${phrase}"`,
        );
      }
    });
  }
});

describe('TeamManagement says the directory is empty, not that a search failed', () => {
  const code = stripComments(readSource('src/app/components/TeamManagement.tsx'));

  it('no longer reports a search nobody performed', () => {
    assert.ok(
      !/No team members found/.test(code),
      '"found" describes a search; the directory is simply empty',
    );
  });

  it('renders the shared empty state', () => {
    assert.match(code, /import \{ EmptyState \} from '@\/app\/components\/EmptyState'/);
    assert.ok(/<EmptyState/.test(code));
    assert.ok(/No team members yet/.test(code));
  });

  it('says what would populate it', () => {
    assert.ok(
      /invited and have signed in/.test(code),
      'an empty state should say what would change it',
    );
  });

  it('still distinguishes loading from empty', () => {
    // A list that is still loading is not an empty list, and saying "nothing
    // here" while a request is in flight is simply wrong.
    assert.ok(/isLoading \?/.test(code));
    assert.ok(/: members\.length === 0 \?/.test(code));
  });
});

describe('the priority inbox keeps its own all-clear', () => {
  const code = stripComments(readSource('src/app/components/TeamHomeDashboard.tsx'));

  it('an empty priority list is good news, and still says so', () => {
    // Not every empty state is a gap to be filled. This one is a result.
    assert.ok(/priorityItems\.length === 0/.test(code));
    assert.ok(/All caught up!/.test(readSource('src/app/components/TeamHomeDashboard.tsx')));
  });
});
