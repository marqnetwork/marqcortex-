/**
 * Enterprise KPIs — blueprint §IV-48.
 *
 * §IV-48 is mostly a list of things a KPI programme must NOT do, and this suite
 * is mostly about those: no targets, no grades, and no indicator that measures
 * activity for its own sake.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KPI_CATEGORIES,
  KpiDefinitionError,
  NON_SUCCESS_TERMS,
  SUCCESS_DIMENSIONS,
  assertValidKpi,
  cortexKpiDefinitions,
  createKpiRegistry,
  ratioPercent,
  registerCortexKpis,
  type KpiDefinition,
  type KpiSignals,
} from '../../supabase/functions/server/kpi/index.ts';

const NOW = () => '2026-09-07T12:00:00.000Z';

function definition(overrides: Partial<KpiDefinition> = {}): KpiDefinition {
  return {
    id: 'strategic.example',
    category: 'strategic',
    name: 'Example',
    question: 'Does this indicator answer a question?',
    unit: 'count',
    serves: ['trust'],
    ...overrides,
  };
}

function signals(overrides: Partial<KpiSignals> = {}): KpiSignals {
  return {
    estate: () =>
      Promise.resolve({ submissions: 40, analyses: 30, outcomes: 12, industries: 5 }),
    ai: () => ({
      requests: 100,
      errors: 4,
      failovers: 2,
      governanceBlocks: 1,
      factLockRestores: 7,
    }),
    ...overrides,
  };
}

describe('IV-48 — the anti-metric exclusion is enforced, not written down', () => {
  it('refuses an indicator that names no constitutional dimension', () => {
    // The binding rule: an indicator that cannot say which dimension it serves
    // is measuring activity for its own sake.
    assert.throws(
      () => assertValidKpi(definition({ serves: [] })),
      (error: Error) =>
        error instanceof KpiDefinitionError && /measuring activity for its own sake/.test(error.message),
    );
  });

  it('refuses a dimension that is not one of the nine', () => {
    assert.throws(
      () => assertValidKpi(definition({ serves: ['velocity' as never] })),
      KpiDefinitionError,
    );
  });

  it('refuses an indicator named for an explicit non-success', () => {
    // DNA Ch 33.3 names five. A blunt gate, and a cheap one.
    for (const term of NON_SUCCESS_TERMS) {
      assert.throws(
        () => assertValidKpi(definition({ id: `strategic.${term}_index`, name: 'Anything' })),
        (error: Error) => error instanceof KpiDefinitionError && error.message.includes(term),
        `an indicator named for ${term} was admitted`,
      );
    }
  });

  it('refuses an indicator whose question is not a question', () => {
    assert.throws(
      () => assertValidKpi(definition({ question: 'measures things' })),
      KpiDefinitionError,
    );
  });

  it('refuses an id that does not agree with its category', () => {
    assert.throws(
      () => assertValidKpi(definition({ id: 'customer.example', category: 'strategic' })),
      KpiDefinitionError,
    );
  });

  it('admits an honest indicator', () => {
    assert.doesNotThrow(() => assertValidKpi(definition()));
  });

  it('declares the nine dimensions and four categories the canon fixes', () => {
    assert.equal(SUCCESS_DIMENSIONS.length, 9, 'DNA Ch 33.2 lists nine');
    assert.deepEqual([...KPI_CATEGORIES], ['strategic', 'operational', 'quality', 'customer']);
  });
});

describe('IV-48 — the registry', () => {
  it('refuses a duplicate id and a mismatched measurement', () => {
    const registry = createKpiRegistry();
    const measurement = { id: 'strategic.example', measure: () => ({ value: 1, basis: 'x' }) };
    registry.register(definition(), measurement);
    assert.throws(() => registry.register(definition(), measurement), KpiDefinitionError);
    assert.throws(
      () =>
        registry.register(definition({ id: 'strategic.other' }), {
          id: 'strategic.example',
          measure: () => ({ value: 1, basis: 'x' }),
        }),
      KpiDefinitionError,
    );
  });

  it('reports a failed measurement as null and says why', async () => {
    // Zero would be a number somebody acts on.
    const registry = createKpiRegistry();
    registry.register(definition(), {
      id: 'strategic.example',
      measure: () => {
        throw new Error('the counter is gone');
      },
    });
    const report = await registry.read(NOW);
    assert.equal(report.readings[0].value, null);
    assert.match(report.readings[0].basis, /the measurement failed: the counter is gone/);
    assert.deepEqual(report.unmeasured, ['strategic.example']);
  });

  it('names the unmeasured indicators rather than leaving them to be inferred', async () => {
    const registry = createKpiRegistry();
    registry.register(definition(), {
      id: 'strategic.example',
      measure: () => ({ value: null, basis: 'nothing to read' }),
    });
    const report = await registry.read(NOW);
    assert.deepEqual(report.unmeasured, ['strategic.example']);
  });

  it('restates on every report that targets are out of scope', async () => {
    // A consumer that renders this cannot quietly start treating the numbers as
    // scored, and one that ignores it has been told.
    const report = await createKpiRegistry().read(NOW);
    assert.equal(report.targetsInScope, false);
  });
});

describe('IV-48 — the Cortex catalogue', () => {
  it('registers every indicator without being refused', () => {
    const registry = createKpiRegistry();
    assert.doesNotThrow(() => registerCortexKpis(registry, signals()));
    assert.equal(registry.list().length, cortexKpiDefinitions().length);
  });

  it('covers all four categories', () => {
    const registry = createKpiRegistry();
    registerCortexKpis(registry, signals());
    for (const category of KPI_CATEGORIES) {
      assert.ok(
        registry.byCategory(category).length > 0,
        `${category} has no indicator, so the category is approved and unmeasured`,
      );
    }
  });

  it('measures the deterministic corrections the Constitution actually cares about', async () => {
    // "Math decides; AI narrates" made measurable: how often the deterministic
    // engines had to put an authoritative number back.
    const registry = createKpiRegistry();
    registerCortexKpis(registry, signals());
    const report = await registry.read(NOW);
    const corrections = report.readings.find(
      (reading) => reading.id === 'quality.deterministic_corrections',
    );
    assert.equal(corrections?.value, 7);
    assert.match(corrections?.basis ?? '', /no target is applied/);
  });

  it('reports a ratio as a measurement, not a grade', async () => {
    const registry = createKpiRegistry();
    registerCortexKpis(registry, signals());
    const report = await registry.read(NOW);
    const coverage = report.readings.find((reading) => reading.id === 'customer.analysis_coverage');
    assert.equal(coverage?.value, 75);
    assert.equal(coverage?.unit, 'ratio_percent');
  });

  it('reports null rather than zero when nothing has happened', async () => {
    // "Nothing has happened" and "none of what happened qualified" are
    // different facts. Reporting both as 0% makes an idle platform look like a
    // failing one.
    assert.equal(ratioPercent(0, 0), null);
    assert.equal(ratioPercent(0, 10), 0);

    const registry = createKpiRegistry();
    registerCortexKpis(
      registry,
      signals({
        estate: () =>
          Promise.resolve({ submissions: 0, analyses: 0, outcomes: 0, industries: 0 }),
      }),
    );
    const report = await registry.read(NOW);
    const coverage = report.readings.find((reading) => reading.id === 'customer.analysis_coverage');
    assert.equal(coverage?.value, null);
    assert.ok(report.unmeasured.includes('customer.analysis_coverage'));
  });

  it('reports null for every AI indicator when the plane published no counters', async () => {
    const registry = createKpiRegistry();
    registerCortexKpis(registry, signals({ ai: () => null }));
    const report = await registry.read(NOW);
    for (const id of [
      'operational.ai_request_success',
      'operational.provider_failovers',
      'quality.deterministic_corrections',
      'quality.governance_blocks',
    ]) {
      const reading = report.readings.find((entry) => entry.id === id);
      assert.equal(reading?.value, null, `${id} invented a number`);
      assert.match(reading?.basis ?? '', /no counters/);
    }
  });

  it('every indicator names a dimension and a question', () => {
    for (const entry of cortexKpiDefinitions()) {
      assert.ok(entry.serves.length > 0, `${entry.id} serves nothing`);
      assert.ok(entry.question.endsWith('?'), `${entry.id} states no question`);
    }
  });
});

describe('IV-48 — what the catalogue must not contain', () => {
  it('states no target, threshold or grade in executable code', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = join(root, 'supabase', 'functions', 'server', 'kpi');

    const executable = (text: string): string =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/`(?:[^`\\]|\\.)*`/g, "''")
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, "''");

    for (const file of ['contracts.ts', 'registry.ts', 'catalog.ts']) {
      const code = executable(readFileSync(join(dir, file), 'utf8'));
      for (const forbidden of ['threshold', 'slo', 'benchmark', 'grade', 'score']) {
        assert.ok(
          !new RegExp(`\\b${forbidden}`, 'i').test(code),
          `${file} mentions ${forbidden} in executable code — IV-48 excludes those`,
        );
      }
      // The substantive rule: nothing is compared against a magic number. A
      // comparison against zero is presence, which is how `null` is decided.
      const gradings = code.match(/[<>]=?\s*[1-9][0-9]*/g) ?? [];
      assert.deepEqual(gradings, [], `${file} compares a measurement against ${gradings.join(', ')}`);
    }
  });
});

// ── The route, as wired ─────────────────────────────────────────────────────

describe('IV-48 — the KPI route', () => {
  async function routeBody(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const source = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const start = source.indexOf('app.get("/make-server-324f4fbe/kpis"');
    assert.ok(start >= 0, 'the KPI route was not found');
    return source.slice(start, source.indexOf('app.get(', start + 10));
  }

  it('requires a verified team caller', async () => {
    const body = await routeBody();
    assert.match(body, /verifyTeamToken\(c\.req\.header\('Authorization'\)\)/);
    assert.match(body, /if \(!userId\) return c\.json\(\{ error: "Unauthorized" \}, 401\)/);
  });

  it('does not count an absent industry as an industry', async () => {
    // 'Not specified' is what the capture route writes when it has none.
    // Counting it would inflate the breadth indicator with the absence of an
    // answer.
    assert.match(await routeBody(), /industry !== 'Not specified'/);
  });

  it('survives a malformed submission rather than failing the report', async () => {
    assert.match(await routeBody(), /catch \{/);
  });

  it('is a read — nothing writes a KPI', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const source = readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8');
    for (const method of ['post', 'patch', 'put', 'delete']) {
      assert.ok(
        !new RegExp(`app\\.${method}\\("/make-server-324f4fbe/kpis`).test(source),
        `a ${method} on the KPI route would make an indicator writable`,
      );
    }
  });
});
