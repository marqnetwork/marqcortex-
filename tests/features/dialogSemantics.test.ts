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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the Modal primitive wears the chrome and delegates the behaviour', () => {
  const modal = stripComments(read('src/app/components/ui/cortex/Modal.tsx'));

  it('takes its dialog attributes from the shared hook', () => {
    // The four behaviours moved into `useDialogBehavior` so an overlay that
    // cannot wear this chrome can still have them. The suite below asserts the
    // behaviours themselves at the hook; here we only assert that Modal uses it
    // rather than keeping a second copy.
    assert.match(modal, /useDialogBehavior\(\{/);
    assert.match(modal, /labelledBy: titleId/);
    assert.match(modal, /describedBy: description \? descriptionId : undefined/);
    assert.match(modal, /<div\s+\{\.\.\.dialogProps\}/);
  });

  it('always renders the name, even when it is visually hidden', () => {
    // `hideTitle` must remove the heading from SIGHT only — a nameless dialog
    // is announced as "dialog" and nothing else.
    assert.match(modal, /hideTitle \? 'sr-only'/);
  });

  it('hides the backdrop rather than the document', () => {
    // Hiding the whole document would hide the dialog with it.
    assert.match(modal, /className="absolute inset-0 bg-black\/70 backdrop-blur-sm"[\s\S]{0,120}aria-hidden="true"/);
  });

  it('offers a named close control', () => {
    assert.match(modal, /aria-label="Close"/);
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

describe('the behaviour is reusable, so an overlay with its own shape can have it', () => {
  const hook = stripComments(read('src/app/components/ui/cortex/useDialogBehavior.ts'));

  it('carries all four behaviours', () => {
    assert.match(hook, /restoreFocusTo\.current = document\.activeElement/);
    assert.match(hook, /restoreFocusTo\.current\?\.focus\?\.\(\)/);
    assert.match(hook, /if \(event\.key === 'Escape'\)/);
    assert.match(hook, /if \(event\.key !== 'Tab'\) return;/);
    assert.match(hook, /document\.body\.style\.overflow = previous;/);
  });

  it('returns the attributes the caller owes, so spreading them is the contract', () => {
    // The hook cannot add these itself — they belong on the caller's element.
    assert.match(hook, /role: 'dialog' as const/);
    assert.match(hook, /'aria-modal': true as const/);
    assert.match(hook, /'aria-label': label/);
    assert.match(hook, /'aria-labelledby': labelledBy/);
    assert.match(hook, /tabIndex: -1/);
  });

  it('is what Modal is built on, so the behaviour exists once', () => {
    const modal = stripComments(read('src/app/components/ui/cortex/Modal.tsx'));
    assert.match(modal, /useDialogBehavior\(\{/);
    assert.match(modal, /<div\s+\{\.\.\.dialogProps\}/);
    // And no longer carries its own copy.
    assert.ok(!/document\.body\.style\.overflow = 'hidden'/.test(modal), 'Modal has a second copy of the scroll lock');
  });
});

describe('the funnel overlays that interrupt the user now behave', () => {
  const CASES: [file: string, label: string, why: string][] = [
    [
      'src/app/components/ExitIntentPopup.tsx',
      'Before you go',
      'appears UNPROMPTED — a modal nobody asked for, that could not be escaped',
    ],
    [
      'src/app/components/ProgressModal.tsx',
      '',
      'appears MID-DIAGNOSTIC, over a form the user is part-way through',
    ],
    [
      'src/app/components/InstantBooking.tsx',
      'Book a strategy call',
      'a date grid, a time grid and two actions to Tab through',
    ],
  ];

  for (const [file, label, why] of CASES) {
    it(`${file.split('/').pop()} — ${why}`, () => {
      const source = read(file);
      assert.match(source, /useDialogBehavior\(/, `${file} does not use the shared behaviour`);
      assert.match(source, /\{\.\.\.dialogProps\}/, `${file} does not spread the dialog attributes`);
      // The name may be passed as a hook option (`label: '…'`) or through a
      // prop on a wrapper that forwards it (`label="…"`). Both are the name.
      if (label) {
        assert.ok(
          source.includes(`label: '${label}'`) || source.includes(`label="${label}"`),
          `${file} is not named`,
        );
      }
    });
  }

  it('names the exit popup differently for its offer and its confirmation', () => {
    // One overlay, two contents. A dialog whose name does not change when its
    // content does is announced as the wrong thing.
    const popup = read('src/app/components/ExitIntentPopup.tsx');
    assert.match(popup, /label="Before you go"/);
    assert.match(popup, /label="Your guide is on its way"/);
  });

  it('names the progress modal by the milestone it is reporting', () => {
    const progress = read('src/app/components/ProgressModal.tsx');
    assert.match(progress, /label: `You are \$\{milestone\}% through the diagnostic`/);
  });

  it('gives the exit popup email field a name of its own', () => {
    assert.match(read('src/app/components/ExitIntentPopup.tsx'), /aria-label="Your email address"/);
  });
});

describe('every hand-rolled overlay in the app is accounted for', () => {
  /**
   * The sweep that started this work found eighteen `fixed inset-0` overlays in
   * `src/app/components`, and NOT ONE of them declared itself. This test is the
   * completeness check: every such file must now either declare a dialog, use
   * the shared behaviour, or be something that is legitimately not a dialog and
   * say which — a wait (`role="status"`) or a decorative backdrop
   * (`aria-hidden`). A new overlay that declares nothing fails here.
   */
  const COMPONENTS_DIR = 'src/app/components';

  function overlayFiles(): string[] {
    return readdirSync(join(REPO_ROOT, COMPONENTS_DIR))
      .filter(name => name.endsWith('.tsx'))
      .filter(name => read(`${COMPONENTS_DIR}/${name}`).includes('fixed inset-0'));
  }

  it('found the overlays this sweep was about', () => {
    // A sanity check on the discovery itself: if this drops to a handful, the
    // test below is passing vacuously.
    assert.ok(overlayFiles().length >= 15, `only ${overlayFiles().length} overlay files found`);
  });

  it('leaves no overlay that declares nothing', () => {
    const undeclared: string[] = [];
    for (const name of overlayFiles()) {
      const source = read(`${COMPONENTS_DIR}/${name}`);
      const declares =
        source.includes('role="dialog"') ||       // declared inline
        source.includes('dialogProps') ||          // uses the shared behaviour
        source.includes('role="status"') ||        // a wait, not a dialog
        source.includes('aria-hidden="true"');     // a decorative backdrop
      if (!declares) undeclared.push(name);
    }
    assert.deepEqual(
      undeclared, [],
      `these overlays announce themselves as nothing: ${undeclared.join(', ')}`,
    );
  });

  it('names every overlay that uses the shared behaviour', () => {
    const unnamed: string[] = [];
    for (const name of overlayFiles()) {
      const source = read(`${COMPONENTS_DIR}/${name}`);
      if (!source.includes('useDialogBehavior(')) continue;
      // Read the CALL, not the file: a name may be a literal, a template, a
      // forwarded prop (`{ open, onClose, label }`) or a `labelledBy` id, and
      // all four are names. What must not happen is a call that passes none.
      for (const call of source.match(/useDialogBehavior\(\{[^}]*\}/g) ?? []) {
        if (!/\blabel\b|\blabelledBy\b/.test(call)) unnamed.push(`${name}: ${call.slice(0, 60)}`);
      }
    }
    assert.deepEqual(unnamed, [], `these dialogs have no accessible name: ${unnamed.join(', ')}`);
  });

  it('treats the submitting overlay as a wait rather than a dialog', () => {
    // Nothing in it is interactive and there is nothing to dismiss. It was
    // silent, so a screen-reader user saw their submission apparently do
    // nothing.
    const score = read('src/app/components/ScorePage.tsx');
    assert.match(score, /role="status" aria-live="polite" aria-busy="true"/);
    assert.ok(!/role="dialog"/.test(score), 'the submitting overlay is being declared a dialog');
  });
});
