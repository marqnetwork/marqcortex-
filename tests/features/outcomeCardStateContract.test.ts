/**
 * PHASE 1B TASK 29 — outcome card local state contract
 *
 * `OutcomeModule` held its card state as the full server-hydrated
 * `OutcomeRecord`:
 *
 *     const [existingOutcome, setExistingOutcome] = useState<OutcomeRecord | null>(null);
 *
 * `OutcomeRecord` extends `OutcomePayload` with three stamps (submissionId,
 * loggedAt, loggedBy) AND five submission-enrichment fields — industry, company,
 * aiScore, recommendedService, submittedAt — that only the backend can supply.
 * The demo-mode branch builds its record locally from form state and has none of
 * them, so that object literal raised TS2739.
 *
 * The fix declares a local `OutcomeCardRecord` = payload + the three stamps: the
 * minimum the card genuinely consumes. The server record stays exactly as it is
 * and remains assignable, so the hydrated path is untouched; the demo producer
 * no longer has to invent enrichment values it does not have.
 *
 * TESTING APPROACH (two halves, split by what each boundary can prove)
 *   The assignability half — `OutcomeRecord` flows into `OutcomeCardRecord`, the
 *   card contract is strictly narrower, and the demo literal satisfies it — is a
 *   compile-time property and lives in
 *   src/app/components/__typechecks__/outcomeCardStateContract.ts, enforced by
 *   `typecheck:web`.
 *
 *   This file covers the half that file cannot: that the *values* the demo
 *   producer writes are unchanged, that every field the card renders is on the
 *   contract, and that neither server contract was edited. CortexModulesNew is a
 *   .tsx component, the repository ships no React test renderer, and the test
 *   runner strips types but does not transform JSX — so, following the
 *   established pattern in frontendRuntimeDefects.test.ts, those guarantees are
 *   enforced structurally against the production source. Assertions are
 *   pattern-based, never line-number-based.
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

const MODULE_REL = 'src/app/components/CortexModulesNew.tsx';
const API_REL = 'src/app/lib/api.ts';
const TYPECHECK_REL = 'src/app/components/__typechecks__/outcomeCardStateContract.ts';

const moduleSource = readSource(MODULE_REL);
const apiSource = readSource(API_REL);

/** Body of an `export interface X { … }` declaration in the given source. */
function interfaceBody(source: string, name: string): string {
  const marker = `export interface ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} was renamed or removed`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n}', open);
  assert.notEqual(close, -1, `${name} is unterminated`);
  return source.slice(open + 1, close);
}

/** Field names declared directly on an interface body. */
function fieldNames(body: string): string[] {
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);
}

/** The demo-mode outcome object literal, from its declaration to its brace. */
function demoOutcomeLiteral(): string {
  const start = moduleSource.indexOf('const localOutcome: OutcomeCardRecord = {');
  assert.notEqual(start, -1, 'the demo outcome literal was renamed or removed');
  const close = moduleSource.indexOf('\n      };', start);
  assert.notEqual(close, -1, 'the demo outcome literal is unterminated');
  return moduleSource.slice(start, close);
}

// ---------------------------------------------------------------------------
// The local contract exists and is used where the server record used to be
// ---------------------------------------------------------------------------

describe('outcome card state contract', () => {
  it('declares OutcomeCardRecord as the payload plus the three stamps', () => {
    const start = moduleSource.indexOf('export type OutcomeCardRecord =');
    assert.notEqual(start, -1, 'OutcomeCardRecord was renamed or removed');
    const decl = moduleSource.slice(start, moduleSource.indexOf('};', start)).replace(/\s+/g, ' ');

    assert.ok(decl.includes('OutcomePayload & {'), 'the contract no longer builds on OutcomePayload');
    for (const stamp of ['submissionId: string;', 'loggedAt: string;', 'loggedBy: string;']) {
      assert.ok(decl.includes(stamp), `the contract lost ${stamp}`);
    }
    for (const enrichment of ['industry', 'company', 'aiScore', 'recommendedService', 'submittedAt']) {
      assert.equal(
        decl.includes(`${enrichment}:`),
        false,
        `the card contract picked up the server enrichment field ${enrichment}`,
      );
    }
  });

  it('uses the local contract for the component state', () => {
    assert.ok(
      moduleSource.includes('useState<OutcomeCardRecord | null>(null)'),
      'the card state is no longer held as OutcomeCardRecord',
    );
    assert.equal(
      moduleSource.includes('useState<OutcomeRecord | null>'),
      false,
      'the state is back on the full server record',
    );
  });

  it('uses the local contract for the demo object', () => {
    assert.ok(
      moduleSource.includes('const localOutcome: OutcomeCardRecord = {'),
      'the demo producer is no longer typed by the card contract',
    );
    assert.equal(
      moduleSource.includes('const localOutcome: OutcomeRecord = {'),
      false,
      'the demo producer is back on the full server record',
    );
  });
});

// ---------------------------------------------------------------------------
// Demo values are untouched
// ---------------------------------------------------------------------------

describe('demo-mode outcome values', () => {
  const literal = demoOutcomeLiteral();

  it('keeps every field the demo branch wrote, verbatim', () => {
    for (const line of [
      'submissionId,',
      'didConvert,',
      "conversionValue: didConvert ? (parseFloat(conversionValue) || null) : null,",
      'lostReason: !didConvert ? lostReason || null : null,',
      'recommendationWorked,',
      'whatWeLearned: whatLearned,',
      'improvementAreas: improvements,',
      "loggedAt: new Date().toISOString(),",
      "loggedBy: 'demo-user',",
    ]) {
      assert.ok(literal.includes(line), `the demo outcome lost or changed: ${line}`);
    }
  });

  it('invents no enrichment values to satisfy the old contract', () => {
    for (const enrichment of ['industry', 'company', 'aiScore', 'recommendedService', 'submittedAt']) {
      assert.equal(
        literal.includes(`${enrichment}:`),
        false,
        `the demo outcome fabricated an enrichment value for ${enrichment}`,
      );
    }
  });

  it('still stores the demo record and shows the saved state', () => {
    assert.ok(moduleSource.includes('setExistingOutcome(localOutcome);'), 'demo record is no longer stored');
    assert.ok(moduleSource.includes('setSaved(true);'), 'demo save feedback was removed');
  });
});

// ---------------------------------------------------------------------------
// Everything the card reads is on the contract
// ---------------------------------------------------------------------------

describe('fields the card actually consumes', () => {
  const CONTRACT_FIELDS = new Set([
    // OutcomePayload
    'didConvert',
    'conversionValue',
    'lostReason',
    'recommendationWorked',
    'whatWeLearned',
    'improvementAreas',
    // stamps
    'submissionId',
    'loggedAt',
    'loggedBy',
  ]);

  it('renders only fields the contract declares', () => {
    const reads = new Set(
      [...moduleSource.matchAll(/existingOutcome\.(\w+)/g)].map(m => m[1]),
    );
    assert.ok(reads.size > 0, 'the card no longer reads its outcome state');
    for (const field of reads) {
      assert.ok(CONTRACT_FIELDS.has(field), `the card renders ${field}, which is not on the contract`);
    }
  });

  it('still renders the won/lost badge and the logged date', () => {
    assert.ok(moduleSource.includes('existingOutcome.didConvert'), 'the won/lost badge read was removed');
    assert.ok(moduleSource.includes('existingOutcome.loggedAt'), 'the logged-date read was removed');
  });

  it('hydrates only fields the contract declares', () => {
    const reads = new Set([...moduleSource.matchAll(/\bo\.(\w+)/g)].map(m => m[1]));
    for (const field of reads) {
      assert.ok(
        CONTRACT_FIELDS.has(field),
        `the hydration effect reads ${field}, which is not on the contract`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// No server contract was modified
// ---------------------------------------------------------------------------

describe('server contracts are untouched', () => {
  it('leaves OutcomePayload exactly as it was', () => {
    assert.deepEqual(fieldNames(interfaceBody(apiSource, 'OutcomePayload')), [
      'didConvert',
      'conversionValue',
      'lostReason',
      'recommendationWorked',
      'whatWeLearned',
      'improvementAreas',
    ]);
  });

  it('leaves OutcomeRecord extending OutcomePayload with all five enrichment fields', () => {
    assert.ok(
      apiSource.includes('export interface OutcomeRecord extends OutcomePayload {'),
      'OutcomeRecord no longer extends OutcomePayload',
    );
    assert.deepEqual(fieldNames(interfaceBody(apiSource, 'OutcomeRecord')), [
      'submissionId',
      'loggedAt',
      'loggedBy',
      'industry',
      'company',
      'aiScore',
      'recommendedService',
      'submittedAt',
    ]);
  });

  it('leaves the outcome API functions alone', () => {
    assert.ok(
      apiSource.includes('export async function logOutcome(submissionId: string, payload: OutcomePayload, accessToken: string)'),
      'logOutcome signature changed',
    );
    assert.ok(
      apiSource.includes('return data as { success: boolean; outcome: OutcomeRecord };'),
      'logOutcome no longer returns the full server record',
    );
    assert.ok(
      apiSource.includes('return data as { success: boolean; outcome: OutcomeRecord | null };'),
      'getOutcome no longer returns the full server record',
    );
  });

  it('keeps the compile-time assignability companion in place', () => {
    const typecheck = readSource(TYPECHECK_REL);
    assert.ok(
      typecheck.includes('type _ServerRecordIsAssignable'),
      'the OutcomeRecord assignability assertion was removed',
    );
    assert.ok(
      typecheck.includes('const _fromApi: OutcomeCardRecord = _hydrated;'),
      'the hydrated-path assignment check was removed',
    );
  });
});
