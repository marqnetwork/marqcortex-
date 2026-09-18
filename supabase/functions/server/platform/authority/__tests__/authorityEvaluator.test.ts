/**
 * BP-001 acceptance tests for the platform authority evaluator.
 *
 * The packet lists fourteen required tests. Twelve of them are questions about
 * the EVALUATOR and are answered here; the remaining two — that the approval
 * path reuses the existing machinery, and that the pilot still behaves on
 * `ALLOW` — are questions about the INTEGRATION and are answered in
 * `ai/__tests__/agentAuthorityPilot.test.ts`, where a real orchestrator, a real
 * approval gate and a real audit trail are in scope.
 *
 * Each `describe` below names the packet item it discharges, so a reviewer can
 * walk §10 against this file without having to infer the mapping.
 *
 * THE FIXTURES ARE DELIBERATELY BORING. One organization, one agent, one tool.
 * A test suite for an authorization boundary earns nothing from elaborate
 * scenarios: every assertion here is about a single rule, and a fixture rich
 * enough to be interesting is a fixture rich enough to make a passing test
 * ambiguous about WHICH rule passed it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTHORITY_REASON,
  evaluateAuthority,
  platformConsequenceFloor,
  type ActionRequest,
  type ActorContext,
  type AuthorityEnvelope,
  type AuthorityEnvelopeSource,
  type AuthorityEvaluationInput,
  type AuthorityPolicySource,
  type ConsequenceLevel,
} from '../index.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-18T12:00:00.000Z';

const HUMAN: ActorContext = {
  actorId: 'user-1',
  actorType: 'human',
  organizationId: ORG,
  roles: ['admin'],
  permissions: ['agent.tool.call', 'agent.run.create'],
  membershipVerified: true,
};

const AGENT: ActorContext = {
  actorId: 'agent-research',
  actorType: 'ai_agent',
  organizationId: ORG,
  roles: [],
  permissions: ['agent.tool.call'],
  membershipVerified: true,
  runId: 'run-1',
  initiatedBy: { actorId: HUMAN.actorId, actorType: 'human' },
};

function envelope(overrides: Partial<AuthorityEnvelope> = {}): AuthorityEnvelope {
  return {
    envelopeId: 'env-agent-research',
    version: 3,
    organizationId: ORG,
    subjectActorId: AGENT.actorId,
    subjectActorType: 'ai_agent',
    status: 'active',
    allowedActionTypes: ['agent.tool.call'],
    allowedResourceTypes: ['agent.tool'],
    allowedTools: ['crm.lookup'],
    dataClassificationCeiling: 'internal',
    consequenceCeiling: 'high',
    approvalThreshold: 'high',
    maxCostMicroUsd: 5_000_000,
    explicitDeny: [],
    ...overrides,
  };
}

function source(value: AuthorityEnvelope | undefined): AuthorityEnvelopeSource {
  return { resolve: () => value };
}

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'action-1',
    correlationId: 'corr-1',
    actionType: 'agent.tool.call',
    resourceType: 'agent.tool',
    organizationId: ORG,
    actor: AGENT,
    requestedEffect: 'read',
    dataClassification: 'internal',
    requestedTool: 'crm.lookup',
    reversible: true,
    estimatedCostMicroUsd: 0,
    ...overrides,
  };
}

function evaluate(overrides: Partial<AuthorityEvaluationInput> = {}) {
  const input: AuthorityEvaluationInput = {
    request: request(),
    envelopes: source(envelope()),
    requiredPermission: 'agent.tool.call',
    nowIso: NOW,
    ...overrides,
  };
  return evaluateAuthority(input);
}

// ── §10.1 / §10.3 — allowed inside role and envelope ────────────────────────

describe('§10.1 and §10.3 — an actor inside its role and its envelope is allowed', () => {
  it('allows an AI agent inside its assigned envelope', () => {
    const decision = evaluate();
    assert.equal(decision.decision, 'ALLOW');
    assert.equal(decision.matchedEnvelopeId, 'env-agent-research');
    assert.deepEqual(decision.matchedPermissions, ['agent.tool.call']);
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.allowed));
  });

  it('allows a human inside their role and their own envelope', () => {
    const decision = evaluate({
      request: request({ actor: HUMAN }),
      envelopes: source(
        envelope({
          envelopeId: 'env-human-admin',
          subjectActorId: HUMAN.actorId,
          subjectActorType: 'human',
        }),
      ),
    });
    assert.equal(decision.decision, 'ALLOW');
    assert.equal(decision.matchedEnvelopeId, 'env-human-admin');
  });

  it('carries the whole evaluation order in its evidence', () => {
    // The evidence is what a reviewer reads instead of re-running the system,
    // so an ALLOW must show that every step actually ran — not merely that the
    // last one did.
    assert.deepEqual(evaluate().evidence.evaluatedSteps, [
      'request',
      'tenant',
      'actor',
      'permission',
      'explicit_deny',
      'policy',
      'envelope',
      'constraints',
      'consequence',
      'decision',
    ]);
  });
});

// ── §10.2 — denied without organization membership ──────────────────────────

describe('§10.2 — an actor without confirmed membership may not act', () => {
  it('denies a consequential action when membership is unverified', () => {
    const decision = evaluate({
      request: request({
        actor: { ...HUMAN, membershipVerified: false },
        requestedEffect: 'write',
      }),
      envelopes: source(
        envelope({ subjectActorId: HUMAN.actorId, subjectActorType: 'human' }),
      ),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.membershipUnverified));
  });

  it('still permits a pure read, matching the existing runtime baseline', () => {
    // `agents/service/agentRbac.ts` deliberately leaves READER reachable in the
    // same state. Diverging from that here would make two surfaces disagree
    // about the same account, which is the class of bug the canonical
    // effective-authority model exists to prevent.
    const decision = evaluate({
      request: request({
        actor: { ...HUMAN, membershipVerified: false },
        requestedEffect: 'read',
      }),
      envelopes: source(
        envelope({ subjectActorId: HUMAN.actorId, subjectActorType: 'human' }),
      ),
    });
    assert.equal(decision.decision, 'ALLOW');
  });
});

// ── §10.4 — approval when consequence exceeds the envelope ──────────────────

describe('§10.4 — an agent needs approval once consequence reaches the threshold', () => {
  it('requires approval for a high-consequence action under a high threshold', () => {
    const decision = evaluate({
      request: request({ requestedEffect: 'external_effect', reversible: false }),
    });
    assert.equal(decision.decision, 'REQUIRE_APPROVAL');
    assert.equal(decision.consequenceLevel, 'high');
    assert.equal(decision.approvalRequirement?.withinEnvelopeCeiling, true);
    assert.ok(
      decision.reasonCodes.includes(AUTHORITY_REASON.consequenceThresholdReached),
    );
  });

  it('denies outright above the ceiling — approval cannot widen an envelope', () => {
    // The distinction this asserts is the one most easily collapsed: a
    // threshold says "not unattended", a ceiling says "not by this actor". If
    // a ceiling could be unlocked by asking somebody, it would be a threshold
    // with extra steps.
    const decision = evaluate({
      request: request({ requestedEffect: 'authority_change' }),
    });
    assert.equal(decision.decision, 'DENY');
    assert.equal(decision.consequenceLevel, 'critical');
    assert.equal(decision.approvalRequirement?.withinEnvelopeCeiling, false);
    assert.ok(
      decision.reasonCodes.includes(AUTHORITY_REASON.consequenceCeilingExceeded),
    );
  });

  it('allows the same action for an actor whose envelope reaches that far', () => {
    // Proves the refusal above is about the ENVELOPE and not about the action
    // type being hard-coded as forbidden.
    const decision = evaluate({
      request: request({ requestedEffect: 'external_effect', reversible: false }),
      envelopes: source(
        envelope({ consequenceCeiling: 'critical', approvalThreshold: 'critical' }),
      ),
    });
    assert.equal(decision.decision, 'ALLOW');
  });
});

// ── §10.5 — no automatic inheritance of human authority ─────────────────────

describe('§10.5 — a workflow never inherits its initiator’s authority', () => {
  const workflow: ActorContext = {
    actorId: 'workflow-nightly',
    actorType: 'workflow',
    organizationId: ORG,
    roles: [],
    permissions: ['agent.tool.call'],
    membershipVerified: true,
    initiatedBy: { actorId: HUMAN.actorId, actorType: 'human' },
  };

  it('refuses a workflow that resolves onto a human envelope', () => {
    const decision = evaluate({
      request: request({ actor: workflow }),
      envelopes: source(
        // The unrestricted human envelope, handed to a workflow.
        envelope({
          envelopeId: 'env-human-owner',
          subjectActorId: HUMAN.actorId,
          subjectActorType: 'human',
          allowedActionTypes: ['*'],
          allowedResourceTypes: ['*'],
          allowedTools: ['*'],
          consequenceCeiling: 'critical',
          approvalThreshold: undefined,
          maxCostMicroUsd: undefined,
        }),
      ),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.inheritedAuthorityRefused));
  });

  it('refuses every non-human actor type the same way', () => {
    for (const actorType of ['ai_agent', 'workflow', 'job', 'integration', 'service'] as const) {
      const decision = evaluate({
        request: request({ actor: { ...workflow, actorType } }),
        envelopes: source(
          envelope({ subjectActorId: workflow.actorId, subjectActorType: 'human' }),
        ),
      });
      assert.equal(decision.decision, 'DENY', actorType);
      assert.ok(
        decision.reasonCodes.includes(AUTHORITY_REASON.inheritedAuthorityRefused),
        actorType,
      );
    }
  });

  it('records the initiator without granting anything from them', () => {
    // `initiatedBy` is provenance, not authority: the workflow is allowed here
    // purely by its OWN envelope, and denied above despite the same initiator.
    const decision = evaluate({
      request: request({ actor: workflow }),
      envelopes: source(
        envelope({
          envelopeId: 'env-workflow',
          subjectActorId: workflow.actorId,
          subjectActorType: 'workflow',
        }),
      ),
    });
    assert.equal(decision.decision, 'ALLOW');
    assert.equal(decision.matchedEnvelopeId, 'env-workflow');
  });
});

// ── §10.6 — a service actor is explicitly bounded ───────────────────────────

describe('§10.6 — a service or integration actor is bounded, not trusted', () => {
  const service: ActorContext = {
    actorId: 'svc-importer',
    actorType: 'service',
    organizationId: ORG,
    roles: ['service'],
    permissions: ['import.records'],
    membershipVerified: true,
  };

  const bounded = envelope({
    envelopeId: 'env-svc-importer',
    subjectActorId: service.actorId,
    subjectActorType: 'service',
    allowedActionTypes: ['import.records'],
    allowedResourceTypes: ['crm.contact'],
    allowedTools: [],
    consequenceCeiling: 'medium',
    approvalThreshold: undefined,
  });

  it('allows exactly the action it was granted', () => {
    const decision = evaluate({
      request: request({
        actor: service,
        actionType: 'import.records',
        resourceType: 'crm.contact',
        requestedEffect: 'write',
        requestedTool: undefined,
      }),
      envelopes: source(bounded),
      requiredPermission: 'import.records',
    });
    assert.equal(decision.decision, 'ALLOW');
  });

  it('denies a neighbouring action it was not granted', () => {
    const decision = evaluate({
      request: request({
        actor: service,
        actionType: 'crm.contact.delete',
        resourceType: 'crm.contact',
        requestedEffect: 'delete',
        requestedTool: undefined,
      }),
      envelopes: source(bounded),
      requiredPermission: 'import.records',
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeActionOutOfScope));
  });

  it('grants no tool at all when its tool scope is empty', () => {
    // An empty scope list admits NOTHING. The alternative reading — empty means
    // unrestricted — is how an envelope nobody finished filling in becomes the
    // most powerful one in the system.
    const decision = evaluate({
      request: request({
        actor: service,
        actionType: 'import.records',
        resourceType: 'crm.contact',
        requestedEffect: 'write',
        requestedTool: 'crm.lookup',
      }),
      envelopes: source(bounded),
      requiredPermission: 'import.records',
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.toolOutOfScope));
  });
});

// ── §10.7 — explicit deny beats allow ───────────────────────────────────────

describe('§10.7 — an explicit deny beats every allow', () => {
  it('denies an action the envelope otherwise permits', () => {
    const decision = evaluate({
      envelopes: source(
        envelope({
          explicitDeny: [
            {
              ruleId: 'containment-1',
              actionTypes: ['agent.tool.call'],
              reason: 'Contained pending review.',
            },
          ],
        }),
      ),
    });
    assert.equal(decision.decision, 'DENY');
    assert.equal(decision.reason, 'Contained pending review.');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.explicitDeny));
  });

  it('beats a wildcard envelope and an allowing policy together', () => {
    const allowEverything: AuthorityPolicySource = {
      constraints: () => [
        { policyId: 'p-allow', effect: 'allow', reason: 'permitted', actionTypes: ['*'] },
      ],
    };
    const decision = evaluate({
      envelopes: source(
        envelope({
          allowedActionTypes: ['*'],
          allowedResourceTypes: ['*'],
          allowedTools: ['*'],
          consequenceCeiling: 'critical',
          explicitDeny: [
            { ruleId: 'containment-2', actionTypes: ['*'], reason: 'Contained.' },
          ],
        }),
      ),
      policies: allowEverything,
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.explicitDeny));
  });

  it('runs before the policy step, so a deny is never merely outvoted', () => {
    const decision = evaluate({
      envelopes: source(
        envelope({
          explicitDeny: [{ ruleId: 'c3', actionTypes: ['*'], reason: 'Contained.' }],
        }),
      ),
    });
    assert.ok(decision.evidence.evaluatedSteps.includes('explicit_deny'));
    assert.equal(decision.evidence.evaluatedSteps.includes('policy'), false);
  });

  it('narrows correctly by tool without forbidding unrelated tools', () => {
    const denyOneTool = envelope({
      allowedTools: ['crm.lookup', 'crm.write'],
      explicitDeny: [
        {
          ruleId: 'c4',
          actionTypes: ['agent.tool.call'],
          tools: ['crm.write'],
          reason: 'Writes are contained.',
        },
      ],
    });
    assert.equal(evaluate({ envelopes: source(denyOneTool) }).decision, 'ALLOW');
    const denied = evaluate({
      request: request({ requestedTool: 'crm.write' }),
      envelopes: source(denyOneTool),
    });
    assert.equal(denied.decision, 'DENY');
    assert.ok(denied.reasonCodes.includes(AUTHORITY_REASON.explicitDeny));
  });
});

// ── §10.8 — missing context fails closed ────────────────────────────────────

describe('§10.8 — absent or unusable context fails closed', () => {
  it('denies when no envelope source is supplied at all', () => {
    const decision = evaluate({ envelopes: undefined });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMissing));
  });

  it('denies a human with no envelope, exactly as it denies an agent', () => {
    // Deny by default has no exemption for people. An exemption is how the
    // envelope becomes decorative: every caller in a hurry routes a human
    // actor through, and the boundary holds only where nobody was in a hurry.
    const decision = evaluate({
      request: request({ actor: HUMAN }),
      envelopes: source(undefined),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMissing));
  });

  it('denies when the envelope source throws', () => {
    const decision = evaluate({
      envelopes: { resolve: () => { throw new Error('store down'); } },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMissing));
  });

  it('denies when the policy source throws', () => {
    const decision = evaluate({
      policies: { constraints: () => { throw new Error('policy down'); } },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.policyDeny));
  });

  it('denies an unreadable evaluation timestamp', () => {
    const decision = evaluate({ nowIso: 'not-a-date' });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.contextIncomplete));
  });

  it('denies a request with no action identity', () => {
    for (const patch of [{ actionId: '' }, { correlationId: '  ' }, { actionType: '' }]) {
      const decision = evaluate({ request: request(patch) });
      assert.equal(decision.decision, 'DENY');
      assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.contextIncomplete));
    }
  });

  it('denies a state change that names no permission', () => {
    const decision = evaluate({
      request: request({ requestedEffect: 'write' }),
      requiredPermission: undefined,
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.permissionMissing));
  });

  it('denies an actor with no identity or an unrecognised type', () => {
    const anonymous = evaluate({
      request: request({ actor: { ...AGENT, actorId: '' } }),
    });
    assert.equal(anonymous.decision, 'DENY');
    assert.ok(anonymous.reasonCodes.includes(AUTHORITY_REASON.actorMissing));

    const unknown = evaluate({
      request: request({
        actor: { ...AGENT, actorType: 'daemon' as unknown as ActorContext['actorType'] },
      }),
    });
    assert.equal(unknown.decision, 'DENY');
    assert.ok(unknown.reasonCodes.includes(AUTHORITY_REASON.actorTypeUnknown));
  });

  it('denies a suspended, expired or not-yet-valid envelope', () => {
    const cases: Array<[Partial<AuthorityEnvelope>, string]> = [
      [{ status: 'suspended' }, AUTHORITY_REASON.envelopeSuspended],
      [{ status: 'expired' }, AUTHORITY_REASON.envelopeExpired],
      [{ validUntil: '2026-01-01T00:00:00.000Z' }, AUTHORITY_REASON.envelopeExpired],
      [{ validFrom: '2027-01-01T00:00:00.000Z' }, AUTHORITY_REASON.envelopeNotYetValid],
      // An UNREADABLE bound is now reported as `envelope.malformed` rather than
      // as expired or not-yet-valid, and that is the more honest code: nobody
      // established that this envelope had expired — its window could not be
      // read at all. The refusal is unchanged; only the reason is sharper.
      [{ validUntil: 'nonsense' }, AUTHORITY_REASON.envelopeMalformed],
      [{ validFrom: 'nonsense' }, AUTHORITY_REASON.envelopeMalformed],
    ];
    for (const [patch, code] of cases) {
      const decision = evaluate({ envelopes: source(envelope(patch)) });
      assert.equal(decision.decision, 'DENY', JSON.stringify(patch));
      assert.ok(decision.reasonCodes.includes(code as never), JSON.stringify(patch));
    }
  });

  it('never returns ALLOW from any failure path', () => {
    // The single property the whole file is really asserting, stated once
    // directly rather than left implicit across thirty cases.
    const broken: AuthorityEvaluationInput[] = [
      { request: request(), nowIso: NOW },
      { request: request(), envelopes: source(undefined), nowIso: NOW },
      { request: request({ actionId: '' }), envelopes: source(envelope()), nowIso: NOW },
      { request: request(), envelopes: source(envelope()), nowIso: '' },
      {
        request: request({ organizationId: OTHER_ORG }),
        envelopes: source(envelope()),
        nowIso: NOW,
      },
    ];
    for (const input of broken) {
      assert.notEqual(evaluateAuthority(input).decision, 'ALLOW');
    }
  });
});

// ── §10.9 — cross-tenant denial ─────────────────────────────────────────────

describe('§10.9 — a cross-tenant action is refused', () => {
  it('denies when the resource belongs to another organization', () => {
    const decision = evaluate({ request: request({ organizationId: OTHER_ORG }) });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.tenantMismatch));
  });

  it('refuses before consulting a single permission', () => {
    // An actor's own grants must never influence what happens to somebody
    // else's data — so the permission step must not have run.
    const decision = evaluate({
      request: request({
        organizationId: OTHER_ORG,
        actor: { ...AGENT, permissions: ['*', 'agent.tool.call', 'platform.superuser'] },
      }),
    });
    assert.equal(decision.decision, 'DENY');
    assert.deepEqual(decision.matchedPermissions, []);
    assert.equal(decision.evidence.evaluatedSteps.includes('permission'), false);
  });

  it('denies an envelope issued by another organization', () => {
    const decision = evaluate({
      envelopes: source(envelope({ organizationId: OTHER_ORG })),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeTenantMismatch));
  });

  it('denies an envelope issued to a different actor', () => {
    const decision = evaluate({
      envelopes: source(envelope({ subjectActorId: 'agent-other' })),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeSubjectMismatch));
  });

  it('denies a missing organization on either side', () => {
    const noRequestOrg = evaluate({ request: request({ organizationId: '' }) });
    assert.equal(noRequestOrg.decision, 'DENY');
    assert.ok(noRequestOrg.reasonCodes.includes(AUTHORITY_REASON.tenantMissing));

    const noActorOrg = evaluate({
      request: request({ actor: { ...AGENT, organizationId: '' } }),
    });
    assert.equal(noActorOrg.decision, 'DENY');
    assert.ok(noActorOrg.reasonCodes.includes(AUTHORITY_REASON.tenantMissing));
  });
});

// ── §10.10 — data, tool and budget restrictions bite ────────────────────────

describe('§10.10 — a data, tool or budget restriction forces deny or approval', () => {
  it('denies a tool outside the envelope', () => {
    const decision = evaluate({ request: request({ requestedTool: 'payments.charge' }) });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.toolOutOfScope));
  });

  it('denies data above the classification ceiling', () => {
    const decision = evaluate({ request: request({ dataClassification: 'restricted' }) });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.dataCeilingExceeded));
  });

  it('denies spend above the envelope ceiling', () => {
    const decision = evaluate({
      request: request({ estimatedCostMicroUsd: 5_000_001 }),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.budgetExceeded));
  });

  it('denies an unusable cost rather than letting it slip past the comparison', () => {
    // `NaN > limit` is false, so an uncomparable number would otherwise be the
    // cheapest way past a spend ceiling.
    //
    // The REASON is `request.malformed` rather than `budget.ceiling_exceeded`,
    // and the distinction is the correct one: a cost of NaN is not an action
    // that overspent, it is a caller that did not state a cost. The hardening
    // pass moved the refusal to where the fact is first read, which is earlier
    // than the ceiling comparison and more accurate about what went wrong. The
    // outcome — DENY, never ALLOW — is what the ceiling test below still pins.
    for (const cost of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const decision = evaluate({ request: request({ estimatedCostMicroUsd: cost }) });
      assert.equal(decision.decision, 'DENY', String(cost));
      assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.requestMalformed), String(cost));
    }
  });

  it('escalates to approval when cost raises the consequence level', () => {
    // A separate mechanism from the ceiling above, and both are wanted: the
    // ceiling is the tenant's own limit, the classification is the platform's.
    const decision = evaluate({
      request: request({ estimatedCostMicroUsd: 30_000_000 }),
      envelopes: source(envelope({ maxCostMicroUsd: 100_000_000 })),
    });
    assert.equal(decision.decision, 'REQUIRE_APPROVAL');
    assert.equal(decision.consequenceLevel, 'high');
  });

  it('lets a policy require approval without any envelope breach', () => {
    const decision = evaluate({
      policies: {
        constraints: () => [
          {
            policyId: 'p-review',
            effect: 'require_approval',
            reason: 'Tenant is under review.',
            actionTypes: ['*'],
          },
        ],
      },
    });
    assert.equal(decision.decision, 'REQUIRE_APPROVAL');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.policyRequiresApproval));
    assert.deepEqual(decision.matchedPolicies, ['p-review']);
  });

  it('lets a policy deny outright', () => {
    const decision = evaluate({
      policies: {
        constraints: () => [
          {
            policyId: 'p-halt',
            effect: 'deny',
            reason: 'Platform is halted.',
            actionTypes: ['*'],
          },
        ],
      },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.policyDeny));
  });
});

// ── §10.12 — structured, traceable evidence ─────────────────────────────────

describe('§10.12 — every decision produces structured traceable evidence', () => {
  it('carries reason codes rather than only prose', () => {
    const decision = evaluate({ request: request({ requestedTool: 'payments.charge' }) });
    assert.ok(decision.reasonCodes.length > 0);
    for (const code of decision.reasonCodes) assert.equal(typeof code, 'string');
    assert.equal(decision.reasonCodes.includes(AUTHORITY_REASON.toolOutOfScope), true);
  });

  it('carries the trace identity on every outcome', () => {
    const traced = request({ traceId: 'trace-9' });
    for (const input of [
      { request: traced },
      { request: { ...traced, requestedTool: 'payments.charge' } },
      { request: { ...traced, requestedEffect: 'external_effect' as const, reversible: false } },
    ]) {
      const decision = evaluate(input);
      assert.equal(decision.actionId, 'action-1');
      assert.equal(decision.correlationId, 'corr-1');
      assert.equal(decision.traceId, 'trace-9');
    }
  });

  it('names the envelope version it decided against', () => {
    const decision = evaluate();
    assert.equal(decision.evidence.envelopeVersion, 3);
    assert.equal(decision.evidence.envelopeConsequenceCeiling, 'high');
    assert.equal(decision.evidence.envelopeApprovalThreshold, 'high');
  });

  it('keeps evidence to bounded scalars and no caller payload', () => {
    // An evidence object that could carry an arbitrary payload becomes an
    // uncontrolled copy of tenant business data the first time it is convenient.
    const decision = evaluate({
      request: request({ attributes: { secret: 'do-not-copy' } }),
    });
    const serialized = JSON.stringify(decision.evidence);
    assert.equal(serialized.includes('do-not-copy'), false);
  });

  it('bounds the caller-safe reason text', () => {
    const decision = evaluate({
      envelopes: source(
        envelope({
          explicitDeny: [{ ruleId: 'c', actionTypes: ['*'], reason: 'x'.repeat(5000) }],
        }),
      ),
    });
    assert.ok(decision.reason.length <= 300);
  });
});

// ── Consequence classification is deterministic ─────────────────────────────

describe('consequence classification is deterministic and only ever raises', () => {
  it('computes the same level for the same request every time', () => {
    const sample = request({ requestedEffect: 'delete' });
    const levels = new Set<ConsequenceLevel>();
    for (let i = 0; i < 50; i += 1) levels.add(platformConsequenceFloor(sample));
    assert.deepEqual([...levels], ['high']);
  });

  it('applies the documented floors', () => {
    const at = (patch: Partial<ActionRequest>) => platformConsequenceFloor(request(patch));
    assert.equal(at({ requestedEffect: 'read' }), 'low');
    assert.equal(at({ requestedEffect: 'write' }), 'medium');
    assert.equal(at({ requestedEffect: 'delete' }), 'high');
    assert.equal(at({ requestedEffect: 'external_effect' }), 'high');
    assert.equal(at({ requestedEffect: 'authority_change' }), 'critical');
    assert.equal(at({ dataClassification: 'confidential' }), 'medium');
    assert.equal(at({ dataClassification: 'restricted' }), 'high');
    assert.equal(at({ requestedEffect: 'write', reversible: false }), 'high');
    assert.equal(at({ estimatedCostMicroUsd: 1_000_000 }), 'medium');
    assert.equal(at({ estimatedCostMicroUsd: 25_000_000 }), 'high');
    assert.equal(at({ estimatedCostMicroUsd: 250_000_000 }), 'critical');
  });

  it('treats an unusable declared cost as critical, not as free', () => {
    assert.equal(platformConsequenceFloor(request({ estimatedCostMicroUsd: Number.NaN })), 'critical');
    assert.equal(platformConsequenceFloor(request({ estimatedCostMicroUsd: -5 })), 'critical');
  });

  it('lets a subsystem raise a classification but never lower one', () => {
    const raised = evaluate({
      request: request({ requestedEffect: 'read' }),
      consequence: { classify: () => 'high' },
    });
    assert.equal(raised.consequenceLevel, 'high');
    assert.equal(raised.decision, 'REQUIRE_APPROVAL');

    const lowered = evaluate({
      request: request({ requestedEffect: 'delete' }),
      consequence: { classify: () => 'low' },
    });
    assert.equal(lowered.consequenceLevel, 'high');
  });

  it('treats a classifier that threw as critical rather than as silent', () => {
    const decision = evaluate({
      consequence: { classify: () => { throw new Error('classifier down'); } },
    });
    assert.equal(decision.consequenceLevel, 'critical');
    assert.equal(decision.decision, 'DENY');
  });

  it('is decided by rules alone — the same input never varies', () => {
    // The literal reading of BP-001 §4.4: the enforced result must be
    // deterministic from persisted rules and context. Running the FULL
    // evaluator repeatedly and comparing the whole decision asserts that
    // nothing in the path reads a clock, a random source or ambient state.
    const first = JSON.stringify(evaluate());
    for (let i = 0; i < 25; i += 1) assert.equal(JSON.stringify(evaluate()), first);
  });
});
