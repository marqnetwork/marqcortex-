// Test-only module-resolution hook.
// The core engines import sibling modules without a file extension
// (e.g. `from './types'`), which the bundler resolves but Node ESM does not.
// This hook appends `.ts` / `.tsx` for extensionless relative specifiers so the
// engines can be imported by the Node test runner unmodified. Engines are NOT changed.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExt = /\.[cm]?[jt]sx?$/i.test(specifier);
  if (isRelative && !hasExt && context.parentURL) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(specifier + ext, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
