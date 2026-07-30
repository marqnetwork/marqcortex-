/**
 * PHASE 1B TASK 20 — DiagnosticProposal.savedAt declaration drift
 *
 * Two TS2339 diagnostics, one root cause: CortexProposalModule renders a
 * "Saved HH:MM" hint from `proposal.savedAt`, but `DiagnosticProposal` never
 * declared the field.
 *
 * The runtime value was there all along. The proposal-save route builds
 *
 *     const toSave = { ...proposal, status, submissionId, savedAt: new Date().toISOString() }
 *
 * persists it, and returns `{ success: true, proposal: toSave }`. The component
 * feeds that response straight back into component state
 * (`setProposal(res.proposal as DiagnosticProposal)`) on both the save path and
 * the load path, so any proposal that has round-tripped through the backend
 * genuinely carries `savedAt`. Only the declaration was missing it.
 *
 * The field is OPTIONAL because a proposal built locally by `buildFromData()`
 * has never been saved and legitimately has no timestamp — which is exactly why
 * the render site already guards with `proposal.savedAt && …`.
 *
 * It is camelCase, unlike the snake_case fields around it, because it mirrors
 * the wire key the server actually sends rather than the proposal document's
 * own naming. Renaming it would break the read.
 *
 * Declaration-only change: no request, response, render or stored value moved.
 *
 * TESTING APPROACH (documented limitation)
 *   proposal.ts is types-only (it erases to nothing, so there is no runtime
 *   object to assert on), CortexProposalModule is .tsx, and the server route is
 *   a Deno .tsx module. The runner (`node --experimental-strip-types`) strips
 *   types but does NOT transform JSX and cannot load the Deno module, so none of
 *   the three can be imported here. Following the established pattern
 *   (frontendIconContracts.test.ts / breadcrumbContract.test.ts), each guarantee
 *   is enforced structurally against the production source, with a compile-time
 *   companion at src/app/components/__typechecks__/proposalSavedAtContract.ts
 *   proving optionality and the value type under `typecheck:web`.
 *   Assertions are pattern-based, never line-number-based.
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

const TYPES_REL = 'src/app/types/proposal.ts';
const MODULE_REL = 'src/app/components/CortexProposalModule.tsx';
const SERVER_REL = 'supabase/functions/server/index.tsx';
const TYPECHECK_REL = 'src/app/components/__typechecks__/proposalSavedAtContract.ts';

describe('DiagnosticProposal — savedAt is declared, and declared optional', () => {
  const types = stripComments(readSource(TYPES_REL));

  it('the interface declares savedAt as an optional string', () => {
    assert.match(
      types,
      /\bsavedAt\?\s*:\s*string\s*;/,
      'expected `savedAt?: string;` on DiagnosticProposal',
    );
  });

  it('savedAt is NOT required — an unsaved proposal must stay valid', () => {
    // The single most important property of this fix. A required field would
    // invalidate every locally built proposal that has not hit the save route.
    assert.doesNotMatch(
      types,
      /\bsavedAt\s*:\s*string\s*;/,
      'savedAt became required — locally built proposals have no timestamp',
    );
  });

  it('it sits inside the DiagnosticProposal interface, not a neighbouring type', () => {
    const iface = /export interface DiagnosticProposal\s*\{([\s\S]*?)\n\}/.exec(types);
    assert.ok(iface, 'expected to find the DiagnosticProposal interface body');
    assert.match(iface[1], /\bsavedAt\?\s*:\s*string\s*;/, 'savedAt is not on DiagnosticProposal');
  });

  it('the pre-existing tracking fields are untouched', () => {
    for (const field of ['viewed_at', 'accepted_at', 'accepted_by', 'sent_date', 'future_path']) {
      assert.match(
        types,
        new RegExp(`\\b${field}\\?\\s*:\\s*\\w+`),
        `optional field ${field} changed or was removed`,
      );
    }
    assert.match(types, /\bproposal_id\s*:\s*string\s*;/, 'proposal_id changed');
    assert.match(
      types,
      /status\s*:\s*'draft'\s*\|\s*'sent'\s*\|\s*'viewed'\s*\|\s*'accepted'\s*\|\s*'rejected'\s*;/,
      'the proposal status union changed',
    );
  });
});

describe('savedAt is a real server-produced value, not an invented field', () => {
  it('the proposal-save route still stamps savedAt onto what it persists', () => {
    // This is the producer that makes the declaration accurate. If the server
    // stops stamping it, the frontend field is fiction and this test says so.
    const server = stripComments(readSource(SERVER_REL));
    assert.match(
      server,
      /savedAt:\s*new Date\(\)\.toISOString\(\)/,
      'the save route no longer stamps savedAt',
    );
    assert.match(
      server,
      /const toSave = \{\s*\.\.\.proposal,/,
      'the save route no longer spreads the incoming proposal into what it stores',
    );
    assert.match(
      server,
      /c\.json\(\{\s*success:\s*true,\s*proposal:\s*toSave\s*\}\)/,
      'the save route no longer returns the stamped proposal to the client',
    );
  });

  it('the component feeds the server response back into proposal state', () => {
    // Both the load path and the save path, which is how savedAt reaches the
    // render site. Losing either would leave the field permanently undefined.
    const code = stripComments(readSource(MODULE_REL));
    const feeds = code.match(/setProposal\(res\.proposal as DiagnosticProposal\)/g) ?? [];
    assert.ok(
      feeds.length >= 2,
      `expected the load and save paths to both adopt the server proposal, found ${feeds.length}`,
    );
  });
});

describe('CortexProposalModule — the render site is unchanged and still guarded', () => {
  const code = stripComments(readSource(MODULE_REL));

  it('the saved-at hint is still rendered behind a presence guard', () => {
    // The guard is why the field can be optional. Removing it would throw
    // `new Date(undefined)` into the label for every unsaved proposal.
    assert.match(
      code,
      /\{proposal\.savedAt\s*&&\s*` · Saved \$\{new Date\(proposal\.savedAt\)\.toLocaleTimeString\(/,
      'the guarded savedAt render changed',
    );
  });

  it('the neighbouring sent-date hint is untouched', () => {
    assert.match(
      code,
      /\{proposal\.sent_date\s*&&\s*` · Sent \$\{new Date\(proposal\.sent_date\)\.toLocaleDateString\(/,
      'the sent_date render changed — out of scope for this task',
    );
  });
});

describe('the compile-time companion contract is present', () => {
  it('typechecks savedAt for existence, optionality and value type', () => {
    const tc = readSource(TYPECHECK_REL);
    assert.match(tc, /'savedAt' extends keyof DiagnosticProposal/, 'missing the existence assertion');
    assert.match(tc, /Extends<undefined, DiagnosticProposal\['savedAt'\]>/, 'missing the optionality assertion');
    assert.match(tc, /NonNullable<DiagnosticProposal\['savedAt'\]>, string/, 'missing the string assertion');
  });
});
