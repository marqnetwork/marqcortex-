/**
 * PHASE 1B TASK 16 — Client Portal auth-context contract
 *
 * Two TS2345 diagnostics were repaired in this task — the same mismatch seen
 * from each side of one stale wrapper annotation:
 *
 *     src/app/components/ClientPortal.tsx(182,62)
 *       error TS2345: Argument of type 'ClientAuthContext' is not assignable
 *                     to parameter of type 'string'.
 *     src/app/services/dataService.ts(251,48)
 *       error TS2345: Argument of type 'string' is not assignable to parameter
 *                     of type 'ClientAuthContext'.
 *
 * `ClientAuthContext` is threaded through three layers. `api.getClientSubmission`
 * has always declared `auth?: ClientAuthContext` and sends it as the
 * `Authorization: Bearer <sessionToken>` header plus the `?email=` fallback
 * query. The `dataService` wrapper standing between ClientPortal and that api
 * function declared the same positional slot as `email?: string`, which
 * described neither the value its only caller passes nor the value it forwards.
 *
 * WHY THIS IS A TYPE-ONLY CORRECTION
 *   The stale parameter occupied exactly the slot `api` expects, so the
 *   ClientAuthContext object was ALREADY being forwarded positionally: live
 *   requests already carried the client's credentials, and the server's
 *   `requireClientAccess` already authorised them. Only the annotation lied.
 *   The one non-annotation line changed is the demo branch's
 *   `clientEmail: email` -> `clientEmail: auth?.email`, which is required for
 *   the corrected type AND is unreachable from the sole caller: ClientPortal
 *   returns early on `!isBackendEnabled()` before ever calling this wrapper,
 *   and `isDemo()` reads that same `FEATURES.BACKEND_INTEGRATION` flag, so the
 *   two gates can never disagree.
 *
 * WHY THE REST OF THE CLUSTER IS EXCLUDED (escalated, not fixed here)
 *   The sibling wrappers — `getClientReport`, `trackEngagement`,
 *   `getClientMessages`, `postClientMessage`, `getClientProposal`,
 *   `getEngagementLog` — are stale in the same declaration-level way, but they
 *   declare NO positional slot for the auth argument. JavaScript discards
 *   surplus arguments, so those calls reach `api` with `auth === undefined`,
 *   the request goes out with the anon key and no `?email=`, and the server
 *   answers 401. Repairing them changes what the browser sends over the wire —
 *   an authentication and telemetry change, not a type-only one — so it is
 *   reported for a separate, live-mode-verified task rather than folded in.
 *   The assertions in the final block PIN that exclusion: they fail if Task 16
 *   silently widened the escalated wrappers.
 *
 * TESTING APPROACH (documented limitation)
 *   `dataService.ts` is authored against the Vite `@/*` aliases and reaches
 *   `import.meta.env` through the config modules, so it cannot be imported by
 *   the runner (`node --experimental-strip-types`, which strips types but
 *   resolves no aliases and provides no Vite env). Following the established
 *   pattern (pipelineManualPollArity / frontendIconContracts /
 *   frontendRuntimeDefects / teamSessionKeys), each guarantee is enforced
 *   structurally against the production source, with pattern-based assertions
 *   rather than line numbers. `typecheck:web` proves the contract itself at the
 *   type level via src/app/components/__typechecks__/clientAuthContract.ts.
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

const SERVICE_REL = 'src/app/services/dataService.ts';
const API_REL = 'src/app/lib/api.ts';
const SESSION_REL = 'src/app/lib/session.ts';
const PORTAL_REL = 'src/app/components/ClientPortal.tsx';
const TYPECHECK_REL = 'src/app/components/__typechecks__/clientAuthContract.ts';

const service = stripComments(readSource(SERVICE_REL));
const apiSrc = stripComments(readSource(API_REL));
const session = stripComments(readSource(SESSION_REL));
const portal = stripComments(readSource(PORTAL_REL));

/** Body of a named exported function in the given source, up to its closer. */
function functionBody(code: string, name: string): string {
  const start = code.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`));
  assert.notEqual(start, -1, `${name} must be an exported function`);
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  assert.fail(`Could not find the end of ${name}`);
}

describe('dataService.getClientSubmission — corrected auth parameter', () => {
  it('declares its second parameter as the canonical ClientAuthContext', () => {
    assert.match(
      service,
      /export\s+async\s+function\s+getClientSubmission\s*\(\s*submissionId:\s*string\s*,\s*auth\?:\s*ClientAuthContext\s*,?\s*\)/,
    );
  });

  it('no longer annotates that parameter as a bare string', () => {
    const body = functionBody(service, 'getClientSubmission');
    assert.doesNotMatch(
      body,
      /email\?:\s*string/,
      'the stale `email?: string` annotation must not return',
    );
  });

  it('resolves ClientAuthContext from the canonical session module', () => {
    assert.match(
      service,
      /import type \{ ClientAuthContext \} from '@\/app\/lib\/session'/,
      'dataService must import the canonical contract, not restate it',
    );
  });

  it('does not redeclare ClientAuthContext or ClientSession', () => {
    // The canonical declaration stays in session.ts; dataService only
    // re-exports it for the portal components (Constitution Article 3).
    assert.doesNotMatch(service, /(?:export\s+)?(?:interface|type)\s+ClientAuthContext\b\s*[={]/);
    assert.doesNotMatch(service, /(?:export\s+)?(?:interface|type)\s+ClientSession\b\s*[={]/);
    assert.match(service, /export type \{ ClientAuthContext \} from '@\/app\/lib\/session'/);
  });
});

describe('dataService.getClientSubmission — forwarding is unchanged', () => {
  const body = functionBody(service, 'getClientSubmission');

  it('still gates on isDemo() before touching the api layer', () => {
    assert.match(body, /if\s*\(\s*isDemo\(\)\s*\)/);
  });

  it('forwards the auth context positionally to api.getClientSubmission', () => {
    // The whole point: the value reaching api is the same one it always was.
    assert.match(body, /return\s+api\.getClientSubmission\(\s*submissionId\s*,\s*auth\s*\)/);
  });

  it('reads the email off the auth context in the demo branch', () => {
    assert.match(body, /demo\.getDemoClientSubmission\(\{\s*submissionId\s*,\s*clientEmail:\s*auth\?\.email\s*\}\)/);
  });

  it('still returns the same { success, submission } shape from both branches', () => {
    assert.match(body, /return\s*\{\s*success:\s*true\s*,\s*submission\s*\}/);
    assert.match(body, /return\s+api\.getClientSubmission\(/);
  });

  it('introduces no unsafe escape to absorb the diagnostic', () => {
    for (const [label, pattern] of [
      ['any', /:\s*any\b/],
      ['as unknown as', /as\s+unknown\s+as/],
      ['as never', /as\s+never\b/],
      ['@ts-ignore', /@ts-ignore/],
      ['@ts-expect-error', /@ts-expect-error/],
      ['index signature', /\[\s*key:\s*string\s*\]/],
    ] as const) {
      assert.doesNotMatch(body, pattern, `getClientSubmission must not use ${label}`);
    }
  });
});

describe('the canonical contracts either side of the wrapper are untouched', () => {
  it('api.getClientSubmission still declares auth?: ClientAuthContext', () => {
    assert.match(
      apiSrc,
      /export\s+async\s+function\s+getClientSubmission\(\s*submissionId:\s*string\s*,\s*auth\?:\s*ClientAuthContext\s*,?\s*\)/,
    );
  });

  it('api still sends the token as the Authorization header and email as the query fallback', () => {
    assert.match(apiSrc, /function clientHeaders\(auth\?: ClientAuthContext\)\s*\{\s*return headers\(auth\?\.sessionToken\);/);
    assert.match(apiSrc, /function withEmailQuery\(url: URL, auth\?: ClientAuthContext\)\s*\{\s*if \(auth\?\.email\) url\.searchParams\.set\('email', auth\.email\);/);
  });

  it('ClientAuthContext is still the ClientSession projection, declared only in session.ts', () => {
    assert.match(
      session,
      /export type ClientAuthContext\s*=\s*Pick<ClientSession, 'sessionToken'> & Partial<Pick<ClientSession, 'email'>>/,
    );
  });

  it('ships the compile-time companion that proves the contract', () => {
    const typecheck = readSource(TYPECHECK_REL);
    assert.match(typecheck, /Param<typeof dataService\.getClientSubmission, 1>/);
    assert.match(typecheck, /Param<typeof api\.getClientSubmission, 1>/);
  });
});

describe('ClientPortal is unchanged by Task 16', () => {
  it('still calls getClientSubmission with the memoised clientAuth', () => {
    assert.match(portal, /await getClientSubmission\(submissionId, clientAuth\)/);
  });

  it('still builds clientAuth from the session token and email', () => {
    assert.match(portal, /useMemo<ClientAuthContext \| undefined>/);
    assert.match(portal, /return \{ sessionToken: sessionToken \?\? null, email: clientEmail \}/);
  });

  it('still short-circuits to demo data before reaching the api layer', () => {
    // This early return is what makes the demo branch of the corrected wrapper
    // unreachable from the only caller, and therefore the change type-only.
    assert.match(portal, /if \(!isBackendEnabled\(\)\)/);
  });

  it('still imports the portal data functions from the dataService gateway', () => {
    assert.match(portal, /getClientSubmission, trackEngagement, getClientReport,/);
    assert.match(portal, /from '@\/app\/services\/dataService'/);
  });
});

describe('the escalated wrappers were deliberately NOT changed', () => {
  /**
   * These are the eight remaining ClientPortal diagnostics plus their siblings
   * in ClientMessaging / ProposalViewer / EngagementActivityFeed. They share
   * Task 16's declaration-level root cause but not its runtime profile, and
   * repairing them alters authentication and telemetry traffic. Task 16 leaves
   * them exactly as found; these assertions fail if that ever stops being true
   * without a task that verifies the live-mode consequence.
   */
  const untouched: readonly [string, RegExp][] = [
    ['getClientReport', /return api\.getClientReport\(submissionId\);/],
    ['trackEngagement', /return api\.trackEngagement\(submissionId, type, meta\);/],
    ['getClientMessages', /return api\.getClientMessages\(submissionId\);/],
    ['getClientProposal', /return api\.getClientProposal\(submissionId\);/],
    ['getEngagementLog', /return api\.getEngagementLog\(submissionId\);/],
  ];

  for (const [name, pattern] of untouched) {
    it(`${name} still delegates without an auth argument`, () => {
      assert.match(service, pattern, `${name} is outside Task 16's selected batch`);
    });
  }

  it('ClientPortal still passes clientAuth at all eight excluded call sites', () => {
    const trackCalls = portal.match(/trackEngagement\(submissionId, '[a-z_]+', undefined, clientAuth\)/g) ?? [];
    assert.equal(trackCalls.length, 7, 'the seven trackEngagement call sites must be untouched');
    assert.match(portal, /await getClientReport\(submissionId, clientAuth\)/);
  });
});

describe('why the excluded group is a runtime change, not a type-only one', () => {
  it('a function that declares no slot for an argument discards it', () => {
    // The exact JavaScript semantics that split the cluster: dataService's
    // three-parameter trackEngagement receives ClientPortal's fourth argument
    // and cannot forward it, so api sees `auth === undefined` and the request
    // goes out unauthenticated. getClientSubmission's stale parameter DID
    // occupy that slot, which is why only it was safe to correct here.
    const forwards = (a: string, b?: unknown) => [a, b] as const;
    const discards = (a: string) => [a, undefined] as const;

    const auth = { sessionToken: 'tok_live', email: 'client@company.com' };

    assert.deepEqual(forwards('sub-1', auth), ['sub-1', auth]);
    assert.deepEqual((discards as (...a: unknown[]) => unknown)('sub-1', auth), ['sub-1', undefined]);
  });
});
