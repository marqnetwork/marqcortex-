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

  it('has no demo generator left to reach', () => {
    // The assertion this replaces required the call to be INSIDE the
    // `!isBackendEnabled()` branch, which sounded like containment and was not:
    // that branch is the shipped configuration, so `generateDemoSubmissions()`
    // was what the Analytics screen actually charted. Worse, it built its
    // twenty records from `Math.random()` — completion, quality and AI scores,
    // and ages spread over a fortnight — so the conversion rates, industry
    // breakdowns and weekly trends changed on every reload.
    assert.ok(
      !/function generateDemoSubmissions/.test(analytics),
      'the random submission generator is back',
    );
    assert.ok(
      !/generateDemoSubmissions\(\)/.test(analytics),
      'the analytics screen is charting generated records again',
    );
    assert.ok(
      !/Math\.random\(\)/.test(analytics),
      'a number on the analytics screen is coming from Math.random()',
    );
    assert.match(analytics, /await Promise\.all\(/, 'the live load is gone');
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
    // The container's classes are now the token vocabulary rather than
    // `bg-black/40 border-white/10 rounded-xl`. What is pinned is the GUARD:
    // the roster card, empty state and all, renders only when there is no
    // error.
    assert.match(team, /\{!error && \(\s*<div className="bg-cortex-raised border border-cortex-default rounded-cortex-md overflow-hidden">/);
  });
});

describe('the engagement panel invents no measurement', () => {
  const engagement = stripComments(read('src/app/components/EngagementIntelligence.tsx'));

  it('builds no EngagementAnalytics anywhere — catch or otherwise', () => {
    // There used to be two copies of the same fabrication: one in the catch,
    // which this file already removed, and one in the `!isBackendEnabled()`
    // branch, which it permitted on the grounds that "that is what demo mode
    // IS". But that branch was the shipped configuration, so the permitted
    // copy was the one a team actually read: fifteen reports available, twelve
    // viewed, eight CTA clicks, an 80% view rate, a "High Engagement Co"
    // scoring 95 — on a panel whose entire purpose is telling the team how
    // real clients are engaging.
    assert.ok(
      !/const demoData: EngagementAnalytics/.test(engagement),
      'the hand-written engagement numbers are back',
    );
    assert.ok(
      !/isBackendEnabled\(\)/.test(engagement),
      'the panel is branching on the backend flag again instead of reporting what happened',
    );
    assert.match(engagement, /await getEngagementAnalytics\(/);
  });

  it('treats a response without analytics as a failure', () => {
    assert.match(engagement, /if \(!res\.engagement\) throw new Error/);
  });
});
