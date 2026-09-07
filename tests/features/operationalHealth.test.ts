/**
 * The Operational Health Framework — blueprint §IV-51.
 *
 * The framework's value is entirely in what it refuses to say. These tests are
 * mostly about that: that an unwired probe is not a pass, that an empty estate
 * is not a pass, that a dimension nothing measures does not get a green light,
 * and that one misbehaving source cannot take the health page down.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HEALTH_DIMENSIONS,
  aiControlPlaneSource,
  aiGovernanceSource,
  buildEnterpriseHealth,
  governanceFrameSource,
  productProgressionSource,
  rollUpDimension,
  shadowReadSource,
  storageSource,
  worse,
  type HealthSignalSource,
} from '../../supabase/functions/server/health/index.ts';

const NOW = () => '2026-09-07T12:00:00.000Z';

function build(sources: readonly HealthSignalSource[]) {
  return buildEnterpriseHealth(sources, NOW);
}

describe('IV-51 — unknown is never a pass', () => {
  it('reports a dimension with no signals as unknown and unobserved', () => {
    const rolled = rollUpDimension('product', []);
    assert.equal(rolled.state, 'unknown');
    assert.equal(rolled.observable, false);
  });

  it('reports a dimension whose every probe is silent as unobserved', () => {
    // A probe that never answers measures nothing, however many there are.
    const rolled = rollUpDimension('platform', [
      { name: 'a', state: 'unknown', detail: '' },
      { name: 'b', state: 'unknown', detail: '' },
    ]);
    assert.equal(rolled.state, 'unknown');
    assert.equal(rolled.observable, false);
  });

  it('ranks unknown worse than healthy and better than degraded', () => {
    assert.equal(worse('healthy', 'unknown'), 'unknown');
    assert.equal(worse('unknown', 'degraded'), 'degraded');
    assert.equal(worse('degraded', 'unhealthy'), 'unhealthy');
  });

  it('does not let one healthy signal cover an unknown one', () => {
    const rolled = rollUpDimension('platform', [
      { name: 'a', state: 'healthy', detail: '' },
      { name: 'b', state: 'unknown', detail: '' },
    ]);
    assert.equal(rolled.state, 'unknown', 'the dimension is only as known as its least-known probe');
    assert.equal(rolled.observable, true, 'but something IS being measured');
  });

  it('names the dimensions nothing is measuring', async () => {
    // The single most important thing a health framework can say.
    const health = await build([]);
    assert.deepEqual([...health.unobservedDimensions].sort(), [...HEALTH_DIMENSIONS].sort());
    assert.equal(health.state, 'unknown');
  });

  it('covers all four dimensions even when no source reports one', async () => {
    const health = await build([aiControlPlaneSource(() => ({ status: 'healthy', issues: [] }))]);
    assert.deepEqual(
      health.dimensions.map((entry) => entry.dimension),
      [...HEALTH_DIMENSIONS],
    );
  });
});

describe('IV-51 — a probe cannot take the health page down', () => {
  it('turns a thrown probe into an unknown signal that names itself', async () => {
    const health = await build([
      {
        dimension: 'platform',
        name: 'platform.explodes',
        collect() {
          throw new Error('the collector is broken');
        },
      },
    ]);
    const platform = health.dimensions.find((entry) => entry.dimension === 'platform');
    assert.equal(platform?.state, 'unknown');
    assert.match(platform?.signals[0].detail ?? '', /the probe failed: the collector is broken/);
  });

  it('keeps collecting the other sources when one fails', async () => {
    const health = await build([
      {
        dimension: 'platform',
        name: 'platform.explodes',
        collect: () => Promise.reject(new Error('nope')),
      },
      aiControlPlaneSource(() => ({ status: 'healthy', issues: [] })),
    ]);
    const ai = health.dimensions.find((entry) => entry.dimension === 'ai');
    assert.equal(ai?.state, 'healthy');
  });
});

describe('IV-51 — the AI dimension', () => {
  it('reports the control plane opinion unchanged', async () => {
    const health = await build([
      aiControlPlaneSource(() => ({ status: 'degraded', issues: ['only the mock is usable'] })),
    ]);
    const ai = health.dimensions.find((entry) => entry.dimension === 'ai');
    assert.equal(ai?.state, 'degraded');
    assert.match(ai?.signals[0].detail ?? '', /only the mock is usable/);
  });

  it('says unknown when the plane was never initialised', async () => {
    const health = await build([aiControlPlaneSource(() => null)]);
    assert.equal(health.dimensions.find((entry) => entry.dimension === 'ai')?.state, 'unknown');
  });

  it('reports an engaged emergency stop as degraded, not unhealthy', async () => {
    // The control working is not an outage. A health page that turned red for
    // it would teach operators that red means nothing.
    const health = await build([
      aiGovernanceSource(() => ({
        aiEnabled: true,
        emergencyStopEngaged: true,
        configurationVersion: 12,
      })),
    ]);
    const ai = health.dimensions.find((entry) => entry.dimension === 'ai');
    assert.equal(ai?.state, 'degraded');
    assert.match(ai?.signals[0].detail ?? '', /emergency switch \(configuration 12\)/);
  });

  it('reports an administrator switching AI off as degraded too', async () => {
    const health = await build([
      aiGovernanceSource(() => ({
        aiEnabled: false,
        emergencyStopEngaged: false,
        configurationVersion: 3,
      })),
    ]);
    assert.equal(health.dimensions.find((entry) => entry.dimension === 'ai')?.state, 'degraded');
  });
});

describe('IV-51 — the platform dimension', () => {
  it('is unhealthy when the authoritative store does not return what was written', async () => {
    const health = await build([storageSource(() => Promise.resolve(false))]);
    const platform = health.dimensions.find((entry) => entry.dimension === 'platform');
    assert.equal(platform?.state, 'unhealthy');
    assert.equal(health.state, 'unhealthy', 'the worst dimension is the enterprise state');
  });

  it('says the stores are not being compared when the shadow read is off', async () => {
    // The common case, and honest. Reporting healthy would claim an agreement
    // nobody measured.
    const health = await build([shadowReadSource(() => ({ enabled: false, domains: [] }))]);
    const platform = health.dimensions.find((entry) => entry.dimension === 'platform');
    assert.equal(platform?.state, 'unknown');
    assert.match(platform?.signals[0].detail ?? '', /switched off/);
  });

  it('reports divergence as degraded and names the domain', async () => {
    const health = await build([
      shadowReadSource(() => ({
        enabled: true,
        domains: [
          { domain: 'outcome', diverged: 3, mismatchRatePercent: 12.5 },
          { domain: 'submission', diverged: 0, mismatchRatePercent: 0 },
        ],
      })),
    ]);
    const platform = health.dimensions.find((entry) => entry.dimension === 'platform');
    assert.equal(platform?.state, 'degraded');
    assert.match(platform?.signals[0].detail ?? '', /outcome at 12.5%/);
  });
});

describe('IV-51 — the product dimension refuses to grade', () => {
  it('is unknown for an empty estate rather than healthy', async () => {
    // A platform with no submissions is not delivering effortless value, it is
    // idle — and a green light for an empty estate is the same lie as a green
    // light for an unwired probe.
    const health = await build([
      productProgressionSource(() =>
        Promise.resolve({ submissions: 0, analysed: 0, outcomes: 0 }),
      ),
    ]);
    assert.equal(health.dimensions.find((entry) => entry.dimension === 'product')?.state, 'unknown');
  });

  it('reports the counts and applies no threshold to them', async () => {
    // IV-48 puts numeric targets out of scope for this phase.
    const health = await build([
      productProgressionSource(() =>
        Promise.resolve({ submissions: 40, analysed: 2, outcomes: 0 }),
      ),
    ]);
    const product = health.dimensions.find((entry) => entry.dimension === 'product');
    assert.equal(product?.state, 'healthy', 'a low analysis rate is not graded here');
    assert.match(product?.signals[0].detail ?? '', /No target is applied/);
  });
});

describe('IV-51 — the organizational dimension does not claim a green light', () => {
  it('reports unknown even when the governed configuration reads cleanly', async () => {
    // Organizational health is a governance judgement made in review, not a
    // probe. Claiming healthy for it would be the unwired-probe failure dressed
    // as governance.
    const health = await build([
      governanceFrameSource(() => ({ configurationVersion: 7, updatedBy: 'ops@marq.test' })),
    ]);
    const organizational = health.dimensions.find(
      (entry) => entry.dimension === 'organizational',
    );
    assert.equal(organizational?.state, 'unknown');
    assert.match(organizational?.signals[0].detail ?? '', /not claimed as healthy by a machine/);
    assert.equal(organizational?.observable, false);
  });
});

describe('IV-51 — what the framework must not contain', () => {
  /** Source with comments AND string literals removed — the executable part. */
  function executable(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/`(?:[^`\\]|\\.)*`/g, "''")
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, "''");
  }

  async function healthSources(): Promise<Array<[string, string]>> {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = join(root, 'supabase', 'functions', 'server', 'health');
    return ['contracts.ts', 'rollup.ts', 'sources.ts'].map((file) => [
      file,
      executable(readFileSync(join(dir, file), 'utf8')),
    ]);
  }

  it('names no threshold, SLO or alert in executable code', async () => {
    // Strings are excluded from the scan deliberately: `sources.ts` SAYS "no
    // target is applied", and a scan that treated the disclaimer as the
    // violation would teach the one lesson a source scan must never teach —
    // that the way to pass is to stop writing down the reasoning.
    for (const [file, code] of await healthSources()) {
      for (const forbidden of ['threshold', 'slo', 'objective', 'alert']) {
        assert.ok(
          !new RegExp(`\\b${forbidden}`, 'i').test(code),
          `${file} mentions ${forbidden} in executable code — IV-48 and IV-51 exclude those`,
        );
      }
    }
  });

  it('grades nothing against a magic number', async () => {
    // The substantive version of the rule. A comparison against 0 is presence —
    // "is there anything at all?" — and is how `unknown` is decided. A
    // comparison against any other literal would be a threshold, whatever it
    // was called.
    for (const [file, code] of await healthSources()) {
      const gradings = code.match(/[<>]=?\s*[1-9][0-9]*/g) ?? [];
      assert.deepEqual(
        gradings,
        [],
        `${file} compares a signal against ${gradings.join(', ')} — that is a threshold`,
      );
    }
  });

  it('declares exactly the four dimensions the blueprint fixes', async () => {
    // Not extensible by configuration: IV-51 fixes four, and a framework that
    // let a deployment invent a fifth would let it invent a green one.
    assert.deepEqual([...HEALTH_DIMENSIONS], [
      'organizational',
      'product',
      'platform',
      'ai',
    ]);
  });
});

// ── The route, as wired ─────────────────────────────────────────────────────

describe('IV-51 — the enterprise health route', () => {
  async function serverSource(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    return readFileSync(join(root, 'supabase', 'functions', 'server', 'index.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  function route(source: string): string {
    const start = source.indexOf('app.get("/make-server-324f4fbe/health/enterprise"');
    assert.ok(start >= 0, 'the enterprise health route was not found');
    return source.slice(start, source.indexOf('app.get("/make-server-324f4fbe/health"', start));
  }

  it('requires a verified team caller', async () => {
    // It reads the submission estate to report progression, so it must not be
    // reachable by anything that polls. `/health` stays the uptime endpoint.
    const body = route(await serverSource());
    assert.match(body, /verifyTeamToken\(c\.req\.header\('Authorization'\)\)/);
    assert.match(body, /if \(!userId\) return c\.json\(\{ error: "Unauthorized" \}, 401\)/);
  });

  it('leaves the anonymous uptime probe cheap and unchanged', async () => {
    const source = await serverSource();
    const start = source.indexOf('app.get("/make-server-324f4fbe/health"');
    const body = source.slice(start, start + 900);
    assert.ok(
      !body.includes('verifyTeamToken'),
      'the uptime probe must stay anonymous',
    );
    assert.ok(
      !body.includes('getByPrefix'),
      'the uptime probe must not start scanning the estate',
    );
  });

  it('reports both shadow-read switches, so one being off is not read as agreement', async () => {
    const body = route(await serverSource());
    assert.match(body, /outcomeShadowReadEnabled\(\) \|\| submissionShadowReadEnabled\(\)/);
  });

  it('is a read — nothing writes enterprise health', async () => {
    const source = await serverSource();
    for (const method of ['post', 'patch', 'put', 'delete']) {
      assert.ok(
        !new RegExp(`app\\.${method}\\("/make-server-324f4fbe/health/enterprise`).test(source),
        `a ${method} on the enterprise health route would make a health reading writable`,
      );
    }
  });
});
