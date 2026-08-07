/**
 * Intelligent reuse and cache engine (AI-01 Batch 3B, Part 6B).
 *
 * The correctness suite: exact identity, the eligibility gate's nine dimensions,
 * freshness, invalidation, integrity, semantic discovery and storage. The
 * adversarial and accounting cases live in `reuseAdversarial.test.ts`, because
 * the questions "does this work" and "can this be made to lie" want to be read
 * separately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReuseIdentity,
  reusableResultIdFor,
  sealSemanticMetadata,
} from '../reuse/identity/reuseIdentity.ts';
import { sealReusableResult } from '../reuse/identity/sealReusableResult.ts';
import { evaluateReuseEligibility } from '../reuse/engine/eligibilityGate.ts';
import { resolveReuse } from '../reuse/engine/reuseDecisionPipeline.ts';
import { invalidateReusableResults } from '../reuse/engine/invalidationEngine.ts';
import { createInMemoryReusableResultStore } from '../reuse/persistence/ports.ts';
import { createDeclaredFeatureDiscovery } from '../reuse/discovery/declaredFeatureDiscovery.ts';
import { declaredFeatureSimilarity } from '../reuse/discovery/semanticDiscoveryPort.ts';
import { sealReusableOutput } from '../reuse/contracts/output.ts';
import { isReuseError } from '../reuse/contracts/failures.ts';
import { normalizeDependencies } from '../reuse/contracts/dependency.ts';
import type { ReusableResultRecord } from '../reuse/contracts/reusableResult.ts';
import type { ReuseMissReason } from '../reuse/contracts/eligibility.ts';

import {
  CURRENT_DEPENDENCIES,
  DATA_DEPENDENCY,
  EVIDENCE_DEPENDENCY,
  HOUR,
  NOW,
  ORG,
  OTHER_ORG,
  TASK_IDENTITY,
  TASK_KIND,
  authority,
  freshness,
  identityInput,
  outputEnvelope,
  policy,
  posture,
  quality,
  record,
  request,
  version,
} from './reuseFixtures.ts';

/** Store a record and return the store, for the pipeline suites. */
async function storeWith(...records: readonly ReusableResultRecord[]) {
  const store = createInMemoryReusableResultStore();
  for (const entry of records) await store.put(entry);
  return store;
}

function missReasonOf(
  verdict: { readonly eligible: boolean; readonly missReason?: ReuseMissReason },
): ReuseMissReason | undefined {
  return verdict.eligible ? undefined : verdict.missReason;
}

// ── Exact identity ──────────────────────────────────────────────────────────

describe('Part 6B — exact reuse identity', () => {
  it('is deterministic: the same input produces the same key on every call', () => {
    const a = buildReuseIdentity(identityInput());
    const b = buildReuseIdentity(identityInput());
    assert.equal(a.exactReuseKey, b.exactReuseKey);
    assert.equal(a.reusableResultId, b.reusableResultId);
    assert.equal(a.taskFingerprint, b.taskFingerprint);
  });

  it('does not depend on the ORDER dependencies were declared in', () => {
    const forward = buildReuseIdentity(
      identityInput({
        dataDependencies: [
          DATA_DEPENDENCY,
          { kind: 'policy', key: 'retention', version: '3' },
        ],
      }),
    );
    const reversed = buildReuseIdentity(
      identityInput({
        dataDependencies: [
          { kind: 'policy', key: 'retention', version: '3' },
          DATA_DEPENDENCY,
        ],
      }),
    );
    assert.equal(forward.exactReuseKey, reversed.exactReuseKey);
  });

  it('derives the record id from the key, so one identity is one record', () => {
    const identity = buildReuseIdentity(identityInput());
    assert.equal(identity.reusableResultId, reusableResultIdFor(identity.exactReuseKey));
  });

  /**
   * THE CENTRAL PROPERTY. The same visible input under different tenant, policy,
   * workflow, agent, plan, quality or dependency state must not share an
   * identity. Each case changes exactly one field and asserts the key moved.
   */
  const dimensions: readonly (readonly [string, Parameters<typeof identityInput>[0]])[] = [
    ['tenant', { organizationId: OTHER_ORG }],
    ['workflow version', { workflowVersion: '5' }],
    ['agent version', { agentVersion: '12' }],
    ['plan digest', { workflowPlanDigest: 'plan_ffffffffffffffff' }],
    ['governance policy', { policyVersion: 'ai.policy.v8' }],
    ['optimization policy', { optimizationPolicyVersion: 'ai.optimization.v3' }],
    ['baseline policy', { baselinePolicyVersion: 'ai.baseline.v2' }],
    ['required quality', { quality: 'high' as const }],
    ['capability floor', { minimumCapabilityProfile: 'reasoning' as const }],
    ['task identity', { taskIdentity: 'wf_quote_review/node_other' }],
    ['deterministic input', { inputDigest: 'sha256:input_beta' }],
    ['evidence version', { evidenceDependencies: [{ ...EVIDENCE_DEPENDENCY, version: 'sha256:bb22' }] }],
    ['data version', { dataDependencies: [{ ...DATA_DEPENDENCY, version: '2026-09-01' }] }],
  ];

  const base = buildReuseIdentity(identityInput());
  for (const [label, override] of dimensions) {
    it(`produces a different identity when the ${label} changes`, () => {
      const changed = buildReuseIdentity(identityInput(override));
      assert.notEqual(
        changed.exactReuseKey,
        base.exactReuseKey,
        `changing the ${label} must not hit the same reusable result`,
      );
    });
  }

  it('refuses a dependency declared twice at two different versions', () => {
    assert.throws(
      () =>
        normalizeDependencies([
          { kind: 'policy', key: 'retention', version: '3' },
          { kind: 'policy', key: 'retention', version: '4' },
        ]),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
  });

  it('refuses an evidence dependency declared as data', () => {
    assert.throws(
      () => buildReuseIdentity(identityInput({ dataDependencies: [EVIDENCE_DEPENDENCY] })),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
  });
});

// ── The eligibility gate ────────────────────────────────────────────────────

describe('Part 6B — the eligibility gate', () => {
  it('admits a record that satisfies all nine dimensions', () => {
    const verdict = evaluateReuseEligibility(record(), request());
    assert.equal(verdict.eligible, true, JSON.stringify(verdict.checks.filter((c) => !c.satisfied)));
    assert.equal(verdict.checks.length, 9);
    assert.ok(verdict.evidenceDigest.length > 0);
  });

  it('evaluates every dimension even after one fails', () => {
    const verdict = evaluateReuseEligibility(record(), request({ posture: posture({ aiEnabled: false }) }));
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.checks.length, 9);
    // The full profile reaches the audit record, not only the first refusal.
    assert.ok(verdict.checks.some((check) => check.dimension === 'dependencies'));
  });

  const refusals: readonly (readonly [string, Parameters<typeof request>[0], ReuseMissReason])[] = [
    ['a different tenant', { organizationId: OTHER_ORG }, 'tenant_mismatch'],
    [
      'an unauthorized caller',
      { authority: authority({ callerAuthorized: false }) },
      'caller_not_authorized',
    ],
    [
      'a caller that named no authorization evidence',
      { authority: authority({ authorizationEvidenceId: '' }) },
      'evidence_unavailable',
    ],
    [
      'a workflow that is no longer permitted',
      { authority: authority({ workflowPermitted: false }) },
      'workflow_not_permitted',
    ],
    [
      'an agent that is no longer permitted',
      { authority: authority({ agentPermitted: false }) },
      'agent_not_permitted',
    ],
    [
      'an outstanding approval',
      { authority: authority({ approvalSatisfied: false }) },
      'approval_required',
    ],
    [
      'a certification that is no longer valid',
      { authority: authority({ certificationValid: false }) },
      'certification_invalid',
    ],
    ['the AI kill switch', { posture: posture({ aiEnabled: false }) }, 'ai_disabled'],
    ['reuse administratively off', { posture: posture({ reuseEnabled: false }) }, 'reuse_disabled'],
    [
      'a changed governance policy',
      { policy: policy({ policyVersion: 'ai.policy.v8' }) },
      'policy_version_incompatible',
    ],
    [
      'a changed optimisation policy',
      { policy: policy({ optimizationPolicyVersion: 'ai.optimization.v3' }) },
      'optimization_policy_incompatible',
    ],
    [
      'a changed baseline policy',
      { policy: policy({ baselinePolicyVersion: 'ai.baseline.v2' }) },
      'baseline_policy_incompatible',
    ],
    [
      'a raised quality contract',
      { quality: quality({ quality: 'critical', minimumCapabilityProfile: 'reasoning' }) },
      'quality_below_requirement',
    ],
    [
      'a raised capability floor',
      { quality: quality({ minimumCapabilityProfile: 'advanced_reasoning' }) },
      'capability_below_requirement',
    ],
    [
      'a changed workflow version',
      { version: version({ workflowVersion: '5' }) },
      'workflow_version_incompatible',
    ],
    [
      'a changed agent version',
      { version: version({ agentVersion: '12' }) },
      'agent_version_incompatible',
    ],
    [
      'a changed plan digest',
      { version: version({ workflowPlanDigest: 'plan_ffffffffffffffff' }) },
      'plan_digest_incompatible',
    ],
    [
      'a different declared task',
      { version: version({ taskIdentity: 'wf_quote_review/node_other' }) },
      'task_identity_mismatch',
    ],
    [
      'a changed certification identity',
      { version: version({ agentCertificationId: 'cert_2026_q3' }) },
      'certification_invalid',
    ],
    [
      'a changed evidence version',
      {
        currentDependencies: [
          { ...EVIDENCE_DEPENDENCY, version: 'sha256:bb22' },
          DATA_DEPENDENCY,
        ],
      },
      'dependency_changed',
    ],
    [
      'a changed data version',
      {
        currentDependencies: [EVIDENCE_DEPENDENCY, { ...DATA_DEPENDENCY, version: '2026-09-01' }],
      },
      'dependency_changed',
    ],
    ['a dependency the caller cannot see', { currentDependencies: [EVIDENCE_DEPENDENCY] }, 'dependency_missing'],
    [
      'an expired window',
      { freshness: freshness({ nowMs: NOW + 48 * HOUR }) },
      'expired',
    ],
    [
      'a caller demanding fresher than the record',
      { freshness: freshness({ maximumAgeMs: 60_000 }) },
      'freshness_policy_unsatisfied',
    ],
    [
      'a caller demanding an immutable result',
      { freshness: freshness({ requireImmutable: true }) },
      'freshness_policy_unsatisfied',
    ],
  ];

  for (const [label, override, expected] of refusals) {
    it(`refuses on ${label}`, () => {
      const verdict = evaluateReuseEligibility(record(), request(override));
      assert.equal(verdict.eligible, false, `${label} should not be eligible`);
      assert.equal(missReasonOf(verdict), expected);
    });
  }

  it('accepts a policy version the caller DECLARED compatible, and only that one', () => {
    const declared = evaluateReuseEligibility(
      record(),
      request({
        policy: policy({
          policyVersion: 'ai.policy.v8',
          compatiblePolicyVersions: ['ai.policy.v7'],
        }),
      }),
    );
    assert.equal(declared.eligible, true);

    // A NEWER stored version is not automatically compatible either. There is no
    // ordering rule, only a declared list.
    const newerStored = evaluateReuseEligibility(
      record({
        identity: buildReuseIdentity(identityInput({ policyVersion: 'ai.policy.v9' })),
        policyVersion: 'ai.policy.v9',
      }),
      request({
        identity: buildReuseIdentity(identityInput({ policyVersion: 'ai.policy.v9' })),
        policy: policy({ policyVersion: 'ai.policy.v8' }),
      }),
    );
    assert.equal(newerStored.eligible, false);
    assert.equal(missReasonOf(newerStored), 'policy_version_incompatible');
  });

  it('admits a HIGHER stored quality against a lower requirement', () => {
    const verdict = evaluateReuseEligibility(
      record({ qualityProfile: 'high', capabilityProfile: 'reasoning' }),
      request(),
    );
    assert.equal(verdict.eligible, true);
  });
});

// ── Integrity ───────────────────────────────────────────────────────────────

describe('Part 6B — integrity', () => {
  it('refuses a record whose output no longer matches its digest', () => {
    const tampered = { ...record(), output: sealReusableOutput(outputEnvelope({ fields: { summary: 'edited' } })) };
    const verdict = evaluateReuseEligibility(tampered, request());
    assert.equal(verdict.eligible, false);
    assert.equal(missReasonOf(verdict), 'output_digest_mismatch');
  });

  it('refuses a record missing its identity fields', () => {
    const partial = { ...record(), outputDigest: '' } as ReusableResultRecord;
    const verdict = evaluateReuseEligibility(partial, request());
    assert.equal(verdict.eligible, false);
    assert.equal(missReasonOf(verdict), 'record_incomplete');
  });

  it('refuses a record whose output envelope is malformed', () => {
    const malformed = {
      ...record(),
      output: { schema: 'quote.summary', schemaVersion: '2', fields: { bad: { nested: 1 } }, redactions: [] },
    } as unknown as ReusableResultRecord;
    const verdict = evaluateReuseEligibility(malformed, request());
    assert.equal(verdict.eligible, false);
    assert.equal(missReasonOf(verdict), 'record_malformed');
  });

  it('refuses a record whose reuse key disagrees with its own parts', () => {
    const inconsistent = { ...record(), exactReuseKey: 'aaaa:bbbb' };
    const verdict = evaluateReuseEligibility(inconsistent, request());
    assert.equal(verdict.eligible, false);
    assert.equal(missReasonOf(verdict), 'record_malformed');
  });

  it('refuses to seal an output carrying a credential-shaped field', () => {
    for (const field of ['apiKey', 'providerApiKey', 'sessionToken', 'systemPrompt', 'reasoning']) {
      assert.throws(
        () => sealReusableOutput(outputEnvelope({ fields: { [field]: 'x' } })),
        (error: unknown) => isReuseError(error) && error.failure === 'reusable_output_rejected',
        `${field} must be refused`,
      );
    }
  });

  it('digests an output independently of key order', () => {
    const a = sealReusableOutput(outputEnvelope({ fields: { alpha: 1, beta: 2 } }));
    const b = sealReusableOutput(outputEnvelope({ fields: { beta: 2, alpha: 1 } }));
    assert.deepEqual(Object.keys(a.fields), Object.keys(b.fields));
  });
});

// ── Freshness ───────────────────────────────────────────────────────────────

describe('Part 6B — freshness', () => {
  it('hits inside a valid TTL and misses once it closes', () => {
    const stored = record();
    assert.equal(evaluateReuseEligibility(stored, request({ freshness: freshness({ nowMs: NOW }) })).eligible, true);
    const expired = evaluateReuseEligibility(
      stored,
      request({ freshness: freshness({ nowMs: (stored.expiresAt ?? 0) + 1 }) }),
    );
    assert.equal(expired.eligible, false);
    assert.equal(missReasonOf(expired), 'expired');
  });

  it('treats an immutable record as never time-expired', () => {
    const immutable = record({ freshness: { policy: 'immutable' }, createdAt: NOW - 5_000 * HOUR });
    const verdict = evaluateReuseEligibility(
      immutable,
      request({ freshness: freshness({ nowMs: NOW }) }),
    );
    assert.equal(verdict.eligible, true);
    assert.equal(immutable.expiresAt, undefined);
  });

  it('binds a dependency-bound record to its dependencies rather than to a clock', () => {
    const bound = record({ freshness: { policy: 'dependency_bound' }, createdAt: NOW - 5_000 * HOUR });
    assert.equal(
      evaluateReuseEligibility(bound, request({ freshness: freshness({ nowMs: NOW }) })).eligible,
      true,
    );
    const moved = evaluateReuseEligibility(
      bound,
      request({
        currentDependencies: [{ ...EVIDENCE_DEPENDENCY, version: 'sha256:cc33' }, DATA_DEPENDENCY],
      }),
    );
    assert.equal(moved.eligible, false);
    assert.equal(missReasonOf(moved), 'dependency_changed');
  });

  it('refuses to seal a dependency-bound record with no dependencies', () => {
    assert.throws(
      () =>
        record({
          identity: buildReuseIdentity(
            identityInput({ evidenceDependencies: [], dataDependencies: [] }),
          ),
          freshness: { policy: 'dependency_bound' },
        }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
  });

  it('refuses a TTL policy with no TTL, and a TTL on a policy that takes none', () => {
    assert.throws(
      () => record({ freshness: { policy: 'ttl' } }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
    assert.throws(
      () => record({ freshness: { policy: 'immutable', ttlMs: 1_000 } }),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
  });

  /**
   * NO SLIDING EXPIRY. A popular wrong answer must not live forever, so a read
   * is asserted to leave the stored expiry exactly where it was — through the
   * store, not merely through the pure gate.
   */
  it('never extends an expiry during a read', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const originalExpiry = stored.expiresAt;

    for (let i = 0; i < 5; i += 1) {
      const resolution = await resolveReuse({ store, eligibility: request() });
      assert.equal(resolution.outcome, 'exact_hit');
    }

    const after = await store.getById(ORG, stored.reusableResultId);
    assert.equal(after?.expiresAt, originalExpiry);
    assert.equal(after?.validatedAt, stored.validatedAt);
    assert.equal(after?.recordVersion, 1);
  });
});

// ── The pipeline ────────────────────────────────────────────────────────────

describe('Part 6B — the reuse decision pipeline', () => {
  it('returns an exact hit with a validated prior output for Part 6A', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const resolution = await resolveReuse({ store, eligibility: request() });

    assert.equal(resolution.outcome, 'exact_hit');
    assert.equal(resolution.reuseType, 'exact');
    assert.equal(resolution.priorOutput?.artifactId, stored.reusableResultId);
    assert.equal(resolution.priorOutput?.digest, stored.outputDigest);
    assert.equal(resolution.priorOutput?.organizationId, ORG);
    // Set by the gate, never by a caller. That is the whole difference between
    // "the caller says this is valid" and "the gate established that it is".
    assert.equal(resolution.priorOutput?.contractValidated, true);
    assert.equal(resolution.attempts.exactHits, 1);
  });

  it('misses when nothing was ever stored, and takes the normal execution path', async () => {
    const store = createInMemoryReusableResultStore();
    const resolution = await resolveReuse({ store, eligibility: request() });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'no_candidate');
    assert.equal(resolution.priorOutput, undefined);
    assert.equal(resolution.record, undefined);
  });

  it('degrades to a miss when the store is unavailable, never to an outage', async () => {
    const broken = {
      ...createInMemoryReusableResultStore(),
      findExact() {
        return Promise.reject(new Error('storage unreachable'));
      },
    };
    const resolution = await resolveReuse({ store: broken, eligibility: request() });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'store_unavailable');
  });

  it('degrades to a miss when discovery is unavailable', async () => {
    const store = createInMemoryReusableResultStore();
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: { discover: () => Promise.reject(new Error('down')) },
      semantic: {
        semanticClass: 'quote_summary',
        features: ['quote'],
        semanticFingerprint: 'x',
        minimumSimilarity: 50,
        maximumCandidates: 5,
      },
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'discovery_unavailable');
  });
});

// ── Semantic discovery ──────────────────────────────────────────────────────

describe('Part 6B — semantic discovery', () => {
  const semanticFor = (features: readonly string[], minimumSimilarity = 40) => {
    const sealed = sealSemanticMetadata('quote_summary', features);
    return {
      semanticClass: sealed.semanticClass,
      features: sealed.features,
      semanticFingerprint: sealed.semanticFingerprint,
      minimumSimilarity,
      maximumCandidates: 5,
    };
  };

  /** A record under a DIFFERENT exact input, so exact reuse cannot answer it. */
  function similarRecord(overrides: Parameters<typeof record>[0] = {}): ReusableResultRecord {
    return record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:input_similar' })),
      ...overrides,
    });
  }

  it('scores declared label overlap deterministically', () => {
    assert.equal(declaredFeatureSimilarity(['a', 'b'], ['a', 'b']), 100);
    assert.equal(declaredFeatureSimilarity(['a', 'b'], ['b', 'a']), 100);
    assert.equal(declaredFeatureSimilarity(['a', 'b'], ['a', 'c']), 33);
    assert.equal(declaredFeatureSimilarity(['a'], ['z']), 0);
    assert.equal(declaredFeatureSimilarity([], ['a']), 0);
  });

  it('finds a candidate under a different input and admits it after the gate', async () => {
    const stored = similarRecord();
    const store = await storeWith(stored);
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: semanticFor(['quote', 'pricing', 'summary']),
    });

    assert.equal(resolution.outcome, 'semantic_hit');
    assert.equal(resolution.reuseType, 'semantic');
    assert.equal(resolution.record?.reusableResultId, stored.reusableResultId);
    assert.equal(resolution.attempts.semanticHits, 1);
  });

  /**
   * DISCOVERY IS NOT AUTHORIZATION. A port that returns a perfect score for a
   * record the gate refuses achieves nothing — and it is counted as a rejected
   * candidate rather than as a hit.
   */
  it('refuses a discovered candidate the gate rejects, however high it scored', async () => {
    const stale = similarRecord({ createdAt: NOW - 100 * HOUR, freshness: { policy: 'ttl', ttlMs: HOUR } });
    const store = await storeWith(stale);
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: {
        // A deliberately over-confident port. Its score is a suggestion and the
        // gate does not read it.
        discover: () =>
          Promise.resolve([
            {
              reusableResultId: stale.reusableResultId,
              similarity: 100,
              method: 'declared_fingerprint' as const,
              organizationId: ORG,
            },
          ]),
      },
      semantic: semanticFor(['quote']),
    });

    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'expired');
    assert.equal(resolution.attempts.semanticHits, 0);
    assert.equal(resolution.attempts.semanticRejections, 1);
  });

  it('refuses a similar candidate below the quality floor', async () => {
    const weak = similarRecord({ qualityProfile: 'best_effort', capabilityProfile: 'economy' });
    const store = await storeWith(weak);
    const resolution = await resolveReuse({
      store,
      eligibility: request({
        quality: quality({ quality: 'high', minimumCapabilityProfile: 'standard' }),
      }),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: semanticFor(['quote', 'pricing', 'summary']),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'quality_below_requirement');
  });

  it('refuses a similar candidate whose evidence has changed', async () => {
    const stored = similarRecord();
    const store = await storeWith(stored);
    const resolution = await resolveReuse({
      store,
      eligibility: request({
        currentDependencies: [{ ...EVIDENCE_DEPENDENCY, version: 'sha256:dd44' }, DATA_DEPENDENCY],
      }),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: semanticFor(['quote', 'pricing', 'summary']),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'dependency_changed');
  });

  it('chooses between several candidates deterministically', async () => {
    const older = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:cand_a' })),
      createdAt: NOW - 6 * HOUR,
    });
    const newer = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:cand_b' })),
      createdAt: NOW - 2 * HOUR,
    });

    // Both directions of insertion, both directions of discovery order.
    for (const order of [[older, newer], [newer, older]]) {
      const store = await storeWith(...order);
      const resolution = await resolveReuse({
        store,
        eligibility: request(),
        discovery: createDeclaredFeatureDiscovery({ store }),
        semantic: semanticFor(['quote', 'pricing', 'summary']),
      });
      assert.equal(resolution.outcome, 'semantic_hit');
      // Equal similarity; the newer validation time wins, every time.
      assert.equal(resolution.record?.reusableResultId, newer.reusableResultId);
    }
  });

  it('produces the normal execution path when no candidate clears the floor', async () => {
    const unrelated = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:unrelated' })),
      semantic: sealSemanticMetadata('quote_summary', ['logistics', 'shipping']),
    });
    const store = await storeWith(unrelated);
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: semanticFor(['quote', 'pricing', 'summary'], 60),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.attempts.semanticCandidates, 0);
  });

  it('never considers a record that declared no semantic metadata', async () => {
    const opaque = record({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:opaque' })),
    });
    // Rebuilt without semantic metadata.
    const stripped = sealReusableResult({
      identity: buildReuseIdentity(identityInput({ inputDigest: 'sha256:opaque' })),
      taskIdentity: TASK_IDENTITY,
      taskKind: TASK_KIND,
      qualityProfile: 'standard',
      capabilityProfile: 'standard',
      policyVersion: opaque.policyVersion,
      optimizationPolicyVersion: opaque.optimizationPolicyVersion,
      baselinePolicyVersion: opaque.baselinePolicyVersion,
      provenance: opaque.provenance,
      freshness: { policy: 'ttl', ttlMs: 24 * HOUR },
      createdAt: NOW - HOUR,
      output: outputEnvelope(),
      originalActualInputTokens: 1,
      originalActualOutputTokens: 1,
      originalActualCostMicroUsd: 1,
    });
    const store = await storeWith(stripped);
    const resolution = await resolveReuse({
      store,
      eligibility: request(),
      discovery: createDeclaredFeatureDiscovery({ store }),
      semantic: semanticFor(['quote', 'pricing', 'summary']),
    });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.attempts.semanticCandidates, 0);
  });
});

// ── Invalidation ────────────────────────────────────────────────────────────

describe('Part 6B — invalidation', () => {
  const command = (
    scope: Parameters<typeof invalidateReusableResults>[1]['scope'],
    reason: Parameters<typeof invalidateReusableResults>[1]['reason'],
  ) => ({ organizationId: ORG, scope, reason, at: NOW, requestedBy: 'user_operator' });

  it('invalidates one record by id, and the gate then refuses it', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const report = await invalidateReusableResults(
      store,
      command({ kind: 'result', reusableResultId: stored.reusableResultId }, 'explicit_result_invalidation'),
    );
    assert.equal(report.invalidated, 1);
    assert.deepEqual(report.invalidatedIds, [stored.reusableResultId]);

    const resolution = await resolveReuse({ store, eligibility: request() });
    assert.equal(resolution.outcome, 'miss');
    assert.equal(resolution.missReason, 'invalidated');
  });

  it('is idempotent: a second run stamps nothing and preserves the first reason', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const scope = { kind: 'result' as const, reusableResultId: stored.reusableResultId };

    const first = await invalidateReusableResults(store, command(scope, 'explicit_result_invalidation'));
    const second = await invalidateReusableResults(store, command(scope, 'policy_changed'));

    assert.equal(first.invalidated, 1);
    assert.equal(second.invalidated, 0);
    assert.equal(second.alreadyInvalidated, 1);

    const after = await store.getById(ORG, stored.reusableResultId);
    // The first stamp's reason survives. An audit trail that changed with every
    // repeated click would be a function of clicking, not of what happened.
    assert.equal(after?.invalidationReason, 'explicit_result_invalidation');
    assert.equal(after?.invalidatedAt, NOW);
  });

  it('invalidates by workflow, by version, by agent, by policy and by organization', async () => {
    const cases = [
      { scope: { kind: 'workflow' as const, workflowId: 'wf_quote_review' }, reason: 'workflow_definition_changed' as const },
      {
        scope: { kind: 'workflow' as const, workflowId: 'wf_quote_review', workflowVersion: '4' },
        reason: 'workflow_definition_changed' as const,
      },
      { scope: { kind: 'agent' as const, agentId: 'agent_reviewer' }, reason: 'agent_definition_changed' as const },
      {
        scope: { kind: 'agent' as const, agentId: 'agent_reviewer', agentVersion: '11' },
        reason: 'agent_definition_changed' as const,
      },
      { scope: { kind: 'policy' as const, policyVersion: 'ai.policy.v7' }, reason: 'policy_changed' as const },
      { scope: { kind: 'organization' as const }, reason: 'organization_invalidated' as const },
      {
        scope: {
          kind: 'dependency' as const,
          dependency: { kind: 'organization_data' as const, key: 'pricing_table' },
        },
        reason: 'dependency_changed' as const,
      },
    ];

    for (const testCase of cases) {
      const stored = record();
      const store = await storeWith(stored);
      const report = await invalidateReusableResults(store, command(testCase.scope, testCase.reason));
      assert.equal(report.invalidated, 1, `${testCase.scope.kind} should invalidate the record`);
      const resolution = await resolveReuse({ store, eligibility: request() });
      assert.equal(resolution.missReason, 'invalidated');
    }
  });

  it('leaves a record alone when the scope does not cover it', async () => {
    const stored = record();
    const store = await storeWith(stored);
    const report = await invalidateReusableResults(
      store,
      command({ kind: 'workflow', workflowId: 'wf_quote_review', workflowVersion: '9' }, 'workflow_definition_changed'),
    );
    assert.equal(report.invalidated, 0);
    assert.equal(report.scanned, 0);
    assert.equal((await resolveReuse({ store, eligibility: request() })).outcome, 'exact_hit');
  });

  it('invalidates a dependency at one version and leaves the others', async () => {
    const pinnedOld = record();
    const pinnedNew = record({
      identity: buildReuseIdentity(
        identityInput({ dataDependencies: [{ ...DATA_DEPENDENCY, version: '2026-09-01' }] }),
      ),
    });
    const store = await storeWith(pinnedOld, pinnedNew);

    const report = await invalidateReusableResults(
      store,
      command(
        {
          kind: 'dependency',
          dependency: { kind: 'organization_data', key: 'pricing_table' },
          version: '2026-08-01',
        },
        'dependency_changed',
      ),
    );
    assert.deepEqual(report.invalidatedIds, [pinnedOld.reusableResultId]);
    assert.equal((await store.getById(ORG, pinnedNew.reusableResultId))?.invalidatedAt, undefined);
  });

  it('keeps the record readable after invalidation, so the audit evidence survives', async () => {
    const stored = record();
    const store = await storeWith(stored);
    await invalidateReusableResults(
      store,
      command({ kind: 'organization' }, 'organization_invalidated'),
    );
    const after = await store.getById(ORG, stored.reusableResultId);
    assert.ok(after, 'an invalidated record must still be readable');
    assert.equal(after.originalActualCostMicroUsd, stored.originalActualCostMicroUsd);
    assert.equal(after.outputDigest, stored.outputDigest);
  });
});

// ── Storage and concurrency ─────────────────────────────────────────────────

describe('Part 6B — storage and concurrency', () => {
  it('stores insert-if-absent: the first write wins and the second is told so', async () => {
    const store = createInMemoryReusableResultStore();
    const first = record();
    const second = record({ output: outputEnvelope({ fields: { summary: 'a different answer' } }) });
    assert.equal(first.reusableResultId, second.reusableResultId, 'the identity must be the same');

    const a = await store.put(first);
    const b = await store.put(second);

    assert.equal(a.stored, true);
    assert.equal(b.stored, false);
    // The loser is handed the WINNER's record, not its own. Two isolates that
    // raced converge on one record with one id and one output digest.
    assert.equal(b.record.outputDigest, first.outputDigest);
    assert.notEqual(b.record.outputDigest, second.outputDigest);
  });

  it('never produces a blended record under concurrent population', async () => {
    const store = createInMemoryReusableResultStore();
    const candidates = [
      record({ output: outputEnvelope({ fields: { summary: 'answer one' } }) }),
      record({ output: outputEnvelope({ fields: { summary: 'answer two' } }) }),
      record({ output: outputEnvelope({ fields: { summary: 'answer three' } }) }),
    ];

    const outcomes = await Promise.all(candidates.map((candidate) => store.put(candidate)));
    assert.equal(outcomes.filter((outcome) => outcome.stored).length, 1);

    const stored = await store.getById(ORG, candidates[0].reusableResultId);
    assert.ok(stored);
    // Exactly one of the three, whole. Not a merge of any two.
    const digests = candidates.map((candidate) => candidate.outputDigest);
    assert.ok(digests.includes(stored.outputDigest));
    const verdict = evaluateReuseEligibility(stored, request());
    assert.equal(verdict.eligible, true, 'a raced record must still verify its own digest');
  });

  it('reads never observe a partially formed record', async () => {
    const store = createInMemoryReusableResultStore();
    const stored = record();
    const read = store.getById(ORG, stored.reusableResultId);
    const write = store.put(stored);
    const [before, outcome] = await Promise.all([read, write]);
    // Either nothing, or the whole thing. Never half.
    assert.ok(before === undefined || before.outputDigest === stored.outputDigest);
    assert.equal(outcome.stored, true);
  });

  it('refuses to store a record that is not whole', async () => {
    const store = createInMemoryReusableResultStore();
    const partial = { ...record(), taskFingerprint: '' } as ReusableResultRecord;
    await assert.rejects(
      async () => await store.put(partial),
      (error: unknown) => isReuseError(error) && error.failure === 'reuse_input_invalid',
    );
  });

  it('scopes every read, candidate scan and dependency listing to one tenant', async () => {
    const mine = record();
    const theirs = record({
      identity: buildReuseIdentity(identityInput({ organizationId: OTHER_ORG })),
    });
    const store = await storeWith(mine, theirs);

    assert.equal(await store.getById(ORG, theirs.reusableResultId), undefined);
    assert.equal(await store.findExact(ORG, theirs.exactReuseKey), undefined);
    assert.deepEqual(await store.findCandidates({ organizationId: ORG, taskIdentity: TASK_IDENTITY }), [mine]);
    assert.deepEqual(
      await store.listByDependency(ORG, { kind: 'organization_data', key: 'pricing_table' }),
      [mine],
    );
  });

  it('keeps the two dependency lists and the current set independent', () => {
    const verdict = evaluateReuseEligibility(
      record(),
      request({ currentDependencies: CURRENT_DEPENDENCIES }),
    );
    assert.equal(verdict.eligible, true);
    const dependencies = verdict.checks.find((check) => check.dimension === 'dependencies');
    assert.match(dependencies?.detail ?? '', /1 evidence and 1 data/);
  });
});
