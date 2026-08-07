/**
 * The reuse decision pipeline (AI-01 Batch 3B, Part 6B).
 *
 * ── WHERE THIS SITS ────────────────────────────────────────────────────────
 *
 *   AI call admission
 *         ↓
 *   Zero-LLM?                      ← Part 6A, and it runs first
 *         ↓ no
 *   EXACT REUSE?     → gate → VALID → reuse            ← here
 *         ↓ no
 *   SEMANTIC CANDIDATE? → gate → VALID → reuse         ← here
 *         ↓ no
 *   Context compression                                 ← Part 6A
 *         ↓
 *   Capability recommendation                           ← Part 6A
 *         ↓
 *   Control Plane                                       ← the only executor
 *
 * ── WHAT THIS FUNCTION RETURNS, AND WHAT IT DOES NOT DO ───────────────────
 *
 * It returns a RESOLUTION: a hit with a `ValidatedPriorOutput` the caller puts
 * on its `AiTaskDescriptor`, or a miss with a reason. It does not execute
 * anything, does not call a provider, does not hold a credential, does not
 * choose a model, does not touch the spend ledger, does not spend an approval
 * and does not build a savings record. On a hit the caller still runs
 * `compressCost`, which produces the one savings record through the one savings
 * ledger; on a miss the caller runs `compressCost` too, and pays for the call.
 *
 * The reuse layer's entire output is therefore an input to a component that
 * already existed — which is the reason it can be added without a second
 * accounting path and without a second execution path.
 *
 * ── EXACT BEFORE SEMANTIC, ALWAYS ──────────────────────────────────────────
 *
 * Exact identity is a proof; semantic similarity is a suggestion. Running
 * discovery first would mean a suggestion could win against a proof of the same
 * work under the same conditions, and the tie-break would be a scoring function.
 * So exact runs first, and semantic runs only when exact produced nothing —
 * which also makes "the same avoided call recorded as both exact and semantic"
 * structurally impossible rather than merely refused downstream.
 *
 * ── THE GATE IS THE ONLY DOOR ──────────────────────────────────────────────
 *
 * Both paths converge on `evaluateReuseEligibility`. There is no branch that
 * reaches a hit without an eligible verdict, and no argument that relaxes it.
 * A semantic candidate is reloaded BY ID from the tenant-scoped store before it
 * is evaluated, so a discovery port that returned another tenant's id, a
 * fabricated id or a fabricated similarity achieves nothing.
 *
 * ── A COLD OR BROKEN CACHE IS NOT AN OUTAGE ────────────────────────────────
 *
 * Every store and discovery call is wrapped. A throw becomes `store_unavailable`
 * or `discovery_unavailable` and the caller proceeds through Part 6A to the
 * Control Plane. The fallback is a completely working platform that merely costs
 * money, and taking the platform down to protect a cost optimisation would be a
 * worse trade than any hit rate could justify.
 */

import type { ValidatedPriorOutput } from '../../optimization/contracts/task.ts';
import type {
  ReuseEligibilityRequest,
  ReuseEligibilityVerdict,
  ReuseMissReason,
} from '../contracts/eligibility.ts';
import type { ReusableResultRecord } from '../contracts/reusableResult.ts';
import type { ReusableResultStore } from '../persistence/ports.ts';
import type {
  SemanticCandidate,
  SemanticReuseDiscoveryPort,
} from '../discovery/semanticDiscoveryPort.ts';
import { evaluateReuseEligibility } from './eligibilityGate.ts';
import type { ReuseType } from '../accounting/avoidedCallLedger.ts';

export type ReuseOutcome = 'exact_hit' | 'semantic_hit' | 'miss';

export interface ReuseSemanticRequest {
  readonly semanticClass: string;
  readonly features: readonly string[];
  readonly semanticFingerprint: string;
  /** 0–100. A candidate below this is not returned by discovery. */
  readonly minimumSimilarity: number;
  /** Candidates the gate will be asked to evaluate, at most. */
  readonly maximumCandidates: number;
}

export interface ReuseResolutionInput {
  readonly store: ReusableResultStore;
  readonly eligibility: ReuseEligibilityRequest;
  /** Absent disables semantic discovery for this request. Exact still runs. */
  readonly semantic?: ReuseSemanticRequest;
  /** Absent disables semantic discovery for this deployment. */
  readonly discovery?: SemanticReuseDiscoveryPort;
}

/** One candidate the gate looked at, and what it decided. Audit evidence. */
export interface ReuseCandidateEvaluation {
  readonly reusableResultId: string;
  readonly source: 'exact' | 'semantic';
  readonly similarity?: number;
  readonly verdict: ReuseEligibilityVerdict;
}

export interface ReuseResolution {
  readonly outcome: ReuseOutcome;
  readonly taskId: string;
  readonly organizationId: string;
  readonly reuseType?: ReuseType;
  /** The record that answered it. Present only on a hit. */
  readonly record?: ReusableResultRecord;
  /**
   * The Part 6A seam. Present only on a hit.
   *
   * `contractValidated: true` is set HERE, by the gate's verdict, and never by a
   * caller — which is the difference between "the caller says this is still
   * valid" and "the eligibility gate established that it is".
   */
  readonly priorOutput?: ValidatedPriorOutput;
  /** Present only on a miss. */
  readonly missReason?: ReuseMissReason;
  /** The gate's verdict for the record that was used, on a hit. */
  readonly verdict?: ReuseEligibilityVerdict;
  /** Every candidate considered, in the order considered. */
  readonly evaluations: readonly ReuseCandidateEvaluation[];
  readonly attempts: ReuseAttemptCounters;
}

/** What this one resolution did. Folded into the economics by `metrics/`. */
export interface ReuseAttemptCounters {
  readonly exactAttempts: number;
  readonly exactHits: number;
  readonly semanticCandidates: number;
  readonly semanticHits: number;
  readonly semanticRejections: number;
  /** Miss reason → count, across every candidate the gate refused. */
  readonly rejectionReasons: Readonly<Record<string, number>>;
}

function priorOutputFor(record: ReusableResultRecord): ValidatedPriorOutput {
  return {
    artifactId: record.reusableResultId,
    digest: record.outputDigest,
    organizationId: record.organizationId,
    // Established by the gate, not asserted by a caller.
    contractValidated: true,
    quality: record.qualityProfile,
  };
}

/**
 * Resolve reuse for one potential AI call.
 *
 * Never throws. Every failure mode is a miss with a reason, because the caller's
 * correct response to all of them is identical: continue to Part 6A and the
 * Control Plane.
 */
export async function resolveReuse(input: ReuseResolutionInput): Promise<ReuseResolution> {
  const request = input.eligibility;
  const evaluations: ReuseCandidateEvaluation[] = [];
  const rejectionReasons: Record<string, number> = {};

  let exactAttempts = 0;
  let exactHits = 0;
  let semanticCandidates = 0;
  let semanticHits = 0;
  let semanticRejections = 0;

  const noteRejection = (reason: ReuseMissReason | undefined): void => {
    const key = reason ?? 'evidence_unavailable';
    rejectionReasons[key] = (rejectionReasons[key] ?? 0) + 1;
  };

  const counters = (): ReuseAttemptCounters => ({
    exactAttempts,
    exactHits,
    semanticCandidates,
    semanticHits,
    semanticRejections,
    rejectionReasons,
  });

  const miss = (missReason: ReuseMissReason): ReuseResolution => ({
    outcome: 'miss',
    taskId: request.taskId,
    organizationId: request.organizationId,
    missReason,
    evaluations,
    attempts: counters(),
  });

  // A request whose identity belongs to another organization never reaches a
  // store at all. Checked here as well as in the gate, because the cheapest way
  // to guarantee no cross-tenant read is to not perform one.
  if (request.identity.organizationId !== request.organizationId) {
    return miss('tenant_mismatch');
  }

  // ── EXACT ─────────────────────────────────────────────────────────────────
  exactAttempts = 1;
  let exactRecord: ReusableResultRecord | undefined;
  try {
    exactRecord = await input.store.findExact(
      request.organizationId,
      request.identity.exactReuseKey,
    );
  } catch {
    // A store that is unavailable produces a miss, not an outage. The caller
    // pays for the inference and the platform stays up.
    return miss('store_unavailable');
  }

  if (exactRecord !== undefined) {
    const verdict = evaluateReuseEligibility(exactRecord, request);
    evaluations.push({
      reusableResultId: exactRecord.reusableResultId,
      source: 'exact',
      verdict,
    });
    if (verdict.eligible) {
      exactHits = 1;
      return {
        outcome: 'exact_hit',
        taskId: request.taskId,
        organizationId: request.organizationId,
        reuseType: 'exact',
        record: exactRecord,
        priorOutput: priorOutputFor(exactRecord),
        verdict,
        evaluations,
        attempts: counters(),
      };
    }
    noteRejection(verdict.missReason);
  }

  // ── SEMANTIC ──────────────────────────────────────────────────────────────
  const semantic = input.semantic;
  const discovery = input.discovery;
  if (semantic === undefined || discovery === undefined) {
    // No semantic path configured. That is a normal execution outcome and not a
    // degradation — a deployment without a discovery port simply gets exact
    // reuse, which is the majority of the value and all of the certainty.
    return miss(exactRecord === undefined ? 'no_candidate' : (evaluations[0]?.verdict.missReason ?? 'no_candidate'));
  }

  let candidates: readonly SemanticCandidate[];
  try {
    candidates = await discovery.discover({
      organizationId: request.organizationId,
      taskFingerprint: request.identity.taskFingerprint,
      taskIdentity: request.version.taskIdentity,
      semanticClass: semantic.semanticClass,
      features: semantic.features,
      semanticFingerprint: semantic.semanticFingerprint,
      minimumSimilarity: semantic.minimumSimilarity,
      limit: Math.max(1, Math.floor(semantic.maximumCandidates)),
    });
  } catch {
    return miss('discovery_unavailable');
  }

  const seen = new Set<string>();
  if (exactRecord !== undefined) seen.add(exactRecord.reusableResultId);

  for (const candidate of candidates) {
    if (seen.has(candidate.reusableResultId)) continue;
    seen.add(candidate.reusableResultId);
    semanticCandidates += 1;

    // RELOADED BY ID, TENANT-SCOPED. The candidate's own `organizationId` is
    // echoed audit data and is never used for scoping: a port that returned
    // another tenant's id gets `undefined` here, not that tenant's record.
    let record: ReusableResultRecord | undefined;
    try {
      record = await input.store.getById(request.organizationId, candidate.reusableResultId);
    } catch {
      return miss('store_unavailable');
    }
    if (record === undefined) {
      semanticRejections += 1;
      noteRejection('no_candidate');
      continue;
    }

    const verdict = evaluateReuseEligibility(record, request);
    evaluations.push({
      reusableResultId: record.reusableResultId,
      source: 'semantic',
      similarity: candidate.similarity,
      verdict,
    });

    if (verdict.eligible) {
      semanticHits = 1;
      return {
        outcome: 'semantic_hit',
        taskId: request.taskId,
        organizationId: request.organizationId,
        reuseType: 'semantic',
        record,
        priorOutput: priorOutputFor(record),
        verdict,
        evaluations,
        attempts: counters(),
      };
    }

    // A DISCOVERED CANDIDATE THE GATE REFUSED. Counted as a rejection, never as
    // a hit, and it contributes nothing to any savings figure anywhere.
    semanticRejections += 1;
    noteRejection(verdict.missReason);
  }

  // Report the most specific reason available. "No candidate" when nothing was
  // found; the gate's own reason when something was found and refused — an
  // operator can act on `dependency_changed` and cannot act on `no_candidate`.
  const lastRefusal = evaluations[evaluations.length - 1]?.verdict.missReason;
  return miss(lastRefusal ?? 'no_candidate');
}
