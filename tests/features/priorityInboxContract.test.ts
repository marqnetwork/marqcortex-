/**
 * THE PRIORITY INBOX — UI Sprint 3.
 *
 * Ch. 21.2 puts "I need today's priorities" first among the intents navigation
 * exists to serve, and the team dashboard's Priority Actions inbox is where
 * that intent lands. Two defects in it, both confirmed:
 *
 *   1. THE PRIMARY ACTION WAS HOVER-ONLY. Each priority row's action lived on a
 *      button held at `opacity-0` until `:hover`. On any touch device there is
 *      no hover, so the primary action of every item in the inbox was
 *      unreachable; it was also invisible to keyboard focus and to a screen
 *      reader scanning for controls. Ch. 21.10 asks for one navigation model
 *      across interaction modes, and a hover-only affordance is not one.
 *
 *      The row itself is now the control. The CTA is an affordance beside it —
 *      always visible, brightening on hover rather than appearing — and
 *      `aria-hidden`, because it must not be a button nested inside a button.
 *
 *   2. THE COUNT DESCRIBED THE TRUNCATION, NOT THE BACKLOG. buildPriorityActions
 *      capped its result at six, and the header then counted that capped array:
 *      a team with twenty items needing attention was told "6 items need
 *      attention", and critical items past the cap were neither shown nor
 *      counted in the "N critical" badge. An operator reading a priority inbox
 *      that under-reports the backlog has been told something false about their
 *      own day.
 *
 *      The builder now returns the whole backlog and the cap is a display
 *      decision at the render, so the counts tell the truth and the footer says
 *      how many are not on screen.
 *
 * Also pinned: the dashboard's Quick Actions tiles name destinations from the
 * navigation model's type, so a renamed or mistyped destination is a compile
 * error rather than a tile that silently does nothing.
 *
 * TESTING APPROACH (documented limitation)
 *   TeamHomeDashboard is `.tsx` and the runner strips types but does not
 *   transform JSX, so it cannot be imported and rendered here. Following the
 *   established pattern (frontendRuntimeDefects / clientPortalAuthContract),
 *   each guarantee is enforced structurally against the production source, with
 *   pattern-based assertions rather than line numbers. The destination ids the
 *   dashboard names are checked BEHAVIOURALLY against the navigation model.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { getDestination } from '../../src/app/core/navigationModel.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const DASHBOARD = 'src/app/components/TeamHomeDashboard.tsx';
const raw  = readSource(DASHBOARD);
const code = stripComments(raw);

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ACTION IS REACHABLE WITHOUT A POINTER
// ─────────────────────────────────────────────────────────────────────────────

describe('every priority action is reachable without hover', () => {
  it('no control in the inbox is hidden behind :hover', () => {
    assert.ok(
      !/opacity-0 group-hover:opacity-100/.test(code),
      'a control revealed only on hover does not exist on a touch device',
    );
  });

  it('the row itself is the control', () => {
    assert.ok(
      /<motion\.button[\s\S]{0,400}?onClick=\{\(\) => onViewCortex\(item\.id\)\}/.test(code),
      'the priority row must be a real button carrying the action',
    );
    assert.ok(
      /type="button"/.test(code),
      'inside a form-less panel a bare <button> still defaults to submit',
    );
  });

  it('the row is focusable and shows where focus is', () => {
    assert.ok(
      /focus-visible:ring/.test(code),
      'a keyboard user must be able to see which priority item is focused',
    );
  });

  it('the row carries an accessible name naming the action and the subject', () => {
    assert.ok(
      /aria-label=\{`\$\{item\.actionLabel\}: \$\{item\.company\} — \$\{item\.detail\}`\}/.test(code),
      'the row is the control, so the row needs the name',
    );
  });

  it('the CTA is an affordance, not a nested button', () => {
    // A <button> inside a <button> is invalid HTML and its behaviour on click
    // is not something to rely on.
    const row = code.match(/<motion\.button[\s\S]*?<\/motion\.button>/);
    assert.ok(row, 'expected the priority row element');
    assert.ok(
      !/<button/.test(row[0]),
      'the CTA must not be a button nested inside the row button',
    );
    assert.ok(
      /aria-hidden="true"/.test(row[0]),
      'the CTA duplicates the row\'s own name and must not be announced twice',
    );
  });

  it('the CTA is visible before it is hovered', () => {
    // The accent is now said as the token rather than as its hex, so this
    // pins the two OPACITIES — which is what the guarantee always was: a
    // resting state that can be seen, and a hover that brightens it.
    assert.ok(
      /group-hover:bg-cortex-accent\/25/.test(code) && /bg-cortex-accent\/10/.test(code),
      'the CTA should brighten on hover, not appear on it',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE COUNTS DESCRIBE THE BACKLOG
// ─────────────────────────────────────────────────────────────────────────────

describe('the priority inbox counts what there is, not what fits', () => {
  it('the builder returns the whole backlog', () => {
    const builder = code.match(/function buildPriorityActions[\s\S]*?\n\}/);
    assert.ok(builder, 'expected buildPriorityActions');
    assert.ok(
      !/\.slice\(/.test(builder[0]),
      'capping in the builder is what made the header count the truncation',
    );
    assert.ok(/return actions\.sort\(/.test(builder[0]));
  });

  it('the cap is a display decision, applied at the render', () => {
    assert.match(code, /const PRIORITY_VISIBLE_LIMIT = \d+;/);
    assert.ok(
      /visiblePriorityItems = useMemo\(\s*\(\) => priorityItems\.slice\(0, PRIORITY_VISIBLE_LIMIT\)/.test(code),
      'the visible slice must be derived from the full list, not replace it',
    );
  });

  it('the header counts the full backlog', () => {
    assert.ok(
      /\{priorityItems\.length\} items need attention/.test(code),
      'the count must be over the whole backlog',
    );
    assert.ok(
      !/\{visiblePriorityItems\.length\} items need attention/.test(code),
      'counting the visible slice is the defect',
    );
  });

  it('the critical badge counts the full backlog', () => {
    assert.ok(
      /priorityItems\.filter\(a => a\.urgency === 'critical'\)\.length\} critical/.test(code),
      'a critical item past the cap was previously invisible AND uncounted',
    );
  });

  it('only the list is capped', () => {
    assert.ok(
      /visiblePriorityItems\.map\(\(item, i\) =>/.test(code),
      'the rendered list is the slice',
    );
  });

  it('says how many are not on screen', () => {
    assert.ok(
      /priorityItems\.length > visiblePriorityItems\.length/.test(code),
      'the list must not imply the backlog ends where it does',
    );
    assert.ok(/more not shown/.test(code));
  });

  it('still shows the all-clear state when there is genuinely nothing', () => {
    assert.ok(/priorityItems\.length === 0/.test(code));
    assert.ok(/All caught up!/.test(raw));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE SHORTCUT TILES NAME REAL DESTINATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('the dashboard shortcut tiles reach real destinations', () => {
  it('are typed against the navigation model', () => {
    assert.match(code, /import type \{ DestinationId \} from '@\/app\/core\/navigationModel'/);
    assert.ok(
      /satisfies \{[^}]*page: DestinationId \}\[\]\)/.test(code),
      'an untyped page string is a tile that silently does nothing',
    );
  });

  it('every tile names a destination the model declares', () => {
    // Behavioural: the ids are read out of the source and resolved against the
    // real model, so a tile pointing at a destination that no longer exists
    // fails here even if the type annotation were removed.
    const block = code.match(/satisfies \{[\s\S]{0,400}?page: DestinationId \}\[\]\)/);
    assert.ok(block, 'expected the typed tile array');
    const tiles = code.match(/\{ label: '[^']+',\s*sub: '[^']+',[\s\S]*?page: '([a-z-]+)' \}/g) ?? [];
    assert.ok(tiles.length >= 6, `expected the shortcut tiles, found ${tiles.length}`);
    for (const tile of tiles) {
      const id = tile.match(/page: '([a-z-]+)'/)![1];
      assert.ok(
        getDestination(id as never),
        `the shortcut tile points at '${id}', which is not a destination`,
      );
    }
  });
});
