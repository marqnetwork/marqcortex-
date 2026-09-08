/**
 * FRONTEND STATE CONTRACTS — five confirmed defects where a component or engine
 * read a field the canonical type does not declare.
 *
 * Every one of these surfaced as a `typecheck:web` diagnostic, and every one of
 * them was a live runtime defect rather than a stale annotation: reading an
 * undeclared field yields `undefined`, and `undefined` compares equal to
 * nothing, so each filter silently matched zero rows and each render produced
 * an empty or literal-`undefined` surface.
 *
 *   1. snapshotEngine.createProposalSnapshot filtered BlockLinks on
 *      `linked_entity_type` / `linked_entity_id`. Schema §5 names those columns
 *      `entity_type` / `entity_id`. Every comparison was `undefined === 'proposal'`,
 *      so EVERY proposal snapshot froze zero blocks — the immutable record
 *      captured at "sent" contained none of the proposal's content blocks.
 *      It also read approval off the Block; schema §4 keeps approval on the
 *      BlockRevision, and the block's live revision is `current_revision_id`.
 *
 *   2. mappingEngine omitted `execution_version` when composing its
 *      ExecutionProject. executionEngine sets it to 1 in both of its own
 *      constructors. ExecutionDashboard renders `v{execution_version}` and
 *      qbrEngine copies it into the QBR delivery-performance section, so a
 *      mapping-engine project rendered "vundefined".
 *
 *   3. ExecutionDashboard filtered milestones on `m.workstream_id`. A Milestone
 *      is phase-scoped and declares no such field; the ExecutionTask is the only
 *      edge between a workstream and a milestone. Every workstream card rendered
 *      an empty milestone list, and — because gates are derived from that list —
 *      an empty gate list too.
 *
 *   4. SettingsPage's two demo fixtures described a different settings product
 *      (companyName / companyEmail / reportFrom* / emailNotifications) than the
 *      one the page renders and the server serves (brandingName /
 *      defaultAssignee / autoAssign / notificationPrefs). With the backend
 *      disabled, or on an API error, the notification panel had no preferences
 *      to render.
 *
 *   5. QuickActions declared a private status vocabulary — 'reviewing' and
 *      'sent' — where the canonical Submission vocabulary is
 *      new | in-review | completed | approved. Approve stayed disabled, and the
 *      'a' shortcut stayed dead, for every submission actually in review.
 *
 * TESTING APPROACH
 *   snapshotEngine.ts has only `import type` dependencies, so the runner
 *   (`node --experimental-strip-types`) can import it and defect 1 is proven
 *   BEHAVIOURALLY, against real output. The other four live in .tsx components
 *   or in modules with runtime `@/*` alias imports that the runner cannot
 *   resolve and does not transform, so — following the established pattern in
 *   frontendRuntimeDefects / clientPortalAuthContract / teamSessionKeys — each
 *   is enforced structurally against the production source, with pattern-based
 *   assertions rather than line numbers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  createProposalSnapshot,
  SNAPSHOT_STORE,
} from '../../src/app/core/snapshotEngine.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SNAPSHOT FREEZE — behavioural
// ─────────────────────────────────────────────────────────────────────────────

/** A BlockState carrying one accepted revision, linked to `proposalId`. */
function blockStateFixture(proposalId: string) {
  return {
    block: {
      block_id:            'B-1',
      block_type:          'executive_brief',
      title:               'Executive Brief',
      content_format:      'rich_text',
      content:             { text: 'the brief' },
      status:              'approved',
      source:              'human',
      owner_user_id:       'U-01',
      created_at:          '2026-01-01T00:00:00.000Z',
      updated_at:          '2026-01-02T00:00:00.000Z',
      current_revision_id: 'R-1B',
      version:             2,
    },
    revisions: [
      {
        revision_id: 'R-1B', block_id: 'B-1', change_type: 'edit',
        proposed_content: { text: 'the brief' }, diff_summary: 'tightened',
        created_by: 'U-01', created_by_type: 'human',
        created_at: '2026-01-02T00:00:00.000Z',
        approval_status: 'accepted',
        approved_by: 'U-07', approved_at: '2026-01-02T09:30:00.000Z',
      },
      {
        revision_id: 'R-1A', block_id: 'B-1', change_type: 'create',
        proposed_content: { text: 'first cut' }, diff_summary: 'created',
        created_by: 'U-01', created_by_type: 'human',
        created_at: '2026-01-01T00:00:00.000Z',
        approval_status: 'accepted',
        approved_by: 'U-02', approved_at: '2026-01-01T10:00:00.000Z',
      },
    ],
    links: [
      {
        link_id: 'L-1', block_id: 'B-1',
        entity_type: 'proposal', entity_id: proposalId,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    lock: null,
    pending_revision: null,
  } as never;
}

function draftFixture(proposalId: string) {
  return {
    proposal_id: proposalId,
    executive_brief: {
      title: 'Acme Corp', strategic_context: 'ctx', why_now: 'now',
      what_success_looks_like: 'success', positioning_statement: 'pos',
    },
    diagnosis_blocks: [],
    scope_boundaries: { included: ['a'], excluded: ['b'], assumptions: ['c'] },
    next_step_offer: {
      offer_name: 'Sprint', price: 1000, currency: 'GBP',
      duration: '2w', primary_cta: 'Book', secondary_cta: 'Ask',
    },
  } as never;
}

describe('snapshot freeze captures the proposal\'s blocks', () => {
  it('freezes a block linked to this proposal through entity_type/entity_id', () => {
    SNAPSHOT_STORE.length = 0;
    const snapshot = createProposalSnapshot(
      draftFixture('P-1'),
      [blockStateFixture('P-1')],
      'U-01',
    );

    // The defect: this array was empty for every proposal ever snapshotted.
    assert.equal(
      snapshot.content_snapshot.blocks.length, 1,
      'a block linked to this proposal must be frozen into the snapshot',
    );
    assert.equal(snapshot.content_snapshot.blocks[0].block_id, 'B-1');
  });

  it('freezes the block title as the frozen label', () => {
    SNAPSHOT_STORE.length = 0;
    const snapshot = createProposalSnapshot(
      draftFixture('P-1'), [blockStateFixture('P-1')], 'U-01',
    );
    // Block declares `title`; FrozenBlock declares `label`. Reading `block.label`
    // froze `undefined` as the label of every block.
    assert.equal(snapshot.content_snapshot.blocks[0].label, 'Executive Brief');
  });

  it('freezes approval from the block\'s current revision, not the block', () => {
    SNAPSHOT_STORE.length = 0;
    const snapshot = createProposalSnapshot(
      draftFixture('P-1'), [blockStateFixture('P-1')], 'U-01',
    );
    const frozen = snapshot.content_snapshot.blocks[0];
    // R-1B is current_revision_id. R-1A is the superseded revision and its
    // approver (U-02) must NOT be the one reported.
    assert.equal(frozen.approved_by, 'U-07');
    assert.equal(frozen.approved_at, '2026-01-02T09:30:00.000Z');
  });

  it('does not freeze a block linked to a different proposal', () => {
    SNAPSHOT_STORE.length = 0;
    const snapshot = createProposalSnapshot(
      draftFixture('P-1'), [blockStateFixture('P-OTHER')], 'U-01',
    );
    assert.equal(
      snapshot.content_snapshot.blocks.length, 0,
      'the proposal filter must still exclude other proposals\' blocks',
    );
  });

  it('never reads the non-existent linked_entity_* fields', () => {
    const source = stripComments(readSource('src/app/core/snapshotEngine.ts'));
    assert.ok(
      !/linked_entity_type|linked_entity_id/.test(source),
      'BlockLink declares entity_type/entity_id — schema §5 has no linked_entity_* column',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXECUTION VERSION — structural
// ─────────────────────────────────────────────────────────────────────────────

describe('a mapped execution project carries an execution_version', () => {
  it('mappingEngine sets execution_version on the composed project', () => {
    const source = stripComments(readSource('src/app/core/mappingEngine.ts'));
    const composed = source.match(
      /const\s+project:\s*ExecutionProject\s*=\s*\{[\s\S]*?\n\s*\};/,
    );
    assert.ok(composed, 'expected mappingEngine to compose an ExecutionProject');
    assert.match(
      composed[0], /execution_version:\s*1\s*,/,
      'a freshly mapped execution starts at v1 — the scope engine increments from there',
    );
  });

  it('executionEngine still agrees that a new project starts at v1', () => {
    const source = stripComments(readSource('src/app/core/executionEngine.ts'));
    assert.ok(
      /execution_version:\s*1\s*,/.test(source),
      'executionEngine is the reference for the v1 starting value',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WORKSTREAM → MILESTONE EDGE — structural
// ─────────────────────────────────────────────────────────────────────────────

describe('workstream milestones are derived through tasks', () => {
  const dashboard = stripComments(readSource('src/app/components/ExecutionDashboard.tsx'));

  it('never filters milestones on a workstream_id they do not declare', () => {
    assert.ok(
      !/milestones\.filter\(\s*m\s*=>\s*m\.workstream_id/.test(dashboard),
      'Milestone is phase-scoped and declares no workstream_id',
    );
  });

  it('derives the workstream\'s milestone ids from its tasks', () => {
    assert.ok(
      /wsMilestoneIds\s*=\s*new Set\(\s*wsTasks\.map\(\s*t\s*=>\s*t\.milestone_id\s*\)\s*\)/.test(dashboard),
      'the ExecutionTask carries both workstream_id and milestone_id — it is the only edge',
    );
    assert.ok(
      /milestones\.filter\(\s*m\s*=>\s*wsMilestoneIds\.has\(\s*m\.milestone_id\s*\)\s*\)/.test(dashboard),
      'milestones must be selected by that derived id set',
    );
  });

  it('Milestone still declares no workstream_id, so the derivation stays necessary', () => {
    const engine = stripComments(readSource('src/app/core/executionEngine.ts'));
    const decl = engine.match(/export interface Milestone\s*\{[\s\S]*?\n\}/);
    assert.ok(decl, 'expected a Milestone interface');
    assert.ok(
      !/workstream_id/.test(decl[0]),
      'if Milestone ever gains a workstream_id, this derivation should be revisited deliberately',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SETTINGS DEMO FIXTURES — structural
// ─────────────────────────────────────────────────────────────────────────────

describe('the settings demo fixtures match the served contract', () => {
  const settings = stripComments(readSource('src/app/components/SettingsPage.tsx'));

  it('carries no field from the invented settings shape', () => {
    for (const field of [
      'companyName', 'companyEmail', 'reportFromName', 'reportFromEmail',
      'emailDeliveryMethod', 'emailSubjectLine', 'smtpConfigured',
      'emailNotifications',
    ]) {
      assert.ok(
        !new RegExp(`\\b${field}\\b`).test(settings),
        `${field} is not part of PlatformSettings and this page never reads it`,
      );
    }
  });

  it('every demo fixture supplies the fields the page actually renders', () => {
    // There is ONE fixture now, and deliberately so. It used to be two: the
    // second stood in for a FAILED load whenever `SHOW_API_ERRORS` was off.
    // On this page that was unsafe — the substituted values render into live
    // form controls and Save writes them back, so a transient failure offered
    // a form pre-filled with settings that were never the user's, one click
    // from overwriting the real configuration. UI Sprint 7 removed it; the
    // assertion below pins that it stays removed.
    const fixtures = settings.match(/platformSettings:\s*\{\n[\s\S]*?\n\s{4}\},/g);
    assert.ok(fixtures && fixtures.length >= 1, 'expected the demo fixture');
    for (const fixture of fixtures) {
      assert.match(fixture, /brandingName:/);
      assert.match(fixture, /defaultAssignee:/);
      assert.match(fixture, /autoAssign:/);
      assert.match(fixture, /notificationPrefs:\s*\{/);
    }
  });

  it('a failed load renders nothing that could be saved', () => {
    const handler = settings.match(/\} catch \(err: any\) \{[\s\S]*?\n {4}\}/);
    assert.ok(handler, 'expected the load error handler');
    assert.ok(
      /setData\(null\)/.test(handler[0]),
      'a failed settings load must clear the form, never substitute a fixture',
    );
    assert.ok(
      !/platformSettings:/.test(handler[0]),
      'the error path must not build a settings fixture the user could save',
    );
  });

  it('the notification preference keys match PlatformSettings', () => {
    const api = stripComments(readSource('src/app/lib/api.ts'));
    const decl = api.match(/export interface PlatformSettings\s*\{[\s\S]*?\n\}/);
    assert.ok(decl, 'expected a PlatformSettings interface');
    const prefs = decl[0].match(/notificationPrefs:\s*\{([\s\S]*?)\};/);
    assert.ok(prefs, 'expected notificationPrefs on PlatformSettings');
    const keys = [...prefs[1].matchAll(/(\w+):\s*boolean/g)].map(m => m[1]);
    assert.ok(keys.length > 0);
    for (const key of keys) {
      assert.ok(
        new RegExp(`${key}:\\s*(true|false)`).test(settings),
        `demo fixtures must supply the ${key} preference the panel renders`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SUBMISSION STATUS VOCABULARY — structural
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickActions speaks the canonical submission vocabulary', () => {
  const quick = stripComments(readSource('src/app/components/QuickActions.tsx'));

  it('declares the same status union as api.Submission', () => {
    const api = stripComments(readSource('src/app/lib/api.ts'));
    const canonical = api.match(/status:\s*('new'[^;]*?);/);
    assert.ok(canonical, 'expected the Submission status union in api.ts');
    const canonicalMembers = new Set(
      [...canonical[1].matchAll(/'([^']+)'/g)].map(m => m[1]),
    );

    const declared = quick.match(/status:\s*('new'[^;]*?);/);
    assert.ok(declared, 'expected a status union on QuickActionsProps');
    const declaredMembers = new Set(
      [...declared[1].matchAll(/'([^']+)'/g)].map(m => m[1]),
    );

    assert.deepEqual(
      [...declaredMembers].sort(), [...canonicalMembers].sort(),
      'QuickActions must not invent a status vocabulary of its own',
    );
  });

  it('gates approve on in-review, the status submissions actually carry', () => {
    assert.ok(
      !/'reviewing'|'sent'/.test(quick),
      "'reviewing' and 'sent' are not submission statuses",
    );
    assert.ok(
      /status === 'new' \|\| status === 'in-review'/.test(quick),
      'the approve shortcut must fire for a submission in review',
    );
    assert.ok(
      /status !== 'new' && status !== 'in-review'/.test(quick),
      'the approve button must be enabled for a submission in review',
    );
  });
});
