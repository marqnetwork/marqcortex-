/**
 * Vite, pointed at a controlled stand-in for the edge function.
 *
 * `VITE_BACKEND_INTEGRATION=true` is the configuration CP-1 cares about: the
 * one where the product calls a real backend and renders what comes back. What
 * it needs to be driven in a browser is a backend, and this environment cannot
 * reach Supabase — the network policy answers 403 to a CONNECT for
 * `*.supabase.co`.
 *
 * So the browser talks to `tests/helpers/fixture-backend.mjs` instead, over the
 * same routes with the same shapes. That is not live verification and is never
 * reported as it; it is how EMPTY, ERROR and PERMISSION DENIED get driven at
 * all, since a live backend does not produce those to order.
 *
 *   node scripts/serve-with-fixture-backend.mjs [--port 5174] [--backend-port 5199]
 */

import { spawn } from 'node:child_process';
import { startFixtureBackend } from '../tests/helpers/fixture-backend.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const PORT = Number(flag('port', 5174));
const BACKEND_PORT = Number(flag('backend-port', 5199));

const backend = await startFixtureBackend({ port: BACKEND_PORT, mode: 'populated' });
console.log(`[fixture] backend on ${backend.url}`);

const vite = spawn(
  'npx',
  ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_BACKEND_INTEGRATION: 'true',
      // Never both. A demo experience on top of a configured backend is the
      // exact conflation CP-1 removed, and the product refuses it anyway.
      VITE_DEMO_EXPERIENCE: 'false',
      VITE_SUPABASE_URL: backend.url,
      VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      VITE_SHOW_API_ERRORS: 'true',
    },
  },
);

const stop = async () => {
  vite.kill('SIGTERM');
  await backend.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
vite.on('exit', code => { void backend.close().then(() => process.exit(code ?? 0)); });
