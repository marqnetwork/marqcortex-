/**
 * UI SPRINT 7 — the console's shared surfaces, and what they replaced.
 *
 * These components are `.tsx`, and the runner (`node --experimental-strip-types`)
 * strips types but does not transform JSX, so they cannot be imported and
 * rendered here. Following the established pattern in this directory
 * (`frontendIconContracts.test.ts`, `breadcrumbContract.test.ts`), each
 * guarantee is enforced structurally against the production source, by pattern
 * and never by line number.
 *
 * WHAT IS GUARDED
 *   1. THE PRIMITIVES ARE BUILT ON THE TOKENS. A shared primitive that
 *      hard-codes a colour is worse than no primitive at all — it puts the
 *      inconsistency somewhere every screen inherits it.
 *   2. THE FEEDBACK STATES ARE ANNOUNCED. A loading state that is silent to a
 *      screen reader is a blank screen; an error that appears without
 *      `role="alert"` is a failure the user never learns about.
 *   3. LOADING IS NOT RENDERED AS ZERO. The home dashboard must not draw its
 *      KPI grid while the first fetch is in flight.
 *   4. NO SEEDED DATA IN A REAL CHART. The seven-day trend padded empty days
 *      with invented counts. It must not come back.
 *   5. A FAILED LOAD IS NOT AN EMPTY WORKSPACE.
 *   6. THE NOTIFICATION BELL CANNOT TAKE DOWN THE CONSOLE. It sits in the
 *      shell header on every page and used to write an unchecked response
 *      straight into state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { CORTEX_TOKENS } from '../../src/app/lib/tokens.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code and never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const PRIMITIVES = [
  'src/app/components/ui/cortex/Surface.tsx',
  'src/app/components/ui/cortex/PageHeader.tsx',
  'src/app/components/ui/cortex/StatusBadge.tsx',
  'src/app/components/ui/cortex/FeedbackStates.tsx',
];

// ── 1. Built on the tokens ────────────────────────────────────────────────────

describe('the shared primitives are built on the token layer', () => {
  it('hard-codes no colour of its own', () => {
    for (const rel of PRIMITIVES) {
      const code = stripComments(read(rel));
      const hexes = code.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
      assert.deepEqual(
        hexes, [],
        `${rel} hard-codes ${hexes.join(', ')} — a primitive must read the tokens`,
      );
    }
  });

  it('says surfaces, borders and text through token utilities', () => {
    const surface = stripComments(read('src/app/components/ui/cortex/Surface.tsx'));
    for (const utility of ['bg-cortex-raised', 'bg-cortex-sunken', 'bg-cortex-overlay']) {
      assert.ok(surface.includes(utility), `Surface does not offer ${utility}`);
    }
    for (const utility of ['border-cortex-default', 'border-cortex-subtle', 'border-cortex-strong']) {
      assert.ok(surface.includes(utility), `Surface does not use ${utility}`);
    }
  });

  it('takes its status colours from the token maps', () => {
    const badge = stripComments(read('src/app/components/ui/cortex/StatusBadge.tsx'));
    assert.ok(badge.includes('SUBMISSION_STATUS_COLOR'), 'status badge invents its own colours');
    assert.ok(badge.includes('PRIORITY_COLOR'), 'priority badge invents its own colours');
  });

  it('is re-exported from one entry point', () => {
    const index = read('src/app/components/ui/cortex/index.ts');
    for (const name of [
      'Surface', 'PageHeader', 'StatusBadge', 'PriorityBadge', 'ToneBadge',
      'LoadingState', 'EmptyState', 'ErrorState',
    ]) {
      assert.ok(index.includes(name), `${name} is not exported from the cortex primitives index`);
    }
  });
});

// ── 2. The feedback states are announced ─────────────────────────────────────

describe('the feedback states reach a screen reader', () => {
  const states = stripComments(read('src/app/components/ui/cortex/FeedbackStates.tsx'));

  it('announces a wait rather than drawing silent rectangles', () => {
    assert.match(states, /role="status"/, 'LoadingState is not a status region');
    assert.match(states, /aria-busy="true"/, 'LoadingState does not report being busy');
    assert.match(states, /aria-live="polite"/, 'LoadingState does not announce');
    assert.match(states, /sr-only">\{label\}/, 'LoadingState has no accessible name');
  });

  it('hides the decorative placeholder bars from assistive technology', () => {
    assert.match(states, /aria-hidden="true"[\s\S]{0,200}animate-pulse/, 'skeleton bars are not hidden');
  });

  it('raises a failure as an alert', () => {
    assert.match(states, /role="alert"/, 'ErrorState appears silently');
  });

  it('requires an empty state to say what is absent and why', () => {
    assert.match(states, /title: string;/);
    assert.match(states, /description: string;/);
    // The action is optional on purpose — a filter that matched nothing has no
    // next step but changing the filter, and inventing one would mislead.
    assert.match(states, /action\?: \{ label: string; onClick: \(\) => void \};/);
  });
});

// ── 3-5. The home dashboard tells the truth about its own state ──────────────

describe('the home dashboard distinguishes loading, empty, failed and real', () => {
  const dash = stripComments(read('src/app/components/TeamHomeDashboard.tsx'));

  it('does not draw the command centre while the first fetch is in flight', () => {
    assert.match(
      dash,
      /\{!isLoading && !loadError && !leadWithOrientation && \(/,
      'the command centre is not gated on the load having finished',
    );
    assert.match(dash, /\{isLoading && \([\s\S]{0,400}<LoadingState/, 'no loading state is rendered');
  });

  it('leads with orientation for a loaded, empty workspace', () => {
    assert.match(dash, /leadWithOrientation = shouldLeadWithOrientation\(orientationFacts\)/);
    assert.match(dash, /<OrientationPanel/);
  });

  it('treats a failed load as a failure, not as an empty workspace', () => {
    assert.match(dash, /\{!isLoading && loadError && \([\s\S]{0,400}<ErrorState/);
    assert.match(dash, /setLoadError\(/, 'a load failure is not recorded');
  });

  it('no longer seeds the trend chart with invented days', () => {
    // The removed line read:
    //   return days.map((d, i) => ({ ...d, count: d.count || (i % 2 === 0 ? 1 : 0), … }))
    assert.ok(
      !/count: d\.count \|\|/.test(dash),
      'the seven-day trend is padding empty days with invented counts again',
    );
    assert.match(dash, /days\.push\(\{ label, count, value: Math\.round\(value\) \}\);[\s\S]{0,80}return days;/);
  });

  it('shows the seeded roster only in demo mode', () => {
    assert.match(
      dash,
      /backendMode \? \[\] : getDemoTeamMembers\(\)/,
      'Team Pulse is showing invented colleagues beside a real pipeline again',
    );
  });

  it('reads an unloaded roster as unknown, never as zero', () => {
    // `null` is the model's UNKNOWN. A failed or skipped roster load must not
    // become the number 0, which the model would read as "you are alone here".
    assert.match(dash, /setLiveTeamMemberCount\(result\.members\?\.length \?\? null\)/);
    assert.match(dash, /if \(!cancelled\) setLiveTeamMemberCount\(null\);/);
  });

  it('fetches the roster only for a role that can act on it', () => {
    assert.match(dash, /const needsRoster = backendMode && canAdministerTeam\(teamRole\)/);
  });
});

// ── 6. The bell cannot take down the console ─────────────────────────────────

describe('the notification centre survives a malformed response', () => {
  const bell = stripComments(read('src/app/components/NotificationCenter.tsx'));

  it('narrows the payload before it reaches state', () => {
    // `getNotifications` returns `data as { notifications: … }` — an assertion,
    // not a check. A 200 without the field set state to `undefined`, and the
    // next render read `.length` and threw. The bell is in the shell header on
    // every page, so that one response replaced the whole console with the
    // route error boundary.
    assert.match(
      bell,
      /setNotifications\(Array\.isArray\(res\?\.notifications\) \? res\.notifications : \[\]\)/,
      'the notification list is written to state unchecked again',
    );
    assert.match(
      bell,
      /typeof res\?\.unreadCount === 'number' && Number\.isFinite\(res\.unreadCount\)/,
      'the unread count is written to state unchecked again',
    );
  });
});

// ── The shells no longer hand-build what the primitives provide ──────────────

describe('the shells use the shared states rather than local ones', () => {
  it('loads a lazy panel through the shared loading state', () => {
    const shell = stripComments(read('src/app/components/TeamDashboardNew.tsx'));
    assert.match(shell, /<LoadingState label="Loading this section"/);
    assert.ok(
      !/@keyframes pulse/.test(shell),
      'the panel skeleton is hand-rolling its own animation again',
    );
  });

  it('gives the empty team roster somewhere to go', () => {
    const team = stripComments(read('src/app/components/TeamManagement.tsx'));
    assert.match(team, /<EmptyState/);
    assert.ok(
      !/No team members found/.test(team),
      'the roster empty state is back to stating an absence and offering nothing',
    );
    // And the offer is made only to somebody the server would let act on it.
    assert.match(team, /action=\{mayAdminister \?/);
  });

  it('reads its palette from the tokens rather than declaring seven hexes', () => {
    const dash = stripComments(read('src/app/components/TeamHomeDashboard.tsx'));
    for (const [name, value] of [
      ['PURPLE', 'brand.accent'], ['BLUE', 'brand.accentAlt'],
      ['CYAN', 'status.info'], ['GREEN', 'status.success'],
      ['ORANGE', 'status.warning'], ['RED', 'status.danger'],
      ['GRAY', 'status.neutral'],
    ]) {
      assert.match(
        dash,
        new RegExp(`const ${name}\\s*=\\s*${value.replace('.', '\\.')};`),
        `${name} is not read from the token layer`,
      );
    }
    // And the values it now reads are the ones the product already rendered.
    assert.equal(CORTEX_TOKENS['--cortex-accent'], '#8B5CF6');
    assert.equal(CORTEX_TOKENS['--cortex-status-neutral'], '#7A7A86');
  });
});

// ── The settings screen never renders values that were never the user's ──────

describe('the settings screen refuses to substitute data for a failed load', () => {
  const settings = stripComments(read('src/app/components/SettingsPage.tsx'));

  it('declares its demo settings once, against the real response shape', () => {
    // There used to be TWO copies of this object — one for demo mode, one
    // substituted on a failed live request — and both were written against an
    // older `PlatformSettings`: `companyName`, `companyEmail`,
    // `emailNotifications` and five other fields the server neither sends nor
    // stores, with `brandingName`, `defaultAssignee`, `autoAssign` and
    // `notificationPrefs` — the fields this page renders — absent entirely.
    assert.equal((settings.match(/function demoSettings\(\): SettingsResponse/g) ?? []).length, 1);
    assert.ok(
      !/companyName:/.test(settings),
      'the settings fallback is back to a shape the server does not use',
    );
    for (const field of ['brandingName:', 'defaultAssignee:', 'autoAssign:', 'notificationPrefs:']) {
      assert.ok(settings.includes(field), `the demo settings omit ${field}`);
    }
  });

  it('reports a failed load instead of pre-filling the form', () => {
    // `NotificationSettings` initialises its toggles from
    // `{ ...settings.notificationPrefs }` and Save writes them back, so a
    // substituted object is a form of values that were never the user's, one
    // click from being persisted over the real configuration.
    assert.match(settings, /setData\(null\);\s*\n\s*setError\(/);
    assert.match(settings, /if \(error \|\| !data\) \{/, 'the screen renders without data');
    assert.ok(
      !/shouldShowApiErrors/.test(settings),
      'the screen is choosing again between reporting a failure and hiding it',
    );
  });

  it('uses the shared loading and error states', () => {
    assert.match(settings, /<LoadingState label="Loading settings"/);
    assert.match(settings, /<ErrorState[\s\S]{0,200}Settings could not be loaded/);
  });

  it('declares its toggles as switches with a readable state and a name', () => {
    // The toggle was a bare `<button>` whose entire state lived in a background
    // colour. A screen-reader user was told "button" and nothing else — not
    // what it controls, and not whether the notification it governs is on —
    // which made the notification settings unusable without sight.
    assert.match(settings, /role="switch"/, 'the toggle is not declared as a switch');
    assert.match(settings, /aria-checked=\{checked\}/, 'the toggle state is not readable');
    assert.match(settings, /aria-label=\{label\}/, 'the toggle has no accessible name');
    // Every call site supplies that name.
    const calls = settings.match(/<Toggle\b[^/]*\/>/g) ?? [];
    assert.ok(calls.length > 0, 'no toggles found');
    for (const call of calls) {
      assert.match(call, /label=/, `a toggle is rendered without a label: ${call}`);
    }
  });
});
