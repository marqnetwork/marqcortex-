/**
 * BP-001 hardening — malformed authorization facts, on purpose.
 *
 * THE COMPANION SUITE TO `authorityEvaluator.test.ts`, AND A DIFFERENT KIND OF
 * TEST. That file drives the evaluator with well-formed inputs and asserts the
 * rules. This one drives it with inputs the type system says cannot exist, and
 * asserts a single property:
 *
 *   A FACT THAT CANNOT BE READ NEVER PRODUCES AN ALLOW, AND NEVER THROWS.
 *
 * WHY IT IS WORTH A FILE OF ITS OWN. Every value the evaluator weighs arrives
 * across a port that a subsystem implements. `ConsequenceLevel` does not exist
 * at runtime; nothing stops a classifier returning `"catastrophic"`, an
 * envelope source returning `status: "zombie"`, or a policy source returning
 * `effect: "DENY"` in the wrong case. A compile-time union is a promise the
 * caller makes, and an authorization boundary cannot be built on a promise.
 *
 * EVERY CASE HERE FAILED BEFORE THE GUARDS EXISTED. This is not defensive
 * programming against hypotheticals — the unhardened evaluator was probed with
 * exactly these inputs and returned ALLOW for eight of them and crashed on two
 * more. The mechanism was always the same: a rank lookup that misses yields
 * `undefined`, and `undefined > 0` and `undefined >= 0` are both FALSE, so an
 * unreadable value LOST every comparison that was supposed to stop it. An
 * invalid level did not exceed a ceiling. An invalid ceiling bounded nothing.
 * An invalid threshold was never reached. `undefined` on either side of `>` is
 * the most dangerous value an authorization system can hold, because it makes
 * every question answer "no".
 *
 * `as never` / `as unknown as T` appear throughout, and that is the point of
 * the file rather than a smell: the casts are how a runtime value that the type
 * system forbids gets into the evaluator, which is precisely the situation a
 * real misbehaving subsystem creates.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTHORITY_REASON,
  evaluateAuthority,
  type ActionRequest,
  type ActorContext,
  type AuthorityEnvelope,
  type AuthorityEvaluationInput,
} from '../index.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-18T12:00:00.000Z';

const AGENT: ActorContext = {
  actorId: 'agent-research',
  actorType: 'ai_agent',
  organizationId: ORG,
  roles: [],
  permissions: ['agent.tool.call'],
  membershipVerified: true,
};

function envelope(overrides: Record<string, unknown> = {}): AuthorityEnvelope {
  return {
    envelopeId: 'env-agent-research',
    version: 1,
    organizationId: ORG,
    subjectActorId: AGENT.actorId,
    subjectActorType: 'ai_agent',
    status: 'active',
    allowedActionTypes: ['agent.tool.call'],
    allowedResourceTypes: ['agent.tool'],
    allowedTools: ['crm.lookup'],
    dataClassificationCeiling: 'confidential',
    consequenceCeiling: 'critical',
    approvalThreshold: undefined,
    maxCostMicroUsd: 5_000_000,
    explicitDeny: [],
    ...overrides,
  } as unknown as AuthorityEnvelope;
}

function request(overrides: Record<string, unknown> = {}): ActionRequest {
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
  } as unknown as ActionRequest;
}

function evaluate(overrides: Partial<AuthorityEvaluationInput> = {}) {
  return evaluateAuthority({
    request: request(),
    envelopes: { resolve: () => envelope() },
    requiredPermission: 'agent.tool.call',
    nowIso: NOW,
    ...overrides,
  });
}

/**
 * The baseline these cases mutate away from.
 *
 * Asserted first, and not as a formality: every case below claims that ONE
 * malformed field turned an allow into a refusal. That claim is worthless
 * unless the unmutated fixture actually allows.
 */
describe('the adversarial fixture allows when nothing is malformed', () => {
  it('is an ALLOW before any field is corrupted', () => {
    assert.equal(evaluate().decision, 'ALLOW');
  });
});

// ── The consequence axis ────────────────────────────────────────────────────

describe('a malformed consequence level never becomes an allow', () => {
  it('denies when the subsystem classifier returns an unrecognised level', () => {
    // THE CASE THE REVIEW NAMED. Unguarded, `"catastrophic"` flowed into
    // `maxConsequence`, lost to the floor on an `undefined >= 0` comparison,
    // and the action was allowed at the floor's own level.
    const decision = evaluate({
      consequence: { classify: () => 'catastrophic' as never },
    });
    assert.equal(decision.decision, 'DENY');
    assert.equal(decision.consequenceLevel, 'critical');
  });

  it('denies for every shape of nonsense a classifier could return', () => {
    for (const value of ['', 'LOW', 'Low', 'severe', 0, 3, true, null, {}, []] as const) {
      const decision = evaluate({
        consequence: { classify: () => value as never },
      });
      assert.notEqual(decision.decision, 'ALLOW', JSON.stringify(value));
    }
  });

  it('denies an unrecognised envelope consequence ceiling', () => {
    // An unreadable ceiling bounds NOTHING. Unguarded, `exceedsConsequence`
    // compared against `undefined` and answered "does not exceed" for every
    // level including `critical`.
    const decision = evaluate({
      request: request({ requestedEffect: 'authority_change' }),
      envelopes: { resolve: () => envelope({ consequenceCeiling: 'nonsense' }) },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies an unrecognised approval threshold rather than skipping approval', () => {
    // The quietest failure of the set: an unreadable threshold is never
    // "reached", so the human step was skipped and the action ran unattended.
    const decision = evaluate({
      request: request({ requestedEffect: 'delete' }),
      envelopes: { resolve: () => envelope({ approvalThreshold: 'sometimes' }) },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies an unrecognised requested effect', () => {
    const decision = evaluate({ request: request({ requestedEffect: 'obliterate' }) });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.requestMalformed));
  });
});

// ── The data axis ───────────────────────────────────────────────────────────

describe('a malformed data classification never becomes an allow', () => {
  it('denies an unrecognised request data classification', () => {
    const decision = evaluate({ request: request({ dataClassification: 'ultra' }) });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.requestMalformed));
  });

  it('denies an unrecognised envelope data ceiling', () => {
    const decision = evaluate({
      request: request({ dataClassification: 'restricted' }),
      envelopes: { resolve: () => envelope({ dataClassificationCeiling: 'nonsense' }) },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies a data classification of the wrong TYPE, not merely the wrong word', () => {
    for (const value of [null, undefined, 2, true, ['internal']] as const) {
      const decision = evaluate({ request: request({ dataClassification: value }) });
      assert.equal(decision.decision, 'DENY', JSON.stringify(value));
    }
  });
});

// ── The envelope's own structure ────────────────────────────────────────────

describe('a malformed envelope never becomes an allow', () => {
  it('denies an unrecognised envelope status instead of reading it as active', () => {
    // Unguarded, the status check asked only whether the value was
    // `'suspended'` or `'expired'`. Anything else — including `"zombie"` —
    // fell through as though the envelope were in force.
    const decision = evaluate({
      envelopes: { resolve: () => envelope({ status: 'zombie' }) },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies a scope that is a string rather than an array', () => {
    // PRIVILEGE ESCALATION BY PUNCTUATION. `String.prototype.includes` matches
    // substrings, so the scope `"crm.lookup,payments.charge"` admitted
    // `payments.charge` — a tool the envelope never listed as an entry.
    const decision = evaluate({
      request: request({ requestedTool: 'payments.charge' }),
      envelopes: {
        resolve: () => envelope({ allowedTools: 'crm.lookup,payments.charge' }),
      },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies every malformed scope array on every axis', () => {
    const malformed = ['*', 'agent.tool.call', null, undefined, 7, {}, [1, 2], ['ok', 3]];
    for (const value of malformed) {
      for (const field of ['allowedActionTypes', 'allowedResourceTypes', 'allowedTools']) {
        const decision = evaluate({
          envelopes: { resolve: () => envelope({ [field]: value }) },
        });
        assert.equal(
          decision.decision,
          'DENY',
          `${field} = ${JSON.stringify(value)}`,
        );
      }
    }
  });

  it('denies a cost limit that is NaN, Infinity or negative', () => {
    // A ceiling of NaN is not a high ceiling. It is NO ceiling: every
    // comparison against NaN is false, so `cost > limit` never fired, while the
    // record still showed a configured limit.
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      const decision = evaluate({
        request: request({ estimatedCostMicroUsd: 4_000_000 }),
        envelopes: { resolve: () => envelope({ maxCostMicroUsd: limit }) },
      });
      assert.equal(decision.decision, 'DENY', String(limit));
      assert.ok(
        decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed),
        String(limit),
      );
    }
  });

  it('denies a cost limit that is not a number at all', () => {
    for (const limit of ['5000000', null, {}, []] as const) {
      const decision = evaluate({
        envelopes: { resolve: () => envelope({ maxCostMicroUsd: limit }) },
      });
      assert.equal(decision.decision, 'DENY', JSON.stringify(limit));
    }
  });

  it('denies an envelope missing its own identity', () => {
    for (const patch of [
      { envelopeId: '' },
      { envelopeId: null },
      { organizationId: '' },
      { subjectActorId: '  ' },
    ]) {
      const decision = evaluate({ envelopes: { resolve: () => envelope(patch) } });
      assert.equal(decision.decision, 'DENY', JSON.stringify(patch));
    }
  });

  it('denies a validity window that is not a string', () => {
    for (const patch of [{ validFrom: 12345 }, { validUntil: 12345 }, { validUntil: {} }]) {
      const decision = evaluate({ envelopes: { resolve: () => envelope(patch) } });
      assert.equal(decision.decision, 'DENY', JSON.stringify(patch));
    }
  });
});

// ── Explicit deny rules ─────────────────────────────────────────────────────

describe('a malformed explicit deny denies, and never silently skips', () => {
  it('denies when the deny list is not an array, instead of throwing', () => {
    // Unguarded this threw `rules.find is not a function` — an uncaught
    // exception out of an authorization boundary, which is a different failure
    // from a refusal and a worse one: the caller decides what it means.
    const decision = evaluate({
      envelopes: { resolve: () => envelope({ explicitDeny: 'deny-everything' }) },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies a rule whose action scope is not an array', () => {
    // The dangerous reading would be "this rule is unparseable, so it does not
    // match, so continue". A containment rule that can be voided by corrupting
    // it is not containment.
    const decision = evaluate({
      envelopes: {
        resolve: () =>
          envelope({
            explicitDeny: [{ ruleId: 'r1', actionTypes: 'agent.tool.call', reason: 'contained' }],
          }),
      },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });

  it('denies every malformed rule shape', () => {
    const malformed = [
      null,
      'a rule',
      42,
      {},
      { ruleId: 'r' },
      { ruleId: '', actionTypes: ['*'], reason: 'x' },
      { ruleId: 'r', actionTypes: ['*'] },
      { ruleId: 'r', actionTypes: ['*'], reason: 7 },
      { ruleId: 'r', actionTypes: ['*'], reason: 'x', resourceTypes: 'agent.tool' },
      { ruleId: 'r', actionTypes: ['*'], reason: 'x', tools: 'crm.lookup' },
    ];
    for (const rule of malformed) {
      const decision = evaluate({
        envelopes: { resolve: () => envelope({ explicitDeny: [rule] }) },
      });
      assert.equal(decision.decision, 'DENY', JSON.stringify(rule));
    }
  });

  it('denies when one rule among several is unreadable', () => {
    // A partially-readable deny list is not a deny list that can be applied in
    // part. The whole envelope is refused rather than enforcing the rules that
    // happened to parse.
    const decision = evaluate({
      envelopes: {
        resolve: () =>
          envelope({
            explicitDeny: [
              { ruleId: 'good', actionTypes: ['something.else'], reason: 'fine' },
              { ruleId: 'bad', actionTypes: null, reason: 'unreadable' },
            ],
          }),
      },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.envelopeMalformed));
  });
});

// ── Policy constraints ──────────────────────────────────────────────────────

describe('a malformed policy constraint denies, and never becomes an allow', () => {
  it('denies an effect in the wrong case rather than ignoring the constraint', () => {
    // `"DENY"` matched neither `'deny'` nor `'require_approval'`, so a policy
    // that meant to REFUSE was dropped and the action was allowed. A deny that
    // can be misspelled into an allow is not a deny.
    const decision = evaluate({
      policies: {
        constraints: () => [
          { policyId: 'p-halt', effect: 'DENY' as never, reason: 'halted', actionTypes: ['*'] },
        ],
      },
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.policyDeny));
    assert.ok(decision.matchedPolicies.includes(AUTHORITY_REASON.policyMalformed));
  });

  it('denies when the policy source returns something that is not an array', () => {
    // Unguarded this threw `constraints.filter is not a function`.
    for (const value of ['nope', 42, {}, null] as const) {
      const decision = evaluate({
        policies: { constraints: () => value as never },
      });
      assert.equal(decision.decision, 'DENY', JSON.stringify(value));
      assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.policyDeny));
    }
  });

  it('denies every malformed constraint shape', () => {
    const malformed = [
      null,
      'allow',
      { effect: 'allow', actionTypes: ['*'] },
      { policyId: '', effect: 'allow', reason: 'x', actionTypes: ['*'] },
      { policyId: 'p', effect: 'permit', reason: 'x', actionTypes: ['*'] },
      { policyId: 'p', effect: 'allow', reason: 'x', actionTypes: '*' },
      { policyId: 'p', effect: null, reason: 'x', actionTypes: ['*'] },
    ];
    for (const constraint of malformed) {
      const decision = evaluate({
        policies: { constraints: () => [constraint] as never },
      });
      assert.equal(decision.decision, 'DENY', JSON.stringify(constraint));
    }
  });

  it('denies when one constraint among several is unreadable', () => {
    // The permissive reading would drop the bad one and honour the good one.
    // But the dropped constraint is exactly as likely to have been the deny.
    const decision = evaluate({
      policies: {
        constraints: () =>
          [
            { policyId: 'p-ok', effect: 'allow', reason: 'fine', actionTypes: ['*'] },
            { policyId: 'p-bad', effect: 'DENY', reason: 'halted', actionTypes: ['*'] },
          ] as never,
      },
    });
    assert.equal(decision.decision, 'DENY');
  });
});

// ── The actor ───────────────────────────────────────────────────────────────

describe('a malformed actor never becomes an allow', () => {
  it('denies permissions supplied as a string, which substring-match', () => {
    // `'p'` is a substring of `'admin.superpower'`, so a required permission of
    // `'p'` was satisfied by an actor who held no list at all.
    const decision = evaluate({
      request: request({ actor: { ...AGENT, permissions: 'agent.tool.call.extra' } }),
      requiredPermission: 'agent.tool.call',
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.actorMalformed));
  });

  it('denies malformed permission and role lists of every shape', () => {
    for (const value of [null, undefined, 'x', 7, {}, [1], ['ok', null]] as const) {
      const byPermissions = evaluate({
        request: request({ actor: { ...AGENT, permissions: value } }),
      });
      assert.equal(byPermissions.decision, 'DENY', `permissions ${JSON.stringify(value)}`);

      const byRoles = evaluate({
        request: request({ actor: { ...AGENT, roles: value } }),
      });
      assert.equal(byRoles.decision, 'DENY', `roles ${JSON.stringify(value)}`);
    }
  });

  it('denies a membership flag that is not a boolean', () => {
    // A truthy string read as "verified" and sailed through the TENANT step,
    // which runs before the actor step would have caught it. The readability
    // check therefore sits ahead of the ordered steps, not inside them.
    for (const value of ['true', 'yes', 1, {}, null, undefined] as const) {
      const decision = evaluate({
        request: request({
          actor: { ...AGENT, membershipVerified: value },
          requestedEffect: 'write',
        }),
      });
      assert.equal(decision.decision, 'DENY', JSON.stringify(value));
      assert.ok(
        decision.reasonCodes.includes(AUTHORITY_REASON.actorMalformed),
        JSON.stringify(value),
      );
    }
  });

  it('denies an unrecognised actor type', () => {
    const decision = evaluate({
      request: request({ actor: { ...AGENT, actorType: 'daemon' } }),
    });
    assert.equal(decision.decision, 'DENY');
    assert.ok(decision.reasonCodes.includes(AUTHORITY_REASON.actorTypeUnknown));
  });
});

// ── The property, stated once over everything ───────────────────────────────

describe('the evaluator never throws and never allows on a malformed fact', () => {
  /** One mutation per entry, applied to an otherwise-allowing request. */
  const mutations: ReadonlyArray<readonly [string, Partial<AuthorityEvaluationInput>]> = [
    ['effect', { request: request({ requestedEffect: 'obliterate' }) }],
    ['data', { request: request({ dataClassification: 'ultra' }) }],
    ['cost', { request: request({ estimatedCostMicroUsd: Number.NaN }) }],
    ['tool type', { request: request({ requestedTool: 42 }) }],
    ['actor type', { request: request({ actor: { ...AGENT, actorType: 'daemon' } }) }],
    ['permissions', { request: request({ actor: { ...AGENT, permissions: 'x' } }) }],
    ['membership', { request: request({ actor: { ...AGENT, membershipVerified: 'yes' } }) }],
    ['actor missing', { request: request({ actor: undefined }) }],
    ['request null', { request: null as never }],
    ['status', { envelopes: { resolve: () => envelope({ status: 'zombie' }) } }],
    ['ceiling', { envelopes: { resolve: () => envelope({ consequenceCeiling: 'x' }) } }],
    ['data ceiling', { envelopes: { resolve: () => envelope({ dataClassificationCeiling: 'x' }) } }],
    ['threshold', { envelopes: { resolve: () => envelope({ approvalThreshold: 'x' }) } }],
    ['scope string', { envelopes: { resolve: () => envelope({ allowedTools: 'a,b' }) } }],
    ['scope null', { envelopes: { resolve: () => envelope({ allowedActionTypes: null }) } }],
    ['cost limit', { envelopes: { resolve: () => envelope({ maxCostMicroUsd: Number.NaN }) } }],
    ['deny list', { envelopes: { resolve: () => envelope({ explicitDeny: 'all' }) } }],
    ['deny rule', { envelopes: { resolve: () => envelope({ explicitDeny: [null] }) } }],
    ['envelope null', { envelopes: { resolve: () => null as never } }],
    ['envelope string', { envelopes: { resolve: () => 'envelope' as never } }],
    ['policy shape', { policies: { constraints: () => 'nope' as never } }],
    ['policy effect', {
      policies: {
        constraints: () => [{ policyId: 'p', effect: 'DENY', reason: 'r', actionTypes: ['*'] }] as never,
      },
    }],
    ['classifier value', { consequence: { classify: () => 'catastrophic' as never } }],
    ['classifier type', { consequence: { classify: () => 99 as never } }],
    ['classifier throws', { consequence: { classify: () => { throw new Error('down'); } } }],
    ['envelope throws', { envelopes: { resolve: () => { throw new Error('down'); } } }],
    ['policy throws', { policies: { constraints: () => { throw new Error('down'); } } }],
    ['nowIso type', { nowIso: 99 as never }],
    ['nowIso null', { nowIso: null as never }],
  ];

  for (const [name, mutation] of mutations) {
    it(`refuses without throwing: ${name}`, () => {
      let decision;
      assert.doesNotThrow(() => {
        decision = evaluate(mutation);
      }, `malformed ${name} threw out of the evaluator`);
      assert.notEqual(decision!.decision, 'ALLOW', `malformed ${name} was allowed`);
      // A refusal is only useful if it says which fact could not be read.
      assert.ok(decision!.reasonCodes.length > 0, `malformed ${name} gave no reason code`);
    });
  }

  it('stays deterministic on malformed input', () => {
    // A guard that branched on anything ambient would make the same corrupt
    // envelope refuse twice and allow the third time.
    for (const [name, mutation] of mutations) {
      const first = JSON.stringify(evaluate(mutation));
      for (let i = 0; i < 5; i += 1) {
        assert.equal(JSON.stringify(evaluate(mutation)), first, name);
      }
    }
  });
});
