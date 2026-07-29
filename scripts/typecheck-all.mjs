#!/usr/bin/env node
/**
 * Root typecheck orchestrator.
 *
 * Runs all three scoped typecheck boundaries in sequence and — unlike an `&&`
 * chain — ALWAYS executes every boundary even when an earlier one reports
 * diagnostics. Each boundary's own output is streamed through unchanged, a
 * summary is printed, and the process exits non-zero when one or more
 * boundaries fail.
 *
 * This is orchestration only. It does not parse, count, fingerprint, baseline,
 * or suppress diagnostics, and it introduces no allowed-error threshold.
 */
import { spawnSync } from 'node:child_process';

const boundaries = [
  ['web', 'typecheck:web'],
  ['api', 'typecheck:api'],
  ['tests', 'typecheck:tests'],
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isWin = process.platform === 'win32';
const results = [];

for (const [label, script] of boundaries) {
  process.stdout.write(`\n=== typecheck:${label} ===\n`);
  const run = spawnSync(npm, ['run', '--silent', script], {
    stdio: 'inherit',
    shell: isWin,
  });
  const code = run.status ?? 1;
  results.push([label, code]);
}

process.stdout.write('\n=== typecheck summary ===\n');
for (const [label, code] of results) {
  process.stdout.write(`${label.padEnd(6)} ${code === 0 ? 'pass' : `fail (exit ${code})`}\n`);
}

const failed = results.filter(([, code]) => code !== 0);
process.exit(failed.length > 0 ? 1 : 0);
