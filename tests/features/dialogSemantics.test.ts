/**
 * UI SPRINT 7 — dialogs that the browser and the screen reader both know are
 * dialogs.
 *
 * THE STATE THIS FOUND
 *   The console and the funnel between them hand-rolled EIGHTEEN overlays —
 *   `fixed inset-0`, a backdrop, a panel — and NOT ONE declared `role="dialog"`
 *   or `aria-modal`. The consequences were the same every time:
 *
 *   * A screen reader is never told a dialog opened.
 *   * The page behind stays in the tab order, so Tab walks out of the dialog
 *     into content the overlay is covering, where clicks hit the backdrop.
 *   * Focus is never moved in, so a keyboard user is left on a trigger now
 *     hidden behind the overlay.
 *   * Focus is never restored, so dismissing drops the user at the top of the
 *     document.
 *   * The page behind scrolls under the overlay.
 *
 * AND ONE OUTRIGHT DEFECT
 *   `useKeyboardShortcuts` skipped every shortcut whose event originated in an
 *   `<input>` or `<textarea>` — sensible for a bare `d` or `/`, and wrong for
 *   Escape. The COMMAND PALETTE focuses its search box the moment it opens,
 *   which is the whole point of it, so its `useEscapeKey` handler hit that
 *   guard and never fired. A keyboard-first feature reached with ⌘K could not
 *   be closed with the keyboard at all; the only way out was clicking the
 *   backdrop.
 *
 * WHAT IS GUARDED
 *   The primitive's five behaviours, the migrated dialogs, the two shell
 *   overlays that keep their own focus handling but gained the declaration, and
 *   the Escape exemption.
 *
 * The behaviour was verified in Chromium: the invite dialog is named "Invite a
 * team member", focus moves into it, the body scroll locks, focus does not
 * escape across 25 consecutive Tab presses, Escape closes it, the scroll is
 * restored, and focus returns to the "Invite Member" button that opened it.
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

describe('the Modal primitive does the five things every overlay needed', () => {
  const modal = stripComments(read('src/app/components/ui/cortex/Modal.tsx'));

  it('declares itself as a modal dialog with a name', () => {
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-labelledby=\{titleId\}/);
  });

  it('always renders the name, even when it is visually hidden', () => {
    // `hideTitle` must remove the heading from SIGHT only — a nameless dialog
    // is announced as "dialog" and nothing else.
    assert.match(modal, /hideTitle \? 'sr-only'/);
  });

  it('moves focus in and restores it on close', () => {
    assert.match(modal, /restoreFocusTo\.current = document\.activeElement/);
    assert.match(modal, /\(first \?\? panel\)\?\.focus\(\)/);
    assert.match(modal, /restoreFocusTo\.current\?\.focus\?\.\(\)/);
  });

  it('traps Tab in both directions', () => {
    assert.match(modal, /if \(event\.shiftKey && \(active === first \|\| active === panel\)\)/);
    assert.match(modal, /\} else if \(!event\.shiftKey && active === last\)/);
  });

  it('keeps focus on the panel when there is nothing else to move to', () => {
    // Otherwise Tab escapes an empty dialog into the page behind it.
    assert.match(modal, /if \(focusable\.length === 0\) \{[\s\S]{0,200}panel\.focus\(\);/);
  });

  it('closes on Escape', () => {
    assert.match(modal, /if \(event\.key === 'Escape'\)/);
  });

  it('locks the background scroll and restores what was there', () => {
    // Not a hard-coded empty string — that would clobber a page that had set it.
    assert.match(modal, /const previous = document\.body\.style\.overflow;/);
    assert.match(modal, /document\.body\.style\.overflow = previous;/);
  });

  it('hides the backdrop rather than the document', () => {
    // Hiding the whole document would hide the dialog with it.
    assert.match(modal, /className="absolute inset-0 bg-black\/70 backdrop-blur-sm"[\s\S]{0,120}aria-hidden="true"/);
  });
});

describe('the console dialogs use it', () => {
  const team = read('src/app/components/TeamManagement.tsx');

  it('the invite dialog is a Modal', () => {
    assert.match(team, /<Modal\s+open\s+onClose=\{onClose\}/);
    assert.match(team, /title=\{showingCredentials \? 'Member created' : 'Invite a team member'\}/);
  });

  it('the invite dialog stops being backdrop-dismissible once the password is on screen', () => {
    // The temporary password is shown once and cannot be recovered. Losing it
    // to a stray click beside the dialog means the new member cannot sign in.
    assert.match(team, /dismissOnBackdrop=\{!showingCredentials\}/);
  });

  it('the confirm-remove dialog cannot be dismissed by a stray click', () => {
    assert.match(team, /dismissOnBackdrop=\{false\}/);
    assert.match(team, /title="Remove team member\?"/);
  });

  it('has no hand-rolled overlay left in this file', () => {
    assert.ok(
      !/fixed inset-0 bg-black\/70 backdrop-blur-sm z-50/.test(stripComments(team)),
      'a hand-rolled modal overlay is back in TeamManagement',
    );
  });
});

describe('the shell overlays keep their own focus handling and gain the declaration', () => {
  // These two manage focus and keyboard navigation well already — the palette
  // focuses its search box and drives arrows and Enter. Wrapping them in the
  // shared Modal would compete for both. What they lacked was the declaration.
  const CASES: [file: string, label: string][] = [
    ['src/app/components/CommandPalette.tsx', 'Command palette'],
    ['src/app/components/KeyboardShortcutsHelp.tsx', 'Keyboard shortcuts'],
  ];

  for (const [rel, label] of CASES) {
    it(`${rel.split('/').pop()} declares itself as "${label}"`, () => {
      const source = read(rel);
      assert.match(source, /role="dialog"/);
      assert.match(source, /aria-modal="true"/);
      assert.ok(source.includes(`aria-label="${label}"`), `${rel} is not named`);
    });
  }
});

describe('Escape is not suppressed for being inside a text field', () => {
  const hook = stripComments(read('src/app/hooks/useKeyboardShortcuts.tsx'));

  it('exempts Escape from the input-field guard', () => {
    assert.match(
      hook,
      /const isInputField =\s*event\.key !== 'Escape' && \(/,
      'Escape is being swallowed inside inputs again — the command palette cannot be closed with the keyboard',
    );
  });

  it('keeps the guard for every other key', () => {
    // The guard exists so a bare `d` or `/` does not fire while somebody types.
    // Escape is not a typing key; nothing else changes.
    assert.match(hook, /target\.tagName === 'INPUT' \|\|/);
    assert.match(hook, /target\.tagName === 'TEXTAREA' \|\|/);
    assert.match(hook, /target\.isContentEditable/);
    assert.match(hook, /if \(isInputField\) continue;/);
  });
});
