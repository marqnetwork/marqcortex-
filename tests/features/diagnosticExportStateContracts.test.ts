/**
 * FRONTEND STATE CONTRACTS, PART 2 — seven further defects where a component
 * read, passed or wired a value the canonical contract does not support.
 *
 * As in proposalExecutionStateContracts, each surfaced as a `typecheck:web`
 * diagnostic and each was a live defect, not a stale annotation:
 *
 *   1. CortexDashboardSections fed the AI toolbar
 *      `String(data.lead?.employeeEstimate ?? '')` as the lead's companySize, at
 *      three call sites. Lead declares `companySize` and no `employeeEstimate`,
 *      so every AI assist in the Cortex dashboard was sent an EMPTY company
 *      size — a silently degraded prompt, not an error.
 *
 *   2. The same toolbar read `v2.core_problem.why_first`. why_first lives on
 *      `strategic_decision` (the component renders it from there elsewhere in
 *      the same file), so the recommendation's reasoning reached the model as
 *      an empty string.
 *
 *   3. DiagnosticForm carried a `type === 'select'` branch reading
 *      `currentQuestion.options`. The canonical QuestionDef declares no
 *      `options`, and all 98 questions across all seven industry banks are
 *      `textarea` — the branch was unreachable, and contradicted canon.
 *
 *   4. DiagnosticQuestion mounted ProgressModal without `isOpen`. ProgressModal
 *      gates its entire body on that flag, so the 25/50/75% milestone modal
 *      never rendered at all.
 *
 *   5. EditableBlockCard passed `handleSave` straight to RichTextEditor.
 *      RichTextEditor yields the raw TEXT; handleSave forwards its first
 *      argument to onEdit as the block's whole CONTENT record. Every rich-text
 *      edit therefore replaced `{ text: '...' }` with a bare string, after which
 *      `block.content.text` was undefined and the block rendered "Empty".
 *
 *   6. InstantBooking's CountdownTimer drove its interval from `useState`, not
 *      `useEffect`. A lazy useState initialiser runs once and its return value
 *      becomes STATE — so the teardown was never a cleanup, the second argument
 *      was ignored, and the interval kept firing setTimeLeft after unmount.
 *
 *   7. ExportPanel passed `title` to a lucide icon, which renders an <svg> and
 *      accepts no such prop, so the "Immutable snapshot" tooltip was dropped.
 *
 *   8. mockCortexData's industry recommendation config returned three service
 *      ids that exist in no canon — 'onboarding-automation',
 *      'founder-leverage-package', 'compliance-systems-audit' — where
 *      ServiceRecommendation.primaryService is a ServiceType keying typed logic
 *      such as getServiceLabel, whose switch has no arm for an id off the union.
 *
 * TESTING APPROACH
 *   Every module here is a .tsx component or is bound to runtime `@/*` aliases
 *   the runner cannot resolve, so — following the established pattern in
 *   frontendRuntimeDefects / frontendIconContracts / clientPortalAuthContract —
 *   each guarantee is enforced structurally against the production source, with
 *   pattern-based assertions rather than line numbers.
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
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1–2. AI TOOLBAR LEAD CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('the AI toolbar is given real lead context', () => {
  const sections = stripComments(readSource('src/app/components/CortexDashboardSections.tsx'));
  const types    = stripComments(readSource('src/app/types/cortex-types.ts'));

  it('reads companySize, the field Lead declares', () => {
    assert.ok(
      !/employeeEstimate/.test(sections),
      'Lead declares companySize; employeeEstimate exists on no lead type',
    );
    const sites = [...sections.matchAll(/companySize:\s*([^\n]+)/g)].map(m => m[1]);
    assert.equal(sites.length, 3, 'expected all three AI toolbar call sites');
    for (const site of sites) {
      assert.match(
        site, /data\.lead\?\.companySize/,
        'every toolbar call site must pass the lead\'s real company size',
      );
    }
  });

  it('Lead still declares companySize and not employeeEstimate', () => {
    const decl = types.match(/export interface Lead\s*\{[\s\S]*?\n\}/);
    assert.ok(decl, 'expected a Lead interface');
    assert.match(decl[0], /companySize:\s*string/);
    assert.ok(!/employeeEstimate/.test(decl[0]));
  });

  it('reads why_first from strategic_decision, where it lives', () => {
    assert.ok(
      !/core_problem\.why_first/.test(sections),
      'why_first is a strategic_decision field, not a core_problem field',
    );
    assert.ok(
      /Reasoning: \$\{v2\.strategic_decision\.why_first/.test(sections),
      'the toolbar\'s reasoning must come from strategic_decision.why_first',
    );
  });

  it('core_problem still declares no why_first, so the correction stays necessary', () => {
    const coreTypes = stripComments(readSource('src/app/core/types.ts'));
    const decl = coreTypes.match(/core_problem:\s*\{[\s\S]*?\n\s*\};/);
    assert.ok(decl, 'expected a core_problem block');
    assert.ok(!/why_first/.test(decl[0]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE DIAGNOSTIC IS A FREE-TEXT INSTRUMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('the diagnostic form matches the canonical question shape', () => {
  const form     = stripComments(readSource('src/app/components/DiagnosticForm.tsx'));
  const registry = stripComments(readSource('src/app/utils/questionRegistry.ts'));

  it('QuestionDef declares no options field', () => {
    const decl = registry.match(/export interface QuestionDef\s*\{[\s\S]*?\n\}/);
    assert.ok(decl, 'expected a QuestionDef interface');
    assert.ok(
      !/options/.test(decl[0]),
      'if choice questions are introduced, QuestionDef must declare them first',
    );
  });

  it('every question in the form is a textarea question', () => {
    const types = new Set([...form.matchAll(/type:\s*'([a-z]+)'/g)].map(m => m[1]));
    assert.deepEqual([...types], ['textarea']);
  });

  it('the form carries no unreachable select branch', () => {
    assert.ok(!/currentQuestion\.options/.test(form));
    assert.ok(!/currentQuestion\.type === 'select'/.test(form));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE PROGRESS MODAL CAN ACTUALLY OPEN
// ─────────────────────────────────────────────────────────────────────────────

describe('the diagnostic progress modal opens', () => {
  const question = stripComments(readSource('src/app/components/DiagnosticQuestion.tsx'));
  const modal    = stripComments(readSource('src/app/components/ProgressModal.tsx'));

  it('ProgressModal still gates its body on isOpen', () => {
    assert.match(modal, /isOpen:\s*boolean/, 'isOpen is a required prop');
    assert.ok(
      /\{isOpen && \(/.test(modal),
      'the component renders nothing at all when isOpen is falsy',
    );
  });

  it('the caller passes isOpen', () => {
    const site = question.match(/<ProgressModal[\s\S]*?\/>/);
    assert.ok(site, 'expected a ProgressModal render site');
    assert.match(
      site[0], /isOpen=\{showModal\}/,
      'without isOpen the milestone modal never renders',
    );
    assert.match(site[0], /milestone=\{modalMilestone\}/);
    assert.match(site[0], /onClose=/);
  });

  it('stays mounted so AnimatePresence can run its exit', () => {
    assert.ok(
      !/\{showModal && \(\s*<ProgressModal/.test(question),
      'conditionally mounting it defeats the exit animation it is built around',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. A RICH-TEXT EDIT DOES NOT DESTROY THE BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('editing a rich-text block preserves its content record', () => {
  const card = stripComments(readSource('src/app/components/EditableBlockCard.tsx'));

  it('RichTextEditor still yields raw text, not a content record', () => {
    const decl = card.match(/function RichTextEditor\(\{[\s\S]*?\n\}\)/);
    assert.ok(decl, 'expected the RichTextEditor declaration');
    assert.match(
      decl[0], /onSave:\s*\(text:\s*string,\s*diffSummary:\s*string\)/,
      'if this ever yields a record, the wrapping at the call site should be revisited',
    );
  });

  it('the call site re-wraps that text into the block content record', () => {
    const site = card.match(/<RichTextEditor[\s\S]*?\/>/);
    assert.ok(site, 'expected a RichTextEditor render site');
    assert.ok(
      !/onSave=\{handleSave\}/.test(site[0]),
      'handleSave takes a content record — passing it raw text replaced the record with a string',
    );
    assert.match(
      site[0],
      /onSave=\{\(text, diffSummary\) =>\s*handleSave\(\{ \.\.\.editorInitialContent, text \}, diffSummary\)\}/,
    );
  });

  it('the structured editor, which already yields a record, is unchanged', () => {
    const site = card.match(/<StructuredJsonEditor[\s\S]*?\/>/);
    assert.ok(site, 'expected a StructuredJsonEditor render site');
    assert.match(site[0], /onSave=\{handleSave\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE COUNTDOWN INTERVAL IS CLEANED UP
// ─────────────────────────────────────────────────────────────────────────────

describe('the booking countdown clears its interval', () => {
  const booking = stripComments(readSource('src/app/components/InstantBooking.tsx'));

  it('drives the interval from useEffect', () => {
    const timer = booking.match(/function CountdownTimer\([\s\S]*?\n\}/);
    assert.ok(timer, 'expected a CountdownTimer component');
    assert.ok(
      !/useState\(\(\) => \{[\s\S]*?setInterval/.test(timer[0]),
      'a lazy useState initialiser stores its return value as state — it is never a cleanup',
    );
    assert.ok(
      /useEffect\(\(\) => \{[\s\S]*?setInterval[\s\S]*?return \(\) => clearInterval\(interval\);[\s\S]*?\}, \[\]\)/.test(timer[0]),
      'the interval must be created in an effect and cleared on unmount',
    );
  });

  it('imports useEffect', () => {
    assert.match(booking, /import \{[^}]*useEffect[^}]*\} from 'react'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE SNAPSHOT TOOLTIP SURVIVES
// ─────────────────────────────────────────────────────────────────────────────

describe('the immutable-snapshot tooltip is rendered', () => {
  const panel = stripComments(readSource('src/app/components/ExportPanel.tsx'));

  it('does not pass title to a lucide icon, which drops it', () => {
    assert.ok(
      !/<Lock[^>]*title=/.test(panel),
      'a lucide icon renders an <svg> and accepts no title prop',
    );
  });

  it('carries the tooltip on a wrapping element instead', () => {
    assert.ok(
      /<span title="Immutable snapshot" aria-label="Immutable snapshot"[^>]*>\s*<Lock/.test(panel),
      'the tooltip must survive as both a tooltip and an accessible name',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MOCK SERVICE IDS ARE CANONICAL
// ─────────────────────────────────────────────────────────────────────────────

describe('mock recommendations name canonical services', () => {
  const mock  = stripComments(readSource('src/app/utils/mockCortexData.ts'));
  const types = stripComments(readSource('src/app/types/cortex-types.ts'));

  const union = types.match(/export type ServiceType\s*=([\s\S]*?);/);
  const canonical = new Set([...union![1].matchAll(/'([^']+)'/g)].map(m => m[1]));

  it('every primaryService in the mock config is a ServiceType', () => {
    assert.ok(canonical.size > 0, 'expected a ServiceType union');
    const config = mock.match(
      /const getIndustryRecommendationConfig[\s\S]*?\n\};/,
    );
    assert.ok(config, 'expected the industry recommendation config');
    const ids = [...config[0].matchAll(/primaryService:\s*'([^']+)'/g)].map(m => m[1]);
    assert.ok(ids.length >= 5, 'expected every industry arm plus the default');
    for (const id of ids) {
      assert.ok(
        canonical.has(id),
        `'${id}' is not a ServiceType — getServiceLabel has no arm for it`,
      );
    }
  });

  it('the config declares ServiceType, so it cannot drift again', () => {
    assert.match(
      mock,
      /const getIndustryRecommendationConfig = \([^)]*\): \{\s*primaryService: ServiceType;/,
    );
  });

  it('getServiceLabel still covers exactly the union', () => {
    const fn = types.match(/export const getServiceLabel[\s\S]*?\n\};/);
    assert.ok(fn, 'expected getServiceLabel');
    const arms = new Set([...fn[0].matchAll(/case '([^']+)':/g)].map(m => m[1]));
    assert.deepEqual([...arms].sort(), [...canonical].sort());
  });
});
