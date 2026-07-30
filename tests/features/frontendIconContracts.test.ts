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
