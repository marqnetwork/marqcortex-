/**
 * PHASE 1B TASK 23 — ValidationReport imported from the wrong module
 *
 * One TS2305 ("Module '../../system/types' has no exported member
 * 'ValidationReport'"): RegistryViewer listed `ValidationReport` in its type
 * import from `system/types`, but the interface is declared in
 * `system/validate` — the very module the component already imports
 * `runValidation` from on the line above.
 *
 * The state it types is populated directly by that call:
 *
 *     const [report, setReport] = useState<ValidationReport | null>(null);
 *     setReport(runValidation(manifest));
 *
 * so the correct source was never in doubt; only the specifier was wrong.
 * `system/types` exports no `Validation*` member at all, so this could never
 * have resolved.
 *
 * Import-only change: the type is identical, the call is untouched, and a
 * `import type` emits nothing.
 *
 * TESTING APPROACH
 *   RegistryViewer is .tsx and cannot be imported here (the runner strips types
 *   but does not transform JSX), so its import wiring is checked structurally.
 *   `system/validate` and `system/manifest` are plain .ts and are already
 *   imported by tests/system, so the other half — that `runValidation` really
 *   returns the ValidationReport shape the component destructures — is verified
 *   by executing it. Assertions are pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { runValidation } from '../../src/system/validate.ts';
import { manifest } from '../../src/system/manifest.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Source with comments removed, so guards match code — never prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const VIEWER_REL = 'src/app/components/RegistryViewer.tsx';
const VALIDATE_REL = 'src/system/validate.ts';
const TYPES_REL = 'src/system/types.ts';

describe('RegistryViewer — ValidationReport is imported from its declaring module', () => {
  const code = stripComments(readSource(VIEWER_REL));

  it('type-imports ValidationReport from system/validate', () => {
    assert.match(
      code,
      /import type \{ ValidationReport \} from '\.\.\/\.\.\/system\/validate';/,
      "expected `import type { ValidationReport } from '../../system/validate';`",
    );
  });

  it('no longer asks system/types for it', () => {
    const fromTypes = /import type \{([^}]*?)\} from '\.\.\/\.\.\/system\/types';/.exec(code);
    assert.ok(fromTypes, 'the system/types type import block disappeared');
    assert.doesNotMatch(
      fromTypes[1],
      /\bValidationReport\b/,
      'ValidationReport is still being imported from system/types, where it does not exist',
    );
  });

  it('the remaining system/types imports are untouched', () => {
    const fromTypes = /import type \{([^}]*?)\} from '\.\.\/\.\.\/system\/types';/.exec(code);
    assert.ok(fromTypes);
    const names = fromTypes[1].split(',').map(s => s.trim()).filter(Boolean);
    assert.deepEqual(
      names,
      ['ManifestEntry', 'EntityType', 'StatusType', 'DomainType'],
      'the system/types type import list changed beyond removing ValidationReport',
    );
    assert.match(code, /search as manifestSearch,/, 'the manifestSearch value import changed');
  });

  it('runValidation is still imported as a value and still feeds the state', () => {
    assert.match(code, /import \{ runValidation \} from '\.\.\/\.\.\/system\/validate';/, 'runValidation import changed');
    assert.match(code, /useState<ValidationReport \| null>\(null\)/, 'the report state type changed');
    assert.match(code, /setReport\(runValidation\(manifest\)\)/, 'the report is no longer produced by runValidation');
  });
});

describe('system/validate is genuinely the declaring module', () => {
  it('validate.ts exports the ValidationReport interface', () => {
    assert.match(
      stripComments(readSource(VALIDATE_REL)),
      /export interface ValidationReport \{/,
      'ValidationReport is no longer declared in system/validate',
    );
  });

  it('system/types exports no Validation* member, so the old import could never resolve', () => {
    assert.doesNotMatch(
      stripComments(readSource(TYPES_REL)),
      /export (?:interface|type|const|function) Validation\w*/,
      'system/types now exports a Validation* member — re-check which module owns the report type',
    );
  });
});

describe('runValidation really returns the shape RegistryViewer renders', () => {
  // Executed, not pattern-matched: the component reads every one of these
  // fields off the state, so the type being correct is only useful if the
  // runtime value agrees with it.
  const report = runValidation(manifest);

  it('returns the scalar fields the summary strip renders', () => {
    assert.equal(typeof report.passed, 'boolean');
    assert.equal(typeof report.totalNodes, 'number');
    assert.equal(typeof report.errorCount, 'number');
    assert.equal(typeof report.warningCount, 'number');
    assert.equal(typeof report.infoCount, 'number');
    assert.equal(typeof report.summary, 'string');
    assert.equal(typeof report.checkedAt, 'string');
  });

  it('returns the issues array the viewer groups over', () => {
    // RegistryViewer does `report.issues.reduce(...)`, so this must be an array.
    assert.ok(Array.isArray(report.issues), 'issues is not an array');
  });

  it('the manifest still validates clean, as the viewer would display', () => {
    assert.equal(report.errorCount, 0, `validator reported ${report.errorCount} error(s)`);
    assert.equal(report.passed, true, 'validator no longer passes');
  });
});
