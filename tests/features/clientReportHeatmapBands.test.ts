/**
 * PHASE 1B TASK 25 — client report heatmap band contract
 *
 * `getHeatmap()` derives four operational bands from two submission scores and
 * then compares each derived value against `'green'` to pick a label and an
 * explanation. Two of the four derivations are two-outcome ternaries:
 *
 *     const sys = sub.completionScore >= 80 ? 'yellow' : 'red';
 *     const ai  = sub.qualityScore    >= 80 ? 'yellow' : 'red';
 *
 * TypeScript narrowed each `const` to the initialiser's own literal union
 * (`'red' | 'yellow'`), so the later `sys === 'green'` / `ai === 'green'`
 * comparisons had no overlap and raised four TS2367 diagnostics — even though
 * the surrounding object had always declared the band as the full
 * `'red' | 'yellow' | 'green'` contract.
 *
 * The fix names that contract locally (`HeatmapBand`) and applies it to all four
 * declarations, which stops the const narrowing without touching a single
 * threshold, operator, label or explanation string. The four redundant
 * `score: x as 'red' | 'yellow' | 'green'` assertions became unnecessary and were
 * dropped; assertions are erased at runtime, so nothing observable changed.
 *
 * These tests lock the behaviour the diagnostics were about:
 *   - each of the four threshold expressions still maps scores to bands exactly
 *     as it did before, swept across the whole 0–100 score range;
 *   - `sys` still cannot produce `'green'` under the current expression;
 *   - `ai` still cannot produce `'green'` under the current expression;
 *   - a fixed submission still generates a byte-identical report.
 *
 * NOTE — the unreachable `'green'` branches are deliberately preserved, not
 * repaired. `operationsExecution` has the same reachability quirk (its `>= 70`
 * test shadows the `>= 85` green branch). Fixing any of that is out of scope for
 * a type-only task; these tests pin the current behaviour so a later, explicit
 * threshold change has to be a deliberate edit to this file too.
 *
 * TESTING APPROACH (documented limitation — same one recorded in
 * demoSubmissionContract.test.ts)
 *   clientReportGenerator.ts is plain .ts and runs fine under the test runner,
 *   but it type-imports `Submission` from the dataService barrel, which reaches
 *   src/app/lib/api.ts — a module authored against DOM globals. The node
 *   boundary (tsconfig.node.json) sets `lib: ["ES2022"]` with no DOM, so a
 *   *static* import here drags api.ts into that boundary and raises
 *   `typecheck:tests` from 10 pre-existing errors to 99.
 *
 *   The module is therefore loaded through a runtime-computed specifier, which
 *   the compiler does not follow, and its surface is declared locally below.
 *   That keeps the node type graph exactly as it was while still exercising the
 *   real generator. The assignability half — that a real `Submission` satisfies
 *   `generateClientReport` and that each band is the full `HeatmapBand` union —
 *   is proven where it belongs, by `typecheck:web`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Local mirror of the generator surface this suite touches.
// ---------------------------------------------------------------------------

/** The fields of `Submission` that `generateClientReport` actually reads, plus
 *  the rest of the record so fixtures stay recognisable as real submissions. */
interface SubmissionFixture {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  industryId: string;
  employees: string;
  revenue: string;
  submittedAt: string;
  submittedDate: string;
  status: string;
  priority: string;
  completionScore: number;
  qualityScore: number;
  aiScore: number;
  roiPotential: string;
  answers: Record<number, string | number>;
  isRead: boolean;
}

interface HeatmapCell {
  score: string;
  label: string;
  explanation: string;
}

interface OperationalHeatmap {
  operationsExecution: HeatmapCell;
  revenueGrowth: HeatmapCell;
  systemsAutomation: HeatmapCell;
  aiReadiness: HeatmapCell;
}

interface ClientReport {
  generatedDate: string;
  operationalHeatmap: OperationalHeatmap;
  [field: string]: unknown;
}

interface ClientReportGeneratorModule {
  generateClientReport(sub: SubmissionFixture): ClientReport;
}

const GENERATOR_URL = new URL('../../src/app/utils/clientReportGenerator.ts', import.meta.url).href;
const { generateClientReport } = (await import(GENERATOR_URL)) as ClientReportGeneratorModule;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const BASE: SubmissionFixture = {
  id: 'SUB-FIXED-001',
  company: 'Northwind Logistics',
  contact: 'Dana Reyes',
  email: 'dana@northwind.example',
  phone: '+44 20 7946 0000',
  website: 'https://northwind.example',
  industry: 'SaaS / Software',
  industryId: 'saas',
  employees: '11-50',
  revenue: '£1M-£5M',
  submittedAt: '2025-01-15T09:00:00.000Z',
  submittedDate: '2025-01-15',
  status: 'new',
  priority: 'medium',
  completionScore: 82,
  qualityScore: 61,
  aiScore: 70,
  roiPotential: 'high',
  answers: { 1: 'I approve every purchase myself', 2: 'Spreadsheets and email' },
  isRead: false,
};

function heatmapFor(completionScore: number, qualityScore: number): OperationalHeatmap {
  return generateClientReport({ ...BASE, completionScore, qualityScore }).operationalHeatmap;
}

/** Every integer score, so each threshold boundary is crossed in both directions. */
const SCORES = Array.from({ length: 101 }, (_, i) => i);

// ---------------------------------------------------------------------------
// Threshold expressions — unchanged
// ---------------------------------------------------------------------------

describe('heatmap threshold expressions', () => {
  it('operationsExecution follows completionScore >= 70 ? yellow : >= 85 ? green : red', () => {
    for (const c of SCORES) {
      const expected = c >= 70 ? 'yellow' : c >= 85 ? 'green' : 'red';
      assert.equal(
        heatmapFor(c, 50).operationsExecution.score,
        expected,
        `operationsExecution changed at completionScore=${c}`,
      );
    }
  });

  it('revenueGrowth follows qualityScore >= 75 ? green : >= 55 ? yellow : red', () => {
    for (const q of SCORES) {
      const expected = q >= 75 ? 'green' : q >= 55 ? 'yellow' : 'red';
      assert.equal(
        heatmapFor(50, q).revenueGrowth.score,
        expected,
        `revenueGrowth changed at qualityScore=${q}`,
      );
    }
  });

  it('systemsAutomation follows completionScore >= 80 ? yellow : red', () => {
    for (const c of SCORES) {
      const expected = c >= 80 ? 'yellow' : 'red';
      assert.equal(
        heatmapFor(c, 50).systemsAutomation.score,
        expected,
        `systemsAutomation changed at completionScore=${c}`,
      );
    }
  });

  it('aiReadiness follows qualityScore >= 80 ? yellow : red', () => {
    for (const q of SCORES) {
      const expected = q >= 80 ? 'yellow' : 'red';
      assert.equal(
        heatmapFor(50, q).aiReadiness.score,
        expected,
        `aiReadiness changed at qualityScore=${q}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The two-outcome bands still cannot reach 'green'
// ---------------------------------------------------------------------------

describe('two-outcome bands remain two-outcome', () => {
  it('systemsAutomation never produces green across the whole score range', () => {
    const produced = new Set<string>();
    for (const c of SCORES) {
      for (const q of [0, 54, 55, 74, 75, 79, 80, 100]) {
        produced.add(heatmapFor(c, q).systemsAutomation.score);
      }
    }
    assert.equal(produced.has('green'), false, 'systemsAutomation produced green');
    assert.deepEqual([...produced].sort(), ['red', 'yellow']);
  });

  it('aiReadiness never produces green across the whole score range', () => {
    const produced = new Set<string>();
    for (const q of SCORES) {
      for (const c of [0, 69, 70, 79, 80, 84, 85, 100]) {
        produced.add(heatmapFor(c, q).aiReadiness.score);
      }
    }
    assert.equal(produced.has('green'), false, 'aiReadiness produced green');
    assert.deepEqual([...produced].sort(), ['red', 'yellow']);
  });

  it('the label of every band still tracks its own score', () => {
    const labelFor = (score: string) =>
      score === 'green' ? 'Stable' : score === 'yellow' ? 'Needs Attention' : 'Immediate';

    for (const c of [0, 55, 70, 80, 85, 100]) {
      for (const q of [0, 55, 75, 80, 100]) {
        const map = heatmapFor(c, q);
        for (const band of [
          map.operationsExecution,
          map.revenueGrowth,
          map.systemsAutomation,
          map.aiReadiness,
        ]) {
          assert.equal(band.label, labelFor(band.score), `label drifted at c=${c} q=${q}`);
          assert.equal(typeof band.explanation, 'string');
          assert.ok(band.explanation.length > 0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Whole-report equivalence for a fixed submission
// ---------------------------------------------------------------------------

describe('generated report for a fixed submission', () => {
  it('produces the exact heatmap recorded before the type-only change', () => {
    assert.deepEqual(generateClientReport(BASE).operationalHeatmap, {
      operationsExecution: {
        score: 'yellow',
        label: 'Needs Attention',
        explanation:
          'Operations function but are constrained. Manual processes and approval bottlenecks limit throughput. Cannot scale without structural change.',
      },
      revenueGrowth: {
        score: 'yellow',
        label: 'Needs Attention',
        explanation:
          'Revenue is growing but constrained by operational execution, not market demand. Fixing operations will unlock faster growth.',
      },
      systemsAutomation: {
        score: 'yellow',
        label: 'Needs Attention',
        explanation:
          'Partial automation exists but significant manual work remains. High-value automation opportunities are clearly identifiable and achievable.',
      },
      aiReadiness: {
        score: 'red',
        label: 'Immediate',
        explanation:
          'Foundation work required before AI implementation will be effective. Rushing AI without this groundwork typically leads to poor adoption and wasted investment.',
      },
    });
  });

  it('produces a byte-identical report body', () => {
    // `generatedDate` is `new Date().toISOString()` and is the only field that
    // varies per call, so it is excluded. The digest below was taken from the
    // pre-change implementation at 0303f9d4 and must not drift for a type-only
    // change. Regenerating it is only legitimate alongside a deliberate,
    // reviewed copy or scoring change.
    const { generatedDate, ...body } = generateClientReport(BASE);
    assert.equal(typeof generatedDate, 'string');

    const digest = createHash('sha256').update(JSON.stringify(body, null, 2)).digest('hex');
    assert.equal(digest, 'ed1ffcae7a90bccc8f4144362c23e043e61e9f0b00cbf69d35f31e468f64832b');
  });

  it('is deterministic apart from generatedDate', () => {
    const strip = (r: ClientReport) => {
      const { generatedDate: _ignored, ...body } = r;
      return body;
    };
    assert.deepEqual(strip(generateClientReport(BASE)), strip(generateClientReport(BASE)));
  });
});
