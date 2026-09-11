/**
 * Serve the BUILT artifact with the production response headers.
 *
 * The headers in `vercel.json` are the ones the deployed site actually gets, and
 * until something serves them nothing has tested them. A Content-Security-Policy
 * that is wrong fails in exactly one place — the deployed site, in a browser, at
 * the moment a user needs it — and it fails silently, because a refused resource
 * is a console message and a blank panel rather than an error anybody sees.
 *
 * `vite dev` cannot be that test: it serves inline scripts and uses `eval` for
 * hot reload, so a policy strict enough to be worth having breaks development.
 * The policy belongs to the static host, which serves `dist/`, and so does this.
 *
 * The headers are READ FROM `vercel.json`, never restated here. A copy would
 * drift, and a test of a copy proves nothing about what is deployed.
 *
 *   node scripts/serve-release.mjs [--port 4173] [--root dist]
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}

const PORT = Number(flag('port', 4173));
const ROOT = resolve(flag('root', 'dist'));
const CONFIG = resolve(flag('config', 'vercel.json'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** `vercel.json` header rules, as {test(pathname), headers} in declared order. */
async function headerRules() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  return (config.headers ?? []).map((rule) => {
    // Vercel's `source` is a path-to-regexp pattern. Only the two shapes this
    // repository uses are supported, and an unrecognised one is an error rather
    // than a silently unmatched rule — a header that quietly stops being served
    // is the failure this script exists to catch.
    let test;
    if (rule.source === '/(.*)') test = () => true;
    else if (rule.source.endsWith('/(.*)')) {
      const prefix = rule.source.slice(0, -'/(.*)'.length);
      test = (pathname) => pathname.startsWith(`${prefix}/`);
    } else {
      throw new Error(`serve-release: unsupported header source ${rule.source}`);
    }
    return { test, headers: rule.headers ?? [] };
  });
}

const rules = await headerRules();

function applyHeaders(response, pathname) {
  for (const rule of rules) {
    if (!rule.test(pathname)) continue;
    for (const { key, value } of rule.headers) response.setHeader(key, value);
  }
}

/** Resolve a request path to a file inside ROOT, or to index.html (SPA rewrite). */
function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  // `normalize` then a prefix check: a request for `/../../etc/passwd` must not
  // leave the served directory even though this is a test server.
  const candidate = normalize(join(ROOT, decoded));
  if (!candidate.startsWith(ROOT)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(ROOT, 'index.html');
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = resolveFile(pathname);
  if (file === null) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  applyHeaders(response, pathname);
  response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  response.writeHead(200);
  createReadStream(file).pipe(response);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serve-release: ${ROOT} on http://127.0.0.1:${PORT} with ${CONFIG} headers`);
});
