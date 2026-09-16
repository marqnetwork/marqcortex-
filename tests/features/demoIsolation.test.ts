/**
 * THE WALL BETWEEN THE DEMO AND THE PRODUCT.
 *
 * ── WHAT THIS GUARDS ────────────────────────────────────────────────────────
 *
 * Product Reality §9 counted 4,492 lines of fabricated business data and found
 * it was what a signed-in operator actually saw. The cause was structural, not
 * a series of mistakes: `dataService` — imported by every authenticated
 * component — imported the fixtures directly, and re-exported ten `getDemo*`
 * helpers. Reaching for invented companies inside a `catch` was therefore the
 * path of least resistance, and eleven components took it.
 *
 * CP-1 moved the fixtures behind `src/app/demo/`. This file is what keeps them
 * there. It fails the build if authenticated product code imports from the demo
 * boundary, by any spelling, through any depth of re-export.
 *
 * ── WHY A TEST AND NOT A CONVENTION ─────────────────────────────────────────
 *
 * Because the convention already existed. `dataService`'s own header carried an
 * "IMPORT HYGIENE RULES (enforced)" block listing rules nothing enforced, and
 * the fixtures were three lines below it. A rule with no test is a comment.
 *
 * ── WHAT IS DELIBERATELY ALLOWED ────────────────────────────────────────────
 *
 *   • `src/app/demo/**` importing itself.
 *   • `dataService` reaching the boundary through a DYNAMIC import inside a
 *     branch guarded by `isDemoExperience()`. That is the one door, it keeps
 *     the fixtures out of the authenticated bundle's module graph, and it is
 *     asserted positively below rather than merely tolerated.
 *   • TYPE-only imports. A type is erased at build time and carries no data.
 *   • Tests, which have to read the fixtures to assert things about them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');

const DEMO_DIR = join('src', 'app', 'demo');
const GATEWAY = join('src', 'app', 'services', 'dataService.ts');

/** Every .ts/.tsx file under src/, as a repo-relative path. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const FILES = sources(SRC);

/** Static `import`/`export … from` specifiers, excluding type-only ones. */
function valueImports(code: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)from\s+['"]([^'"]+)['"]/g;
  for (let m = pattern.exec(code); m !== null; m = pattern.exec(code)) {
    const clause = m[1];
    // `import type { X } from` and `export type { X } from` erase at build time.
    if (/^\s*type\s/.test(clause)) continue;
    // A clause that is ENTIRELY `{ type A, type B }` also erases.
    const braced = /^\s*\{([\s\S]*)\}\s*$/.exec(clause);
    if (braced) {
      const specifiers = braced[1].split(',').map(s => s.trim()).filter(Boolean);
      if (specifiers.length > 0 && specifiers.every(s => s.startsWith('type '))) continue;
    }
    found.push(m[2]);
  }
  return found;
}

/** Bare `import '…'` side-effect specifiers, which import-for-effect. */
function sideEffectImports(code: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (let m = pattern.exec(code); m !== null; m = pattern.exec(code)) found.push(m[1]);
  return found;
}

function namesTheDemoBoundary(specifier: string): boolean {
  return /(^|\/)@\/app\/demo(\/|$)/.test(specifier) || /(^|\.\.?\/)app\/demo(\/|$)/.test(specifier)
    || specifier.startsWith('@/app/demo');
}

function isInsideDemo(file: string): boolean {
  return file.startsWith(DEMO_DIR + sep) || file === DEMO_DIR;
}

describe('no authenticated product module imports the demo boundary', () => {
  it('statically', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (isInsideDemo(file)) continue;
      const code = readFileSync(join(ROOT, file), 'utf8');
      for (const specifier of [...valueImports(code), ...sideEffectImports(code)]) {
        if (namesTheDemoBoundary(specifier)) offenders.push(`${file} → ${specifier}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'these link fabricated business data into the authenticated bundle:\n' + offenders.join('\n'),
    );
  });

  it('and dynamically, except through the one gated door', () => {
    // A dynamic import does not enter the authenticated bundle's module graph,
    // so it is the right mechanism — but only where the gate is. Anywhere else
    // it is the same defect with an `await` in front of it.
    const ALLOWED = new Set([
      GATEWAY,
      // The nurture queue seeds a demo queue, and gates itself the same way.
      join('src', 'app', 'utils', 'emailNurtureQueue.ts'),
      // The assistant's canned replies, gated on `isDemoMode()`.
      join('src', 'app', 'components', 'GlobalAIChat.tsx'),
      // The Mapping Engine's proposal snapshot, gated on `isDemoMode()`. Its
      // input is produced by accepting a proposal, and nothing persists one
      // where this surface can read it — so outside a demo it has nothing to
      // map and says so.
      join('src', 'app', 'components', 'MappingEnginePanel.tsx'),
    ]);

    const offenders: string[] = [];
    for (const file of FILES) {
      if (isInsideDemo(file) || ALLOWED.has(file)) continue;
      const code = readFileSync(join(ROOT, file), 'utf8');
      const pattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
      for (let m = pattern.exec(code); m !== null; m = pattern.exec(code)) {
        if (namesTheDemoBoundary(m[1])) offenders.push(`${file} → ${m[1]}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'these reach the demo boundary outside the gated door:\n' + offenders.join('\n'),
    );
  });

  it('and every gated door is actually gated', () => {
    const GATES: [file: string, gate: RegExp][] = [
      [GATEWAY, /isDemoExperience\(\)/],
      [join('src', 'app', 'utils', 'emailNurtureQueue.ts'),
        /FEATURES\.DEMO_EXPERIENCE && !FEATURES\.BACKEND_INTEGRATION/],
      [join('src', 'app', 'components', 'GlobalAIChat.tsx'), /isDemoMode\(\)/],
      [join('src', 'app', 'components', 'MappingEnginePanel.tsx'), /if \(!isDemoMode\(\)\) return;/],
    ];
    for (const [file, gate] of GATES) {
      const code = readFileSync(join(ROOT, file), 'utf8');
      assert.match(code, gate, `${file} reaches the demo boundary without a gate`);
    }
  });
});

describe('the gateway is the only door, and it is one door', () => {
  const gateway = readFileSync(join(ROOT, GATEWAY), 'utf8');

  it('dataService has no static value import of the fixtures', () => {
    for (const specifier of valueImports(gateway)) {
      assert.ok(
        !namesTheDemoBoundary(specifier),
        `dataService statically imports ${specifier}, which links the fixtures into every ` +
          'component that imports dataService — which is all of them',
      );
    }
  });

  it('it reaches them through exactly one dynamic import', () => {
    // `typeof import('…')` is a TYPE query — erased at build time, and the
    // thing that gives the delegation helper its signature. It is not a door.
    const doors = [...gateway.matchAll(/(?<!typeof )import\(\s*['"]@\/app\/demo\/[^'"]+['"]\s*\)/g)];
    assert.equal(
      doors.length,
      1,
      `expected one door into the demo boundary, found ${doors.length}`,
    );
    assert.match(gateway, /await import\('@\/app\/demo\/demoBackend'\)/);
  });

  it('and every fixture answer goes through the same guarded shape', () => {
    // `if (isDemoExperience()) return demoBackend(…); requireProductBackend();`
    // The second line is what makes a build with no backend REFUSE rather than
    // answer, and a delegation without it would answer `undefined` — which a
    // surface would render as an empty workspace.
    const delegations = [...gateway.matchAll(/if \(isDemoExperience\(\)\) return demoBackend\(/g)];
    assert.ok(delegations.length > 50, `expected the full data surface, found ${delegations.length}`);

    const unguarded: string[] = [];
    const pattern = /if \(isDemoExperience\(\)\) return demoBackend\(b => b\.(\w+)\([\s\S]*?\);\n(.*)/g;
    for (let m = pattern.exec(gateway); m !== null; m = pattern.exec(gateway)) {
      if (!m[2].includes('requireProductBackend()')) unguarded.push(m[1]);
    }
    assert.deepEqual(
      unguarded,
      [],
      'these delegate to the demo backend but do not require a real one otherwise:\n' +
        unguarded.join(', '),
    );
  });

  it('the old synchronous re-exports have not come back', () => {
    // Ten of these — `getDemoSubmissions`, `getDemoTeamMembers`,
    // `getDemoMessages`, `getDemoProposal`, `getDemoEngagementEvents`,
    // `getDemoScheduledMeeting`, `getDemoClientSubmission`, `DEMO_CLIENTS`,
    // `DEMO_TEAM_LOGIN`, `DEMO_NURTURE_LEADS` — were the mechanism. Eleven
    // components imported them, most inside a `catch`.
    for (const name of [
      'getDemoSubmissions', 'getDemoTeamMembers', 'getDemoTeamFallback',
      'getDemoMessages', 'getDemoProposal', 'getDemoEngagementEvents',
      'getDemoScheduledMeeting', 'getDemoClientSubmission',
      'DEMO_CLIENTS', 'DEMO_TEAM_LOGIN', 'DEMO_NURTURE_LEADS',
    ]) {
      assert.ok(
        !new RegExp(`export const ${name}\\s*=`).test(gateway),
        `dataService re-exports ${name} again — the wall has a hole in it`,
      );
    }
  });

  it('and `isDemo()` — the conflation itself — is gone', () => {
    // `isDemo()` was `!BACKEND_INTEGRATION`: "the backend is off" and "this is
    // a demo" were one question with one answer, and the shipped default
    // answered yes.
    assert.ok(!/function isDemo\(\)/.test(gateway));
    assert.match(
      gateway,
      /function isDemoExperience\(\): boolean \{\s*return FEATURES\.DEMO_EXPERIENCE && !FEATURES\.BACKEND_INTEGRATION;/,
      'the demo gate no longer requires the backend to be off, so a live failure could be ' +
        'answered with a fixture',
    );
  });
});

describe('the fixtures are where they were put', () => {
  it('none has drifted back into src/app/utils or src/app/core', () => {
    const strays = FILES.filter(file =>
      /(^|\/)src\/app\/(utils|core)\//.test(file.split(sep).join('/')) &&
      /(^|\/)(mock[A-Z]\w*|demoData)\.tsx?$/.test(file.split(sep).pop()!),
    );
    assert.deepEqual(strays, [], 'fabricated fixtures are back outside the demo boundary');
  });

  it('the boundary still holds the fixtures it is supposed to', () => {
    const inside = FILES.filter(isInsideDemo).map(f => f.split(sep).join('/'));
    for (const expected of [
      'src/app/demo/demoBackend.ts',
      'src/app/demo/aiDemoResponses.ts',
      'src/app/demo/fixtures/demoData.ts',
      'src/app/demo/fixtures/mockCortexData.ts',
      'src/app/demo/fixtures/mockCortexAIBrain.ts',
      'src/app/demo/fixtures/mockAIAnalysis.ts',
      'src/app/demo/fixtures/mockClientReport.ts',
      'src/app/demo/fixtures/revenueSnapshots.ts',
      'src/app/demo/fixtures/executionProject.ts',
      'src/app/demo/fixtures/proposalSnapshot.ts',
    ]) {
      assert.ok(inside.includes(expected), `${expected} is missing from the demo boundary`);
    }
  });
});

describe('no authenticated surface declares its own fabricated business data', () => {
  /**
   * Moving the shared fixtures is not enough on its own. Four surfaces had
   * their OWN, declared inline, which no boundary would have caught:
   *
   *   AnalyticsDashboard      `generateDemoSubmissions()` — twenty records from
   *                           `Math.random()`, charted as a business.
   *   EngagementIntelligence  an `EngagementAnalytics` literal — 15 reports,
   *                           an 80% view rate, a "High Engagement Co".
   *   TeamHomeDashboard       `ACTIVITY_FEED` — eight events naming real-looking
   *                           companies, timestamped "2 min ago".
   *   emailNurtureQueue       open and click rates from benchmark constants.
   */
  const NAMED = [
    'Manufacturing Pro', 'RetailMax Inc', 'TechCorp Solutions', 'CloudServe Ltd',
    'HealthFirst', 'FinanceHub', 'High Engagement Co', 'Active Prospect Inc',
    'Demo Company', 'Marcus Chen', 'Priya Sharma', 'James Wilson',
  ];

  it('no invented company or person is named outside the demo boundary', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (isInsideDemo(file)) continue;
      // The registry and the architecture view DESCRIBE the codebase, quoting
      // module names and their contents. Describing a fixture is not being one.
      const base = file.split(sep).pop()!;
      if (/^registry|^SystemArchitecture|^manifest/.test(base)) continue;
      const code = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      for (const name of NAMED) {
        if (code.includes(name)) offenders.push(`${file} names "${name}"`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'fabricated businesses or people are declared outside the demo boundary:\n' +
        offenders.join('\n'),
    );
  });

  it('the four inline generators have not returned', () => {
    const GONE: [file: string, marker: RegExp, what: string][] = [
      [join('src', 'app', 'components', 'AnalyticsDashboard.tsx'),
        /generateDemoSubmissions/, 'the random submission generator'],
      [join('src', 'app', 'components', 'EngagementIntelligence.tsx'),
        /const demoData: EngagementAnalytics/, 'the hand-written engagement numbers'],
      [join('src', 'app', 'components', 'TeamHomeDashboard.tsx'),
        /const ACTIVITY_FEED = \[/, 'the invented activity feed'],
      [join('src', 'app', 'components', 'FullFeaturedDashboard.tsx'),
        /const SEED_SUBMISSIONS/, 'the module-scope seed submissions'],
    ];
    for (const [file, marker, what] of GONE) {
      const code = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      assert.ok(!marker.test(code), `${what} is back in ${file}`);
    }
  });

  it('email engagement is reported as unmeasured rather than estimated', () => {
    // 97% delivered, 42% opened, 18% clicked, 2% bounced — constants times the
    // sent count, drawn as the Email Queue's four headline figures. Nothing
    // consumes a delivery webhook, so there is no number to draw.
    const queue = readFileSync(join(ROOT, 'src', 'app', 'utils', 'emailNurtureQueue.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    assert.ok(!/benchmarkOpenRates/.test(queue), 'the benchmark open-rate table is back');
    assert.ok(
      !/Math\.round\(totalSent \* 0\.97\)/.test(queue),
      'delivery is being estimated from the sent count again',
    );
    assert.match(queue, /openRate: number \| null;/, 'the unmeasured fields are numbers again');
  });
});

describe('the banner that makes a demo honest', () => {
  it('exists, renders nothing outside a demo, and is mounted on both shells', () => {
    const banner = readFileSync(
      join(ROOT, 'src', 'app', 'components', 'DemoExperienceBanner.tsx'), 'utf8');
    assert.match(
      banner,
      /return FEATURES\.DEMO_EXPERIENCE && !FEATURES\.BACKEND_INTEGRATION;/,
      'the banner uses a different rule from the data layer, so the two can disagree',
    );
    assert.match(banner, /if \(!isDemoExperienceBuild\(\)\) return null;/);

    for (const shell of [
      join('src', 'app', 'components', 'TeamDashboardLayout.tsx'),
      join('src', 'app', 'components', 'ClientPortal.tsx'),
    ]) {
      assert.match(
        readFileSync(join(ROOT, shell), 'utf8'),
        /<DemoExperienceBanner \/>/,
        `${shell} does not carry the demo banner — a demo there would be silent`,
      );
    }
  });
});
