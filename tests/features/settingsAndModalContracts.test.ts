/**
 * FRONTEND CONTRACT REPAIRS — settings fixture, milestone modal, icon tooltip
 *
 * Three confirmed defects, each of which typecheck:web had been reporting as a
 * type error while the user-visible consequence went unnoticed.
 *
 *   1. SettingsPage.tsx(93,13) and (140,13) TS2353
 *      'companyName' does not exist in type 'PlatformSettings'.
 *
 *      Both demo fixtures modelled a settings schema the platform no longer
 *      has. `GET /settings` returns `brandingName`, `defaultAssignee`,
 *      `autoAssign` and `notificationPrefs`; the fixtures supplied none of
 *      those four and eight fields nothing reads (companyName, companyEmail,
 *      reportFromName, reportFromEmail, emailDeliveryMethod, emailSubjectLine,
 *      smtpConfigured, emailNotifications). TypeScript reported only
 *      `companyName` because excess-property checking stops at the first
 *      unknown key, which is why the other seven were never chased.
 *
 *      The consequence was in the notification panel: it initialises from
 *      `{ ...settings.notificationPrefs }`, and in demo mode that spread an
 *      `undefined` into an empty object, so every toggle rendered from nothing
 *      while the fixture's `emailNotifications` values sat unread beside it.
 *
 *   2. DiagnosticQuestion.tsx(289,10) TS2741
 *      Property 'isOpen' is missing but required in 'ProgressModalProps'.
 *
 *      ProgressModal renders `<AnimatePresence>{isOpen && …}</AnimatePresence>`.
 *      DiagnosticQuestion mounted it under `{showModal && …}` but never passed
 *      `isOpen`, so the prop was `undefined`, the inner guard was falsy, and
 *      the 25/50/75 % milestone celebration NEVER RENDERED — the component
 *      mounted and drew nothing.
 *
 *   3. ExportPanel.tsx(660,66) TS2322
 *      Property 'title' does not exist on the lucide icon props.
 *
 *      Lucide spreads unknown props onto the `<svg>`, and SVG has no `title`
 *      attribute — a tooltip there needs a `<title>` CHILD element. So the
 *      "Immutable snapshot" tooltip on the snapshot lock never appeared. The
 *      tooltip now sits on a wrapper span, with an aria-label on the icon.
 *
 * All three are client-side and change no request, header or stored record.
 *
 * TESTING APPROACH (documented limitation)
 *   These are .tsx components; the repository ships no React test renderer and
 *   the runner (`node --experimental-strip-types`) strips types but does not
 *   transform JSX, so they cannot be mounted here. Following the established
 *   pattern in frontendRuntimeDefects.test.ts and frontendIconContracts.test.ts,
 *   each guarantee is enforced structurally against the production source with
 *   pattern-based assertions, never line numbers.
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

const settingsPage = stripComments(readSource('src/app/components/SettingsPage.tsx'));
const api = stripComments(readSource('src/app/lib/api.ts'));
const diagnosticQuestion = stripComments(readSource('src/app/components/DiagnosticQuestion.tsx'));
const exportPanel = stripComments(readSource('src/app/components/ExportPanel.tsx'));

describe('SettingsPage — the demo fixture matches the settings contract', () => {
  it('supplies every field the page actually reads', () => {
    // The page reads exactly these four off `settings`.
    for (const field of ['brandingName', 'defaultAssignee', 'autoAssign', 'notificationPrefs']) {
      assert.match(
        settingsPage,
        new RegExp(`platformSettings:\\s*\\{[\\s\\S]*?\\b${field}\\b`),
        `the demo fixture must supply ${field}, which the page reads`,
      );
    }
  });

  it('carries none of the fields from the retired settings schema', () => {
    for (const dead of [
      'companyName', 'companyEmail', 'reportFromName', 'reportFromEmail',
      'emailDeliveryMethod', 'emailSubjectLine', 'smtpConfigured', 'emailNotifications',
    ]) {
      assert.doesNotMatch(
        settingsPage,
        new RegExp(`\\b${dead}\\s*:`),
        `${dead} is not part of PlatformSettings and nothing reads it`,
      );
    }
  });

  it('uses the notificationPrefs keys the server sends, not the retired ones', () => {
    // The panel spreads settings.notificationPrefs directly, so a key that
    // disagrees with the server silently renders a toggle from undefined.
    for (const key of [
      'newSubmission', 'reportReady', 'teamActivity', 'weeklyDigest',
      'proposalViewed', 'proposalAccepted', 'messageReceived',
    ]) {
      assert.match(settingsPage, new RegExp(`\\b${key}\\s*:`), `notificationPrefs.${key} is missing`);
      assert.match(api, new RegExp(`\\b${key}\\s*:`), `${key} must still be part of PlatformSettings`);
    }
    assert.doesNotMatch(settingsPage, /\bsubmissionReceived\s*:/, 'submissionReceived was the retired name for newSubmission');
    assert.doesNotMatch(settingsPage, /\breviewComplete\s*:/, 'reviewComplete has no counterpart on the server');
  });

  it('both fixtures were repaired, not just the first', () => {
    // One serves the backend-disabled path, the other the error fallback.
    const occurrences = settingsPage.match(/brandingName:\s*'CORTEX Intelligence'/g) ?? [];
    assert.equal(occurrences.length, 2, 'both demo fixtures must carry the corrected shape');
  });
});

describe('DiagnosticQuestion — the milestone modal is actually opened', () => {
  it('passes isOpen to ProgressModal', () => {
    assert.match(
      diagnosticQuestion,
      /<ProgressModal[\s\S]{0,200}?isOpen=\{showModal\}/,
      'ProgressModal gates its own body on isOpen; without the prop it renders nothing',
    );
  });

  it('ProgressModal still gates on isOpen, so the prop remains load-bearing', () => {
    const modal = stripComments(readSource('src/app/components/ProgressModal.tsx'));
    assert.match(modal, /\{isOpen && \(/, 'if this guard goes, the assertion above stops meaning anything');
    assert.match(modal, /isOpen:\s*boolean;/, 'isOpen must stay required');
  });
});

describe('ExportPanel — the snapshot tooltip is on an element that can show one', () => {
  it('does not put a title prop on the lucide icon', () => {
    assert.doesNotMatch(
      exportPanel,
      /<Lock[^>]*\stitle=/,
      'lucide spreads unknown props onto the svg, which has no title attribute',
    );
  });

  it('keeps the tooltip text on a wrapper that renders it', () => {
    assert.match(exportPanel, /<span title="Immutable snapshot"/);
    assert.match(exportPanel, /<Lock[^>]*aria-label="Immutable snapshot"/);
  });
});
