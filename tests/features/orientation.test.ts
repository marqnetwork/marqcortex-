/**
 * UI SPRINT 7 — the orientation model.
 *
 * WHAT THIS GUARDS
 *   `src/app/core/orientation.ts` is what makes the console's first-run
 *   experience derivable rather than decorative. Every guarantee below is a
 *   property of that derivation, and each one corresponds to a way the previous
 *   console got it wrong:
 *
 *   1. LOADING IS NOT EMPTY. The home dashboard rendered a full grid of zeros
 *      while the first fetch was in flight, telling a busy workspace it had no
 *      work. `workspaceState` distinguishes the two, and no workspace-derived
 *      step resolves while loading.
 *
 *   2. UNKNOWN IS NOT DONE, AND NOT OUTSTANDING. A fact the console has not
 *      loaded — the team roster, on a surface that does not load it — yields
 *      `unknown`. It is never rendered as either completed or outstanding,
 *      because both would be a guess presented as a fact.
 *
 *   3. EXACTLY ONE NEXT ACTION. §4.9 asks every surface to answer "what should
 *      happen next?" — singular. Zero next steps means orientation is finished,
 *      never that it is stuck.
 *
 *   4. NO STEP ENDS IN A 403. Only a role the server lets administer the team
 *      is told to invite anybody.
 *
 *   5. NOTHING IS UNREACHABLE. Progressive disclosure groups and folds; it
 *      never removes. Every page the shell can render is in the model, and only
 *      a group that is entirely system-tier may be collapsed.
 *
 *   6. A REFRESH RESTORES A REAL PAGE. `restorablePage` accepts only page keys
 *      the model knows, so a stale or forged stored value cannot leave the
 *      shell rendering nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NAV_MODEL,
  navigationGroups,
  navEntry,
  navigablePageIds,
  restorablePage,
  workspaceState,
  orientationSteps,
  nextOrientationStep,
  orientationProgress,
  shouldLeadWithOrientation,
  type OrientationInput,
} from '../../src/app/core/orientation.ts';
import { TEAM_ROLES, canAdministerTeam } from '../../src/app/lib/teamRole.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sub = (status: string) => ({ status });

function input(overrides: Partial<OrientationInput> = {}): OrientationInput {
  return {
    role: 'admin',
    isLoading: false,
    submissions: [],
    teamMemberCount: 1,
    ...overrides,
  };
}

// ── 1. The navigation model ───────────────────────────────────────────────────

describe('the navigation model covers the shell without hiding anything', () => {
  it('has a unique id for every entry', () => {
    const ids = NAV_MODEL.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate nav id');
  });

  it('names and describes every entry', () => {
    for (const entry of NAV_MODEL) {
      assert.ok(entry.label.length > 0, `${entry.id} has no label`);
      assert.ok(entry.description.length > 0, `${entry.id} has no description`);
      assert.ok(entry.group.length > 0, `${entry.id} has no group`);
    }
  });

  it('covers every page the shell renders', () => {
    // The keys `TeamDashboardNew` switches on. If a page is added to the shell
    // and not to the model, it becomes unreachable from the sidebar.
    const shellPages = [
      'dashboard', 'cortex', 'team', 'settings', 'reviewer',
      'analytics', 'emails', 'revenue', 'execution', 'mapping', 'architecture',
    ];
    for (const page of shellPages) {
      assert.ok(navEntry(page), `${page} is renderable but not in the nav model`);
    }
    assert.deepEqual([...navigablePageIds()].sort(), [...shellPages].sort());
  });

  it('leads with the work before the reporting on it', () => {
    const first = NAV_MODEL[0];
    assert.equal(first.id, 'dashboard');
    assert.equal(first.tier, 'primary');
  });

  it('folds only groups that are entirely system-tier', () => {
    for (const group of navigationGroups()) {
      if (group.collapsible) {
        assert.ok(
          group.entries.every(e => e.tier === 'system'),
          `${group.label} is collapsible but holds real work`,
        );
      } else {
        assert.ok(
          group.entries.some(e => e.tier !== 'system'),
          `${group.label} is all system-tier but is not collapsible`,
        );
      }
    }
  });

  it('keeps at least one group always open', () => {
    const open = navigationGroups().filter(g => !g.collapsible);
    assert.ok(open.length > 0, 'every group is folded — there is no way in');
  });

  it('loses no entry to grouping', () => {
    const grouped = navigationGroups().flatMap(g => g.entries.map(e => e.id));
    assert.deepEqual([...grouped].sort(), [...NAV_MODEL.map(e => e.id)].sort());
  });

  it('preserves declaration order inside a group', () => {
    for (const group of navigationGroups()) {
      const declared = NAV_MODEL.filter(e => e.group === group.label).map(e => e.id);
      assert.deepEqual(group.entries.map(e => e.id), declared);
    }
  });
});

describe('a refresh restores a page the shell can actually render', () => {
  it('restores a page the model knows', () => {
    assert.equal(restorablePage('analytics'), 'analytics');
  });

  it('falls back for anything else', () => {
    for (const bad of [null, undefined, '', 'not-a-page', 'DASHBOARD', '../etc/passwd']) {
      assert.equal(restorablePage(bad), 'dashboard', `${String(bad)} was restored`);
    }
  });

  it('honours an explicit fallback', () => {
    assert.equal(restorablePage('nonsense', 'cortex'), 'cortex');
  });
});

// ── 2. Workspace state ────────────────────────────────────────────────────────

describe('loading is a state of its own, not zero', () => {
  it('reads as loading while the first fetch is in flight', () => {
    assert.equal(workspaceState(input({ isLoading: true })), 'loading');
    // Even with submissions already in hand from a previous render.
    assert.equal(
      workspaceState(input({ isLoading: true, submissions: [sub('new')] })),
      'loading',
    );
  });

  it('reads as empty only once loading has finished with nothing', () => {
    assert.equal(workspaceState(input({ isLoading: false, submissions: [] })), 'empty');
  });

  it('reads as active with any work at all', () => {
    assert.equal(workspaceState(input({ submissions: [sub('new')] })), 'active');
  });

  it('never leads with orientation while still loading', () => {
    assert.equal(shouldLeadWithOrientation(input({ isLoading: true })), false);
  });

  it('leads with orientation for a loaded, genuinely empty workspace', () => {
    assert.equal(shouldLeadWithOrientation(input({ submissions: [] })), true);
  });

  it('does not lead with orientation once there is work', () => {
    assert.equal(shouldLeadWithOrientation(input({ submissions: [sub('new')] })), false);
  });
});

// ── 3. Steps ──────────────────────────────────────────────────────────────────

describe('steps are derived from the workspace, never stored', () => {
  it('marks nothing done in an empty workspace', () => {
    const steps = orientationSteps(input({ submissions: [], teamMemberCount: 1 }));
    assert.equal(steps.filter(s => s.state === 'done').length, 0);
  });

  it('completes the first step the moment a submission exists', () => {
    const steps = orientationSteps(input({ submissions: [sub('new')] }));
    assert.equal(steps.find(s => s.id === 'first-submission')?.state, 'done');
  });

  it('completes the review step only once something has moved off new', () => {
    const stillNew = orientationSteps(input({ submissions: [sub('new'), sub('new')] }));
    assert.notEqual(stillNew.find(s => s.id === 'first-review')?.state, 'done');

    const moved = orientationSteps(input({ submissions: [sub('new'), sub('in-review')] }));
    assert.equal(moved.find(s => s.id === 'first-review')?.state, 'done');
  });

  it('completes the outcome step on approved or completed, not on in-review', () => {
    const reviewing = orientationSteps(input({ submissions: [sub('in-review')] }));
    assert.notEqual(reviewing.find(s => s.id === 'first-outcome')?.state, 'done');

    for (const status of ['approved', 'completed']) {
      const finished = orientationSteps(input({ submissions: [sub(status)] }));
      assert.equal(
        finished.find(s => s.id === 'first-outcome')?.state, 'done',
        `${status} should finish the outcome step`,
      );
    }
  });

  it('resolves nothing while loading — every step reads unknown', () => {
    const steps = orientationSteps(input({
      isLoading: true,
      submissions: [sub('approved')],
      teamMemberCount: 9,
    }));
    for (const step of steps) {
      assert.equal(step.state, 'unknown', `${step.id} resolved during load`);
    }
    assert.equal(nextOrientationStep(input({ isLoading: true })), null);
  });

  it('treats an unloaded roster as unknown, never as "you are alone"', () => {
    const steps = orientationSteps(input({ role: 'admin', teamMemberCount: null }));
    assert.equal(steps.find(s => s.id === 'invite-team')?.state, 'unknown');
  });

  it('completes the invite step once somebody else is in the workspace', () => {
    const alone = orientationSteps(input({ role: 'owner', teamMemberCount: 1 }));
    assert.notEqual(alone.find(s => s.id === 'invite-team')?.state, 'done');

    const shared = orientationSteps(input({ role: 'owner', teamMemberCount: 2 }));
    assert.equal(shared.find(s => s.id === 'invite-team')?.state, 'done');
  });
});

describe('no step ends in a refusal', () => {
  it('offers the invite step only to roles that may administer the team', () => {
    for (const role of TEAM_ROLES) {
      const has = orientationSteps(input({ role, teamMemberCount: 1 }))
        .some(s => s.id === 'invite-team');
      assert.equal(
        has, canAdministerTeam(role),
        `${role}: invite step offered=${has}, may administer=${canAdministerTeam(role)}`,
      );
    }
  });

  it('gives every actionable step somewhere real to go', () => {
    for (const role of TEAM_ROLES) {
      for (const step of orientationSteps(input({ role }))) {
        if (step.target === null) {
          assert.equal(step.actionLabel, null, `${step.id} has a label but nowhere to go`);
          continue;
        }
        assert.ok(navEntry(step.target), `${step.id} points at ${step.target}, which is not a page`);
        assert.ok(step.actionLabel, `${step.id} goes somewhere but offers no label`);
      }
    }
  });

  it('gives every step a unique id, a title and a reason', () => {
    const steps = orientationSteps(input({ role: 'owner' }));
    assert.equal(new Set(steps.map(s => s.id)).size, steps.length);
    for (const step of steps) {
      assert.ok(step.title.length > 0, `${step.id} has no title`);
      assert.ok(step.detail.length > 0, `${step.id} has no detail`);
    }
  });
});

describe('there is exactly one next action, or none at all', () => {
  it('names one next step in an empty workspace', () => {
    const steps = orientationSteps(input());
    assert.equal(steps.filter(s => s.state === 'next').length, 1);
    assert.equal(nextOrientationStep(input())?.id, 'first-submission');
  });

  it('advances the next step as the workspace advances', () => {
    assert.equal(
      nextOrientationStep(input({ submissions: [sub('new')] }))?.id,
      'first-review',
    );
    assert.equal(
      nextOrientationStep(input({ submissions: [sub('in-review')] }))?.id,
      'first-outcome',
    );
  });

  it('never names more than one next step, in any state', () => {
    const workspaces: OrientationInput[] = [];
    for (const role of TEAM_ROLES) {
      for (const submissions of [[], [sub('new')], [sub('in-review')], [sub('approved')]]) {
        for (const teamMemberCount of [null, 1, 4]) {
          workspaces.push(input({ role, submissions, teamMemberCount }));
        }
      }
    }
    for (const workspace of workspaces) {
      const next = orientationSteps(workspace).filter(s => s.state === 'next');
      assert.ok(next.length <= 1, `${next.length} next steps for ${JSON.stringify(workspace)}`);
    }
  });

  it('finishes rather than nags once everything resolvable is done', () => {
    const finished = input({
      role: 'viewer',
      submissions: [sub('approved')],
      teamMemberCount: 5,
    });
    assert.equal(nextOrientationStep(finished), null);
    assert.equal(orientationProgress(finished).complete, true);
  });

  it('is never complete while a step is unknown', () => {
    const unresolved = input({ role: 'admin', submissions: [sub('approved')], teamMemberCount: null });
    assert.equal(orientationProgress(unresolved).unknown, 1);
    assert.equal(orientationProgress(unresolved).complete, false);
  });
});

describe('progress counts every step exactly once', () => {
  it('partitions the steps into done, outstanding and unknown', () => {
    for (const role of TEAM_ROLES) {
      for (const teamMemberCount of [null, 1, 3]) {
        for (const submissions of [[], [sub('new')], [sub('in-review')], [sub('completed')]]) {
          const facts = input({ role, submissions, teamMemberCount });
          const progress = orientationProgress(facts);
          assert.equal(
            progress.done + progress.outstanding + progress.unknown,
            progress.total,
            `partition broken for ${role}`,
          );
          assert.equal(progress.total, orientationSteps(facts).length);
        }
      }
    }
  });
});
