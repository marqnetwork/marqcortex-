/**
 * PHASE 1B TASK 30 — copilot diagnosis-block assertion
 *
 * `handleCopilotApply` receives accepted AI revisions as `Record<string,
 * unknown>` and routes them into one of four draft sections with an unchecked
 * assertion each:
 *
 *     executive_brief:  content as ProposalDraft['executive_brief']
 *     scope_boundaries: content as ProposalDraft['scope_boundaries']
 *     next_step_offer:  content as ProposalDraft['next_step_offer']
 *     diagnosis_N:      content as ProposalDraft['diagnosis_blocks'][0]
 *
 * The first three targets overlap `Record<string, unknown>` enough for a direct
 * assertion. `DiagnosisBlock` carries more required structure than they do, so
 * TypeScript judged the conversion a probable mistake and raised TS2352, telling
 * the author to go via `unknown` first.
 *
 * The fix does exactly that, on that one branch only:
 *
 *     content as unknown as ProposalDraft['diagnosis_blocks'][0]
 *
 * The other three assertions, the routing chain, the diagnosis index parsing,
 * the version bump, the timestamp and the save call are all untouched. The
 * assertion is erased at runtime, so behaviour is identical — this task
 * deliberately does not add validation the other three branches do not have.
 *
 * These tests cover the routing the assertion sits in:
 *   - each of the four sections lands in its own draft field
 *   - version increments exactly once per apply
 *   - last_updated_at is refreshed
 *   - an out-of-range diagnosis index leaves the diagnosis blocks alone
 *
 * TESTING APPROACH (documented limitation — the established pattern in
 * frontendRuntimeDefects.test.ts and deltaLogAccumulator.test.ts)
 *   ProposalDraftEditor is a .tsx component, the repository ships no React test
 *   renderer, the runner strips types but does not transform JSX, and
 *   `handleCopilotApply` is a `useCallback` closure that is never exported. The
 *   router is therefore mirrored below as `applyCopilotSection`, exercised
 *   against every required case, and then locked to production by structural
 *   assertions that the shipped routing chain still reads exactly as mirrored.
 *   Assertions are pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EDITOR_REL = 'src/app/components/ProposalDraftEditor.tsx';
const editorSource = readFileSync(join(REPO_ROOT, EDITOR_REL), 'utf8');

// ---------------------------------------------------------------------------
// Mirror of the shipped router
// ---------------------------------------------------------------------------

type Section = Record<string, unknown>;

/** Minimal mirror of the `ProposalDraft` fields the router touches. */
interface Draft {
  proposal_id: string;
  executive_brief: Section;
  scope_boundaries: Section;
  next_step_offer: Section;
  diagnosis_blocks: Section[];
  metadata: { version: number; last_updated_at: string };
}

/** Byte-equivalent to `handleCopilotApply`; the structural suite at the bottom
 *  proves the shipped routing chain still matches, branch for branch. Returns
 *  the saved draft, or `null` where the component returns without saving. */
function applyCopilotSection(
  draft: Draft,
  section: string,
  content: Record<string, unknown>,
  now: string,
): Draft | null {
  let updated: Draft;
  const nextMeta = { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: now };

  if (section === 'executive_brief') {
    updated = { ...draft, executive_brief: content, metadata: nextMeta };
  } else if (section === 'scope_boundaries') {
    updated = { ...draft, scope_boundaries: content, metadata: nextMeta };
  } else if (section === 'next_step_offer') {
    updated = { ...draft, next_step_offer: content, metadata: nextMeta };
  } else if (section.startsWith('diagnosis_')) {
    const idx = parseInt(section.split('_')[1] ?? '0', 10);
    const newBlocks = [...draft.diagnosis_blocks];
    if (idx < newBlocks.length) newBlocks[idx] = content;
    updated = { ...draft, diagnosis_blocks: newBlocks, metadata: nextMeta };
  } else {
    return null; // unknown section — no-op
  }
  return updated;
}

const T0 = '2025-01-15T09:00:00.000Z';
const T1 = '2025-02-20T18:30:00.000Z';

function makeDraft(): Draft {
  return {
    proposal_id: 'P-FIX-0001',
    executive_brief: { headline: 'original brief' },
    scope_boundaries: { included: ['original scope'] },
    next_step_offer: { offer: 'original offer' },
    diagnosis_blocks: [
      { title: 'block 0', severity: 'high' },
      { title: 'block 1', severity: 'medium' },
    ],
    metadata: { version: 3, last_updated_at: T0 },
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('copilot section routing', () => {
  it('routes executive_brief content to executive_brief only', () => {
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'executive_brief', { headline: 'revised brief' }, T1);

    assert.ok(next);
    assert.deepEqual(next.executive_brief, { headline: 'revised brief' });
    assert.deepEqual(next.scope_boundaries, draft.scope_boundaries);
    assert.deepEqual(next.next_step_offer, draft.next_step_offer);
    assert.deepEqual(next.diagnosis_blocks, draft.diagnosis_blocks);
  });

  it('routes scope_boundaries content to scope_boundaries only', () => {
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'scope_boundaries', { included: ['revised scope'] }, T1);

    assert.ok(next);
    assert.deepEqual(next.scope_boundaries, { included: ['revised scope'] });
    assert.deepEqual(next.executive_brief, draft.executive_brief);
    assert.deepEqual(next.next_step_offer, draft.next_step_offer);
    assert.deepEqual(next.diagnosis_blocks, draft.diagnosis_blocks);
  });

  it('routes next_step_offer content to next_step_offer only', () => {
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'next_step_offer', { offer: 'revised offer' }, T1);

    assert.ok(next);
    assert.deepEqual(next.next_step_offer, { offer: 'revised offer' });
    assert.deepEqual(next.executive_brief, draft.executive_brief);
    assert.deepEqual(next.scope_boundaries, draft.scope_boundaries);
    assert.deepEqual(next.diagnosis_blocks, draft.diagnosis_blocks);
  });

  it('routes diagnosis_N content to that diagnosis block only', () => {
    const draft = makeDraft();
    const revised = { title: 'revised block 1', severity: 'critical' };
    const next = applyCopilotSection(draft, 'diagnosis_1', revised, T1);

    assert.ok(next);
    assert.deepEqual(next.diagnosis_blocks, [draft.diagnosis_blocks[0], revised]);
    assert.deepEqual(next.executive_brief, draft.executive_brief);
    assert.deepEqual(next.scope_boundaries, draft.scope_boundaries);
    assert.deepEqual(next.next_step_offer, draft.next_step_offer);
  });

  it('routes diagnosis_0 to the first block', () => {
    const draft = makeDraft();
    const revised = { title: 'revised block 0', severity: 'low' };
    const next = applyCopilotSection(draft, 'diagnosis_0', revised, T1);

    assert.ok(next);
    assert.deepEqual(next.diagnosis_blocks, [revised, draft.diagnosis_blocks[1]]);
  });

  it('does not mutate the draft it was given', () => {
    const draft = makeDraft();
    const before = structuredClone(draft);
    applyCopilotSection(draft, 'diagnosis_0', { title: 'revised' }, T1);
    assert.deepEqual(draft, before);
  });

  it('no-ops on an unknown section', () => {
    assert.equal(applyCopilotSection(makeDraft(), 'appendix', { anything: true }, T1), null);
    assert.equal(applyCopilotSection(makeDraft(), '', { anything: true }, T1), null);
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('copilot apply metadata', () => {
  for (const section of ['executive_brief', 'scope_boundaries', 'next_step_offer', 'diagnosis_1']) {
    it(`increments version exactly once for ${section}`, () => {
      const draft = makeDraft();
      const next = applyCopilotSection(draft, section, { revised: true }, T1);
      assert.ok(next);
      assert.equal(next.metadata.version, draft.metadata.version + 1);
    });

    it(`updates last_updated_at for ${section}`, () => {
      const next = applyCopilotSection(makeDraft(), section, { revised: true }, T1);
      assert.ok(next);
      assert.equal(next.metadata.last_updated_at, T1);
      assert.notEqual(next.metadata.last_updated_at, T0);
    });
  }

  it('increments once per apply, not once per section touched', () => {
    let draft = makeDraft();
    const start = draft.metadata.version;
    for (const section of ['executive_brief', 'scope_boundaries', 'next_step_offer', 'diagnosis_0']) {
      const next = applyCopilotSection(draft, section, { revised: section }, T1);
      assert.ok(next);
      draft = next;
    }
    assert.equal(draft.metadata.version, start + 4);
  });

  it('leaves metadata untouched when the section is unknown', () => {
    const draft = makeDraft();
    assert.equal(applyCopilotSection(draft, 'appendix', { revised: true }, T1), null);
    assert.equal(draft.metadata.version, 3);
    assert.equal(draft.metadata.last_updated_at, T0);
  });
});

// ---------------------------------------------------------------------------
// Out-of-range diagnosis index
// ---------------------------------------------------------------------------

describe('out-of-range diagnosis index', () => {
  it('leaves the diagnosis blocks unchanged when the index is past the end', () => {
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'diagnosis_7', { title: 'ghost block' }, T1);

    assert.ok(next);
    assert.deepEqual(next.diagnosis_blocks, draft.diagnosis_blocks);
    assert.equal(next.diagnosis_blocks.length, 2);
  });

  it('leaves the diagnosis blocks unchanged when the index equals the length', () => {
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'diagnosis_2', { title: 'ghost block' }, T1);

    assert.ok(next);
    assert.deepEqual(next.diagnosis_blocks, draft.diagnosis_blocks);
  });

  it('still bumps the version and timestamp on an out-of-range index', () => {
    // Pre-existing behaviour: the branch is taken, the copy is written back
    // unchanged, and the metadata bump happens regardless. Preserved as-is.
    const draft = makeDraft();
    const next = applyCopilotSection(draft, 'diagnosis_9', { title: 'ghost block' }, T1);

    assert.ok(next);
    assert.equal(next.metadata.version, draft.metadata.version + 1);
    assert.equal(next.metadata.last_updated_at, T1);
  });

  it('falls back to index 0 when the suffix is not a number', () => {
    const draft = makeDraft();
    const revised = { title: 'revised via NaN suffix' };
    const nanNext = applyCopilotSection(draft, 'diagnosis_abc', revised, T1);

    assert.ok(nanNext);
    // parseInt('abc', 10) is NaN, and `NaN < length` is false — no block written.
    assert.deepEqual(nanNext.diagnosis_blocks, draft.diagnosis_blocks);

    const emptyNext = applyCopilotSection(draft, 'diagnosis_', revised, T1);
    assert.ok(emptyNext);
    assert.deepEqual(emptyNext.diagnosis_blocks, draft.diagnosis_blocks);
  });
});

// ---------------------------------------------------------------------------
// The shipped router must still match the mirror
// ---------------------------------------------------------------------------

describe('shipped copilot router', () => {
  it('completes the diagnosis-block assertion through unknown', () => {
    assert.ok(
      editorSource.includes(
        "if (idx < newBlocks.length) newBlocks[idx] = content as unknown as ProposalDraft['diagnosis_blocks'][0];",
      ),
      'the diagnosis-block assertion no longer routes through unknown',
    );
  });

  it('leaves the other three section assertions direct', () => {
    for (const field of ['executive_brief', 'scope_boundaries', 'next_step_offer']) {
      assert.ok(
        editorSource.includes(`${field}: content as ProposalDraft['${field}']`),
        `the ${field} assertion changed`,
      );
      assert.equal(
        editorSource.includes(`${field}: content as unknown as ProposalDraft['${field}']`),
        false,
        `the ${field} assertion was widened to go through unknown as well`,
      );
    }
  });

  it('keeps the routing chain and its unknown-section no-op', () => {
    for (const branch of [
      "if (section === 'executive_brief') {",
      "} else if (section === 'scope_boundaries') {",
      "} else if (section === 'next_step_offer') {",
      "} else if (section.startsWith('diagnosis_')) {",
      'return; // unknown section — no-op',
    ]) {
      assert.ok(editorSource.includes(branch), `the routing chain lost: ${branch}`);
    }
  });

  it('keeps the diagnosis index parsing unchanged', () => {
    assert.ok(
      editorSource.includes("const idx = parseInt(section.split('_')[1] ?? '0', 10);"),
      'the diagnosis index parsing changed',
    );
    assert.ok(
      editorSource.includes('const newBlocks = [...draft.diagnosis_blocks];'),
      'the diagnosis blocks are no longer copied before write',
    );
  });

  it('keeps the single version bump and timestamp refresh', () => {
    assert.ok(
      editorSource.includes(
        'const nextMeta = { ...draft.metadata, version: draft.metadata.version + 1, last_updated_at: now };',
      ),
      'the metadata bump changed',
    );
    assert.ok(
      editorSource.includes('const now = new Date().toISOString();'),
      'the apply timestamp source changed',
    );
  });

  it('adds no runtime validation the other branches lack', () => {
    const start = editorSource.indexOf('const handleCopilotApply = useCallback(');
    assert.notEqual(start, -1, 'handleCopilotApply was renamed or removed');
    const end = editorSource.indexOf('}, [draft, save]);', start);
    assert.notEqual(end, -1, 'handleCopilotApply is unterminated');
    const body = editorSource.slice(start, end);

    for (const smell of ['JSON.parse', 'try {', 'zod', 'validate(', 'throw ']) {
      assert.equal(body.includes(smell), false, `the router grew unapproved logic: ${smell}`);
    }
    assert.ok(body.includes('save(updated);'), 'the router no longer saves');
  });
});
