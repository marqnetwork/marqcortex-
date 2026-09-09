/**
 * EVERY DESTINATION HAS AN ADDRESS — UI Sprint 6.
 *
 * Ch. 21.11: "Users should always be able to recover from navigation mistakes …
 * Exploration should never carry a penalty." Losing your place on refresh is a
 * penalty, and Cortex charged it on every in-app destination.
 *
 * ── TWO DEFECTS, ONE SYMPTOM ────────────────────────────────────────────────
 *
 * 1. NO DESTINATION HAD AN ADDRESS. All eleven in-app pages lived in `useState`
 *    under the single URL `#/team/dashboard`. Nothing was linkable,
 *    bookmarkable or restorable; browser Back left the shell entirely rather
 *    than returning to the previous destination. The hand-off from
 *    `/team/execution` back into the shell went through a `sessionStorage` key
 *    whose literal was declared separately in two files — a side channel that
 *    existed only because pages had no address of their own.
 *
 * 2. THE AUTH GATE DISCARDED THE URL ANYWAY. Session restore runs in an effect,
 *    so on the FIRST render `teamAccessToken` is null even for a signed-in
 *    operator. Both team route guards treated that as "signed out" and
 *    redirected to the login screen, dropping the requested location; the login
 *    route then bounced back to a bare `/team/dashboard`. So EVERY cold load of
 *    the dashboard — refresh, bookmark, shared link — landed on the dashboard
 *    regardless of where it was aimed.
 *
 *    The second defect is why fixing only the first would have changed nothing
 *    observable. `isRestoringSession` is now part of the app context, starts
 *    true, and is cleared in a `finally` so no early return can strand a guard
 *    waiting on it forever.
 *
 * ── DELIBERATELY NOT CHANGED ────────────────────────────────────────────────
 *
 * `ClientPortalRoute` has the identical first-render redirect. It is inside the
 * DEFERRED ClientPortal auth cluster, which must not have its browser auth
 * behaviour changed without the live-backend verification environment, so it is
 * recorded here and left alone. This suite asserts that it was left alone.
 *
 * VERIFIED IN A REAL BROWSER
 *   Driven in Chromium against the production build. Measured: a deep link to
 *   `?page=control-plane` lands on the AI Control Plane; navigating writes the
 *   URL; refresh keeps the place; Back returns to the previous destination and
 *   Forward returns; the dashboard carries no parameter; and `?page=nonsense`
 *   falls back to the dashboard rather than the invalid-page screen. No errors.
 *
 * TESTING APPROACH (documented limitation)
 *   The routes and shell are `.tsx`, so they cannot be imported and rendered by
 *   this runner. Each guarantee is enforced structurally, per the established
 *   pattern. The parameter name itself is checked BEHAVIOURALLY against the
 *   navigation model, which the runner can import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PAGE_PARAM, DESTINATIONS } from '../../src/app/core/navigationModel.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SHELL     = stripComments(readSource('src/app/components/TeamDashboardNew.tsx'));
const CONTEXT   = stripComments(readSource('src/app/contexts/AppContext.tsx'));
const DASH_ROUTE = stripComments(readSource('src/app/pages/TeamDashboardRoute.tsx'));
const EXEC_ROUTE = stripComments(readSource('src/app/pages/ExecutionRoute.tsx'));
const PORTAL_ROUTE = stripComments(readSource('src/app/pages/ClientPortalRoute.tsx'));

// ─────────────────────────────────────────────────────────────────────────────
// THE ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

describe('the destination lives in the URL', () => {
  it('the parameter name is declared once, with the navigation contract', () => {
    assert.equal(PAGE_PARAM, 'page');
    // Declared in the model rather than in either consumer, so the shell and
    // the routes that hand off to it need not import each other — which would
    // pull the whole dashboard into the execution chunk.
    assert.ok(
      /export const PAGE_PARAM = 'page';/.test(readSource('src/app/core/navigationModel.ts')),
    );
  });

  it('the shell reads the current destination from the URL', () => {
    assert.match(SHELL, /import \{ useNavigate, useSearchParams \} from 'react-router'/);
    assert.ok(
      /const currentPage = pageFromParam\(searchParams\.get\(PAGE_PARAM\)\)/.test(SHELL),
      'the URL must be the source of truth, not a mirror of state',
    );
    assert.ok(
      !/useState<PageView>/.test(SHELL),
      'a second copy in useState would let the two disagree',
    );
  });

  it('changing destination writes the URL, and enters history', () => {
    assert.ok(/setSearchParams\(/.test(SHELL));
    assert.ok(
      /\{ replace: false \}/.test(SHELL),
      'Back must return to the previous destination — that is the recovery Ch. 21.11 asks for',
    );
  });

  it('the dashboard is the root, and carries no parameter', () => {
    assert.ok(
      /if \(page === 'dashboard'\) next\.delete\(PAGE_PARAM\);/.test(SHELL),
      'two URLs for one place is the duplicate reality Ch. 21.4 forbids',
    );
  });

  it('an unknown parameter falls back rather than erroring', () => {
    // The parameter is user-editable. A hand-typed `?page=nonsense` must land
    // somewhere real, not on the invalid-page error screen.
    assert.ok(
      /if \(raw && SHELL_PAGES\.has\(raw as DestinationId\)\) return raw as PageView;/.test(SHELL),
    );
    assert.ok(/return 'dashboard';/.test(SHELL));
  });

  it('validates against the model, so every real destination is addressable', () => {
    // SHELL_PAGES is derived from DESTINATIONS, so this cannot drift.
    assert.ok(
      /const SHELL_PAGES: ReadonlySet<DestinationId> = new Set\(\s*DESTINATIONS\.map/.test(SHELL),
    );
    assert.ok(DESTINATIONS.length > 0);
  });
});

describe('the sessionStorage side channel is gone', () => {
  it('the shell no longer reads a handed-over page', () => {
    assert.ok(!/sessionStorage/.test(SHELL));
    assert.ok(!/TEAM_DASHBOARD_PAGE_KEY/.test(SHELL));
    assert.ok(!/readInitialPage/.test(SHELL));
  });

  it('the execution route hands off through the URL instead', () => {
    assert.ok(!/sessionStorage\.setItem/.test(EXEC_ROUTE));
    assert.ok(!/TEAM_DASHBOARD_PAGE_KEY/.test(EXEC_ROUTE));
    assert.match(EXEC_ROUTE, /import \{ PAGE_PARAM \} from '@\/app\/core\/navigationModel'/);
    assert.ok(
      /`\/team\/dashboard\?\$\{PAGE_PARAM\}=\$\{encodeURIComponent\(page\)\}`/.test(EXEC_ROUTE),
      'the page name goes in the URL, encoded',
    );
  });

  it('the literal is declared in no component', () => {
    for (const [name, src] of [['shell', SHELL], ['execution route', EXEC_ROUTE]] as const) {
      assert.ok(
        !/'teamDashboardPage'/.test(src),
        `${name} still declares the old side-channel key`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe('the auth gate waits before concluding anyone is signed out', () => {
  it('the context reports whether restore has finished', () => {
    assert.match(CONTEXT, /isRestoringSession: boolean;/);
    assert.ok(
      /useState\(true\);/.test(CONTEXT),
      'it must START true — nothing is known before the effect runs',
    );
    assert.ok(
      /const \[isRestoringSession, setIsRestoringSession\] = useState\(true\)/.test(CONTEXT),
    );
  });

  it('no early return can strand a guard waiting on it', () => {
    // The restore body has several early returns; a flag cleared at the bottom
    // would never be cleared on those paths, and the app would hang on a
    // blank page forever.
    assert.ok(
      /try \{\s*restoreSessions\(\);\s*\} finally \{\s*setIsRestoringSession\(false\);\s*\}/.test(CONTEXT),
      'the flag must be cleared in a finally',
    );
  });

  it('the context exposes it to consumers', () => {
    assert.ok(/isRestoringSession,/.test(CONTEXT));
  });

  for (const [name, src] of [
    ['TeamDashboardRoute', DASH_ROUTE],
    ['ExecutionRoute', EXEC_ROUTE],
  ] as const) {
    it(`${name} holds instead of redirecting while restore is pending`, () => {
      assert.ok(
        /isRestoringSession/.test(src),
        `${name} must read the flag`,
      );
      assert.ok(
        /if \(isRestoringSession\) \{\s*return <RouteRestoring \/>;\s*\}/.test(src),
        `${name} must render a placeholder, not a redirect`,
      );
    });

    it(`${name} still redirects once the operator is known to be signed out`, () => {
      assert.ok(
        /<Navigate to="\/team\/login" replace \/>/.test(src),
        `${name} must still protect the route`,
      );
    });

    it(`${name} checks restore BEFORE the signed-out check`, () => {
      // Order is the whole fix. Reversed, it redirects before it waits.
      const restoreAt = src.indexOf('isRestoringSession');
      const redirectAt = src.indexOf('/team/login');
      assert.ok(restoreAt !== -1 && redirectAt !== -1);
      assert.ok(
        restoreAt < redirectAt,
        `${name} must wait before it redirects`,
      );
    });
  }

  it('the placeholder announces itself rather than reading as an empty page', () => {
    const placeholder = stripComments(readSource('src/app/components/RouteRestoring.tsx'));
    assert.ok(/role="status"/.test(placeholder));
    assert.ok(/aria-busy="true"/.test(placeholder));
    assert.ok(/aria-label="Restoring your session"/.test(placeholder));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFERRED BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

describe('the deferred ClientPortal auth cluster was not touched', () => {
  it('ClientPortalRoute still has its original first-render redirect', () => {
    // It has the IDENTICAL defect. Repairing it changes ClientPortal browser
    // auth behaviour, which is deferred pending live-backend verification, so
    // it is recorded and left alone. This assertion is the record.
    assert.ok(
      !/isRestoringSession/.test(PORTAL_ROUTE),
      'do not fix this without the live verification environment',
    );
    assert.ok(/<Navigate to="\/client\/login" replace \/>/.test(PORTAL_ROUTE));
  });
});
