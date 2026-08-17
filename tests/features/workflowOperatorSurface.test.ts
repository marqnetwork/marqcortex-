/**
 * The workflow operator surface, from the console to the route table
 * (AI-01 Batch 3B).
 *
 * The server suite (`ai/__tests__/workflowHttp.test.ts`) drives the whole
 * request/response mapping through the adapter, over the real production
 * assembly. It cannot see the one defect that lives BETWEEN the two halves: a
 * console asking for a URL the route table does not register. That is a silent
 * 404 in production, it passes every server test, and TypeScript cannot catch it
 * either — the paths are strings on both sides.
 *
 * So this suite asserts the seam. It also pins the three properties the console
 * half is built on, all of which are claims about ABSENCE and therefore claims a
 * behavioural test cannot settle:
 *
 *   the client invents no demo data — an operator reading fabricated run states
 *   or a fabricated approval queue has been told a dangerous lie;
 *   the console decides no authority — it renders what the server said the
 *   actor may do and compares no role of its own;
 *   the console names no other workflow — the surface is generic, and the one
 *   business workflow it offers is named once, as an identifier.
 *
 * Source-based, like every other frontend contract test here: `.tsx` cannot be
 * imported by this runner (it strips types but does not transform JSX), and the
 * assertions are pattern-based rather than line-based.
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
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const CLIENT = 'src/app/services/workflowRuntimeService.ts';
const CONSOLE = 'src/app/components/AIAdministrationConsole.tsx';
const ROUTES = 'supabase/functions/server/workflowRuntimeRoutes.ts';
const ADAPTER = 'supabase/functions/server/ai/workflows/http/workflowHttpAdapter.ts';
const EDGE = 'supabase/functions/server/index.tsx';

const clientCode = stripComments(readSource(CLIENT));
const consoleCode = stripComments(readSource(CONSOLE));
const routesCode = stripComments(readSource(ROUTES));
const adapterCode = stripComments(readSource(ADAPTER));
const edgeCode = stripComments(readSource(EDGE));

/**
 * Every `/ai/workflows/...` path a source mentions, normalised.
 *
 * A path parameter is a path parameter whichever notation names it: `:runId` in
 * the route table and `${encodeURIComponent(runId)}` in the client both become
 * `*`. A trailing `*` that is NOT its own segment came from an interpolated
 * query string (`/runs${suffix}`) and is dropped, because a query string is not
 * part of the path a router matches.
 */
function workflowPaths(code: string): Set<string> {
  const normalised = code.replace(/\$\{[^}]*\}/g, '*');
  const found = normalised.match(/\/ai\/workflows[A-Za-z0-9/:*_-]*/g) ?? [];
  return new Set(
    found.map((path) =>
      path
        .replace(/:[A-Za-z0-9_]+/g, '*')
        .replace(/([^/])\*+$/, '$1')
        .replace(/\/$/, ''),
    ),
  );
}

describe('workflow operator surface — the console reaches routes that exist', () => {
  it('finds a path on both sides at all', () => {
    // A scan over zero paths passes vacuously, which would make every assertion
    // below meaningless.
    assert.ok(workflowPaths(clientCode).size >= 6, 'the client must call the workflow surface');
    assert.ok(workflowPaths(routesCode).size >= 6, 'the route table must register it');
  });

  it('registers every path the console client asks for', () => {
    const registered = workflowPaths(routesCode);
    const requested = [...workflowPaths(clientCode)];
    const missing = requested.filter((path) => !registered.has(path));
    assert.deepEqual(
      missing,
      [],
      `the client calls ${missing.join(', ')}, which the route table does not register`,
    );
  });

  it('mounts the route table on the edge entry point', () => {
    // Routes that are never registered are a surface that exists only in review.
    assert.match(edgeCode, /registerWorkflowRuntimeRoutes\(/);
    assert.match(edgeCode, /getWorkflowRuntime\(\)/);
    // And it fails closed: no runtime, no routes. A surface that mounted itself
    // without a runtime behind it would have to invent what to do with a request.
    assert.match(edgeCode, /workflow runtime unavailable/);
  });

  it('binds every declared operation to a route', () => {
    // An operation in the adapter's union with no route is an operation nothing
    // can reach; a route naming an operation the union does not declare is a 404
    // the adapter produces at runtime. Both are caught by comparing the two.
    const declared = [...adapterCode.matchAll(/^\s{2}([a-zA-Z]+):\s*'(workflow\.[a-z.]+)',/gm)].map(
      (match) => match[1],
    );
    assert.ok(declared.length >= 8, `expected the operation table, found ${declared.length}`);

    const routed = new Set(
      [...routesCode.matchAll(/WORKFLOW_OPERATION\.([a-zA-Z]+)/g)].map((match) => match[1]),
    );
    const unreachable = declared.filter((operation) => !routed.has(operation));
    assert.deepEqual(
      unreachable,
      [],
      `${unreachable.join(', ')} is declared but no route reaches it`,
    );
  });
});

describe('workflow operator surface — what the console never does', () => {
  it('invents no demo, seed or fallback data', () => {
    // Every other service in this console falls back to seed data when the
    // backend is off, which is right for a sales demo of a dashboard and wrong
    // for an operations view.
    assert.match(clientCode, /isBackendEnabled\(\)/);
    assert.match(clientCode, /BACKEND_DISABLED/);
    for (const forbidden of [/mockWorkflow/i, /seedWorkflow/i, /demoRun/i, /fallbackRuns/i]) {
      assert.equal(forbidden.test(clientCode), false, `the client fabricates data: ${forbidden}`);
    }
  });

  it('reads the actor’s permissions from the server and compares no role', () => {
    // `capabilities` arrives on the overview. A role literal in the console
    // would be a second, drifting copy of the server's grant table — and the
    // copy is always the one an operator ends up trusting.
    assert.match(consoleCode, /hasWorkflowCapability\(/);
    assert.match(consoleCode, /workflow\.run\.create/);
    assert.match(consoleCode, /workflow\.approval\.decide/);
    assert.match(consoleCode, /workflow\.run\.control/);

    const workflowTab = consoleCode.slice(
      consoleCode.indexOf('function WorkflowsTab'),
      consoleCode.indexOf('function ProviderList'),
    );
    assert.ok(workflowTab.length > 500, 'the workflow tab must be found');
    for (const role of ['super_admin', 'platform_admin', 'consultant', 'reviewer', 'owner']) {
      assert.equal(
        new RegExp(`['"\`]${role}['"\`]`).test(workflowTab),
        false,
        `the workflow tab compares the role ${role} itself`,
      );
    }
  });

  it('sends a reason with every decision and every cancellation', () => {
    // The server refuses both without one, and a reason the console invented
    // would be a reason nobody gave — the one thing an approval trail must never
    // contain. `reason` is a required parameter on both client functions.
    assert.match(
      clientCode,
      /export async function decideWorkflowApproval\([\s\S]{0,240}reason: string/,
    );
    assert.match(clientCode, /export async function cancelWorkflowRun\([\s\S]{0,240}reason: string/);
    // And the console prompts for it rather than defaulting one.
    assert.match(consoleCode, /Cancel this workflow run/);
    assert.match(consoleCode, /A reason of at least four characters is required/);
  });

  it('shows the approver what they are deciding about', () => {
    // Without the subject, a queue entry names a run and some definition-authored
    // prose, and the decider has to reconstruct the subject before they can know
    // what they are granting.
    assert.match(consoleCode, /subjectEvidence/);
    assert.match(consoleCode, /subjectEvidence\.subjectId/);
    assert.match(consoleCode, /subjectEvidence\.contentDigest/);
  });

  it('names the diagnostic review as an identifier and hard-wires nothing else', () => {
    // The surface is generic. The one certified business workflow is named once,
    // in the client, as a constant the console offers by name — everything else
    // comes from the registry read.
    assert.match(
      clientCode,
      /READINESS_REVIEW_WORKFLOW_ID = 'workflow\.diagnostic\.readiness_review'/,
    );
    const literals = consoleCode.match(/'workflow\.diagnostic\.[a-z_]+'/g) ?? [];
    assert.deepEqual(literals, [], 'the console hard-codes a workflow id instead of importing it');
  });

  it('tells an operator when the capability is simply not enabled here', () => {
    // Off by default is the correct state of a deployment that has not activated
    // the capability, and it must read as that rather than as a broken console.
    assert.match(consoleCode, /AI_DIAGNOSTIC_REVIEW_ENABLED/);
    assert.match(consoleCode, /not enabled in this deployment/);
  });
});
