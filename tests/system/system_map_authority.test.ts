/**
 * PHASE 1B TASK 8 — Single machine-readable system map authority
 *
 * `src/system/system_map.json` was a stale duplicate of the canonical machine
 * snapshot. It was imported by nothing, carried outdated architecture facts,
 * and declared two contradictory identifier grammars — while sitting beside
 * `manifest.ts` and `validate.ts`, where it read as the system authority.
 *
 * The canonical machine snapshot is `architecture/system_map.json`
 * (MARQ_CORTEX_CONSTITUTION.md Art. 15; ARCHITECT.md § Change checklist) and
 * the canonical node registry is `src/system/manifest.ts` (Art. 14).
 *
 * These tests lock that single-authority state. They assert current state only.
 *
 * Historical reports that truthfully describe the retired duplicate as a past
 * finding are not failures: the active-reference guard reads code, script and
 * configuration files, never prose documentation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { manifest } from '../../src/system/manifest.ts';
import { runValidation } from '../../src/system/validate.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const CANONICAL_MAP = 'architecture/system_map.json';
const RETIRED_MAP = 'src/system/system_map.json';
const CANONICAL_MANIFEST = 'src/system/manifest.ts';
const CANONICAL_VALIDATOR = 'src/system/validate.ts';

const CERTIFIED_ID_FORMAT = 'MQC-{PAGE|COMP|CORE|SVC|HOOK|TYPE}-{NNN}';
const CERTIFIED_NODE_COUNT = 310;
const CERTIFIED_CORE_COUNT = 36;

/** Directories that are never part of the active repository surface. */
const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'test-results',
  'playwright-report',
  'coverage',
]);

/**
 * Extensions that can carry a real dependency: imports, requires, filesystem
 * reads, fetches, bundler/test/CI configuration and agent rules. Markdown is
 * deliberately excluded — a report may truthfully mention the retired path as
 * historical evidence without depending on it.
 */
const ACTIVE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.yml',
  '.yaml',
  '.mdc',
  '.sh',
  '.ps1',
  '.sql',
  '.css',
]);

/** Generated lockfiles are machine output, not an authored dependency. */
const SKIPPED_FILES = new Set(['package-lock.json']);

/**
 * This guard is the one active file that must name the retired path in order
 * to forbid it, so it is excluded from its own scan.
 */
const SELF = 'tests/system/system_map_authority.test.ts';

/**
 * Locations permitted to hold a non-canonical `system_map.json` (historical
 * archives or test fixtures). Empty by design: today exactly one exists.
 */
const PERMITTED_EXTRA_MAP_PREFIXES: string[] = [];

/**
 * Matches the retired duplicate under any spelling a consumer could use —
 * `src/system/system_map.json`, `/src/system/system_map.json`,
 * `@/system/system_map.json`, `./system/system_map.json`. It cannot match the
 * canonical `architecture/system_map.json`.
 */
const RETIRED_MAP_REFERENCE = /system\/system_map\.json/;

const repoPath = (rel: string) => path.join(REPO_ROOT, rel);
const readRepoFile = (rel: string) => readFileSync(repoPath(rel), 'utf8');

function walkRepo(): string[] {
  const files: string[] = [];

  const visit = (absDir: string) => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        visit(path.join(absDir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(path.relative(REPO_ROOT, path.join(absDir, entry.name)).split(path.sep).join('/'));
    }
  };

  visit(REPO_ROOT);
  return files;
}

const repoFiles = walkRepo();

const activeFiles = repoFiles.filter(
  rel => ACTIVE_EXTENSIONS.has(path.extname(rel)) && !SKIPPED_FILES.has(path.basename(rel)),
);

describe('retired duplicate system map', () => {
  it('src/system/system_map.json does not exist', () => {
    assert.equal(
      existsSync(repoPath(RETIRED_MAP)),
      false,
      `${RETIRED_MAP} was retired in Phase 1B Task 8 and must not be reintroduced`,
    );
  });

  it('no active source, script, test or configuration file references the retired path', () => {
    const offenders = activeFiles.filter(
      rel => rel !== SELF && RETIRED_MAP_REFERENCE.test(readRepoFile(rel)),
    );

    assert.deepEqual(
      offenders,
      [],
      `Active dependency on the retired system map: ${offenders.join(', ')}`,
    );
  });

  it('exactly one active system_map.json exists in the repository', () => {
    const maps = repoFiles.filter(rel => path.basename(rel) === 'system_map.json');
    const unexpected = maps.filter(
      rel =>
        rel !== CANONICAL_MAP &&
        !PERMITTED_EXTRA_MAP_PREFIXES.some(prefix => rel.startsWith(prefix)),
    );

    assert.deepEqual(unexpected, [], `Unexpected system_map.json files: ${unexpected.join(', ')}`);
    assert.deepEqual(maps, [CANONICAL_MAP]);
  });
});

describe('canonical machine-readable system map', () => {
  it('architecture/system_map.json exists', () => {
    assert.equal(existsSync(repoPath(CANONICAL_MAP)), true);
    assert.equal(statSync(repoPath(CANONICAL_MAP)).isFile(), true);
  });

  it('architecture/system_map.json is valid JSON', () => {
    const parsed = JSON.parse(readRepoFile(CANONICAL_MAP));
    assert.equal(typeof parsed, 'object');
    assert.notEqual(parsed, null);
    assert.equal(Array.isArray(parsed), false);
  });

  it('is named as the machine snapshot by the Constitution and ARCHITECT.md', () => {
    // Content matches, not line numbers — these documents are append-heavy.
    assert.match(
      readRepoFile('MARQ_CORTEX_CONSTITUTION.md'),
      new RegExp(`\`${CANONICAL_MAP}\` is the machine snapshot`),
    );
    assert.match(
      readRepoFile('ARCHITECT.md'),
      new RegExp(`\\*{0,2}\`${CANONICAL_MAP}\`\\*{0,2} — machine snapshot`),
      'ARCHITECT.md § Change checklist must name the canonical machine snapshot',
    );
  });

  it('points at the canonical manifest with the certified identifier grammar', () => {
    const map = JSON.parse(readRepoFile(CANONICAL_MAP));

    assert.equal(map._meta.manifest, CANONICAL_MANIFEST);
    assert.equal(map.manifest.file, CANONICAL_MANIFEST);
    assert.equal(map.manifest.id_format, CERTIFIED_ID_FORMAT);
    assert.equal(map.manifest.node_count, CERTIFIED_NODE_COUNT);
  });
});

describe('canonical manifest surface', () => {
  it('src/system/manifest.ts still exists', () => {
    assert.equal(existsSync(repoPath(CANONICAL_MANIFEST)), true);
  });

  it('src/system/validate.ts still exists', () => {
    assert.equal(existsSync(repoPath(CANONICAL_VALIDATOR)), true);
  });

  it('certified manifest validation still runs clean against the canonical manifest', () => {
    const report = runValidation(manifest);

    const errors = report.issues.filter(issue => issue.severity === 'ERROR');

    assert.deepEqual(
      errors.map(e => `[${e.nodeId}] ${e.field}: ${e.message}`),
      [],
    );
    assert.equal(report.errorCount, 0);
    assert.equal(report.passed, true);
    assert.equal(report.totalNodes, CERTIFIED_NODE_COUNT);

    const core = Object.values(manifest.nodes).filter(node => node.id.startsWith('MQC-CORE-'));
    assert.equal(core.length, CERTIFIED_CORE_COUNT);
  });
});
