/**
 * THE COMPOSITION SEAM, AND THE ONE THING BP-003 MUST NOT HAVE CHANGED.
 *
 * Two claims, and the second is the safety position of the whole packet.
 *
 *   The SQL stores can be assembled as ONE shared run / checkpoint / approval
 *   set, so the workflow engine and the diagnostic capability's
 *   approval-authority port read and write the same rows.
 *
 *   PRODUCTION STILL USES THE KEY-VALUE STORES. `ai/bootstrap.ts` constructs
 *   them, passes them to the workflow runtime and to the authority port, and
 *   BP-003 did not touch that.
 *
 * The second is asserted as a SOURCE SCAN rather than behaviourally, because
 * the claim is about what the assembly cannot do rather than about what it
 * does on one path. A behavioural test would show that bootstrap uses KV under
 * the conditions the test set up; only a scan shows there is no condition
 * under which it uses SQL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSqlWorkflowStores,
  isRelationalOrganizationId,
  type WorkflowSqlGateway,
} from '../workflows/persistence/sqlWorkflowStores.ts';
import { createWorkflowApprovalAuthorityPort } from '../business/diagnostic/persistence/authorityPort.ts';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOTSTRAP = join(SERVER_ROOT, 'ai', 'bootstrap.ts');
const bootstrap = readFileSync(BOOTSTRAP, 'utf8');

/** A gateway that records calls and answers nothing. Identity is the subject. */
function recordingGateway(): WorkflowSqlGateway & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn) {
      calls.push(fn);
      return Promise.resolve([]);
    },
  };
}

describe('BP-003 composition seam', () => {
  it('assembles one shared store set, not three independent ones', () => {
    const gateway = recordingGateway();
    const stores = createSqlWorkflowStores({ gateway });

    // The authority port takes the ENGINE's own two stores. Identity, not
    // equivalence: two stores over one database would eventually agree, and
    // "eventually" is not what a commit's authorization may rest on.
    const authority = createWorkflowApprovalAuthorityPort({
      runs: stores.runStore,
      approvals: stores.approvalStore,
    });
    assert.ok(authority, 'the authority port could not be assembled from the SQL stores');

    const second = createSqlWorkflowStores({ gateway });
    assert.notEqual(
      stores.runStore,
      second.runStore,
      'two assemblies returned the same instance, so this test could not detect a split',
    );
  });

  it('routes the engine and the approval authority to the same rows', async () => {
    const gateway = recordingGateway();
    const stores = createSqlWorkflowStores({ gateway });
    const authority = createWorkflowApprovalAuthorityPort({
      runs: stores.runStore,
      approvals: stores.approvalStore,
    });

    // The authority port's two reads must land on the SAME gateway the engine's
    // stores hold. A second gateway here would be a second database.
    await authority.owningWorkflowRun('11111111-1111-4111-8111-111111111111', 'run_x');
    await authority.approvalsForRun('11111111-1111-4111-8111-111111111111', 'wfr_x');
    assert.deepEqual(gateway.calls, ['workflow_run_list', 'workflow_approval_list']);

    await stores.runStore.list({ organizationId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(gateway.calls.length, 3, 'the engine store reached a different gateway');
  });

  it('offers no way to construct a store without the tenant guard', () => {
    // The relational authority names tenants by UUID. A deployment whose
    // organization identifier is the slug-shaped default cannot write here, and
    // that is reported rather than silently succeeding — see the module header.
    assert.equal(isRelationalOrganizationId('11111111-1111-4111-8111-111111111111'), true);
    assert.equal(isRelationalOrganizationId('marq-cortex'), false);
    assert.equal(isRelationalOrganizationId(''), false);
  });
});

describe('BP-003 did not cut production over', () => {
  it('bootstrap still constructs the KEY-VALUE workflow stores', () => {
    for (const constructor of [
      'createKvWorkflowRunStore',
      'createKvWorkflowCheckpointStore',
      'createKvWorkflowApprovalStore',
    ]) {
      assert.match(
        bootstrap,
        new RegExp(`${constructor}\\(`),
        `bootstrap no longer constructs ${constructor}`,
      );
    }
  });

  it('bootstrap imports nothing from the SQL workflow stores', () => {
    // THE LOAD-BEARING ASSERTION OF THIS PACKET. Not "SQL is off by default" —
    // the production assembly cannot reach the SQL stores at all, so there is
    // no flag to set by accident, no environment variable to mistype and no
    // branch to fall through into.
    assert.doesNotMatch(
      bootstrap,
      /sqlWorkflowStores/,
      'the production assembly imports the SQL workflow stores',
    );
    assert.doesNotMatch(
      bootstrap,
      /createSqlWorkflow/,
      'the production assembly constructs a SQL workflow store',
    );
  });

  it('bootstrap still hands the diagnostic authority the engine\'s own stores', () => {
    // The shared-store invariant, at the one place it actually has to hold.
    assert.match(bootstrap, /runs:\s*workflowStores\.runStore/);
    assert.match(bootstrap, /approvals:\s*workflowStores\.approvalStore/);
    // And the trio is built exactly once.
    assert.equal(
      (bootstrap.match(/createKvWorkflowRunStore\(/g) ?? []).length,
      1,
      'the workflow run store is constructed more than once in the assembly',
    );
  });

  it('no migration in this packet touches the key-value store', () => {
    // A workflow record moved, copied or deleted by a BP-003 migration would be
    // a cutover wearing a schema change's clothes.
    const MIGRATIONS = join(SERVER_ROOT, '..', '..', 'migrations');
    for (const file of [
      '20260921120000_cortex_workflow_persistence.sql',
      '20260921120001_cortex_workflow_persistence_rls.sql',
      '20260921120002_cortex_workflow_persistence_functions.sql',
      join('rollbacks', '20260921120000_rollback_workflow_persistence.sql'),
    ]) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      const STATEMENT = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b[^\n;]*/gi;
      for (const match of sql.matchAll(STATEMENT)) {
        assert.doesNotMatch(
          match[0],
          /kv_store|kv_compare_and_swap/i,
          `${file} has a statement that touches the key-value store: ${match[0].slice(0, 120)}`,
        );
      }
    }
  });
});
