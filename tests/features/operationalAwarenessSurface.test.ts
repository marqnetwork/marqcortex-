/**
 * THE OPERATIONAL AWARENESS SURFACE — UI Sprint 2.
 *
 * G5 built two server reads and shipped both with no consumer: the enterprise
 * health roll-up (blueprint §IV-51, `GET /health/enterprise`) and the
 * enterprise KPI report (§IV-48, `GET /kpis`). Nothing in the product read
 * either one. This suite covers the client and the panel that now do.
 *
 * ── WHAT THIS SUITE IS ACTUALLY GUARDING ────────────────────────────────────
 *
 * Both server modules were written around disciplines that only survive if the
 * RENDERER honours them, and a renderer is exactly where they get lost. Every
 * one of these is a claim about what the UI must NOT do, which is why they are
 * asserted rather than trusted:
 *
 *   `unknown` must never read as healthy. It is a first-class answer, it gets
 *   its own word and its own colour, and it must sort above healthy.
 *
 *   A dimension nothing measures must say so. `observable: false` and
 *   "observable but currently unknown" look identical on a status page and mean
 *   completely different things; the server names them separately so the page
 *   can too.
 *
 *   `value: null` must never render as 0. A platform where nothing has happened
 *   and a platform whose signal cannot be read are different states.
 *
 *   No target, threshold, grade or score. §IV-48 defers every numeric target to
 *   a later phase and restates `targetsInScope: false` on every report; a UI
 *   that drew a progress bar or a RAG rating would be inventing the product the
 *   blueprint deferred.
 *
 *   No demo data. Every other dashboard service falls back to seed data with
 *   the backend off. On an operational surface a fabricated green is worse than
 *   a blank page.
 *
 * TESTING APPROACH (documented limitation)
 *   The service is authored against the Vite `@/*` aliases and reaches
 *   `import.meta.env` through the config modules, and the panel is `.tsx`, so
 *   neither can be imported by this runner (`node --experimental-strip-types`,
 *   which strips types but resolves no aliases and transforms no JSX).
 *   Following the established pattern (clientPortalAuthContract /
 *   workflowOperatorSurface / frontendRuntimeDefects), each guarantee is
 *   enforced structurally against the production source, with pattern-based
 *   assertions rather than line numbers. The navigation half IS behavioural —
 *   the navigation model imports only lucide-react.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { getDestination } from '../../src/app/core/navigationModel.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Code with every human-readable string removed: comments, quoted and template
 * literals, and JSX text nodes.
 *
 * The "no targets, no grades" guards below are about what the code REASONS
 * about, not about which words appear on the page — and the page deliberately
 * says the words, to tell the reader these numbers are not scored. Checking the
 * raw source would fail on its own disclaimer.
 */
function codeOnly(text: string): string {
  return stripComments(text)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    // JSX text: whatever sits between a closing '>' and the next '<'.
    .replace(/>[^<>{}]+</g, '><');
}

const SERVICE = 'src/app/services/operationalAwarenessService.ts';
const PANEL   = 'src/app/components/OperationsPanel.tsx';
const SHELL   = 'src/app/components/TeamDashboardNew.tsx';

const service = stripComments(readSource(SERVICE));
const panel   = stripComments(readSource(PANEL));
const shell   = stripComments(readSource(SHELL));

// ─────────────────────────────────────────────────────────────────────────────
// THE SEAM — a client asking for a URL the server does not register is a silent
// 404 in production, passes every server test, and TypeScript cannot see it.
// ─────────────────────────────────────────────────────────────────────────────

describe('the client asks for routes the server registers', () => {
  const server = readSource('supabase/functions/server/index.tsx');

  it('reads enterprise health at the path the server serves it on', () => {
    assert.match(service, /'\/health\/enterprise'/);
    assert.match(server, /app\.get\("\/make-server-324f4fbe\/health\/enterprise"/);
  });

  it('reads the KPI report at the path the server serves it on', () => {
    assert.match(service, /'\/kpis'/);
    assert.match(server, /app\.get\("\/make-server-324f4fbe\/kpis"/);
  });

  it('sends the team token both endpoints require', () => {
    // Both routes call verifyTeamToken and 401 without it.
    assert.match(service, /Authorization: `Bearer \$\{accessToken\}`/);
  });

  it('unwraps the envelope key each route actually returns', () => {
    assert.match(service, /\{ health \} = await read/);
    assert.match(server, /c\.json\(\{ success: true, health \}\)/);
    assert.match(service, /\{ kpis \} = await read/);
    assert.match(server, /c\.json\(\{ success: true, kpis:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNKNOWN NEVER READS AS HEALTHY
// ─────────────────────────────────────────────────────────────────────────────

describe('unknown is never rendered as healthy', () => {
  it('the client mirrors the server\'s four states, unknown included', () => {
    assert.match(
      service,
      /export type HealthState = 'healthy' \| 'degraded' \| 'unhealthy' \| 'unknown';/,
    );
  });

  it('unknown gets a word that carries its meaning', () => {
    const labels = service.match(/HEALTH_STATE_LABELS[\s\S]*?\};/);
    assert.ok(labels, 'expected a state label map');
    assert.match(labels[0], /unknown:\s*'Not known'/);
    // Never a dash, never "OK" — both read as "nothing to worry about".
    assert.ok(!/unknown:\s*'(OK|Ok|—|-|N\/A)'/.test(labels[0]));
  });

  it('unknown is not green', () => {
    // The map reads from the token layer now rather than spelling out hex, so
    // this compares the RESOLVED colours: what matters is that a state nobody
    // could measure is never painted the same as one that was measured and
    // came back well.
    const colors = service.match(/HEALTH_STATE_COLORS[\s\S]*?\};/);
    assert.ok(colors, 'expected a state colour map');
    assert.ok(
      !/'#[0-9A-Fa-f]{3,8}'/.test(colors[0]),
      'the health colours must come from the token layer, not from hex',
    );
    const ref = (state: string) => {
      const m = colors[0].match(new RegExp(`${state}:\\s*([A-Za-z_][\\w.]*)`));
      assert.ok(m, `expected a colour for ${state}`);
      return m[1];
    };
    assert.notEqual(ref('unknown'), ref('healthy'),
      'unknown must not borrow the healthy colour');
    assert.notEqual(ref('unknown'), ref('degraded'),
      'unknown must not borrow the degraded colour either');
  });

  it('unknown outranks healthy when ordering worst-first', () => {
    const severity = service.match(/HEALTH_SEVERITY[\s\S]*?\};/);
    assert.ok(severity, 'expected a severity map');
    const value = (state: string) =>
      Number(severity[0].match(new RegExp(`${state}:\\s*(\\d+)`))![1]);
    assert.ok(
      value('unknown') > value('healthy'),
      'an operator should meet what is not known before what is fine',
    );
    assert.ok(value('unhealthy') > value('degraded'));
    assert.ok(value('degraded') > value('unknown'));
  });

  it('the panel sorts dimensions and signals worst-first', () => {
    assert.ok(
      /\.sort\(\(a, b\) =>\s*compareHealthStates\(a\.state, b\.state\)/.test(panel),
      'signals within a dimension must be ordered worst-first',
    );
    assert.ok(
      /health\.dimensions\]\.sort\(\(a, b\) => compareHealthStates\(a\.state, b\.state\)\)/.test(panel),
      'dimensions must be ordered worst-first',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A DIMENSION NOTHING MEASURES SAYS SO
// ─────────────────────────────────────────────────────────────────────────────

describe('an unobserved dimension is named, not inferred', () => {
  it('the client carries the observable flag and the unobserved list', () => {
    assert.match(service, /observable:\s*boolean;/);
    assert.match(service, /unobservedDimensions:\s*HealthDimension\[\];/);
  });

  it('the panel renders the unobserved list explicitly', () => {
    assert.ok(/health\.unobservedDimensions\.length > 0/.test(panel));
    assert.ok(
      /Not machine-observable in this deployment/.test(panel),
      'the page must say which dimensions nothing measures',
    );
  });

  it('the panel distinguishes "not measured" from a state', () => {
    assert.ok(
      /!dimension\.observable && \(/.test(panel),
      'observable:false is its own badge, not a flavour of unknown',
    );
  });

  it('a dimension with no signals is not presented as fine', () => {
    assert.ok(
      /That is\s*\n?\s*not a healthy reading — it is the absence of one\./.test(readSource(PANEL)) ||
        /not a healthy reading/.test(panel),
      'an empty dimension must say what its emptiness means',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// null IS NOT ZERO
// ─────────────────────────────────────────────────────────────────────────────

describe('an unmeasured indicator is never shown as zero', () => {
  it('the reading type keeps null distinct from a number', () => {
    assert.match(service, /value:\s*number \| null;/);
  });

  it('the formatter returns null rather than a zero string', () => {
    assert.ok(
      /if \(reading\.value === null\) return null;/.test(service),
      'formatKpiValue must refuse to render an unmeasured value at all',
    );
    assert.match(service, /export function formatKpiValue\([\s\S]*?\): string \| null/);
    // The tempting bug: `?? 0` or `|| 0` anywhere near the value.
    assert.ok(
      !/reading\.value\s*(\?\?|\|\|)\s*0/.test(service),
      'coalescing a null measurement to 0 is the exact defect this guards',
    );
  });

  it('the panel renders "Not measured" for it', () => {
    assert.ok(/const measured = formatted !== null;/.test(panel));
    assert.ok(/Not measured/.test(panel));
  });

  it('the panel names the unmeasured indicators the report lists', () => {
    assert.ok(/kpis\.unmeasured\.length > 0/.test(panel));
    assert.ok(
      /These\s*\n?\s*are unread, not zero\./.test(readSource(PANEL)) ||
        /unread, not zero/.test(panel),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO TARGETS, NO GRADES
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing here converts a measurement into a judgement', () => {
  it('the panel renders the report\'s own out-of-scope statement', () => {
    assert.ok(
      /kpis\.targetsInScope === false/.test(panel),
      'the server restates this on every report; the page must not drop it',
    );
    assert.ok(/no targets, thresholds or grades/i.test(panel));
  });

  it('neither the client nor the panel invents a target or a grade', () => {
    for (const [name, source] of [
      ['service', codeOnly(readSource(SERVICE))],
      ['panel', codeOnly(readSource(PANEL))],
    ] as const) {
      for (const term of ['threshold', 'slo', 'target', 'grade', 'score', 'rating']) {
        assert.ok(
          !new RegExp(`\\b${term}\\b`, 'i').test(source),
          `the ${name} must not reason about a ${term} — §IV-48 defers all of them`,
        );
      }
    }
  });

  it('draws no progress bar, which would imply a target', () => {
    assert.ok(!/role="progressbar"|<progress/i.test(panel));
  });

  it('keeps the type literal that pins the statement', () => {
    assert.match(service, /targetsInScope:\s*false;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO DEMO DATA
// ─────────────────────────────────────────────────────────────────────────────

describe('the operational surface fabricates nothing', () => {
  it('the client refuses to answer with the backend off', () => {
    assert.ok(
      /if \(!isBackendEnabled\(\)\) throw BACKEND_DISABLED;/.test(service),
      'it must throw, not fall back',
    );
  });

  it('names no seed, demo or mock source', () => {
    for (const term of ['demo', 'mock', 'seed', 'fixture', 'sample']) {
      assert.ok(
        !new RegExp(`\\b${term}\\w*\\s*\\(`, 'i').test(service),
        `the client must not call a ${term} source`,
      );
    }
    assert.ok(!/getDemo|mockData|DEMO_/.test(service));
    assert.ok(!/getDemo|mockData|DEMO_/.test(panel));
  });

  it('the panel shows nothing rather than something, when a read fails', () => {
    assert.ok(
      /setHealth\(healthResult\.status === 'fulfilled' \? healthResult\.value : null\)/.test(panel),
    );
    assert.ok(
      /No indicator is being shown as zero in its place/.test(panel),
      'a failed KPI read must not become a page of zeroes',
    );
    assert.ok(
      /Nothing is being reported as healthy in its place/.test(panel),
      'a failed health read must not become a green page',
    );
  });

  it('one surface failing does not blank the other', () => {
    assert.ok(
      /Promise\.allSettled\(\[/.test(panel),
      'the two reads are independent and must be settled, not raced',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORITY
// ─────────────────────────────────────────────────────────────────────────────

describe('the panel decides no authority of its own', () => {
  it('compares no role and grants no capability', () => {
    for (const term of ['isAdmin', 'super_admin', 'organization_admin', 'teamRole']) {
      assert.ok(
        !new RegExp(term).test(panel),
        `the panel must not reason about ${term} — both routes verify the token server-side`,
      );
    }
  });

  it('renders a refusal as a normal state, not a crash', () => {
    assert.ok(/forbidden: awarenessError\?\.isForbidden \?\? false/.test(panel));
    assert.ok(/Not authorized/.test(panel));
    assert.ok(
      /error\?\.forbidden \? undefined :/.test(panel),
      'a refusal offers no retry — retrying will not change the operator\'s role',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REACHABILITY — behavioural, via the navigation model
// ─────────────────────────────────────────────────────────────────────────────

describe('Operations is reachable', () => {
  const operations = getDestination('operations');

  it('exists as a navigation destination', () => {
    assert.ok(operations, 'both server reads had no consumer and no destination');
  });

  it('is filed under the operating intent', () => {
    assert.equal(operations!.group, 'operate');
  });

  it('is findable by the words an operator would search', () => {
    for (const term of ['health', 'kpi', 'signal', 'status', 'operational']) {
      assert.ok(
        operations!.keywords.includes(term),
        `an operator searching "${term}" must find Operations`,
      );
    }
  });

  it('the shell renders it, with the operator\'s token', () => {
    assert.ok(/currentPage === 'operations'/.test(shell));
    assert.ok(/<OperationsPanel[\s\S]{0,80}accessToken=\{accessToken\}/.test(shell));
  });

  it('stays a lazy chunk', () => {
    assert.ok(/const OperationsPanel\s*=\s*lazy\(/.test(shell));
  });
});
