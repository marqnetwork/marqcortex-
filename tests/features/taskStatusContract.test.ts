/**
 * PHASE 1B TASK 26 — TaskStatus contract in the two task generators
 *
 * `mappingEngine.step4_mapDeliverablestoTasks` and the private `generateTasks`
 * behind `executionEngine.generateExecution` both derive a task status from the
 * same three-outcome ternary:
 *
 *     const status: TaskStatus =
 *       ms.status === 'complete'    ? 'complete'    :
 *       ms.status === 'in_progress' ? (ti < 2 ? 'complete' : ti === 2 ? 'in_progress' : 'not_started') :
 *       'not_started';
 *
 * `TaskStatus` also admits `'blocked'` and `'skipped'`, and both generators go on
 * to write `blocked_reason: status === 'blocked' ? … : undefined`. Even with the
 * explicit `: TaskStatus` annotation, control-flow analysis narrows the `const`
 * to the initialiser's own literal union — `'complete' | 'in_progress' |
 * 'not_started'` — so each `status === 'blocked'` test had no overlap and raised
 * a TS2367.
 *
 * The fix moves the contract from an annotation to an assertion on the
 * initialiser (`const status = ( … ) as TaskStatus`), which keeps the declared
 * type across the flow without touching the ternary. Nothing observable changed:
 * `'blocked'` was unreachable before the fix and is still unreachable after it,
 * so `blocked_reason` is still `undefined` on every generated task.
 *
 * These tests pin exactly that:
 *   - the generators produce stable, equivalent task arrays for fixture inputs;
 *   - every generated status matches the ternary, milestone by milestone;
 *   - no generated task is `'blocked'`, and every `blocked_reason` is `undefined`.
 *
 * TESTING APPROACH (two documented limitations)
 *
 *   1. executionEngine is exercised for real, but through a runtime-computed
 *      specifier rather than a static import. It type-imports `ProposalSnapshot`
 *      from snapshotEngine, which carries five pre-existing web diagnostics of
 *      its own; a static import would drag those into the node boundary
 *      (tsconfig.node.json) and raise `typecheck:tests` from 10 pre-existing
 *      errors to 16. The compiler does not follow a computed specifier, so the
 *      module's surface is declared locally below instead. The assignability
 *      half is proven where it belongs, by `typecheck:web`. This mirrors the
 *      limitation already recorded in demoSubmissionContract.test.ts.
 *
 *   2. mappingEngine cannot be loaded by the test runner at all: it *value*-
 *      imports `'./executionEngine'` without the `.ts` extension that Node ESM
 *      requires, so `import()` throws ERR_MODULE_NOT_FOUND. Adding the extension
 *      is a source change outside this task's approved scope. Its half of the
 *      contract is therefore verified structurally — the two generators are
 *      shown to share a character-identical status declaration and a
 *      character-identical `blocked_reason` expression, so the runtime proof
 *      obtained from executionEngine transfers to mappingEngine by construction.
 *      Assertions are pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Local mirror of the executionEngine surface this suite touches.
// ---------------------------------------------------------------------------

interface MilestoneShape {
  milestone_id: string;
  title: string;
  status: string;
}

interface GeneratedTask {
  task_id: string;
  workstream_id: string;
  milestone_id: string;
  title: string;
  assigned_role: string;
  owner: string;
  due_date: string;
  status: string;
  priority: string;
  dependency_ids: string[];
  blocked_reason?: string;
}

interface SnapshotFixture {
  proposal_snapshot_id: string;
  proposal_id: string;
  version_number: number;
  version_hash: string;
  created_at: string;
  created_by: string;
  status: string;
  content_snapshot: {
    implementation_phases: {
      phase_name: string;
      start_week: number;
      end_week: number;
      duration: string;
    }[];
  };
}

interface ExecutionEngineModule {
  generateExecution(
    snapshot: SnapshotFixture,
    userId?: string,
  ): { milestones: MilestoneShape[]; tasks: GeneratedTask[] };
}

const resolveUrl = (rel: string) => new URL(rel, import.meta.url).href;
const readSource = (rel: string) => readFileSync(fileURLToPath(resolveUrl(rel)), 'utf8');

const execution = (await import(
  resolveUrl('../../src/app/core/executionEngine.ts')
)) as ExecutionEngineModule;

// ---------------------------------------------------------------------------
// Fixture — the four canonical phases, covering every milestone status the
// ternary can see ('complete', 'in_progress', 'not_started' ×2).
// ---------------------------------------------------------------------------

const PHASES = [
  { phase_name: 'Audit & System Mapping', start_week: 1, end_week: 2, duration: 'Weeks 1–2' },
  { phase_name: 'Build & Configure', start_week: 3, end_week: 5, duration: 'Weeks 3–5' },
  { phase_name: 'Validate & Pilot', start_week: 6, end_week: 8, duration: 'Weeks 6–8' },
  { phase_name: 'Deploy & Review', start_week: 9, end_week: 12, duration: 'Weeks 9–12' },
];

const MILESTONE_STATUSES = ['complete', 'in_progress', 'not_started', 'not_started'];

function snapshotFixture(): SnapshotFixture {
  return {
    proposal_snapshot_id: 'PS-FIX-0001',
    proposal_id: 'P-FIX-0001',
    version_number: 1,
    version_hash: 'fixture-hash',
    created_at: '2025-01-15T09:00:00.000Z',
    created_by: 'U-FIX',
    status: 'immutable',
    content_snapshot: { implementation_phases: PHASES },
  };
}

/** The ternary both generators use, re-derived independently of the source. */
function expectedStatus(milestoneStatus: string, taskIndex: number): string {
  if (milestoneStatus === 'complete') return 'complete';
  if (milestoneStatus === 'in_progress') {
    return taskIndex < 2 ? 'complete' : taskIndex === 2 ? 'in_progress' : 'not_started';
  }
  return 'not_started';
}

/** Task ids and `due_date` are counter/clock derived, so equivalence is checked
 *  on the stable shape with every id replaced by its positional index. */
function normalise(tasks: GeneratedTask[], milestones: MilestoneShape[]) {
  const taskOrder = new Map(tasks.map((t, i) => [t.task_id, i]));
  const msOrder = new Map(milestones.map((m, i) => [m.milestone_id, i]));
  return tasks.map(t => ({
    index: taskOrder.get(t.task_id),
    milestone_index: msOrder.get(t.milestone_id),
    title: t.title,
    assigned_role: t.assigned_role,
    owner: t.owner,
    status: t.status,
    priority: t.priority,
    dependency_indices: t.dependency_ids.map(id => taskOrder.get(id) ?? null),
    blocked_reason: t.blocked_reason,
  }));
}

// ---------------------------------------------------------------------------
// executionEngine — exercised for real
// ---------------------------------------------------------------------------

describe('generateExecution tasks — task status contract', () => {
  const project = execution.generateExecution(snapshotFixture(), 'U-FIX');
  const { milestones, tasks } = project;

  it('derives milestone statuses complete / in_progress / not_started', () => {
    assert.deepEqual(milestones.map(m => m.status), MILESTONE_STATUSES);
  });

  it('generates a task batch for every milestone', () => {
    assert.equal(tasks.length, 17); // 4 + 5 + 4 + 4 from TASK_TEMPLATES
    for (const ms of milestones) {
      assert.ok(
        tasks.some(t => t.milestone_id === ms.milestone_id),
        `no tasks generated for ${ms.title}`,
      );
    }
  });

  it('assigns exactly the status the ternary yields', () => {
    for (const ms of milestones) {
      const batch = tasks.filter(t => t.milestone_id === ms.milestone_id);
      assert.ok(batch.length > 0, `no tasks generated for ${ms.title}`);
      assert.deepEqual(
        batch.map(t => t.status),
        batch.map((_t, ti) => expectedStatus(ms.status, ti)),
        `status drifted for ${ms.title}`,
      );
    }
  });

  it('keeps the recorded status sequence for the canonical four phases', () => {
    const byMilestone = milestones.map(ms =>
      tasks.filter(t => t.milestone_id === ms.milestone_id).map(t => t.status),
    );
    assert.deepEqual(byMilestone, [
      ['complete', 'complete', 'complete', 'complete'],
      ['complete', 'complete', 'in_progress', 'not_started', 'not_started'],
      ['not_started', 'not_started', 'not_started', 'not_started'],
      ['not_started', 'not_started', 'not_started', 'not_started'],
    ]);
  });

  it('never emits a blocked task', () => {
    assert.equal(tasks.some(t => t.status === 'blocked'), false);
  });

  it('leaves blocked_reason undefined on every task', () => {
    for (const t of tasks) {
      assert.equal(t.blocked_reason, undefined, `${t.title} carried a blocked_reason`);
      assert.equal(
        Object.prototype.hasOwnProperty.call(t, 'blocked_reason'),
        true,
        'blocked_reason key was dropped from the generated task',
      );
    }
  });

  it('produces an equivalent task array for an equivalent input', () => {
    const again = execution.generateExecution(snapshotFixture(), 'U-FIX');
    assert.deepEqual(
      normalise(again.tasks, again.milestones),
      normalise(tasks, milestones),
    );
  });
});

// ---------------------------------------------------------------------------
// mappingEngine — verified structurally against its runtime-proven twin
// ---------------------------------------------------------------------------

const MAPPING_REL = '../../src/app/core/mappingEngine.ts';
const EXECUTION_REL = '../../src/app/core/executionEngine.ts';

/** The `const status = ( … ) as TaskStatus;` declaration, whitespace-collapsed. */
function statusDeclaration(rel: string): string {
  const code = readSource(rel);
  const start = code.indexOf('const status = (');
  assert.notEqual(start, -1, `${rel}: the status declaration was renamed or removed`);
  const end = code.indexOf('as TaskStatus;', start);
  assert.notEqual(end, -1, `${rel}: the status declaration lost its TaskStatus contract`);
  return code.slice(start, end + 'as TaskStatus;'.length).replace(/\s+/g, ' ');
}

/** The `blocked_reason:` property assignment, whitespace-collapsed. */
function blockedReasonExpression(rel: string): string {
  const code = readSource(rel);
  const start = code.indexOf('blocked_reason:');
  assert.notEqual(start, -1, `${rel}: blocked_reason was removed from the generated task`);
  const end = code.indexOf('\n', start);
  return code.slice(start, end).replace(/\s+/g, ' ').trim();
}

describe('mappingEngine step 4 shares the executionEngine contract', () => {
  it('declares status with the identical ternary and TaskStatus assertion', () => {
    assert.equal(statusDeclaration(MAPPING_REL), statusDeclaration(EXECUTION_REL));
  });

  it('applies the contract as an assertion, not a narrowing annotation', () => {
    for (const rel of [MAPPING_REL, EXECUTION_REL]) {
      const decl = statusDeclaration(rel);
      assert.match(decl, /^const status = \( ms\.status === 'complete'/, `${rel}: ternary changed`);
      assert.match(decl, /\) as TaskStatus;$/, `${rel}: contract is not an assertion`);
      assert.equal(
        readSource(rel).includes('const status: TaskStatus ='),
        false,
        `${rel}: the narrowing annotation is back`,
      );
    }
  });

  it('preserves the ternary branches verbatim', () => {
    const decl = statusDeclaration(MAPPING_REL);
    assert.ok(decl.includes("ms.status === 'complete' ? 'complete' :"));
    assert.ok(
      decl.includes(
        "ms.status === 'in_progress' ? (ti < 2 ? 'complete' : ti === 2 ? 'in_progress' : 'not_started') :",
      ),
    );
    assert.ok(decl.includes("'not_started' )"));
  });

  it('keeps the identical blocked_reason expression', () => {
    assert.equal(blockedReasonExpression(MAPPING_REL), blockedReasonExpression(EXECUTION_REL));
    assert.equal(
      blockedReasonExpression(MAPPING_REL),
      "blocked_reason: status === 'blocked' ? 'Awaiting prior task completion' : undefined,",
    );
  });

  it('never assigns a blocked status to a generated task', () => {
    for (const rel of [MAPPING_REL, EXECUTION_REL]) {
      assert.equal(
        readSource(rel).includes("status: 'blocked'"),
        false,
        `${rel}: a generator started emitting blocked tasks`,
      );
    }
  });
});
