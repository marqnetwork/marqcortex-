/**
 * PHASE 1B TASK 19 — TeamDashboardNew breadcrumb contract
 *
 * Two TS2345 diagnostics, one root cause: `getBreadcrumbs` and its `breadcrumbs`
 * local carried no type annotation, so TypeScript inferred the array's element
 * type from the initializer alone —
 *
 *     { label: string; onClick: () => void }
 *
 * — with `onClick` REQUIRED (the initializer's `: undefined` branch collapses
 * into the function type because the frontend boundary does not enable
 * strictNullChecks). The two later `breadcrumbs.push({ label: … })` calls then
 * failed, even though a breadcrumb with no click handler is the normal case.
 *
 * The consumer had the correct contract all along. TeamDashboardLayout exports
 *
 *     interface Breadcrumb { label: string; onClick?: () => void }
 *
 * and its render explicitly branches on `crumb.onClick ? <button> : <span>`, so
 * a handler-less crumb is a supported, rendered state — not an oversight. The
 * fix simply names that canonical exported type at the producer, which is also
 * what every other `case` in the switch was already returning structurally.
 *
 * Type-only change: no breadcrumb added, removed, relabelled or rewired, and no
 * click handler gained or lost, so runtime behaviour is byte-identical.
 *
 * TESTING APPROACH (documented limitation)
 *   Both modules are .tsx and the runner (`node --experimental-strip-types`)
 *   strips types but does NOT transform JSX, so neither can be imported and
 *   rendered here. Following the established pattern
 *   (frontendIconContracts.test.ts / frontendRuntimeDefects.test.ts), each
 *   guarantee is enforced structurally against the production source.
 *   Assertions are pattern-based, never line-number-based.
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

const LAYOUT_REL = 'src/app/components/TeamDashboardLayout.tsx';
const DASHBOARD_REL = 'src/app/components/TeamDashboardNew.tsx';

describe('Breadcrumb — the canonical contract is the one with an optional handler', () => {
  const layout = stripComments(readSource(LAYOUT_REL));

  it('TeamDashboardLayout exports Breadcrumb with onClick optional', () => {
    assert.match(
      layout,
      /export\s+interface\s+Breadcrumb\s*\{[^}]*\blabel\s*:\s*string\s*;[^}]*\bonClick\s*\?\s*:\s*\(\)\s*=>\s*void\s*;?[^}]*\}/,
      'expected `export interface Breadcrumb { label: string; onClick?: () => void }`',
    );
  });

  it('the layout renders a handler-less crumb as plain text, not a button', () => {
    // This is why `onClick` is optional rather than merely nullable: the render
    // has a real branch for its absence. If that branch ever goes away, the
    // producer-side annotation below stops being the right fix.
    assert.match(
      layout,
      /crumb\.onClick\s*\?/,
      'expected the breadcrumb render to branch on crumb.onClick',
    );
    assert.match(layout, /<span[^>]*>\{crumb\.label\}<\/span>/, 'expected a non-button crumb render');
  });
});

describe('TeamDashboardNew — breadcrumbs are produced against the canonical type', () => {
  const code = stripComments(readSource(DASHBOARD_REL));

  it('imports Breadcrumb as a type from TeamDashboardLayout', () => {
    assert.match(
      code,
      /import\s+type\s*\{[^}]*\bBreadcrumb\b[^}]*\}\s*from\s*['"]@\/app\/components\/TeamDashboardLayout['"]/,
      'expected a type import of Breadcrumb from TeamDashboardLayout',
    );
  });

  it('getBreadcrumbs declares Breadcrumb[] as its return type', () => {
    assert.match(
      code,
      /const\s+getBreadcrumbs\s*=\s*\(\)\s*:\s*Breadcrumb\[\]\s*=>/,
      'expected `const getBreadcrumbs = (): Breadcrumb[] =>`',
    );
  });

  it('the cortex-branch local is annotated, not inferred from its initializer', () => {
    // The annotation on the local is the half that actually unblocks `.push`;
    // the return type alone would not, since the local is widened first.
    assert.match(
      code,
      /const\s+breadcrumbs\s*:\s*Breadcrumb\[\]\s*=\s*\[/,
      'expected `const breadcrumbs: Breadcrumb[] = [`',
    );
  });

  it('both handler-less crumbs are still pushed on their original branches', () => {
    assert.match(
      code,
      /if\s*\(\s*cortexState\.view\s*===\s*'detail'\s*\)\s*\{\s*breadcrumbs\.push\(\{\s*label:\s*'Lead Detail'\s*\}\)/,
      'the Lead Detail crumb changed branch or label',
    );
    assert.match(
      code,
      /else if\s*\(\s*cortexState\.view\s*===\s*'insights'\s*\)\s*\{\s*breadcrumbs\.push\(\{\s*label:\s*'Learning Insights'\s*\}\)/,
      'the Learning Insights crumb changed branch or label',
    );
  });

  it('the CORTEX crumb still gets its conditional overview handler', () => {
    // The one crumb that DOES carry a handler, and only when not already on
    // overview. Losing this would silently break back-navigation.
    assert.match(
      code,
      /label:\s*'CORTEX',\s*onClick:\s*cortexState\.view\s*!==\s*'overview'\s*\?\s*\(\)\s*=>\s*setCortexState\(\{\s*view:\s*'overview'\s*\}\)\s*:\s*undefined/,
      'the CORTEX crumb handler changed',
    );
  });

  it('every switch branch still returns its original single crumb', () => {
    const expected: Record<string, string> = {
      team: 'Team Management',
      settings: 'Settings',
      reviewer: 'Reviewer Dashboard',
      analytics: 'Analytics Dashboard',
      emails: 'Email Nurture Queue',
      revenue: 'Revenue Intelligence',
      mapping: 'Mapping Engine',
      architecture: 'System Architecture',
    };
    for (const [page, label] of Object.entries(expected)) {
      assert.match(
        code,
        new RegExp(`case '${page}':\\s*return \\[\\{ label: '${label}' \\}\\]`),
        `the '${page}' breadcrumb changed`,
      );
    }
    assert.match(code, /default:\s*return \[\]/, 'the default branch no longer returns an empty list');
  });

  it('the layout still receives the produced breadcrumbs', () => {
    assert.match(code, /breadcrumbs=\{getBreadcrumbs\(\)\}/, 'breadcrumbs are no longer passed to the layout');
  });
});
