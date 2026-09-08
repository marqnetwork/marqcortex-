/**
 * UI SPRINT 7 — the client portal must never show a client a report that is
 * not theirs.
 *
 * THE DEFECT
 *   `ClientPortal.loadSubmission` caught a failed live request and, whenever
 *   `SHOW_API_ERRORS` was off — WHICH IS THE DEFAULT — substituted
 *   `getDemoClientSubmission({ submissionId, companyName, clientEmail })`.
 *
 *   That helper takes the client's real company name and email as overrides and
 *   fills everything else from a seeded profile: the contact, the industry, the
 *   employee count, the revenue band, the completion, quality and AI scores,
 *   the ROI figure, and the diagnostic ANSWERS themselves. `generateClientReport`
 *   then derives the readiness report and its prioritised recommendations from
 *   those seeded answers.
 *
 *   So on any transient failure — an expired session, a cold edge function, a
 *   network blip — a client opened their portal and read a readiness score, a
 *   set of findings and a list of recommendations that were never derived from
 *   their diagnostic, under their own company name, with nothing on the page to
 *   say so. Not a degraded experience: a fabricated one, on the customer-facing
 *   surface.
 *
 *   `ClientMessaging` had the milder form of the same thing: a failed load
 *   cleared the thread AND cleared the error, so a client could conclude the
 *   team had never replied to them.
 *
 * WHAT IS GUARDED
 *   1. The portal reports a failed load; it does not substitute data.
 *   2. The demo submission is reachable only from the demo-mode branch.
 *   3. A response without a submission is treated as a failure, not as an
 *      empty portal.
 *   4. A background poll does not replace a report the client is reading.
 *   5. The portal has a main landmark and a skip link past its eight tabs.
 *
 * These are structural assertions against the production source — the runner
 * strips types but does not transform JSX, so the component cannot be rendered
 * here. The behaviour itself was verified in Chromium against a stubbed backend
 * returning 503: the portal showed "Your report could not be loaded" with a
 * `role="alert"`, and leaked no part of the seeded profile.
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

const PORTAL = 'src/app/components/ClientPortal.tsx';
const MESSAGING = 'src/app/components/ClientMessaging.tsx';

describe('a failed load never becomes a fabricated report', () => {
  const portal = stripComments(read(PORTAL));

  it('does not choose between reporting a failure and hiding it', () => {
    assert.ok(
      !/shouldShowApiErrors/.test(portal),
      'the portal is deciding again whether to hide a failure behind demo data',
    );
  });

  it('reaches the demo submission only from the demo-mode branch', () => {
    const calls = portal.match(/getDemoClientSubmission\(/g) ?? [];
    assert.equal(calls.length, 1, `getDemoClientSubmission is called ${calls.length} times`);
    // And that one call is above the network request, inside the
    // `!isBackendEnabled()` branch which returns before it.
    const demoBranch = portal.indexOf('if (!isBackendEnabled())');
    const demoCall = portal.indexOf('getDemoClientSubmission(');
    const request = portal.indexOf('await getClientSubmission(');
    assert.ok(demoBranch >= 0 && demoBranch < demoCall, 'the demo call is outside the demo branch');
    assert.ok(demoCall < request, 'the demo call is reachable after the live request');
  });

  it('records a failure instead of substituting anything', () => {
    assert.match(
      portal,
      /setError\(err\.message \|\| 'Your report could not be loaded\.'\);/,
      'the catch no longer reports the failure',
    );
    // The specific regression: rebuilding state from the seed in the catch.
    assert.ok(
      !/catch[\s\S]{0,600}setSubmission\(demoSubmission\)/.test(portal),
      'the catch is rebuilding the portal from seeded data again',
    );
  });

  it('treats a response without a submission as a failure', () => {
    assert.match(
      portal,
      /if \(!result\.submission\) \{\s*throw new Error\('Your submission could not be found\.'\);/,
      'a missing submission falls through silently again',
    );
  });

  it('does not replace a report the client is reading when a poll fails', () => {
    // `!submission` is the guard: a first load that fails has nothing to keep
    // and shows the error; a background poll that fails leaves the real report
    // on screen.
    assert.match(portal, /if \(error && !submission\) \{/);
  });

  it('fails through the shared error state, which announces itself', () => {
    assert.match(portal, /<ErrorState[\s\S]{0,200}Your report could not be loaded/);
    assert.ok(
      !/Unable to Load Report/.test(portal),
      'the hand-built error panel with no alert role is back',
    );
  });
});

describe('the client message thread does not read as empty when it failed', () => {
  const messaging = stripComments(read(MESSAGING));

  it('reports a failed load the client asked for', () => {
    assert.match(messaging, /if \(!silent\) \{\s*setError\(err\.message \|\| 'Your messages could not be loaded\.'\);/);
  });

  it('no longer clears the thread and the error together', () => {
    assert.ok(
      !/const demoMessages: Message\[\] = \[\];/.test(messaging),
      'a failed load is emptying the conversation again',
    );
    assert.ok(!/shouldShowApiErrors/.test(messaging));
  });

  it('stays quiet when a background poll fails', () => {
    // The thread polls every few seconds behind a conversation the client is
    // reading. Replacing that with an error because one poll failed would be
    // its own defect.
    assert.match(messaging, /if \(!silent\) \{/);
  });

  it('narrows the message list before it becomes state', () => {
    assert.match(messaging, /asArray<Message>\(res\.messages\)/);
  });
});

describe('the portal is reachable by keyboard', () => {
  const portal = stripComments(read(PORTAL));

  it('offers a skip link past the eight section tabs', () => {
    assert.match(portal, /href="#portal-main"/);
    assert.match(portal, /Skip to your report/);
  });

  it('has a main landmark for that link to land in', () => {
    assert.match(portal, /<main id="portal-main" tabIndex=\{-1\} aria-label="Your engagement">/);
  });

  it('keeps its tablist labelled and its selection readable', () => {
    assert.match(portal, /role="tablist" aria-label="Portal sections"/);
    assert.match(portal, /aria-selected=\{activeView === tab\.id\}/);
  });
});
