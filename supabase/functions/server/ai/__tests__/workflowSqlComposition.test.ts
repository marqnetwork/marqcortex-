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
import {
  ALPHA,
  makeApproval,
  makeCheckpoint,
  makeRun,
} from './workflowPersistenceContract.ts';

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


/**
 * THE CUTOVER PRECONDITION, ASSERTED SO A LATER PACKET CANNOT WALK PAST IT.
 *
 * `security/tenancy.ts` admits any organization identifier matching
 * `[a-z0-9][a-z0-9._-]{0,63}`, and `AI_DEFAULT_ORGANIZATION_ID` ships with the
 * slug-shaped default `marq-cortex`. The relational authority names tenants by
 * `organizations.id`, a UUID. So there are identifiers the key-value store
 * accepts and the SQL store structurally cannot.
 *
 * BP-003 does NOT solve that — production is still KV, so nothing is affected
 * today, and inventing a slug-to-UUID mapping would be a tenancy change inside
 * a persistence-parity packet. What BP-003 owes is that the candidate store
 * FAILS CLOSED and SAYS SO, rather than appearing to write and silently
 * storing nothing.
 *
 * Writes raise a typed `workflow_persistence_failed`. Reads return nothing,
 * and the asymmetry is not a compromise: an organization with no row has no
 * records either, so "nothing found" is the true answer to a read and "this
 * cannot be written" is the true answer to a write.
 *
 * Every assertion below is reached WITHOUT touching the gateway — the guard is
 * in front of it — which is what makes this a claim about the store rather
 * than about a database's error message.
 */
describe('BP-003 fails closed for a tenant the relational authority cannot name', () => {
  const UNNAMEABLE = 'marq-cortex';

  function stores() {
    const gateway = recordingGateway();
    return { gateway, ...createSqlWorkflowStores({ gateway }) };
  }

  async function refusesWrite(call: () => Promise<unknown>, what: string) {
    let raised: unknown;
    try {
      await call();
    } catch (error) {
      raised = error;
    }
    assert.ok(raised !== undefined, `${what}: the write was not refused`);
    assert.equal(
      (raised as { failure?: unknown }).failure,
      'workflow_persistence_failed',
      `${what}: the refusal was not a typed workflow failure`,
    );
    // The diagnostic names the actual problem, so a deployment that hits this
    // gets a sentence it can act on rather than a UUID parse error three
    // layers up.
    assert.match(
      String((raised as { diagnostics?: unknown }).diagnostics ?? ''),
      /not a relational organization id/,
      `${what}: the refusal does not say why`,
    );
  }

  it('refuses every write path with a typed workflow failure', async () => {
    const s = stores();
    await refusesWrite(
      () => s.runStore.create(makeRun({ organizationId: UNNAMEABLE })),
      'run create',
    );
    await refusesWrite(
      () => s.runStore.save(makeRun({ organizationId: UNNAMEABLE, runVersion: 2 }), 1),
      'run save',
    );
    await refusesWrite(
      () => s.checkpointStore.write(makeCheckpoint({ organizationId: UNNAMEABLE })),
      'checkpoint write',
    );
    await refusesWrite(
      () => s.approvalStore.create(makeApproval({ organizationId: UNNAMEABLE })),
      'approval create',
    );
    await refusesWrite(
      () => s.approvalStore.save(makeApproval({ organizationId: UNNAMEABLE, approvalVersion: 2 }), 1),
      'approval save',
    );
  });

  it('never reaches the database with an identifier it cannot represent', async () => {
    const s = stores();
    await s.runStore.create(makeRun({ organizationId: UNNAMEABLE })).catch(() => {});
    await s.runStore.list({ organizationId: UNNAMEABLE });
    await s.runStore.load(UNNAMEABLE, 'wfr_x');
    await s.checkpointStore.history(UNNAMEABLE, 'wfr_x');
    // THE GUARD IS IN FRONT OF THE GATEWAY. Not "the database rejects it" —
    // the store never asks.
    assert.deepEqual(s.gateway.calls, []);
  });

  it('answers reads honestly rather than raising', async () => {
    const s = stores();
    // An organization with no row has no records. "Nothing" is true.
    assert.equal(await s.runStore.load(UNNAMEABLE, 'wfr_x'), undefined);
    assert.deepEqual(await s.runStore.list({ organizationId: UNNAMEABLE }), []);
    assert.equal(await s.checkpointStore.read(UNNAMEABLE, 'wfr_x', 1), undefined);
    assert.equal(await s.checkpointStore.latest(UNNAMEABLE, 'wfr_x'), undefined);
    assert.deepEqual(await s.checkpointStore.history(UNNAMEABLE, 'wfr_x'), []);
    assert.equal(await s.approvalStore.load(UNNAMEABLE, 'wfa:x'), undefined);
    assert.deepEqual(await s.approvalStore.list({ organizationId: UNNAMEABLE }), []);
  });

  it('accepts the same operations for a relational tenant', async () => {
    // THE CONTROL. Without it, "everything is refused" would also pass this
    // suite. The gateway answers `true` because that is what
    // `workflow_run_create` returns when it inserts.
    const calls: string[] = [];
    const gateway: WorkflowSqlGateway = {
      rpc(fn) {
        calls.push(fn);
        return Promise.resolve(true);
      },
    };
    const { runStore } = createSqlWorkflowStores({ gateway });
    await runStore.create(makeRun({ organizationId: ALPHA }));
    assert.deepEqual(calls, ['workflow_run_create']);
  });
});
