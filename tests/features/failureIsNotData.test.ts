/**
 * UI SPRINT 7 — the family of fallbacks that answered a failed request with
 * invented business data.
 *
 * THE PATTERN
 *   Six panels caught a failed live request and, whenever `SHOW_API_ERRORS` was
 *   off — WHICH IS THE DEFAULT — substituted seeded data instead of reporting
 *   the failure. The reasoning was presumably that a seamless screen beats an
 *   error banner. On a surface whose entire purpose is telling somebody what is
 *   true, it is the opposite: an error is a fact the reader can act on, and a
 *   fabricated number is one they cannot tell from a real one.
 *
 *   What each of them invented:
 *
 *   * `ClientPortal` — a readiness score, findings and prioritised
 *     recommendations derived from a SEEDED DIAGNOSTIC, under the client's own
 *     company name. Covered in `clientPortalIntegrity.test.ts`; it is the most
 *     serious of the family because the reader is the customer.
 *   * `ClientMessaging` — an empty conversation with the error cleared, so a
 *     client could conclude the team had never replied.
 *   * `AnalyticsDashboard` — conversion rates, industry breakdowns and weekly
 *     trends computed from `generateDemoSubmissions()`. The worst-behaved:
 *     the substitution sat OUTSIDE the flag check, so with errors enabled the
 *     panel rendered the banner AND the fabricated charts beneath it, captioned
 *     "showing computed data from submissions".
 *   * `EngagementIntelligence` — fifteen reports available, twelve viewed,
 *     eight CTA clicks, an 80% view rate. Numbers, in the same cards as the real
 *     ones, on the panel that exists to say how clients are engaging.
 *   * `SettingsPage` — a configuration object rendered into live form controls
 *     that Save writes back. Covered in `consoleSurfaces.test.ts`.
 *   * `TeamManagement` — a roster of colleagues who are not in the workspace,
 *     with roles they do not hold, beside controls offering to re-role and
 *     remove them against ids the server has never seen.
 *
 * WHAT IS GUARDED HERE
 *   That none of them chooses again between reporting a failure and hiding it,
 *   that the seeded helpers are reachable only from the demo-mode branch, and
 *   that a failed load does not leave zeros or an empty state on screen where a
 *   measurement would go — a grid of zeros IS a claim, and "0 members" under an
 *   error is the panel asserting the thing it just failed to find out.
 *
 * The behaviour was verified in Chromium against a stubbed backend returning
 * 503, on each panel, with the success path re-checked afterwards.
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

/** Every panel that used to substitute seeded data for a failed live request. */
const CURED = [
  'src/app/components/ClientPortal.tsx',
  'src/app/components/ClientMessaging.tsx',
  'src/app/components/AnalyticsDashboard.tsx',
  'src/app/components/EngagementIntelligence.tsx',
  'src/app/components/SettingsPage.tsx',
  'src/app/components/TeamManagement.tsx',
];

describe('no panel decides whether to hide a failure', () => {
  for (const rel of CURED) {
    it(`${rel.split('/').pop()} does not read shouldShowApiErrors`, () => {
      // Comments are stripped, so the deliberate note each file carries about
      // why it does NOT read the flag does not satisfy this.
      assert.ok(
        !/shouldShowApiErrors/.test(stripComments(read(rel))),
        `${rel} is choosing again between reporting a failure and hiding it`,
      );
    });
  }
});

describe('every panel records the failure it used to swallow', () => {
  const EXPECTED: [file: string, message: RegExp][] = [
    ['src/app/components/ClientPortal.tsx', /Your report could not be loaded/],
    ['src/app/components/ClientMessaging.tsx', /Your messages could not be loaded/],
    ['src/app/components/AnalyticsDashboard.tsx', /Analytics could not be loaded/],
    ['src/app/components/EngagementIntelligence.tsx', /Engagement data could not be loaded/],
    ['src/app/components/SettingsPage.tsx', /Settings could not be loaded/],
    ['src/app/components/TeamManagement.tsx', /The team list could not be loaded/],
  ];
  for (const [rel, message] of EXPECTED) {
    it(`${rel.split('/').pop()} says what failed`, () => {
      assert.match(read(rel), message);
    });
  }
});

describe('the analytics panel no longer draws charts from seeded records', () => {
  const analytics = stripComments(read('src/app/components/AnalyticsDashboard.tsx'));

  it('reaches the demo generator only from the demo-mode branch', () => {
    // The CALL, not the declaration — `generateDemoSubmissions` is defined near
    // the bottom of the file, long after the request, and matching that would
    // fail for no reason.
    const demoBranch = analytics.indexOf('if (!isBackendEnabled())');
    const request = analytics.indexOf('await Promise.all(');
    assert.ok(demoBranch >= 0 && request > demoBranch, 'the demo branch is gone or has moved');

    const calls = [...analytics.matchAll(/(?<!function )generateDemoSubmissions\(\)/g)]
      .map(m => m.index!)
      .filter(at => !analytics.slice(Math.max(0, at - 40), at).includes('function '));
    assert.ok(calls.length > 0, 'the demo branch no longer generates anything');
    for (const at of calls) {
      assert.ok(
        at > demoBranch && at < request,
        'generateDemoSubmissions is called outside the demo-mode branch',
      );
    }
  });

  it('clears the state it could not load', () => {
    assert.match(analytics, /setError\(err\.message \|\| 'Analytics could not be loaded\.'\);\s*setSubmissions\(\[\]\);\s*setAnalytics\(null\);/);
  });

  it('replaces the charts with the failure rather than stacking them', () => {
    assert.match(analytics, /\{activeTab === 'overview' && error && \(/);
    assert.match(analytics, /\{activeTab === 'overview' && !error && \(/);
    assert.ok(
      !/showing computed data from submissions/.test(analytics),
      'the caption that made fabricated charts sound like a fallback calculation is back',
    );
  });
});

describe('the team panel makes no claim about a roster it could not read', () => {
  const team = stripComments(read('src/app/components/TeamManagement.tsx'));

  it('no longer substitutes a demo roster', () => {
    assert.ok(!/getDemoTeamFallback/.test(team), 'the demo roster fallback is back');
  });

  it('hides the counted stats when the count is unknown', () => {
    // Four confident zeros above an error is the panel asserting the thing it
    // just failed to find out.
    assert.match(team, /\{!error && !isLoading && \(/);
  });

  it('hides the empty state too', () => {
    // "Nobody else is in this workspace yet" under a load failure reads as a
    // fact about the workspace. It is a fact about the request.
    assert.match(team, /\{!error && \(\s*<div className="bg-black\/40 border border-white\/10 rounded-xl overflow-hidden">/);
  });
});

describe('the engagement panel invents no measurement', () => {
  const engagement = stripComments(read('src/app/components/EngagementIntelligence.tsx'));

  it('no longer builds an EngagementAnalytics in its catch', () => {
    // The demo-mode branch legitimately constructs one — that is what demo mode
    // IS. The defect was a SECOND copy in the catch, so the assertion is scoped
    // to the catch rather than to the file.
    const catchAt = engagement.indexOf('} catch (err');
    assert.ok(catchAt > 0, 'the catch block has moved');
    const catchBody = engagement.slice(catchAt);
    assert.ok(
      !/const demoData: EngagementAnalytics/.test(catchBody),
      'the hand-written engagement numbers are back in the catch',
    );
    // And the one that remains is inside the demo branch, before the request.
    const demoBranch = engagement.indexOf('if (!isBackendEnabled())');
    const seed = engagement.indexOf('const demoData: EngagementAnalytics');
    const request = engagement.indexOf('await getEngagementAnalytics(');
    assert.ok(demoBranch >= 0 && demoBranch < seed && seed < request);
  });

  it('treats a response without analytics as a failure', () => {
    assert.match(engagement, /if \(!res\.engagement\) throw new Error/);
  });
});
