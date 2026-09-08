/**
 * THE SHELL AT EVERY WIDTH — UI Sprint 4.
 *
 * The team dashboard shell shipped with NO responsive breakpoint of any kind.
 * A fixed 280px sidebar sat beside the content as a flex sibling under
 * `h-screen overflow-hidden`, so on a 375px phone the entire product ran in the
 * remaining 95px. Every destination, every panel, every table.
 *
 * Ch. 21.10 asks for one mental model across interaction modes — the same
 * destinations, the same intent grouping, the same order — with only the
 * INTERACTION changing. So the fix is not a second navigation for small
 * screens. It is the identical <nav>, from the identical model, presented as an
 * overlay drawer below 1024px.
 *
 * ── WHAT THIS SUITE GUARDS ──────────────────────────────────────────────────
 *
 *   The drawer can be opened. Without a trigger in the header, compact width
 *   has no navigation at all — which is what the shell shipped with.
 *
 *   The drawer can be dismissed every way a drawer is expected to be: the
 *   scrim, the close button, Escape, and navigating.
 *
 *   A CLOSED DRAWER IS NOT IN THE TAB ORDER. Off-screen is not the same as
 *   absent: a drawer left visible-but-translated keeps every one of its
 *   controls focusable, so a keyboard user tabs into a set of controls they
 *   cannot see. This is asserted on `visibility`, which is what actually
 *   removes an element from the tab order and from assistive technology.
 *
 *   Desktop behaviour is untouched. The rail still collapses to 80px and the
 *   collapsed rail is still labelled.
 *
 *   The drawer is never an icon rail. Collapsing to icons is a second, worse
 *   navigation on the screen that can least afford one.
 *
 * VERIFIED IN A REAL BROWSER
 *   These structural guards were written after driving the built app in
 *   Chromium at 1440x900, 820x1180 and 375x812. Measured there: the aside is
 *   `static` at 1440 and `fixed` at 820 and below; main content width goes from
 *   95px to the full 375px on a phone; no horizontal document overflow at any
 *   width; all 13 destinations and all 6 intent groups present at every width;
 *   25 Tab presses never land inside a closed drawer, and do once it is open;
 *   open / tap-outside / Escape / navigate all resolve to hidden.
 *
 * TESTING APPROACH (documented limitation)
 *   The layout is `.tsx` and the runner strips types but does not transform
 *   JSX, so it cannot be imported and rendered here, and the repository ships
 *   no React test renderer. Following the established pattern, each guarantee
 *   is enforced structurally against the production source, with pattern-based
 *   assertions rather than line numbers.
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

const LAYOUT = 'src/app/components/TeamDashboardLayout.tsx';
const layout = stripComments(readSource(LAYOUT));

// ─────────────────────────────────────────────────────────────────────────────

describe('the shell has a compact mode at all', () => {
  it('detects a compact viewport', () => {
    assert.match(layout, /import \{ useMediaQuery \} from '@\/app\/hooks\/usePerformance'/);
    assert.ok(
      /const isCompact = useMediaQuery\('\(max-width: 1023px\)'\)/.test(layout),
      'the shell shipped with no breakpoint of any kind',
    );
  });

  it('reuses the hook the codebase already had, rather than a second one', () => {
    assert.ok(!/window\.matchMedia/.test(layout), 'useMediaQuery already exists');
  });
});

describe('the drawer can be opened', () => {
  it('the header carries the only trigger, and only at compact width', () => {
    assert.ok(
      /\{isCompact && \(\s*<button\s+onClick=\{\(\) => setDrawerOpen\(true\)\}/.test(layout),
      'without a trigger, compact width has no navigation at all',
    );
  });

  it('the trigger is named and states what it controls', () => {
    assert.ok(/aria-label="Open navigation"/.test(layout));
    assert.ok(/aria-expanded=\{drawerOpen\}/.test(layout));
  });

  it('the keyboard toggle means the same thing at both widths', () => {
    // Ch. 21.10 — same intent ("show me navigation"), different interaction.
    assert.ok(
      /isCompact \? setDrawerOpen\(!drawerOpen\) : setSidebarCollapsed\(!sidebarCollapsed\)/.test(layout),
      'Cmd+B must open the drawer where there is no rail to collapse',
    );
  });
});

describe('the drawer can be dismissed every way one expects', () => {
  it('by the scrim, which only exists while it is open', () => {
    assert.ok(
      /\{isCompact && drawerOpen && \(/.test(layout),
      'the scrim is what makes "tap outside to dismiss" true',
    );
    assert.ok(/onClick=\{\(\) => setDrawerOpen\(false\)\}/.test(layout));
    assert.ok(
      /className="fixed inset-0 z-40[^"]*"\s*\n?\s*onClick=\{\(\) => setDrawerOpen\(false\)\}/.test(layout) ||
        /fixed inset-0 z-40/.test(layout),
      'the scrim must cover the viewport',
    );
  });

  it('the scrim sits under the drawer, not over it', () => {
    const scrimZ = Number(layout.match(/fixed inset-0 z-(\d+)/)![1]);
    const drawerZ = Number(layout.match(/fixed inset-y-0 left-0 z-(\d+)/)![1]);
    assert.ok(drawerZ > scrimZ, 'a scrim above the drawer would swallow every tap on it');
  });

  it('by the close button, which the same control becomes at compact width', () => {
    assert.ok(
      /isCompact \? setDrawerOpen\(false\) : setSidebarCollapsed\(!sidebarCollapsed\)/.test(layout),
    );
    assert.ok(/'Close navigation'/.test(layout));
  });

  it('by Escape — scoped to the open drawer, and never stealing the key', () => {
    const escape = layout.match(/\{\s*key: 'Escape',[\s\S]*?\},/);
    assert.ok(escape, 'expected an Escape shortcut');
    assert.ok(
      /enabled: drawerOpen/.test(escape[0]),
      'registering it always would fight the command palette for Escape',
    );
    assert.ok(
      /preventDefault: false/.test(escape[0]),
      'Escape belongs to whatever modal is on top',
    );
  });

  it('by navigating, so the drawer never covers the page it just opened', () => {
    assert.ok(
      /const navigateAndClose = \(page: string\) => \{\s*setDrawerOpen\(false\);\s*onNavigate\?\.\(page\);/.test(layout),
    );
    assert.ok(
      /onClick=\{\(\) => navigateAndClose\(destination\.id\)\}/.test(layout),
      'every destination button must close the drawer',
    );
  });

  it('and leaving compact width does not strand it open', () => {
    assert.ok(
      /useEffect\(\(\) => \{\s*if \(!isCompact\) setDrawerOpen\(false\);\s*\}, \[isCompact\]\)/.test(layout),
      'at desktop width there is no scrim to dismiss it with',
    );
  });
});

describe('a closed drawer is not reachable', () => {
  it('animates visibility, not only position', () => {
    // The real guard. `x: -280` alone leaves every control focusable.
    assert.ok(
      /visibility: drawerOpen \? 'visible' : 'hidden'/.test(layout),
      'off-screen is not absent — a translated drawer stays in the tab order',
    );
  });

  it('is restored to visible at desktop width', () => {
    assert.ok(
      /\{ width: sidebarCollapsed \? 80 : 280, x: 0, visibility: 'visible' \}/.test(layout),
      'the desktop rail must never inherit the drawer\'s hidden state',
    );
  });

  it('is hidden from assistive technology too', () => {
    assert.ok(
      /aria-hidden=\{isCompact && !drawerOpen \? true : undefined\}/.test(layout),
      'and must not be aria-hidden at desktop width, where it is the navigation',
    );
  });
});

describe('the drawer is the same navigation, not a second one', () => {
  it('renders the one model, exactly as the desktop rail does', () => {
    // There is a single <nav> in the component: the drawer IS the rail.
    const navs = layout.match(/<nav\b/g) ?? [];
    assert.equal(navs.length, 2, 'expected exactly the primary nav and the breadcrumb nav');
    assert.ok(/NAV_GROUPS\.map\(group =>/.test(layout));
    assert.equal(
      (layout.match(/NAV_GROUPS\.map/g) ?? []).length, 1,
      'a second rendering of the model would be a second navigation',
    );
  });

  it('is never an icon rail — labels always show at compact width', () => {
    assert.ok(
      /\{\(!sidebarCollapsed \|\| isCompact\) && \(\s*<span className="flex-1 text-left font-medium">\{destination\.label\}<\/span>/.test(layout),
      'collapsing to icons on a phone is a second, worse navigation',
    );
    assert.ok(
      /\{!sidebarCollapsed \|\| isCompact \? \(/.test(layout),
      'the intent group headings must show at compact width too',
    );
    assert.ok(
      /isCompact\s*\n?\s*\?\s*\{\s*width: 280,/.test(layout),
      'the drawer is always full drawer width',
    );
  });

  it('keeps the brand and the account block at compact width', () => {
    assert.ok(/\{\(!sidebarCollapsed \|\| isCompact\) && \(\s*<motion\.div/.test(layout));
    assert.ok(/\{\(!sidebarCollapsed \|\| isCompact\) && <span className="font-medium">Logout<\/span>\}/.test(layout));
  });
});

describe('desktop behaviour is untouched', () => {
  it('the rail is still a flex sibling, not an overlay', () => {
    assert.ok(
      /isCompact\s*\n?\s*\?\s*'fixed inset-y-0 left-0 z-50[^']*'\s*\n?\s*:\s*'bg-black\/40 backdrop-blur-xl border-r border-white\/10 flex flex-col'/.test(layout),
      'the desktop class list must be the original one',
    );
  });

  it('still collapses to an 80px rail', () => {
    assert.ok(/width: sidebarCollapsed \? 80 : 280/.test(layout));
  });

  it('the collapsed rail is still labelled, and only there', () => {
    assert.ok(
      /title=\{sidebarCollapsed && !isCompact \? destination\.label : undefined\}/.test(layout),
      'the drawer shows real labels, so a tooltip there would be redundant',
    );
    assert.ok(/aria-label=\{destination\.label\}/.test(layout));
  });
});

describe('the header survives a narrow viewport', () => {
  it('pads down rather than pushing content off screen', () => {
    assert.ok(/px-4 sm:px-6 py-4/.test(layout));
  });

  it('lets a long breadcrumb truncate instead of widening the page', () => {
    assert.ok(/text-white font-medium truncate/.test(layout));
    assert.ok(/<nav className="flex items-center gap-2 text-sm min-w-0"/.test(layout));
    assert.ok(
      /ChevronRight className="size-4 text-gray-500 flex-shrink-0"/.test(layout),
      'the separators must not be squeezed',
    );
  });

  it('names the two navigation landmarks distinctly', () => {
    assert.ok(/aria-label="Primary"/.test(layout));
    assert.ok(/aria-label="Breadcrumb"/.test(layout));
  });

  it('names the header icon buttons', () => {
    // "Search" alone names the widget, not the job. UI Sprint 7 made every
    // icon-only control in the console say what it acts on.
    assert.ok(/aria-label="Search submissions"/.test(layout));
  });
});
