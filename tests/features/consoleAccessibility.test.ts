/**
 * UI SPRINT 7 — the accessible names the console was missing.
 *
 * HOW THESE WERE FOUND
 *   By driving the running console in Chromium and asking the DOM, on each
 *   page, which interactive elements had no accessible name: buttons with no
 *   text and no `aria-label`, and inputs whose only "label" was a `<span>` or a
 *   placeholder beside them. Seven surfaces were swept; five had gaps.
 *
 * WHY EACH ONE MATTERED
 *   * A `<label>` with no `htmlFor`, wrapping nothing, is a styled paragraph.
 *     The control beside it has no accessible name at all, a screen reader
 *     announces "edit text, blank", and clicking the label focuses nothing.
 *     The settings profile had two; the revenue dashboard had five combo boxes
 *     whose dimension — scenario, service, industry — was in a `<span>`.
 *   * A placeholder is not a name. It is absent from the accessibility tree in
 *     some browsers and disappears the instant the user types. Both search
 *     boxes relied on one.
 *   * An icon-only button with no label is announced as "button". The team
 *     roster and the CORTEX lead list each had a refresh control like that.
 *   * A toggle whose entire state is a background colour cannot be read at all
 *     — covered in `consoleSurfaces.test.ts`.
 *
 * WHAT THIS TEST IS, AND IS NOT
 *   These are structural assertions against the production source, following
 *   the pattern this directory already uses for `.tsx` (the runner strips types
 *   but does not transform JSX, so nothing here can be rendered). They pin the
 *   specific fixes so they cannot be quietly undone. They are NOT a general
 *   accessibility audit and do not claim the console is accessible — that
 *   claim needs the real browser sweep, which is how these were found and how a
 *   future one should be checked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the Field primitive makes an unlabelled control impossible', () => {
  const field = stripComments(read('src/app/components/ui/cortex/Field.tsx'));

  it('generates the id and puts it on the label', () => {
    assert.match(field, /const id = useId\(\);/);
    assert.match(field, /htmlFor=\{id\}/);
  });

  it('hands the same id to the control rather than trusting the caller', () => {
    // The render prop is what makes the association unbreakable: there is no
    // way to use this component that leaves the control unnamed.
    assert.match(field, /children\(\{ id, 'aria-describedby': describedById \}\)/);
  });

  it('wires hint and error text through aria-describedby', () => {
    assert.match(field, /const describedById = error \? `\$\{id\}-error` : hint \? `\$\{id\}-hint` : undefined;/);
    assert.match(field, /role="alert"/, 'a validation error appears silently');
  });

  it('marks a required field in the accessibility tree, not only with an asterisk', () => {
    assert.match(field, /sr-only"> \(required\)</);
    assert.match(field, /<span aria-hidden="true" className="text-cortex-danger"> \*<\/span>/);
  });
});

describe('every control the browser sweep found unnamed now has a name', () => {
  const CASES: [file: string, description: string, pattern: RegExp][] = [
    [
      'src/app/components/SettingsPage.tsx',
      'the profile fields use Field rather than a detached label',
      /<Field label="Display Name">/,
    ],
    [
      'src/app/components/SettingsPage.tsx',
      'the read-only email field explains itself through a hint, not loose text',
      /<Field\s+label="Email Address"\s+hint="Email is managed through Supabase Auth/,
    ],
    [
      'src/app/components/RevenueIntelligenceDashboard.tsx',
      'each filter select is tied to its visible label',
      /<label htmlFor=\{selectId\}[\s\S]{0,120}\{label\}<\/label>/,
    ],
    [
      'src/app/components/RevenueIntelligenceDashboard.tsx',
      'the select carries the generated id',
      /<select\s+id=\{selectId\}/,
    ],
    [
      'src/app/components/TeamManagement.tsx',
      'the roster refresh control is named',
      /aria-label="Refresh the team list"/,
    ],
    [
      'src/app/components/CortexDashboard.tsx',
      'the lead-list refresh control is named',
      /aria-label="Refresh the lead list"/,
    ],
    [
      'src/app/components/CortexDashboard.tsx',
      'the lead search box is named, not merely hinted at',
      /aria-label="Search leads by company, email or industry"/,
    ],
    [
      'src/app/components/ReviewerDashboard.tsx',
      'the review queue search box is named',
      /aria-label="Search submissions by company name"/,
    ],
  ];

  for (const [file, description, pattern] of CASES) {
    it(`${file.split('/').pop()}: ${description}`, () => {
      assert.match(read(file), pattern);
    });
  }
});

describe('the shell keeps the landmarks and states it gained', () => {
  const shell = stripComments(read('src/app/components/TeamDashboardLayout.tsx'));

  it('offers a skip link into the main region', () => {
    assert.match(shell, /href="#cortex-main"/);
    assert.match(shell, /id="cortex-main"/);
  });

  it('labels both navigation landmarks distinctly', () => {
    // Two `<nav>` elements in one shell — the sidebar and the breadcrumb trail
    // — are indistinguishable to a landmark list unless each is named.
    assert.match(shell, /<nav[^>]*aria-label="Primary"/);
    assert.match(shell, /aria-label="Breadcrumb"/);
  });

  it('marks the page the user is on', () => {
    assert.match(shell, /aria-current=\{isActive \? 'page' : undefined\}/);
  });

  it('declares the collapsible group as a disclosure', () => {
    assert.match(shell, /aria-expanded=\{expanded\}/);
    assert.match(shell, /aria-controls=\{groupId\}/);
  });

  it('names every icon-only control in the shell', () => {
    for (const label of ['Open navigation', 'Search submissions', 'Sign out']) {
      assert.ok(shell.includes(`aria-label="${label}"`), `the shell is missing "${label}"`);
    }
    // One control serves both widths: it closes the drawer where there is a
    // drawer, and collapses the rail where there is a rail. Its name therefore
    // changes with its state, so it is asserted as the expression rather than
    // as a literal — but every one of the three states must still be named.
    assert.match(
      shell,
      /aria-label=\{\s*isCompact\s*\?\s*'Close navigation'\s*:\s*sidebarCollapsed \? 'Expand navigation' : 'Collapse navigation'\s*\}/,
      'the drawer close / rail collapse control must name all three of its states',
    );
  });

  it('hides decorative glyphs from assistive technology', () => {
    // Every icon in the shell sits beside its own text or a label, so none of
    // them should be announced twice.
    const icons = shell.match(/<(Brain|X|Menu|PanelLeft\w+|LogOut|ChevronRight|ChevronDown|SearchIcon|Icon)\b[^>]*\/>/g) ?? [];
    assert.ok(icons.length > 0, 'no shell icons found — the pattern needs updating');
    for (const icon of icons) {
      assert.match(icon, /aria-hidden="true"/, `${icon} is announced to a screen reader`);
    }
  });
});

describe('the execution dashboard has a document outline', () => {
  const execution = stripComments(read('src/app/components/ExecutionDashboard.tsx'));

  it('makes every section header a real heading', () => {
    // `SectionHeader` rendered its title in a `<span>`, and it is used
    // twenty-two times, so every section on the page LOOKED like a heading and
    // was not one. The document had no outline at all: a screen-reader user
    // could not list the sections or jump between them, and had to read the
    // page linearly to find out what was on it — on the densest page in the
    // console.
    assert.match(execution, /<h2 className="text-sm font-bold text-white">\{title\}<\/h2>/);
    assert.ok(
      !/<span className="text-sm font-bold text-white">\{title\}<\/span>/.test(execution),
      'the section title is a span again',
    );
    // One definition, so the fix reaches all of them.
    assert.ok((execution.match(/<SectionHeader/g) ?? []).length >= 20);
  });

  it('gives the page an h1', () => {
    assert.match(execution, /<h1 className="text-\[11px\] font-black text-white">\{project\.client_name\}<\/h1>/);
  });

  it('declares its section switcher as a tablist', () => {
    // Six buttons whose current one was distinguishable only by colour.
    assert.match(execution, /role="tablist"\s*\n\s*aria-label="Engagement sections"/);
    assert.match(execution, /role="tab"\s*\n\s*aria-selected=\{isActive\}/);
    assert.match(execution, /aria-controls="execution-tabpanel"/);
    assert.match(execution, /id="execution-tabpanel" role="tabpanel"/);
  });

  it('keeps the styling it had — this is a semantics change, not a redesign', () => {
    // The heading classes are the span's classes verbatim, so nothing moves.
    assert.match(execution, /className="text-sm font-bold text-white">\{title\}/);
  });
});

describe('the system tools were swept too', () => {
  /**
   * `/registry` is a developer tool rather than a canonical journey, which is
   * why it was swept last — but it had the same two faults as everything else,
   * and leaving them would have meant the standing claim ("every route reports
   * zero unnamed controls") was not actually true of every route.
   */
  const registry = read('src/app/components/RegistryViewer.tsx');

  it('names the search box', () => {
    assert.match(registry, /aria-label="Search the registry by name, id or description"/);
  });

  it('uses the label the filter select was already given', () => {
    // `FilterSelect` received a `label` prop and used it only inside the
    // "All …s" option text, never as the control's own name, so each filter
    // was announced as an unnamed combo box.
    assert.match(registry, /aria-label=\{`Filter by \$\{label\.toLowerCase\(\)\}`\}/);
  });

  it('gives the route an h1', () => {
    // The route had no heading at all: a screen reader landing on it was told
    // nothing about where it had landed.
    // The colour is now the primary-text token rather than the `#F9FAFB` it
    // spelled out; the guarantee here is the heading, and that it is styled
    // deliberately rather than inheriting from whatever wraps it.
    assert.match(registry, /<h1 style=\{\{ fontSize: 16, fontWeight: 700, color: K_TEXT_PRIMARY, margin: 0/);
  });
});
