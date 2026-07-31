/**
 * PHASE 1B TASK 11 — Frontend icon component contract corrections
 *
 * Four TS2322 diagnostics were repaired in this task. Three local icon-holder
 * types declared their icon component as
 *
 *     React.ComponentType<{ className?: string }>
 *
 * — a contract narrower than the runtime values ever were. Every icon assigned
 * to these fields is a real `lucide-react` icon (a `LucideIcon`), and every
 * render site passes both `className` and `style` (the colour). Because the
 * declared type accepted only `className`, TypeScript rejected the `style`
 * prop (TS2322) even though the render was always valid at runtime.
 *
 *   SystemArchitecture.tsx
 *     - ArchLayer.icon      → rendered <layer.icon className style={{ color }} />
 *     - RuleCard icon prop  → rendered <Icon      className style={{ color }} />
 *   PipelineKanban.tsx
 *     - PipelineColumnDef.Icon → rendered <column.Icon / <col.Icon className
 *                                          style={{ color }} /> (two sites)
 *
 * The fix widens each contract to the official `LucideIcon` type imported from
 * `lucide-react` — the narrowest accurate type for the real runtime values,
 * which accepts every SVG prop the render sites already pass (className, style,
 * size, …). No icon was replaced, no visual prop removed, no render changed.
 *
 * TESTING APPROACH (documented limitation)
 *   These are .tsx components. The repository ships no React test renderer, and
 *   the runner (`node --experimental-strip-types`) strips types but does NOT
 *   transform JSX, so the components cannot be imported and rendered here.
 *   Following the established pattern (frontendRuntimeDefects.test.ts /
 *   teamSessionKeys.test.ts), each guarantee is enforced structurally against
 *   the production source: the corrected type contract AND the preserved render
 *   behaviour (icons still rendered, still styled, none removed or replaced).
 *   Assertions are pattern-based, never line-number-based. A compile-time
 *   companion contract (src/app/components/__typechecks__/iconContract.ts,
 *   checked by `typecheck:web`) proves the exported PipelineColumnDef['Icon']
 *   contract at the type level.
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

const ARCH_REL = 'src/app/components/SystemArchitecture.tsx';
const KANBAN_REL = 'src/app/components/PipelineKanban.tsx';

// Task 13 — the remaining three icon holders, same root cause.
const SCENARIO_REL = 'src/app/components/ScenarioPanel.tsx';
const SOLARCH_REL = 'src/app/components/SolutionArchitectureCard.tsx';
const STAGE_REL = 'src/app/components/StageTracker.tsx';

// Task 15 — the GlobalAIChat icon-alias cluster, same family, different mechanism.
const GAC_REL = 'src/app/components/GlobalAIChat.tsx';

// ── Shared: the narrow contract must be gone everywhere ───────────────────────

describe('icon contracts — narrow className-only type is fully retired', () => {
  it('neither component still declares an icon as ComponentType<{ className?: string }>', () => {
    for (const rel of [ARCH_REL, KANBAN_REL]) {
      const code = stripComments(readSource(rel));
      assert.doesNotMatch(
        code,
        /(icon|Icon)\s*:\s*React\.ComponentType<\{\s*className\?:\s*string\s*\}>/,
        `${rel}: an icon field still uses the narrow className-only contract`,
      );
    }
  });

  it('both components import LucideIcon as a type from lucide-react', () => {
    for (const rel of [ARCH_REL, KANBAN_REL]) {
      const code = stripComments(readSource(rel));
      assert.match(
        code,
        /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
        `${rel}: expected a type import of LucideIcon from lucide-react`,
      );
    }
  });
});

// ── SystemArchitecture — ArchLayer.icon + RuleCard icon prop ──────────────────

describe('SystemArchitecture — icon contracts corrected, render preserved', () => {
  const raw = readSource(ARCH_REL);
  const code = stripComments(raw);

  it('ArchLayer.icon is typed as LucideIcon', () => {
    assert.match(code, /icon\s*:\s*LucideIcon\s*;/, 'expected ArchLayer.icon: LucideIcon');
  });

  it('RuleCard still accepts an icon prop typed as LucideIcon', () => {
    // The RuleCard prop object destructures `icon: Icon` and types it LucideIcon.
    assert.match(code, /icon\s*:\s*Icon\b/, 'expected RuleCard to destructure icon: Icon');
    assert.match(
      code,
      /icon\s*:\s*LucideIcon\s*;\s*title\s*:\s*string/,
      'expected RuleCard icon prop typed as LucideIcon',
    );
  });

  it('render behaviour preserved: icons still rendered WITH className and style', () => {
    // Behaviour guard — the exact props that produced the original TS2322 and
    // that we intentionally kept must still be passed, so the icons render
    // styled (colour) exactly as before. If style were dropped the visual
    // colour would change; this fails if that regresses.
    assert.match(
      code,
      /<layer\.icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*layer\.color\s*\}\}\s*\/>/,
      'expected <layer.icon className style={{ color: layer.color }} /> unchanged',
    );
    assert.match(
      code,
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'expected <Icon className style={{ color }} /> unchanged',
    );
  });

  it('no icon removed or replaced: every LAYERS icon component is unchanged', () => {
    for (const name of ['Globe', 'Cpu', 'DollarSign', 'Brain', 'Server', 'Network']) {
      assert.match(code, new RegExp(`icon:\\s*${name}\\b`), `expected LAYERS icon ${name} present`);
    }
  });
});

// ── PipelineKanban — PipelineColumnDef.Icon ───────────────────────────────────

describe('PipelineKanban — column icon contract corrected, render preserved', () => {
  const raw = readSource(KANBAN_REL);
  const code = stripComments(raw);

  it('PipelineColumnDef.Icon is typed as LucideIcon', () => {
    assert.match(code, /Icon\s*:\s*LucideIcon\s*;/, 'expected PipelineColumnDef.Icon: LucideIcon');
  });

  it('render behaviour preserved: both column-icon sites still pass className and style', () => {
    assert.match(
      code,
      /<column\.Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*column\.color\s*\}\}\s*\/>/,
      'expected <column.Icon className style={{ color: column.color }} /> unchanged',
    );
    assert.match(
      code,
      /<col\.Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*col\.color\s*\}\}\s*\/>/,
      'expected <col.Icon className style={{ color: col.color }} /> unchanged',
    );
  });

  it('no icon removed or replaced: every PIPELINE_COLUMNS icon component is unchanged', () => {
    for (const name of ['Zap', 'Brain', 'Phone', 'FileText', 'TrendingUp', 'XCircle']) {
      assert.match(code, new RegExp(`Icon:\\s*${name}\\b`), `expected column Icon ${name} present`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * PHASE 1B TASK 13 — remaining frontend icon contracts
 *
 * Four more TS2322s, one root cause, identical to Task 11: an icon holder was
 * declared className-only while the render site passes className AND style.
 *
 *   ScenarioPanel.tsx
 *     - SCENARIO_CFG[].Icon  (React.FC<{className?:string}>)  → 1 diagnostic
 *   SolutionArchitectureCard.tsx
 *     - LeverBar `Icon` prop (React.FC<{className?:string}>)  → 1 diagnostic
 *   StageTracker.tsx
 *     - STAGES[].icon (React.ComponentType<{className?:string}>) → 2 diagnostics
 *
 * All three now name the official `LucideIcon`; every value ever assigned to
 * them is a genuine lucide-react icon, so the type is accurate, not merely
 * wider. Type-only change — no icon replaced, no render prop added or removed.
 *
 * SCOPE NOTE (deliberate): SolutionArchitectureCard also declares PILLAR_CFG.Icon
 * and the SmallList `icon` prop with the same narrow shape. Neither produces a
 * diagnostic today because their render sites pass className only, so both are
 * OUT of this batch and are intentionally left untouched. That is why the checks
 * below are per-declaration rather than a file-wide "no narrow contract" sweep.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('ScenarioPanel — scenario icon contract corrected, render preserved', () => {
  const code = stripComments(readSource(SCENARIO_REL));

  it('imports LucideIcon as a type from lucide-react', () => {
    assert.match(
      code,
      /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
      'expected a type import of LucideIcon from lucide-react',
    );
  });

  it('SCENARIO_CFG.Icon is typed as LucideIcon, not the narrow className-only type', () => {
    assert.match(code, /Icon\s*:\s*LucideIcon\s*;/, 'expected Icon: LucideIcon');
    assert.doesNotMatch(
      code,
      /Icon\s*:\s*React\.(FC|ComponentType)<\{\s*className\?:\s*string\s*\}>/,
      'ScenarioPanel still declares an icon with the narrow className-only contract',
    );
  });

  it('render behaviour preserved: the scenario icon still passes className and style', () => {
    assert.match(
      code,
      /<activeCfg\.Icon\s+className="size-6"\s+style=\{\{\s*color:\s*activeCfg\.color\s*\}\}\s*\/>/,
      'expected <activeCfg.Icon className="size-6" style={{ color: activeCfg.color }} /> unchanged',
    );
  });

  it('the className-only sibling render site is untouched', () => {
    assert.match(
      code,
      /<cfg\.Icon\s+className="size-4 flex-shrink-0"\s*\/>/,
      'expected the cfg.Icon list render site to remain className-only',
    );
  });

  it('no icon removed or replaced: every SCENARIO_CFG icon is unchanged', () => {
    for (const name of ['Shield', 'Target', 'Zap']) {
      assert.match(code, new RegExp(`Icon:\\s*${name}\\b`), `expected SCENARIO_CFG icon ${name} present`);
    }
  });
});

describe('SolutionArchitectureCard — LeverBar icon contract corrected, render preserved', () => {
  const code = stripComments(readSource(SOLARCH_REL));

  it('imports LucideIcon as a type from lucide-react', () => {
    assert.match(
      code,
      /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
      'expected a type import of LucideIcon from lucide-react',
    );
  });

  it('the LeverBar Icon prop is typed as LucideIcon', () => {
    assert.match(
      code,
      /value:\s*number;\s*color:\s*string;\s*label:\s*string;\s*Icon:\s*LucideIcon\s*;/,
      'expected LeverBar prop Icon: LucideIcon',
    );
  });

  it('render behaviour preserved: LeverBar still renders its icon with className and style', () => {
    assert.match(
      code,
      /<Icon\s+className="size-2\.5"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'expected <Icon className="size-2.5" style={{ color }} /> unchanged',
    );
  });

  it('LeverBar is still fed the real LEVER_CFG icons', () => {
    assert.match(code, /Icon=\{lc\.Icon\}/, 'expected LeverBar to receive Icon={lc.Icon}');
    for (const name of ['Zap', 'TrendingUp', 'DollarSign', 'Shield']) {
      assert.match(code, new RegExp(`Icon:\\s*${name}\\b`), `expected LEVER_CFG icon ${name} present`);
    }
  });

  it('out-of-batch narrow contracts are deliberately left as-is (no scope creep)', () => {
    // PILLAR_CFG.Icon and SmallList's icon prop produce no diagnostic today.
    // This pins the batch boundary: if a later task widens them, it should do so
    // knowingly (and update this expectation) rather than by accident here.
    const narrow = code.match(/React\.FC<\{\s*className\?:\s*string\s*\}>/g) ?? [];
    assert.equal(narrow.length, 2, 'expected exactly the 2 out-of-batch narrow icon contracts to remain');
  });
});

describe('StageTracker — stage icon contract corrected, render preserved', () => {
  const code = stripComments(readSource(STAGE_REL));

  it('imports LucideIcon as a type from lucide-react', () => {
    assert.match(
      code,
      /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
      'expected a type import of LucideIcon from lucide-react',
    );
  });

  it('STAGES[].icon is typed as LucideIcon, not the narrow className-only type', () => {
    assert.match(code, /icon:\s*LucideIcon\s*;/, 'expected icon: LucideIcon');
    assert.doesNotMatch(
      code,
      /icon\s*:\s*React\.(FC|ComponentType)<\{\s*className\?:\s*string\s*\}>/,
      'StageTracker still declares its stage icon with the narrow className-only contract',
    );
  });

  it('render behaviour preserved: both repaired sites still pass className and style', () => {
    assert.match(
      code,
      /<Icon\s+className="size-5"\s+style=\{\{\s*color:\s*'rgba\(255,255,255,0\.2\)'\s*\}\}\s*\/>/,
      "expected the pending-stage <Icon className=\"size-5\" style={{ color: 'rgba(255,255,255,0.2)' }} /> unchanged",
    );
    assert.match(
      code,
      /<Icon\s+className="size-4"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'expected the stage-row <Icon className="size-4" style={{ color: accent }} /> unchanged',
    );
  });

  it('the className-only active-stage render site is untouched', () => {
    assert.match(
      code,
      /<Icon\s+className="size-5 text-white"\s*\/>/,
      'expected the active-stage icon render to remain className-only',
    );
  });

  it('no icon removed or replaced: every STAGES icon is unchanged', () => {
    for (const name of ['CheckCircle2', 'Search', 'FileText', 'Calendar']) {
      assert.match(code, new RegExp(`icon:\\s+${name}\\b`), `expected STAGES icon ${name} present`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * PHASE 1B TASK 15 — GlobalAIChat icon contract
 *
 * GlobalAIChat.tsx held the largest remaining frontend cluster: 24 diagnostics,
 * all TS2322, all with a byte-identical message, all traced to ONE declaration —
 * a module-private alias shared by the file's two icon holders:
 *
 *     type IconComponent = (props: { className?: string }) => React.ReactElement | null
 *       SECTIONS[].icon      →  6 diagnostics   (lines 59-64)
 *       QuickAction.icon     → 18 diagnostics   (the 6 x 3 SECTION_QUICK_ACTIONS)
 *
 * Same family as Tasks 11/13, different mechanism — and the distinction is the
 * reason this is one coherent batch rather than a code-level grouping. There the
 * narrow contract lacked `style` and the render sites passed it. Here BOTH render
 * sites pass `className` only, which the old alias already accepted; the
 * assignment failed on the RETURN type, because a lucide icon returns `ReactNode`
 * and the alias promised `ReactElement | null`. So this batch touches no JSX at
 * all: the alias is removed and both fields name the official `LucideIcon`, which
 * every one of the 24 assigned values genuinely is.
 *
 * The mechanism itself is proven at the type level in
 * src/app/components/__typechecks__/iconContract.ts (checked by typecheck:web);
 * the declarations and the preserved render are pinned structurally here, since
 * neither holder type is exported and the runner cannot transform JSX.
 * ═════════════════════════════════════════════════════════════════════════════ */

describe('GlobalAIChat — icon alias corrected, render preserved', () => {
  const code = stripComments(readSource(GAC_REL));

  it('imports LucideIcon as a type from lucide-react', () => {
    assert.match(
      code,
      /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
      'expected a type import of LucideIcon from lucide-react',
    );
  });

  it('the stale IconComponent alias is gone entirely', () => {
    assert.doesNotMatch(
      code,
      /type\s+IconComponent\s*=/,
      'GlobalAIChat still declares the local IconComponent alias',
    );
    assert.doesNotMatch(
      code,
      /\bIconComponent\b/,
      'GlobalAIChat still references IconComponent somewhere',
    );
  });

  it('the alias was not merely re-pointed at LucideIcon behind the old name', () => {
    // Guards the shape of the fix: both fields must name LucideIcon directly,
    // matching how Tasks 11 and 13 declared their corrected icon holders.
    const declarations = code.match(/icon:\s*LucideIcon\s*;/g) ?? [];
    assert.equal(declarations.length, 2, 'expected exactly 2 fields declared `icon: LucideIcon;`');
  });

  it('SECTIONS[].icon is typed as LucideIcon', () => {
    assert.match(
      code,
      /label:\s*string;\s*short:\s*string;\s*icon:\s*LucideIcon\s*;/,
      'expected the SECTIONS element type to declare icon: LucideIcon',
    );
  });

  it('QuickAction.icon is typed as LucideIcon', () => {
    assert.match(
      code,
      /interface\s+QuickAction\s*\{[^}]*\bicon:\s*LucideIcon\s*;[^}]*\}/,
      'expected QuickAction.icon: LucideIcon',
    );
  });

  it('no return-type-narrowing icon contract survives anywhere in the file', () => {
    assert.doesNotMatch(
      code,
      /\(\s*props:\s*\{\s*className\?:\s*string\s*\}\s*\)\s*=>\s*React\.ReactElement\s*\|\s*null/,
      'the narrow className-in/ReactElement-out icon contract is still declared',
    );
  });

  it('no unsafe escape was used to silence the cluster', () => {
    for (const [pattern, label] of [
      [/@ts-(ignore|expect-error)/, 'a TypeScript suppression comment'],
      [/\bas\s+unknown\b/, 'an `as unknown` assertion'],
      [/\bas\s+never\b/, 'an `as never` assertion'],
      [/icon\??:\s*any\b/, 'an `any`-typed icon field'],
    ] as const) {
      assert.doesNotMatch(code, pattern, `GlobalAIChat contains ${label}`);
    }
  });

  it('render behaviour preserved: both icon sites still resolve and render identically', () => {
    // The capitalised local binding is what makes the value renderable as JSX;
    // if either were dropped the icons would stop rendering.
    assert.match(code, /const\s+Icon\s*=\s*sec\.icon\s*;/, 'expected `const Icon = sec.icon;` unchanged');
    assert.match(code, /const\s+Icon\s*=\s*action\.icon\s*;/, 'expected `const Icon = action.icon;` unchanged');

    // Both render sites pass className only — no style was added or removed.
    const renders = code.match(/<Icon\s+className="size-3"\s*\/>/g) ?? [];
    assert.equal(renders.length, 2, 'expected exactly the 2 unchanged <Icon className="size-3" /> renders');
    assert.doesNotMatch(
      code,
      /<Icon\s+className="size-3"\s+style=/,
      'a style prop was added to an icon render site (visual change, out of scope)',
    );
  });

  it('no icon removed, replaced or reordered: all 24 assignments are unchanged', () => {
    // 6 SECTIONS icons + 18 SECTION_QUICK_ACTIONS icons = the exact 24 values
    // that produced the 24 diagnostics. Counts are pinned per component so a
    // swapped icon fails even though the total would still be 24.
    const expected: Record<string, number> = {
      Sparkles: 7, Zap: 5, AlertCircle: 3, ArrowRight: 3,
      FileText: 1, Target: 1, DollarSign: 1, Phone: 1, MessageSquare: 1, Info: 1,
    };
    let total = 0;
    for (const [name, count] of Object.entries(expected)) {
      const found = code.match(new RegExp(`\\bicon:\\s*${name}\\b`, 'g')) ?? [];
      assert.equal(found.length, count, `expected ${count} \`icon: ${name}\` assignment(s), found ${found.length}`);
      total += found.length;
    }
    assert.equal(total, 24, 'expected exactly 24 icon assignments across SECTIONS and SECTION_QUICK_ACTIONS');
  });

  it('the six sections and their order are unchanged', () => {
    const ids = (code.match(/\{\s*id:\s*'([^']+)',\s*label:/g) ?? [])
      .map(m => m.replace(/^\{\s*id:\s*'/, '').replace(/',\s*label:$/, ''));
    assert.deepEqual(ids, [
      'general', 'proposal.executive_brief', 'proposal.diagnosis',
      'recommendation', 'roi', 'call_prep',
    ], 'SECTIONS ids or their order changed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * PHASE 1B TASK 17 — the remaining className-only icon holders
 *
 * Twenty TS2322s, one root cause, identical in mechanism to Tasks 11 and 13: an
 * icon holder was declared
 *
 *     React.FC<{ className?: string }>  /  React.ComponentType<{ className?: string }>
 *
 * while its render site passes className AND style (the colour). The declared
 * type has no `style` key, so the colour was an excess property and TypeScript
 * rejected a render that was always valid at runtime — every value assigned to
 * these fields is a genuine lucide-react icon.
 *
 * Fifteen components, twenty diagnostics:
 *   BlockHistoryPanel 1 · BlockRegistryPanel 1 · ClientReportDashboard 1
 *   EngagementActivityFeed 1 · ExecutionDashboard 1 · ExportPanel 1
 *   FinancialSummaryCard 1 · ImplementationArchitectureCard 1 · KanbanAlertToast 1
 *   MappingEnginePanel 4 · ObjectionHandlerPanel 3 · ProposalDraftEditor 1
 *   ROITabLayout 1 · ROITrackingPanel 1 · RevenueIntelligenceDashboard 1
 *
 * SCOPE NOTE (deliberate, and a departure from the Task 13 note above): within
 * these fifteen files the narrow contract is retired COMPLETELY — including the
 * eight sibling declarations whose render sites pass className only and so
 * produced no diagnostic (ClientReportDashboard SectionHeader/NextStepCard,
 * ImplementationArchitectureCard CHECKPOINT_CFG/GOVERNANCE_FLAGS,
 * MappingEnginePanel tabs/typeIcon, ROITrackingPanel rows,
 * RevenueIntelligenceDashboard OBJECTION_ICONS). Those siblings are the same
 * stale contract on the same runtime values; naming `LucideIcon` there is still
 * a type-only change, and `typecheck:web` proves every assigned value really is
 * a LucideIcon. Retiring them together means the guard below can be a file-wide
 * sweep — a strictly stronger regression barrier than per-declaration matching,
 * and one that stops the diagnostic from reappearing the next time a colour is
 * added to one of those renders.
 *
 * Type-only change: no JSX was edited, no icon replaced, no render prop added
 * or removed, so runtime and visual output are byte-identical.
 * ═════════════════════════════════════════════════════════════════════════════ */

/** The fifteen components repaired in Task 17, with their repaired count. */
const TASK17_FILES: ReadonlyArray<readonly [string, number]> = [
  ['src/app/components/BlockHistoryPanel.tsx', 1],
  ['src/app/components/BlockRegistryPanel.tsx', 1],
  ['src/app/components/ClientReportDashboard.tsx', 1],
  ['src/app/components/EngagementActivityFeed.tsx', 1],
  ['src/app/components/ExecutionDashboard.tsx', 1],
  ['src/app/components/ExportPanel.tsx', 1],
  ['src/app/components/FinancialSummaryCard.tsx', 1],
  ['src/app/components/ImplementationArchitectureCard.tsx', 1],
  ['src/app/components/KanbanAlertToast.tsx', 1],
  ['src/app/components/MappingEnginePanel.tsx', 4],
  ['src/app/components/ObjectionHandlerPanel.tsx', 3],
  ['src/app/components/ProposalDraftEditor.tsx', 1],
  ['src/app/components/ROITabLayout.tsx', 1],
  ['src/app/components/ROITrackingPanel.tsx', 1],
  ['src/app/components/RevenueIntelligenceDashboard.tsx', 1],
];

/** The exact narrow contract Task 17 retired, in both spellings it appeared in. */
const NARROW_ICON_CONTRACT = /React\.(?:FC|ComponentType)<\{\s*className\?:\s*string\s*\}>/;

describe('Task 17 — className-only icon contract retired across fifteen components', () => {
  it('no repaired component still declares the narrow className-only contract', () => {
    for (const [rel] of TASK17_FILES) {
      assert.doesNotMatch(
        stripComments(readSource(rel)),
        NARROW_ICON_CONTRACT,
        `${rel}: an icon declaration still uses the narrow className-only contract`,
      );
    }
  });

  it('every repaired component imports LucideIcon as a type from lucide-react', () => {
    for (const [rel] of TASK17_FILES) {
      assert.match(
        stripComments(readSource(rel)),
        /import\s+type\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
        `${rel}: expected a type import of LucideIcon from lucide-react`,
      );
    }
  });

  it('every repaired component names LucideIcon on at least one icon declaration', () => {
    for (const [rel] of TASK17_FILES) {
      assert.match(
        stripComments(readSource(rel)),
        /\b(?:icon|Icon)\s*(?:\?)?\s*:\s*LucideIcon\b|Record<[^>]+,\s*LucideIcon>/,
        `${rel}: expected at least one icon field typed as LucideIcon`,
      );
    }
  });

  it('the LucideIcon import is type-only — no value import was added', () => {
    // A value import would change the emitted bundle; this task must not.
    for (const [rel] of TASK17_FILES) {
      assert.doesNotMatch(
        stripComments(readSource(rel)),
        /import\s*\{[^}]*\bLucideIcon\b[^}]*\}\s*from\s*['"]lucide-react['"]/,
        `${rel}: LucideIcon must be imported with \`import type\`, not as a value`,
      );
    }
  });
});

describe('Task 17 — render behaviour preserved at all twenty repaired sites', () => {
  // Behaviour guard. Each entry is the icon expression whose colour render
  // produced the original TS2322. If a `style` prop were dropped the icon would
  // silently lose its colour — a visual regression this task must not cause.
  // Patterns are shape-based (never line-numbered) so they survive edits above.
  const STYLED_RENDERS: ReadonlyArray<readonly [string, RegExp, string]> = [
    ['src/app/components/BlockHistoryPanel.tsx',
      /<ChangeIcon\s+className="[^"]*"\s+style=\{\{\s*color:\s*changeColor\s*\}\}\s*\/>/,
      'ChangeIcon colour render'],
    ['src/app/components/BlockRegistryPanel.tsx',
      /<Ic\s+className="[^"]*"\s+style=\{\{\s*color:\s*passed\s*\?[^}]*\}\}\s*\/>/,
      'section icon colour render'],
    ['src/app/components/ClientReportDashboard.tsx',
      /<Icon\s+className="size-5"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'MetricCard icon colour render'],
    ['src/app/components/EngagementActivityFeed.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*cfg\.color\s*\}\}\s*\/>/,
      'event icon colour render'],
    ['src/app/components/ExecutionDashboard.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'SectionHeader icon colour render'],
    ['src/app/components/ExportPanel.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*config\.color\s*\}\}\s*\/>/,
      'doc-type icon colour render'],
    ['src/app/components/FinancialSummaryCard.tsx',
      /<Icon\s+className="size-2\.5"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'StatCard icon colour render'],
    ['src/app/components/ImplementationArchitectureCard.tsx',
      /<Icon\s+className="size-3"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'integration-section icon colour render'],
    ['src/app/components/KanbanAlertToast.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*colors\.hex\s*\}\}\s*\/>/,
      'alert-kind icon colour render'],
    ['src/app/components/ObjectionHandlerPanel.tsx',
      /<sig\.icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*riskColors\[sig\.risk\]\s*\}\}\s*\/>/,
      'engagement-signal icon colour render'],
    ['src/app/components/ProposalDraftEditor.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'CardShell icon colour render'],
    ['src/app/components/ROITabLayout.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'SectionShell icon colour render'],
    ['src/app/components/ROITrackingPanel.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'SectionShell icon colour render'],
    ['src/app/components/RevenueIntelligenceDashboard.tsx',
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*accent\s*\}\}\s*\/>/,
      'PanelShell icon colour render'],
  ];

  for (const [rel, pattern, what] of STYLED_RENDERS) {
    it(`${rel.replace('src/app/components/', '')} — ${what} still passes className and style`, () => {
      assert.match(stripComments(readSource(rel)), pattern, `${rel}: ${what} lost its style prop`);
    });
  }

  it('MappingEnginePanel — all four styled icon renders are unchanged', () => {
    const code = stripComments(readSource('src/app/components/MappingEnginePanel.tsx'));
    // Stepper: colour only while the step is active, `{}` otherwise. This
    // conditional style is exactly what the narrow contract rejected.
    assert.match(
      code,
      /<Icon\s+className=\{`size-4[^`]*`\}\s+style=\{stepActive\s*\?\s*\{\s*color:\s*step\.color\s*\}\s*:\s*\{\}\}\s*\/>/,
      'stepper conditional-colour render changed',
    );
    assert.match(
      code,
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*STEPS\[activeStep\]\.color\s*\}\}\s*\/>/,
      'active-step icon render changed',
    );
    assert.match(
      code,
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color:\s*s\.color\s*\}\}\s*\/>/,
      'step-grid icon render changed',
    );
    assert.match(
      code,
      /<Icon\s+className="[^"]*"\s+style=\{\{\s*color\s*\}\}\s*\/>/,
      'SectionTitle icon render changed',
    );
  });

  it('ObjectionHandlerPanel — both OBJECTION_ICONS renders are unchanged', () => {
    const code = stripComments(readSource('src/app/components/ObjectionHandlerPanel.tsx'));
    const styled = code.match(/<Icon\s+className="[^"]*"\s+style=\{\{\s*color\s*\}\}\s*\/>/g) ?? [];
    assert.equal(styled.length, 2, 'expected the playbook-header and history-row icon renders');
  });
});

describe('Task 17 — no icon value was removed or replaced', () => {
  // The runtime values are the reason `LucideIcon` is ACCURATE rather than
  // merely wider. Pinning them means a swap to a non-lucide component fails
  // here as well as in typecheck:web.
  // Each entry pins the object-literal KEY as well as the icon, because these
  // holders are keyed by their own domain type (`price:`, `score_low:`, …) and
  // not by a field literally called `icon` — so a key→icon swap, not just a
  // deletion, is what these guards have to catch.
  const ICON_VALUES: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
    ['src/app/components/BlockHistoryPanel.tsx', {
      create: 'Edit3', edit: 'Edit3', ai_improve: 'Zap',
      ai_expand: 'Expand', ai_simplify: 'Minimize2', chat_patch: 'MessageSquare',
    }],
    ['src/app/components/BlockRegistryPanel.tsx', {
      structural: 'ShieldCheck', financial: 'CheckCircle2', narrative: 'Info',
    }],
    ['src/app/components/EngagementActivityFeed.tsx', {
      icon: 'Eye', // EVENT_CONFIG is keyed by event, each entry holding `icon:`
    }],
    ['src/app/components/KanbanAlertToast.tsx', {
      score_low: 'TrendingDown', score_high: 'TrendingUp', remote_move: 'Users',
      conflict: 'AlertTriangle', stale_escalation: 'TimerOff',
    }],
    ['src/app/components/ObjectionHandlerPanel.tsx', {
      price: 'DollarSign', risk: 'Shield', timing: 'Clock',
      trust: 'Eye', internal_alignment: 'Users',
    }],
    ['src/app/components/RevenueIntelligenceDashboard.tsx', {
      price: 'DollarSign', risk: 'Shield', timing: 'Clock',
      trust: 'Eye', internal_alignment: 'Users',
    }],
  ];

  for (const [rel, pairs] of ICON_VALUES) {
    it(`${rel.replace('src/app/components/', '')} — every icon value is still assigned`, () => {
      const code = stripComments(readSource(rel));
      for (const [key, name] of Object.entries(pairs)) {
        assert.match(
          code,
          new RegExp(`\\b${key}\\s*:\\s*${name}\\b`),
          `${rel}: expected \`${key}: ${name}\` — the icon was removed or replaced`,
        );
      }
    });
  }

  it('EngagementActivityFeed — all seven EVENT_CONFIG icons are unchanged', () => {
    const code = stripComments(readSource('src/app/components/EngagementActivityFeed.tsx'));
    for (const name of ['Eye', 'FileText', 'Zap', 'Printer', 'FileCheck2', 'Calendar', 'MessageSquare']) {
      assert.match(code, new RegExp(`icon:\\s*${name}\\b`), `EVENT_CONFIG icon ${name} missing`);
    }
  });

  it('ExportPanel — all three DOC_TYPES icons are unchanged', () => {
    const code = stripComments(readSource('src/app/components/ExportPanel.tsx'));
    for (const name of ['FileBarChart2', 'FileText', 'Pen']) {
      assert.match(code, new RegExp(`icon:\\s*${name}\\b`), `DOC_TYPES icon ${name} missing`);
    }
  });

  it('ImplementationArchitectureCard — the five integration-section icons are unchanged', () => {
    const code = stripComments(readSource('src/app/components/ImplementationArchitectureCard.tsx'));
    for (const name of ['Layers', 'Database', 'Settings', 'Bot', 'Shield']) {
      assert.match(code, new RegExp(`Icon:\\s*${name}\\b`), `integration icon ${name} missing`);
    }
  });

  it('MappingEnginePanel — the eight STEPS icons are unchanged', () => {
    const code = stripComments(readSource('src/app/components/MappingEnginePanel.tsx'));
    for (const name of ['Package', 'GitBranch', 'Calendar', 'List', 'Shield']) {
      assert.match(code, new RegExp(`icon:\\s*${name}\\b`), `STEPS icon ${name} missing`);
    }
  });
});

describe('Task 17 — the repaired count is pinned', () => {
  it('the fifteen files account for exactly twenty repaired diagnostics', () => {
    const total = TASK17_FILES.reduce((sum, [, n]) => sum + n, 0);
    assert.equal(total, 20, 'Task 17 repaired twenty TS2322 diagnostics');
    assert.equal(TASK17_FILES.length, 15, 'Task 17 touched fifteen components');
  });
});
