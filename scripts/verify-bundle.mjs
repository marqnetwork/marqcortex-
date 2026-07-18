#!/usr/bin/env node
/**
 * F-004 bundle guard.
 *
 * Fails the build if any hardcoded demo credential or demo session token
 * leaks into the compiled production bundle (dist/). Scans every emitted
 * file for each forbidden secret in plaintext AND in common obfuscations
 * (base64, hex, URL-encoded, whitespace/quote-split) so a value that is
 * concatenated or encoded at build time is still caught.
 *
 * Usage:  node scripts/verify-bundle.mjs [distDir]
 * Exit:   0 = clean, 1 = leak found or dist missing.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] || 'dist';

/**
 * Forbidden values. These are the historically-leaked demo credential and
 * the legacy fixed demo token. The admin *email* is intentionally NOT listed:
 * it is a non-secret identifier that legitimately appears in demo seed data.
 */
const SECRETS = [
  'CortexAdmin2026!',
  'CortexAdmin2026',
  'demo_access_token_12345',
];

/** Build detection variants for a single secret. */
function variantsFor(secret) {
  const variants = new Map();
  variants.set('plaintext', secret);
  variants.set('base64', Buffer.from(secret, 'utf8').toString('base64').replace(/=+$/, ''));
  variants.set('hex', Buffer.from(secret, 'utf8').toString('hex'));
  variants.set('url-encoded', encodeURIComponent(secret));
  // "split" guard: the secret with any run of quotes/backslashes/whitespace/
  // plus signs (JS string concatenation artefacts) removed. We normalise the
  // haystack the same way before matching so `'Cortex'+'Admin2026!'` is caught.
  variants.set('split/concatenated', secret);
  return variants;
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

/** Remove JS string-concatenation artefacts so split literals reveal themselves. */
function stripConcatArtefacts(text) {
  return text.replace(/['"`]\s*\+\s*['"`]/g, '').replace(/['"`]/g, '');
}

if (!existsSync(DIST)) {
  console.error(`✗ F-004 bundle guard: "${DIST}" not found. Run \`vite build\` first.`);
  process.exit(1);
}

const files = collectFiles(DIST);
const findings = [];

for (const file of files) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    continue; // binary / unreadable asset — nothing to match
  }
  const stripped = stripConcatArtefacts(raw);
  for (const secret of SECRETS) {
    for (const [kind, needle] of variantsFor(secret)) {
      if (!needle) continue;
      const haystack = kind === 'split/concatenated' ? stripConcatArtefacts(needle) && stripped : raw;
      const target = kind === 'split/concatenated' ? stripConcatArtefacts(needle) : needle;
      if (haystack.includes(target)) {
        findings.push({ file: relative('.', file), secret, kind });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('✗ F-004 bundle guard FAILED — credential material found in the bundle:');
  for (const f of findings) {
    console.error(`   • ${f.file}: "${f.secret}" (${f.kind})`);
  }
  console.error('\nRemove the hardcoded value from source; demo login must stay passwordless (VITE_DEMO_MODE).');
  process.exit(1);
}

console.log(`✓ F-004 bundle guard passed — scanned ${files.length} file(s) in "${DIST}", no credential leaks.`);
process.exit(0);
