/**
 * NAVIGATION AS ONE CANONICAL MODEL — UI Sprint 1.
 *
 * Product Experience Ch. 21 is the authority for this suite.
 *
 * THE DEFECT THIS CLOSES
 *   Cortex had four navigation surfaces and they described four different
 *   products:
 *
 *     the sidebar               — eleven destinations, one flat list
 *     the command palette       — FOUR of those eleven
 *     the layout's accelerators — four, hand-listed
 *     the shortcuts help sheet  — four, hand-listed again, and already stale
 *
 *   Ch. 21.4 names this exactly: "Navigation should never create duplicate
 *   realities." Seven destinations were findable only by already knowing where
 *   they were, and the help sheet advertised an accelerator table that was not
 *   the one the layout registered.
 *
 *   Worse, one destination existed on NO surface. AI-01 Batches 1-4F built a
 *   ten-tab AI Control Plane — providers, routing, agents, workflows, budget,
 *   usage, audit, diagnostics — reachable only at Settings -> AI -> a sub-tab.
 *   To anyone using the running product, the platform's central governance
 *   surface was invisible.
 *
 * THE SHAPE OF THE FIX
 *   One module, `navigationModel.ts`, describes every destination once, grouped
 *   by the operator's intent (Ch. 21.2). All four surfaces derive from it.
 *   Adding a destination is one entry (Ch. 21.6 — growth adds depth, not
 *   complexity).
 *
 * TESTING APPROACH
 *   navigationModel.ts imports only lucide-react, so the runner can import it:
 *   the model's own guarantees are proven BEHAVIOURALLY. The four consuming
 *   surfaces are .tsx, so — following frontendRuntimeDefects and the other
 *   frontend contract suites — their derivation is enforced structurally, with
 *   pattern-based assertions rather than line numbers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  NAV_GROUPS,
  DESTINATIONS,
  SHORTCUT_DESTINATIONS,
  getDestination,
  destinationLabel,
  type DestinationId,
} from '../../src/app/core/navigationModel.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const LAYOUT   = 'src/app/components/TeamDashboardLayout.tsx';
const PALETTE  = 'src/app/components/CommandPalette.tsx';
const HELP     = 'src/app/components/KeyboardShortcutsHelp.tsx';
const SHELL    = 'src/app/components/TeamDashboardNew.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// THE MODEL — behavioural
// ─────────────────────────────────────────────────────────────────────────────

describe('the navigation model is internally coherent', () => {
  it('every destination is reachable from exactly one group', () => {
    const seen = new Map<DestinationId, number>();
    for (const group of NAV_GROUPS) {
      for (const destination of group.destinations) {
        seen.set(destination.id, (seen.get(destination.id) ?? 0) + 1);
      }
    }
    for (const [id, count] of seen) {
      assert.equal(count, 1, `${id} appears in ${count} groups — pick one`);
    }
    assert.equal(seen.size, DESTINATIONS.length);
  });

  it('every destination declares the group it is filed under', () => {
    for (const group of NAV_GROUPS) {
      for (const destination of group.destinations) {
        assert.equal(
          destination.group, group.id,
          `${destination.id} is filed under ${group.id} but declares ${destination.group}`,
        );
      }
    }
  });

  it('DESTINATIONS is the flattened groups, in sidebar order', () => {
    assert.deepEqual(
      DESTINATIONS.map(d => d.id),
      NAV_GROUPS.flatMap(g => g.destinations.map(d => d.id)),
    );
  });

  it('every destination is complete enough for every surface to render it', () => {
    for (const destination of DESTINATIONS) {
      assert.ok(destination.label.trim().length > 0, `${destination.id} needs a label`);
      assert.ok(
        destination.description.trim().length > 0,
        `${destination.id} needs a description — the command palette renders it`,
      );
      // A lucide icon is a forwardRef object, not a plain function.
      assert.ok(
        destination.icon &&
          ['function', 'object'].includes(typeof destination.icon),
        `${destination.id} needs a renderable icon component`,
      );
      assert.ok(
        destination.keywords.length > 0,
        `${destination.id} needs keywords — Ch. 21.2 wants search by intent`,
      );
    }
  });

  it('no two destinations share an accelerator digit', () => {
    const digits = SHORTCUT_DESTINATIONS.map(d => d.shortcutDigit);
    assert.deepEqual(digits, [...new Set(digits)], 'an accelerator must go one place');
    assert.deepEqual(digits, [...digits].sort((a, b) => a - b), 'digits come in order');
  });

  it('resolves a destination and its label by id', () => {
    for (const destination of DESTINATIONS) {
      assert.equal(getDestination(destination.id), destination);
      assert.equal(destinationLabel(destination.id), destination.label);
    }
  });

  it('degrades to the raw id rather than throwing on an unknown destination', () => {
    // A stale sessionStorage value must not take down the shell.
    assert.equal(destinationLabel('not-a-destination' as DestinationId), 'not-a-destination');
    assert.equal(getDestination('not-a-destination' as DestinationId), undefined);
  });
});

describe('the model is grouped by intent, not by subsystem', () => {
  it('groups are named for what the operator is trying to do', () => {
    // Ch. 21.2 — "Users should navigate by intent, not by interface."
    assert.deepEqual(
      NAV_GROUPS.map(g => g.id),
      ['work', 'understand', 'deliver', 'operate', 'administer', 'platform'],
    );
  });

  it('no group is empty', () => {
    for (const group of NAV_GROUPS) {
      assert.ok(group.destinations.length > 0, `${group.id} has no destinations`);
      assert.ok(group.label.trim().length > 0, `${group.id} has no label`);
    }
  });
});

describe('the AI Control Plane is a first-class destination', () => {
  const controlPlane = getDestination('control-plane');

  it('exists in the navigation model at all', () => {
    // It was reachable ONLY at Settings -> AI -> a sub-tab, which is to say
    // not reachable: nothing in the navigation named it.
    assert.ok(controlPlane, 'the AI Control Plane must be a destination');
  });

  it('is filed under an operating intent, not under administration', () => {
    assert.equal(controlPlane!.group, 'operate');
  });

  it('carries an accelerator, like the other primary destinations', () => {
    assert.equal(typeof controlPlane!.shortcutDigit, 'number');
  });

  it('is findable by the words an operator would actually search', () => {
    for (const term of [
      'provider', 'routing', 'agent', 'workflow', 'budget', 'usage', 'audit', 'byok',
    ]) {
      assert.ok(
        controlPlane!.keywords.includes(term),
        `an operator searching "${term}" must find the control plane`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR SURFACES — structural
// ─────────────────────────────────────────────────────────────────────────────

describe('every navigation surface derives from the one model', () => {
  const layout  = stripComments(readSource(LAYOUT));
  const palette = stripComments(readSource(PALETTE));
  const help    = stripComments(readSource(HELP));

  it('the sidebar renders the model\'s groups, and keeps no list of its own', () => {
    assert.match(layout, /from '@\/app\/core\/navigationModel'/);
    assert.ok(
      !/const navItems\s*=/.test(layout),
      'the sidebar must not keep a second destination list',
    );
    assert.ok(
      /NAV_GROUPS\.map\(group =>/.test(layout),
      'the sidebar renders the model\'s intent groups',
    );
    assert.ok(
      /group\.destinations\.map\(destination =>/.test(layout),
      'and each group\'s destinations',
    );
  });

  it('the command palette generates its navigation commands from the model', () => {
    assert.match(palette, /from '@\/app\/core\/navigationModel'/);
    assert.ok(
      /\.\.\.DESTINATIONS\.map\(\(destination\): Command =>/.test(palette),
      'the palette must offer every destination, not a hand-picked four',
    );
    for (const id of ['dashboard', 'cortex', 'team', 'settings']) {
      assert.ok(
        !new RegExp(`id:\\s*'nav-${id}'`).test(palette),
        `nav-${id} must come from the model, not a literal entry`,
      );
    }
  });

  it('the layout registers accelerators from the model', () => {
    assert.ok(
      /\.\.\.SHORTCUT_DESTINATIONS\.map\(destination =>/.test(layout),
      'the accelerator table must be derived',
    );
    assert.ok(
      !/description: 'Go to CORTEX'/.test(layout),
      'no hand-listed accelerator may survive',
    );
  });

  it('the help sheet advertises the accelerators the layout registers', () => {
    assert.match(help, /from '@\/app\/core\/navigationModel'/);
    assert.ok(
      /\.\.\.SHORTCUT_DESTINATIONS\.map\(destination =>/.test(help),
      'the help sheet must be derived — it had already gone stale',
    );
    assert.ok(
      !/description: 'Go to Team'/.test(help),
      'the sheet claimed Cmd+3 went to Team; it does not',
    );
  });

  it('the layout types its current page as a model destination', () => {
    assert.match(layout, /currentPage:\s*DestinationId;/);
  });
});

describe('the shell renders what the model declares', () => {
  const shell = stripComments(readSource(SHELL));

  it('mounts the AI Control Plane as a page', () => {
    assert.match(shell, /from '@\/app\/core\/navigationModel'/);
    assert.ok(
      /currentPage === 'control-plane'/.test(shell),
      'the destination must render something',
    );
    assert.ok(
      /<AIAdministrationConsole[\s\S]{0,120}accessToken=\{accessToken\}/.test(shell),
      'the console needs the operator\'s token to resolve authority server-side',
    );
  });

  it('mounts the SAME console the Settings tab mounts, not a copy', () => {
    // Ch. 21.4 — different journeys, one canonical entity.
    const settings = stripComments(readSource('src/app/components/SettingsPage.tsx'));
    assert.match(settings, /<AIAdministrationConsole accessToken=\{accessToken\}/);
    assert.match(
      shell,
      /import\('@\/app\/components\/AIAdministrationConsole'\)/,
      'the shell must load the one console module',
    );
  });

  it('keeps the console a lazy chunk, so promoting it costs no first paint', () => {
    assert.ok(
      /const AIAdministrationConsole\s*=\s*lazy\(/.test(shell),
      'the console is 76kB — it must stay split',
    );
  });

  it('derives its valid-page set from the model', () => {
    assert.ok(
      /const SHELL_PAGES: ReadonlySet<DestinationId> = new Set\(\s*DESTINATIONS\.map/.test(shell),
      'the fallback guard must not keep a fourth hand-written list',
    );
    assert.ok(
      !/!\['dashboard', 'cortex', 'team', 'settings'/.test(shell),
      'the literal page array must be gone',
    );
  });

  it('takes its page type from the model', () => {
    assert.match(shell, /type PageView = DestinationId;/);
  });
});

describe('the collapsed sidebar is still labelled', () => {
  const layout = stripComments(readSource(LAYOUT));

  it('every destination button carries an accessible name', () => {
    // Collapsed to 80px only the icon renders. Without these the sidebar is
    // unreadable to a screen reader and unlabelled on hover.
    assert.ok(/aria-label=\{destination\.label\}/.test(layout));
    // Sprint 4 narrowed the tooltip to the DESKTOP collapsed rail: at compact
    // width the same nav is a drawer showing real labels, so a tooltip there
    // would be redundant. The guarantee is unchanged — an icon-only control is
    // always labelled — only the condition for "icon-only" got more precise.
    assert.ok(
      /title=\{sidebarCollapsed && !isCompact \? destination\.label : undefined\}/.test(layout),
    );
  });

  it('marks the active destination for assistive technology', () => {
    assert.ok(/aria-current=\{isActive \? 'page' : undefined\}/.test(layout));
  });

  it('names the primary navigation landmark', () => {
    assert.ok(/aria-label="Primary"/.test(layout));
  });
});

describe('the navigation model decides no authority', () => {
  const model = stripComments(readSource('src/app/core/navigationModel.ts'));

  it('names no role, permission or capability', () => {
    // Every surface it points at resolves the actor's role server-side and
    // renders its own unauthorized state. A client-side gate here would be a
    // check the server does not honour.
    for (const term of ['role', 'permission', 'canAccess', 'isAdmin', 'capability']) {
      assert.ok(
        !new RegExp(`\\b${term}\\b`, 'i').test(model),
        `the model must not reason about ${term}`,
      );
    }
  });

  it('reads no state and calls no service', () => {
    assert.ok(!/fetch\(|useState|useEffect|localStorage|sessionStorage/.test(model));
    assert.ok(
      !/from '@\/app\/(services|lib)/.test(model),
      'the model is a description, not a client',
    );
  });
});
