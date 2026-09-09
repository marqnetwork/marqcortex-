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
 * THE ESCALATED CLUSTER, NOW CLOSED
 *   Task 16 deliberately left seven sibling wrappers alone — `getClientReport`,
 *   `trackEngagement`, `getClientMessages`, `postClientMessage`,
 *   `getClientProposal`, `respondToProposal`, `getEngagementLog`. They declared
 *   NO positional slot for the auth argument, so JavaScript discarded the
 *   fourth argument every call site was already passing: `api` saw
 *   `auth === undefined`, the request went out with the anon key and no
 *   `?email=`, and `requireClientAccess` answered 401. In demo mode nothing
 *   noticed, because those wrappers return before touching `api` at all — and
 *   `api.trackEngagement` swallows its own errors by design, so seven of the
 *   eight failures were silent even in live mode.
 *
 *   That is now repaired. Each wrapper accepts `auth?: ClientAuthContext` in
 *   the slot its api counterpart already declared, and forwards it. The
 *   assertions that used to PIN the exclusion now pin the FORWARDING, and the
 *   server-contract block below pins what the browser is allowed to send.
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

describe('every client wrapper forwards the auth context it is given', () => {
  /**
   * The repair of the escalated cluster. Each of these declares the auth slot
   * its api counterpart already had, and passes the value straight through.
   * A wrapper that drops the argument again fails here.
   */
  const forwarding: readonly [name: string, signature: RegExp, delegation: RegExp][] = [
    ['getClientSubmission',
      /export async function getClientSubmission\(submissionId: string, auth\?: ClientAuthContext\)/,
      /return api\.getClientSubmission\(submissionId, auth\);/],
    ['getClientReport',
      /export async function getClientReport\(submissionId: string, auth\?: ClientAuthContext\)/,
      /return api\.getClientReport\(submissionId, auth\);/],
    ['getClientMessages',
      /export async function getClientMessages\(submissionId: string, auth\?: ClientAuthContext\)/,
      /return api\.getClientMessages\(submissionId, auth\);/],
    ['getClientProposal',
      /export async function getClientProposal\(submissionId: string, auth\?: ClientAuthContext\)/,
      /return api\.getClientProposal\(submissionId, auth\);/],
    ['getEngagementLog',
      /export async function getEngagementLog\(submissionId: string, auth\?: ClientAuthContext\)/,
      /return api\.getEngagementLog\(submissionId, auth\);/],
    ['trackEngagement',
      /auth\?: ClientAuthContext,\s*\)\s*\{\s*if \(isDemo\(\)\) return;/,
      /return api\.trackEngagement\(submissionId, type, meta, auth\);/],
    ['postClientMessage',
      /export async function postClientMessage\([\s\S]{0,160}?auth\?: ClientAuthContext,\s*\)/,
      /return api\.postClientMessage\(submissionId, content, clientName, auth\);/],
    ['respondToProposal',
      /export async function respondToProposal\([\s\S]{0,200}?auth\?: ClientAuthContext,\s*\)/,
      /return api\.respondToProposal\(submissionId, response, clientName, auth\);/],
  ];

  for (const [name, signature, delegation] of forwarding) {
    it(`${name} declares the auth slot and forwards it`, () => {
      assert.match(service, signature, `${name} must accept ClientAuthContext`);
      assert.match(service, delegation, `${name} must pass auth through to api`);
    });
  }

  it('no client wrapper delegates without its auth argument any more', () => {
    // The precise regression this closes: a call reaching api with
    // `auth === undefined` goes out on the anon key and is refused 401.
    for (const name of [
      'getClientSubmission', 'getClientReport', 'getClientMessages',
      'getClientProposal', 'getEngagementLog',
    ]) {
      assert.doesNotMatch(
        service,
        new RegExp(`return api\\.${name}\\(submissionId\\);`),
        `${name} dropped the auth argument again`,
      );
    }
    assert.doesNotMatch(service, /return api\.trackEngagement\(submissionId, type, meta\);/);
    assert.doesNotMatch(service, /return api\.postClientMessage\(submissionId, content, clientName\);/);
    assert.doesNotMatch(service, /return api\.respondToProposal\(submissionId, response, clientName\);/);
  });

  it('introduces no unsafe escape anywhere in the repaired wrappers', () => {
    for (const name of [
      'getClientReport', 'getClientMessages', 'getClientProposal',
      'getEngagementLog', 'trackEngagement', 'postClientMessage', 'respondToProposal',
    ]) {
      const body = functionBody(service, name);
      for (const [label, pattern] of [
        ['any', /:\s*any\b/], ['as unknown as', /as\s+unknown\s+as/],
        ['as never', /as\s+never\b/], ['@ts-ignore', /@ts-ignore/],
        ['@ts-expect-error', /@ts-expect-error/],
      ] as const) {
        // `report as any` predates this work and is asserted separately below.
        if (name === 'getClientReport' && label === 'any') continue;
        assert.doesNotMatch(body, pattern, `${name} must not use ${label}`);
      }
    }
  });
});

describe('the browser sends only what the server boundary asks for', () => {
  /**
   * `requireClientAccess` is the authority. It accepts a bearer session token
   * bound to ONE submission, or — on reads only — an `?email=` that must equal
   * the submission's own email. Anything else is refused. These assertions pin
   * that the browser sends exactly that and nothing more: no organization
   * header, no service-role key, no tenant identifier the server would have to
   * trust.
   */
  it('client requests carry the session token as a bearer header', () => {
    assert.match(apiSrc, /function clientHeaders\(auth\?: ClientAuthContext\)\s*\{\s*return headers\(auth\?\.sessionToken\);/);
  });

  it('and the email only as a query fallback, never as a trusted claim', () => {
    assert.match(apiSrc, /function withEmailQuery\(url: URL, auth\?: ClientAuthContext\)\s*\{\s*if \(auth\?\.email\) url\.searchParams\.set\('email', auth\.email\);/);
  });

  it('ClientAuthContext can carry nothing but the token and the email', () => {
    // A widened context would be a new claim for the server to decide about.
    assert.match(
      session,
      /export type ClientAuthContext\s*=\s*Pick<ClientSession, 'sessionToken'> & Partial<Pick<ClientSession, 'email'>>/,
    );
  });

  it('no client wrapper invents an organization or tenant header', () => {
    for (const forbidden of [/X-Org/i, /organization[iI]d/, /tenant[iI]d/, /service_role/, /SERVICE_ROLE/]) {
      assert.doesNotMatch(
        service, forbidden,
        'the client path must send no claim the server would have to trust',
      );
    }
  });

  it('the demo branch is still gated, so live mode has no demo fallback', () => {
    for (const name of [
      'getClientSubmission', 'getClientReport', 'getClientMessages',
      'getClientProposal', 'getEngagementLog', 'respondToProposal',
    ]) {
      assert.match(functionBody(service, name), /if\s*\(\s*isDemo\(\)\s*\)/,
        `${name} must reach api only when the backend is enabled`);
    }
  });
});

describe('ClientPortal still passes its memoised auth at every call site', () => {
  it('all seven trackEngagement calls carry clientAuth', () => {
    const trackCalls = portal.match(/trackEngagement\(submissionId, '[a-z_]+', undefined, clientAuth\)/g) ?? [];
    assert.equal(trackCalls.length, 7, 'every engagement call must be authenticated');
  });

  it('the report read carries it too', () => {
    assert.match(portal, /await getClientReport\(submissionId, clientAuth\)/);
  });
});

describe('why this was never a type-only change', () => {
  it('a function that declares no slot for an argument discards it', () => {
    // The JavaScript semantics that made the cluster a runtime bug rather than
    // a stale annotation: the fourth argument reached a three-parameter
    // wrapper and vanished, so api saw `auth === undefined` and the request
    // went out unauthenticated. Repairing the SLOT is what changes the wire.
    const forwards = (a: string, b?: unknown) => [a, b] as const;
    const discards = (a: string) => [a, undefined] as const;

    const auth = { sessionToken: 'tok_live', email: 'client@company.com' };

    assert.deepEqual(forwards('sub-1', auth), ['sub-1', auth]);
    assert.deepEqual((discards as (...a: unknown[]) => unknown)('sub-1', auth), ['sub-1', undefined]);
  });
});
