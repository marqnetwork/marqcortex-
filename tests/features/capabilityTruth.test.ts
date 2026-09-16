/**
 * A DESTINATION MAY NOT CLAIM MORE THAN IT CAN DO.
 *
 * ── WHAT THIS GUARDS ────────────────────────────────────────────────────────
 *
 * `registryAudit.ts` classified 133 of 185 interactions as LIVE, and defined
 * LIVE as "works right now with zero backend (pure UI / client-side engine)".
 * That is a measurement of WIRING wearing the name of CAPABILITY, and the
 * number was read the way the name invites: as a product that mostly works.
 * Product Reality §9 named it; CP-2 split the two questions apart.
 *
 * `capabilityStatus.ts` answers the capability question per destination. This
 * file is what stops that answer being a comment. It checks the CLAIMS against
 * the SOURCE, so a surface cannot be called LIVE because somebody edited a
 * string — which is precisely how the registry's number got where it was.
 *
 * ── WHY SOURCE-STRUCTURAL ───────────────────────────────────────────────────
 *
 * The strongest check here — "a LIVE destination reads a backend" — is a claim
 * about what a component's module graph contains, which is a fact about the
 * repository rather than about a render. The browser suite proves the states;
 * this proves that the classification cannot quietly drift away from them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  DESTINATIONS,
  VISIBLE_DESTINATIONS,
  SHORTCUT_DESTINATIONS,
  VISIBLE_NAV_GROUPS,
  NAV_GROUPS,
  type DestinationId,
} from '../../src/app/core/navigationModel.ts';
import {
  CAPABILITY,
  isDestinationUsable,
  isDestinationVisible,
  type CapabilityStatus,
} from '../../src/app/core/capabilityStatus.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The component each shell destination renders, from the shell's own source. */
const SHELL = strip(read('src/app/components/TeamDashboardNew.tsx'));

function componentFor(id: DestinationId): string | null {
  // The two destinations that live at their own route.
  if (id === 'execution') return 'ExecutionDashboard';
  if (id === 'architecture') return 'SystemArchitecture';

  const at = SHELL.indexOf(`currentPage === '${id}' && (`);
  if (at === -1) return null;
  // The first component tag after the guard that is not shell scaffolding.
  // A single regex cannot do this: `<Suspense fallback={<PanelSkeleton />}>`
  // contains a `>` inside its own attribute, so `<Suspense[^>]*>` stops early
  // and the next match is never the component.
  const window = SHELL.slice(at, at + 400);
  for (const match of window.matchAll(/<(\w+)/g)) {
    if (match[1] === 'Suspense' || match[1] === 'PanelSkeleton') continue;
    return match[1];
  }
  return null;
}

function sourceOf(component: string): string | null {
  for (const rel of [
    `src/app/components/${component}.tsx`,
    `src/app/components/${component}.ts`,
  ]) {
    if (existsSync(join(ROOT, rel))) return strip(read(rel));
  }
  return null;
}

describe('every destination declares a capability, and only what it has', () => {
  it('the capability map covers exactly the declared destinations', () => {
    // `Record<DestinationId, Capability>` makes the compiler enforce this, but
    // a compiler error is not a message anybody reads in a test summary.
    const declared = DESTINATIONS.map(d => d.id).sort();
    const classified = Object.keys(CAPABILITY).sort();
    assert.deepEqual(classified, declared, 'a destination has no capability entry, or vice versa');
  });

  it('uses only the six statuses, and nothing looser', () => {
    const allowed: CapabilityStatus[] = [
      'LIVE', 'PARTIAL', 'EMPTY', 'BLOCKED', 'DEMO-ONLY', 'UNREACHABLE',
    ];
    for (const [id, cap] of Object.entries(CAPABILITY)) {
      assert.ok(allowed.includes(cap.status), `${id} has an invented status: ${cap.status}`);
    }
  });

  it('says what a person can do wherever it claims they can do something', () => {
    for (const [id, cap] of Object.entries(CAPABILITY)) {
      if (cap.status === 'LIVE' || cap.status === 'PARTIAL' || cap.status === 'BLOCKED') {
        // BLOCKED is included deliberately. The capability is BUILT — what is
        // missing is egress to a backend, not the feature — so describing it is
        // accurate, and refusing to would misreport finished work as absent.
        assert.ok(
          cap.userCan.trim().length > 20,
          `${id} is ${cap.status} but does not say what a person can do`,
        );
      } else {
        // The inverse matters more: a surface with nothing behind it must not
        // describe a capability, because that description is where the next
        // over-claim comes from.
        assert.equal(cap.userCan, '', `${id} is ${cap.status} but describes a capability`);
      }
    }
  });

  it('gives evidence for every claim, and a route out of every non-LIVE one', () => {
    for (const [id, cap] of Object.entries(CAPABILITY)) {
      assert.ok(cap.evidence.trim().length > 40, `${id} has no real evidence`);
      if (cap.status !== 'LIVE') {
        assert.ok(
          cap.needs && cap.needs.trim().length > 20,
          `${id} is ${cap.status} with no statement of what would fix it — ` +
            'a status with no way out is a complaint, not a plan',
        );
      }
    }
  });
});

describe('LIVE is not a word a surface can award itself', () => {
  it('a LIVE or PARTIAL destination reaches a real data path', () => {
    // The check the old definition could not make. "Works with zero backend"
    // was treated as evidence FOR liveness; here it is disqualifying, unless
    // the destination is honestly static (Architecture, which is documentation
    // and says so).
    const STATIC_BY_NATURE = new Set<DestinationId>(['architecture']);

    const offenders: string[] = [];
    for (const destination of DESTINATIONS) {
      const cap = CAPABILITY[destination.id];
      if (!isDestinationUsable(destination.id)) continue;
      if (STATIC_BY_NATURE.has(destination.id)) continue;

      const component = componentFor(destination.id);
      if (!component) { offenders.push(`${destination.id}: no component found in the shell`); continue; }
      const source = sourceOf(component);
      if (!source) { offenders.push(`${destination.id}: ${component} has no source`); continue; }

      const readsData =
        /@\/app\/services\/(dataService|operationalAwarenessService|aiAdminService|cortexDataService)/.test(source) ||
        /@\/app\/utils\/emailNurtureQueue/.test(source);
      if (!readsData) {
        offenders.push(
          `${destination.id} is ${cap.status} but ${component} reads no data service`,
        );
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  it('no LIVE or PARTIAL destination renders generated or fabricated records', () => {
    // Reviewer QA is why this exists. It called `generateMockSubmissions()` for
    // its initial state and `generateRandomSubmission()` on a 30-second timer,
    // so the queue invented a company every half minute — and CP-1's demo
    // guard missed it, because the generator lives in the component and the
    // invented names were not the ones the audit had listed.
    const FORBIDDEN: [RegExp, string][] = [
      [/generateMock\w*\(/, 'a mock generator'],
      [/generateRandom\w*\(/, 'a random record generator'],
      [/from '@\/app\/demo\//, 'the demo boundary'],
    ];

    const offenders: string[] = [];
    for (const destination of DESTINATIONS) {
      if (!isDestinationUsable(destination.id)) continue;
      const component = componentFor(destination.id);
      const source = component ? sourceOf(component) : null;
      if (!source) continue;
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${destination.id} is usable but ${component} uses ${what}`);
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });
});

describe('a sidebar entry is a promise the product can keep', () => {
  it('nothing DEMO-ONLY, EMPTY or UNREACHABLE is offered in the sidebar', () => {
    const offered = VISIBLE_DESTINATIONS.map(d => d.id);
    const cannotDeliver = offered.filter(id =>
      ['DEMO-ONLY', 'EMPTY', 'UNREACHABLE'].includes(CAPABILITY[id].status),
    );
    assert.deepEqual(
      cannotDeliver,
      [],
      'these are offered in the sidebar and cannot do what their label promises',
    );
  });

  it('BLOCKED destinations stay visible', () => {
    // Deliberately NOT hidden. Operations and the AI Control Plane are built,
    // tested and correct; they are waiting on egress to a backend. Hiding them
    // would misreport finished work as missing, which is the same dishonesty
    // pointing the other way.
    for (const [id, cap] of Object.entries(CAPABILITY)) {
      if (cap.status === 'BLOCKED') {
        assert.ok(
          isDestinationVisible(id as DestinationId),
          `${id} is BLOCKED, which is not a reason to hide finished work`,
        );
      }
    }
  });

  it('every hidden destination says why, and what would bring it back', () => {
    const hidden = DESTINATIONS.filter(d => !isDestinationVisible(d.id));
    assert.ok(hidden.length > 0, 'the fixture is stale — nothing is hidden');
    for (const destination of hidden) {
      const cap = CAPABILITY[destination.id];
      assert.ok(!isDestinationUsable(destination.id), `${destination.id} is hidden but usable`);
      assert.ok(cap.needs, `${destination.id} is hidden with no route back`);
    }
  });
});

describe('the three paths agree on which product this is', () => {
  it('the command palette and the shortcut table offer only visible destinations', () => {
    // Ch. 21.4. Before CP-2 the palette read the DECLARED list while the
    // sidebar read the visible one, so hiding a destination from the sidebar
    // left it one Cmd-K away — the same duplicate reality, sideways.
    const visible = new Set(VISIBLE_DESTINATIONS.map(d => d.id));
    for (const destination of SHORTCUT_DESTINATIONS) {
      assert.ok(
        visible.has(destination.id),
        `${destination.id} has an accelerator but is not offered anywhere`,
      );
    }

    const palette = strip(read('src/app/components/CommandPalette.tsx'));
    assert.match(
      palette,
      /\.\.\.VISIBLE_DESTINATIONS\.map/,
      'the palette enumerates the declared list again',
    );

    const layout = strip(read('src/app/components/TeamDashboardLayout.tsx'));
    assert.match(layout, /VISIBLE_NAV_GROUPS\.map/, 'the sidebar enumerates the declared list again');
  });

  it('a group with nothing left to offer does not render a heading', () => {
    for (const group of VISIBLE_NAV_GROUPS) {
      assert.ok(group.destinations.length > 0, `${group.id} renders an empty heading`);
    }
    // And the declared model still holds the group, so nothing was deleted.
    assert.ok(
      NAV_GROUPS.some(g => g.id === 'deliver'),
      'the deliver group was deleted rather than emptied — hiding is reversible, deleting is not',
    );
  });

  it('no destination id is declared twice', () => {
    const ids = DESTINATIONS.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length, 'a destination id is declared more than once');
  });
});

describe('the interaction registry no longer calls wiring "live"', () => {
  const audit = read('src/app/utils/registryAudit.ts');

  it('uses WIRED, and says what it measures', () => {
    assert.ok(
      !/status: 'LIVE'/.test(audit),
      'the registry is classifying controls as LIVE again — it measures wiring, not capability',
    );
    assert.match(audit, /status: 'WIRED'/);
    assert.match(audit, /export type AuditStatus = 'WIRED'/);
  });

  it('points at the capability model for the question it does not answer', () => {
    assert.match(audit, /capabilityStatus/, 'the registry does not say where capability is answered');
  });
});
