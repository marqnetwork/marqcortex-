/**
 * EXECUTION VERSION + LEAD FIELD READS
 *
 * Two more confirmed defects behind pre-existing typecheck:web diagnostics.
 *
 *   1. src/app/core/mappingEngine.ts(504,9) TS2741
 *      Property 'execution_version' is missing but required in ExecutionProject.
 *
 *      `runMappingPipeline` builds the same ExecutionProject shape
 *      executionEngine builds, and executionEngine sets `execution_version: 1`
 *      at creation. mappingEngine omitted it, so every mapped project carried
 *      `undefined` there. Two consumers read it without a guard: qbrEngine
 *      copies it into `delivery_performance.execution_version` and renders
 *      `v${...}` in the QBR report and its footer — "vundefined" — and
 *      scopeEngine computes `state.execution_version + 1` for the new baseline
 *      version on an approved change order, which is NaN.
 *
 *   2. src/app/components/CortexDashboardSections.tsx(965,42), (2035,44),
 *      (2859,42) TS2339  Property 'employeeEstimate' does not exist on Lead.
 *
 *      Three sites read `data.lead?.employeeEstimate` to populate a
 *      `companySize` field. `Lead` declares `companySize: string` and no
 *      `employeeEstimate`; the name belongs to the core diagnostics input
 *      (src/app/core/index.ts), where it is a number on a different type. The
 *      read was `undefined` every time, so `String(undefined ?? '')` produced
 *      the empty string and company size was blank in all three panels.
 *
 * Both are client-side and change no request, header or stored record.
 *
 * TESTING APPROACH (documented limitation)
 *   mappingEngine cannot be loaded by the runner: it value-imports
 *   './executionEngine' without the '.ts' extension Node ESM requires, so
 *   `import()` throws ERR_MODULE_NOT_FOUND — the limitation already recorded in
 *   taskStatusContract.test.ts. CortexDashboardSections is .tsx, which the
 *   runner does not transform. Both guarantees are therefore enforced
 *   structurally against the production source, pattern-based and never by line
 *   number, following frontendRuntimeDefects.test.ts.
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

const mappingEngine = stripComments(readSource('src/app/core/mappingEngine.ts'));
const executionEngine = stripComments(readSource('src/app/core/executionEngine.ts'));
const dashboard = stripComments(readSource('src/app/components/CortexDashboardSections.tsx'));
const cortexTypes = stripComments(readSource('src/app/types/cortex-types.ts'));

describe('mappingEngine — the mapped project carries an execution version', () => {
  it('sets execution_version on the project it builds', () => {
    assert.match(
      mappingEngine,
      /execution_version:\s*1,/,
      'ExecutionProject requires execution_version; qbrEngine and scopeEngine both read it unguarded',
    );
  });

  it('agrees with executionEngine, which creates projects the same way', () => {
    assert.match(executionEngine, /execution_version:\s*1,/, 'the two creation paths must not disagree on the starting version');
  });

  it('execution_version is still required, so the assertion stays load-bearing', () => {
    assert.match(executionEngine, /execution_version:\s+number;/);
  });

  it('the consumers that made this visible still read it', () => {
    const qbr = stripComments(readSource('src/app/core/qbrEngine.ts'));
    const scope = stripComments(readSource('src/app/core/scopeEngine.ts'));
    assert.match(qbr, /execution_version:\s*project\.execution_version/, 'qbrEngine copies it into the report');
    assert.match(scope, /execution_version \+ 1/, 'scopeEngine increments it for the new baseline version');
  });
});

describe('CortexDashboardSections — company size is read from the field Lead has', () => {
  it('never reads employeeEstimate off a lead', () => {
    assert.doesNotMatch(
      dashboard,
      /lead\?\.employeeEstimate/,
      'employeeEstimate belongs to the core diagnostics input, not to Lead',
    );
  });

  it('reads companySize at all three sites', () => {
    const reads = dashboard.match(/companySize:\s*String\(data\.lead\?\.companySize \?\? ''\)/g) ?? [];
    assert.equal(reads.length, 3, 'all three panels must populate company size from Lead.companySize');
  });

  it('Lead still declares companySize and still has no employeeEstimate', () => {
    assert.match(cortexTypes, /interface Lead\b[\s\S]*?companySize:\s*string;/);
    const lead = cortexTypes.slice(cortexTypes.indexOf('interface Lead'));
    const body = lead.slice(0, lead.indexOf('\n}'));
    assert.doesNotMatch(body, /employeeEstimate/, 'if Lead ever gains this field, revisit which one these panels want');
  });
});
