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
    for (const label of [
      'Close navigation', 'Open navigation', 'Search submissions', 'Sign out',
    ]) {
      assert.ok(shell.includes(`aria-label="${label}"`), `the shell is missing "${label}"`);
    }
    // The collapse control's name changes with its state, so it is asserted
    // as the expression rather than as a literal.
    assert.match(shell, /aria-label=\{sidebarCollapsed \? 'Expand navigation' : 'Collapse navigation'\}/);
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
