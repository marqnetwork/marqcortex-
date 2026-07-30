/**
 * PHASE 1B TASK 14 — SolutionBlueprint phase contract
 *
 * THE DEFECT
 *   src/app/components/SolutionBlueprint.tsx renders `blueprint.phases`, which
 *   `SolutionBlueprint` declares as `BlueprintPhase[]`. All three of its
 *   section components (RoadmapSection, DeliverablesSection, ResourceSection)
 *   instead annotated their `phases` prop as `ImplementationPhase[]` — a
 *   different domain object belonging to the proposal-draft model
 *   (`ProposalDraft.implementation_phases`).
 *
 *     BlueprintPhase        name, duration, objectives, deliverables
 *                           {item, description}[], teamRequired,
 *                           milestones {day, milestone}[], linkedBottleneck?,
 *                           risksMitigated
 *     ImplementationPhase   phase_number, title, duration_weeks, solution_ids,
 *                           deliverables: string[]
 *
 *   Result: 18 diagnostics — 3 × TS2322 where the real `BlueprintPhase[]` was
 *   passed to the mis-annotated props, and 15 × TS2339 on the field reads
 *   (name, duration ×3, objectives, milestones, teamRequired, risksMitigated,
 *   linkedBottleneck ×2, and del.item / del.description ×2 pairs, which
 *   surfaced as "Property 'item' does not exist on type 'string'" because
 *   `deliverables` is the two models' only shared field name).
 *
 *   The runtime value was a BlueprintPhase at every step; only the annotation
 *   was wrong. The fix repoints the three annotations at `BlueprintPhase`.
 *   No adapter, no cast, no interface changed, no runtime code touched.
 *
 * TESTING APPROACH
 *   The phase data itself is a plain .ts module (`industryBlueprints.ts`), so
 *   this suite imports the REAL generator and asserts against REAL phase data
 *   for all eight industry blueprints — the exact objects the component
 *   receives in production. That covers the shape, ordering and value
 *   preservation guarantees directly rather than by proxy.
 *
 *   The component is .tsx, and the runner (`node --experimental-strip-types`)
 *   strips types but does not transform JSX, so it cannot be imported here.
 *   Following the established pattern (frontendIconContracts.test.ts,
 *   frontendRuntimeDefects.test.ts), its declarations and render reads are
 *   pinned structurally against the production source, with a compile-time
 *   companion at src/app/components/__typechecks__/phaseContract.ts proving the
 *   contract at the type level under `typecheck:web`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getIndustryBlueprint } from '../../src/app/utils/industryBlueprints.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BLUEPRINT_REL = 'src/app/components/SolutionBlueprint.tsx';
const TYPES_REL = 'src/app/types/cortex-types.ts';

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every industry branch `getIndustryBlueprint` dispatches on, plus the default. */
const INDUSTRIES = [
  'E-commerce / DTC',
  'SaaS / Software',
  'Agency / Services',
  'Healthcare / Medical',
  'Manufacturing / Supply Chain',
  'Creators / Training / Courses',
  'Non-Profit / Education',
  'Government / Public Sector',
] as const;

const COMPANY = 'Northline Supply Co.';

/** Every field SolutionBlueprint.tsx reads off a phase object. */
const READ_FIELDS = [
  'name',
  'duration',
  'objectives',
  'deliverables',
  'milestones',
  'teamRequired',
  'risksMitigated',
] as const;

// ── 1. Real runtime data matches the selected contract ────────────────────────

describe('BlueprintPhase is the real runtime shape of SolutionBlueprint.phases', () => {
  it('every phase of every industry blueprint carries every field the component reads', () => {
    for (const industry of INDUSTRIES) {
      const { phases } = getIndustryBlueprint(industry, COMPANY);
      assert.ok(phases.length > 0, `${industry}: blueprint has no phases`);

      for (const [idx, phase] of phases.entries()) {
        for (const field of READ_FIELDS) {
          assert.ok(
            field in phase,
            `${industry} phase ${idx + 1}: missing "${field}" — SolutionBlueprint.tsx reads it`,
          );
          assert.notEqual(
            phase[field],
            undefined,
            `${industry} phase ${idx + 1}: "${field}" is undefined`,
          );
        }
      }
    }
  });

  it('name and duration are non-empty strings — rendered verbatim, not derived', () => {
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        assert.equal(typeof phase.name, 'string', `${industry} phase ${idx + 1}: name not a string`);
        assert.ok(phase.name.length > 0, `${industry} phase ${idx + 1}: empty name`);
        // `duration` is a rendered label ("Days 1-10"), NOT ImplementationPhase's
        // numeric `duration_weeks`. The component prints it directly.
        assert.equal(typeof phase.duration, 'string', `${industry} phase ${idx + 1}: duration not a string`);
        assert.ok(phase.duration.length > 0, `${industry} phase ${idx + 1}: empty duration`);
      }
    }
  });

  it('deliverables are {item, description} records, never bare strings', () => {
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        assert.ok(Array.isArray(phase.deliverables), `${industry} phase ${idx + 1}: deliverables not an array`);
        assert.ok(phase.deliverables.length > 0, `${industry} phase ${idx + 1}: no deliverables`);
        for (const [d, del] of phase.deliverables.entries()) {
          // This is the exact divergence: ImplementationPhase.deliverables is
          // string[], so `del.item` was "Property 'item' does not exist on
          // type 'string'". The real data is a record.
          assert.notEqual(typeof del, 'string', `${industry} phase ${idx + 1} deliverable ${d}: is a bare string`);
          assert.equal(typeof del.item, 'string', `${industry} phase ${idx + 1} deliverable ${d}: item not a string`);
          assert.equal(
            typeof del.description,
            'string',
            `${industry} phase ${idx + 1} deliverable ${d}: description not a string`,
          );
        }
      }
    }
  });

  it('milestones are {day, milestone} records, and team/risks are string arrays', () => {
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        for (const [m, ms] of phase.milestones.entries()) {
          assert.equal(typeof ms.day, 'string', `${industry} phase ${idx + 1} milestone ${m}: day not a string`);
          assert.equal(
            typeof ms.milestone,
            'string',
            `${industry} phase ${idx + 1} milestone ${m}: milestone not a string`,
          );
        }
        for (const list of ['objectives', 'teamRequired', 'risksMitigated'] as const) {
          assert.ok(Array.isArray(phase[list]), `${industry} phase ${idx + 1}: ${list} not an array`);
          for (const entry of phase[list]) {
            assert.equal(typeof entry, 'string', `${industry} phase ${idx + 1}: ${list} entry not a string`);
          }
        }
      }
    }
  });

  it('linkedBottleneck is optional and, when present, a non-empty string', () => {
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        if (phase.linkedBottleneck === undefined) continue;
        assert.equal(
          typeof phase.linkedBottleneck,
          'string',
          `${industry} phase ${idx + 1}: linkedBottleneck not a string`,
        );
        assert.ok(phase.linkedBottleneck.length > 0, `${industry} phase ${idx + 1}: empty linkedBottleneck`);
      }
    }
  });

  it('no phase carries an ImplementationPhase field — the two models stay distinct', () => {
    const IMPL_ONLY = ['phase_number', 'title', 'duration_weeks', 'solution_ids'] as const;
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        for (const field of IMPL_ONLY) {
          assert.ok(
            !(field in phase),
            `${industry} phase ${idx + 1}: carries ImplementationPhase field "${field}"`,
          );
        }
      }
    }
  });

  it('phases carry no field beyond the BlueprintPhase contract — nothing is silently discarded', () => {
    const CONTRACT = new Set([...READ_FIELDS, 'linkedBottleneck']);
    for (const industry of INDUSTRIES) {
      for (const [idx, phase] of getIndustryBlueprint(industry, COMPANY).phases.entries()) {
        for (const key of Object.keys(phase)) {
          assert.ok(
            CONTRACT.has(key),
            `${industry} phase ${idx + 1}: field "${key}" is present at runtime but absent from BlueprintPhase`,
          );
        }
      }
    }
  });
});

// ── 2. Order and values are unchanged by this task ────────────────────────────

describe('phase order, labels and values are preserved', () => {
  it('generation is deterministic — repeated calls yield identical phases', () => {
    for (const industry of INDUSTRIES) {
      const a = getIndustryBlueprint(industry, COMPANY).phases;
      const b = getIndustryBlueprint(industry, COMPANY).phases;
      assert.deepEqual(b, a, `${industry}: blueprint generation is not deterministic`);
    }
  });

  it('the e-commerce roadmap keeps its exact phase order, names and durations', () => {
    // Pinned literals — the visible roadmap strip. Task 14 is type-only, so any
    // drift here means runtime behaviour changed and the change is out of scope.
    const expected = [
      { name: 'Customer Service AI', duration: 'Days 1-10' },
      { name: 'Inventory Sync & Visibility', duration: 'Days 11-20' },
      { name: 'Retention & Revenue Recovery', duration: 'Days 21-30' },
    ];
    const actual = getIndustryBlueprint('E-commerce / DTC', COMPANY).phases.map(p => ({
      name: p.name,
      duration: p.duration,
    }));
    assert.deepEqual(actual, expected);
  });

  it('an unknown industry still falls back to the e-commerce blueprint', () => {
    assert.deepEqual(
      getIndustryBlueprint('Not A Real Industry', COMPANY).phases,
      getIndustryBlueprint('E-commerce / DTC', COMPANY).phases,
    );
  });

  it('every industry keeps a stable, non-empty, uniquely named phase sequence', () => {
    for (const industry of INDUSTRIES) {
      const names = getIndustryBlueprint(industry, COMPANY).phases.map(p => p.name);
      assert.ok(names.length >= 3, `${industry}: fewer than 3 phases`);
      assert.equal(new Set(names).size, names.length, `${industry}: duplicate phase names`);
    }
  });

  it('the deliverables matrix and resource plan still line up with the phases', () => {
    for (const industry of INDUSTRIES) {
      const bp = getIndustryBlueprint(industry, COMPANY);
      // DeliverablesSection renders one row per deliverable, with the phase cell
      // spanning `phase.deliverables.length` — a zero-length phase would break
      // the rowSpan. ResourceSection renders `resourcePlan` independently.
      for (const [idx, phase] of bp.phases.entries()) {
        assert.ok(phase.deliverables.length > 0, `${industry} phase ${idx + 1}: rowSpan would be 0`);
      }
      assert.ok(bp.resourcePlan.length > 0, `${industry}: empty resource plan`);
      for (const res of bp.resourcePlan) {
        assert.equal(typeof res.role, 'string');
        assert.equal(typeof res.allocation, 'string');
        assert.equal(typeof res.phase, 'string');
      }
    }
  });
});

// ── 3. The corrected declarations are pinned in the component source ──────────

describe('SolutionBlueprint.tsx declares the corrected phase contract', () => {
  it('all three section components annotate phases as BlueprintPhase[]', () => {
    const code = stripComments(readSource(BLUEPRINT_REL));
    for (const fn of ['RoadmapSection', 'DeliverablesSection', 'ResourceSection']) {
      const decl = new RegExp(`function\\s+${fn}\\s*\\(\\{[^}]*\\}\\s*:\\s*\\{[^}]*phases:\\s*BlueprintPhase\\[\\]`);
      assert.match(code, decl, `${fn} does not annotate phases as BlueprintPhase[]`);
    }
  });

  it('the component no longer references ImplementationPhase at all', () => {
    const code = stripComments(readSource(BLUEPRINT_REL));
    assert.doesNotMatch(code, /ImplementationPhase/, 'SolutionBlueprint.tsx still names ImplementationPhase');
    assert.match(code, /import type \{[^}]*BlueprintPhase[^}]*\} from '@\/app\/types\/cortex-types'/);
  });

  it('the fix introduced no unsafe assertion or suppression', () => {
    const code = stripComments(readSource(BLUEPRINT_REL));
    assert.doesNotMatch(code, /\bas\s+any\b/, 'as any introduced');
    assert.doesNotMatch(code, /\bas\s+unknown\s+as\b/, 'double assertion introduced');
    assert.doesNotMatch(code, /@ts-(ignore|expect-error|nocheck)/, 'suppression comment introduced');
    assert.doesNotMatch(code, /\bas\s+(Blueprint|Implementation)Phase\b/, 'phase type assertion introduced');
    // The optional field is guarded, never asserted non-null.
    assert.doesNotMatch(code, /phase\.linkedBottleneck!/, 'non-null assertion on linkedBottleneck');
    assert.match(code, /\{phase\.linkedBottleneck &&/, 'linkedBottleneck guard was removed');
  });

  it('every phase read the component performs is still present', () => {
    const code = stripComments(readSource(BLUEPRINT_REL));
    for (const field of [...READ_FIELDS, 'linkedBottleneck']) {
      assert.match(code, new RegExp(`phase\\.${field}\\b`), `component no longer reads phase.${field}`);
    }
    // Structured deliverable reads — the four `del.*` diagnostics.
    assert.match(code, /\{del\.item\}/, 'del.item render removed');
    assert.match(code, /\{del\.description\}/, 'del.description render removed');
    // Milestone chip reads.
    assert.match(code, /\{ms\.day\}/, 'ms.day render removed');
    assert.match(code, /\{ms\.milestone\}/, 'ms.milestone render removed');
  });

  it('the render path still receives blueprint.phases unmodified at all three call sites', () => {
    const code = stripComments(readSource(BLUEPRINT_REL));
    // No adapter, no map, no clone — the same array object is passed straight
    // through, which is why runtime output is byte-identical.
    assert.equal(
      (code.match(/phases=\{blueprint\.phases\}/g) ?? []).length,
      3,
      'blueprint.phases is no longer passed directly to all three sections',
    );
  });
});

// ── 4. Both interfaces are left intact ────────────────────────────────────────

describe('neither phase interface was redefined', () => {
  it('BlueprintPhase still declares exactly its original fields', () => {
    const code = readSource(TYPES_REL);
    const body = /export interface BlueprintPhase \{([\s\S]*?)\n\}/.exec(code);
    assert.ok(body, 'BlueprintPhase declaration not found');
    for (const field of [...READ_FIELDS, 'linkedBottleneck']) {
      assert.match(body[1], new RegExp(`\\b${field}\\??:`), `BlueprintPhase lost field ${field}`);
    }
    assert.match(body[1], /duration:\s*string/, 'BlueprintPhase.duration is no longer a string');
    assert.match(body[1], /linkedBottleneck\?:/, 'linkedBottleneck is no longer optional');
    assert.match(body[1], /deliverables:\s*\{[\s\S]*?item:\s*string/, 'deliverables are no longer records');
  });

  it('ImplementationPhase still declares exactly its original fields', () => {
    const code = readSource(TYPES_REL);
    const body = /export interface ImplementationPhase \{([\s\S]*?)\n\}/.exec(code);
    assert.ok(body, 'ImplementationPhase declaration not found');
    for (const field of ['phase_number', 'title', 'duration_weeks', 'solution_ids', 'deliverables']) {
      assert.match(body[1], new RegExp(`\\b${field}:`), `ImplementationPhase lost field ${field}`);
    }
    assert.match(body[1], /deliverables:\s*string\[\]/, 'ImplementationPhase.deliverables is no longer string[]');
  });

  it('SolutionBlueprint.phases is still typed BlueprintPhase[]', () => {
    const code = readSource(TYPES_REL);
    const body = /export interface SolutionBlueprint \{([\s\S]*?)\n\}/.exec(code);
    assert.ok(body, 'SolutionBlueprint declaration not found');
    assert.match(body[1], /phases:\s*BlueprintPhase\[\]/);
  });

  it('the proposal-draft consumers of ImplementationPhase are untouched', () => {
    // SolutionArchitectureCard remains the ImplementationPhase consumer — this
    // task deliberately did not unify the two models.
    const solArch = stripComments(readSource('src/app/components/SolutionArchitectureCard.tsx'));
    assert.match(solArch, /phases:\s*ImplementationPhase\[\]/);
    assert.doesNotMatch(solArch, /BlueprintPhase/, 'SolutionArchitectureCard was pulled into this batch');
  });
});
