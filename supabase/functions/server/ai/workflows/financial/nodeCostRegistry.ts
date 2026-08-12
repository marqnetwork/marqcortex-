/**
 * The production node cost-profile registry
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── THE PROBLEM THIS FILE IS THE ANSWER TO ─────────────────────────────────
 *
 * `nodeCostProfile.ts` derives a truthful, claim-nothing descriptor for a node
 * nobody declared anything about, and gives way to a `WorkflowNodeCostProfile`
 * whenever a deployment supplies one. Until this file, the ONLY way to supply
 * one was a hand-written fixture per node — so in production every node fell to
 * the defaults, and the platform reported a truthful cost with no attributable
 * saving on every node it ran.
 *
 * This registry closes that gap WITHOUT inventing a single fact. Every field it
 * produces is read from something a human already declared and a validator
 * already accepted:
 *
 *   the agent's safety class          `AgentDefinition.safetyClass`
 *   the agent's approved model bands  `AgentDefinition.allowedModelProfiles`,
 *                                     resolved through the certified model
 *                                     profile registry
 *   the agent's own token ceilings    `AgentDefinition.limits`
 *   the node's declared output shape  `WorkflowAgentNode.outputContract`
 *   the node's attempt allowance      `WorkflowAgentNode.maxAttempts`
 *
 * ── THE THREE RULES, AND WHY EACH ONE POINTS THE SAME WAY ──────────────────
 *
 * A registry that derives a node's economics is the single most attractive place
 * in this platform to manufacture a saving, because every figure it produces is
 * the DENOMINATOR of one. Three rules, and every one of them costs hit rate to
 * buy defensibility:
 *
 *   1. THE DERIVED CEILING IS NEVER THE LADDER'S CEILING. `advanced_reasoning`
 *      is unreachable by derivation. The highest band this file will ever infer
 *      is `reasoning`, and only for an agent whose approved profiles declare
 *      `high` quality. Pricing an undeclared node at the top of the ladder and
 *      then "saving" the difference is the single largest fabricated number
 *      available here, and it would have looked like a mapping table.
 *
 *   2. AN UNKNOWN FACT COLLAPSES THE BAND LIST, IT DOES NOT WIDEN IT. An agent
 *      naming a model profile the registry cannot resolve gets a SINGLE-band
 *      envelope at its own maximum — which makes `downgraded` unreachable and
 *      claims no routing saving at all. The alternative, assuming the
 *      unresolvable profile was a cheap one, is a saving derived from a fact
 *      nobody could produce.
 *
 *   3. NARROWING THE ENVELOPE IS ALLOWED; WIDENING IT IS NOT REPRESENTABLE. The
 *      completion allowance is clamped DOWN to what the agent's approved model
 *      profiles can actually emit, which LOWERS the baseline — the deflationary
 *      direction. Nothing here can raise a ceiling above the agent's own
 *      declared limit, and `narrowNodeCostProfile` refuses a deployment override
 *      that tries to.
 *
 * ── WHAT IT REFUSES TO DERIVE, AND WHY THE ABSENCE MATTERS ─────────────────
 *
 *   NO DETERMINISTIC CAPABILITIES. A `DeterministicCapability` is an assertion
 *   that a non-inference path exists and is authorised for this work. Nothing in
 *   an agent definition says that, so nothing here may infer it — an inferred
 *   deterministic capability is an avoided call that never had permission to be
 *   avoided.
 *
 *   NO EXPECTED OUTPUT SIZE. Left equal to the (narrowed) allowance, so no
 *   output-budget saving is claimed for a size nobody estimated.
 *
 *   NO CONTEXT METADATA. The workflow engine holds none. See
 *   `nodeCostProfile.ts` for why an empty candidate list understates the
 *   baseline and why understating it is the safe direction.
 *
 * ── PURE, AND VERSIONED ────────────────────────────────────────────────────
 *
 * No clock, no store, no randomness — the same declared facts produce the same
 * profile on every isolate, which is what keeps a settlement after a restart
 * converging on the event the first isolate wrote. `NODE_COST_REGISTRY_VERSION`
 * names the derivation, and it is reported by the health read so an operator can
 * tell which rules a run's events were derived under.
 */

import type { AgentCapability, AgentSafetyClass } from '../../agents/contracts/agent.ts';
import type {
  CapabilityProfile,
  QualityProfile,
} from '../../optimization/contracts/compression.ts';
import { CAPABILITY_RANK, QUALITY_RANK } from '../../optimization/contracts/compression.ts';
import type { WorkflowNodeFinancialFacts } from './contracts/emission.ts';
import type {
  WorkflowNodeCostProfile,
  WorkflowNodeLimits,
} from './nodeCostProfile.ts';
import {
  DEFAULT_NODE_CAPABILITY_PROFILE,
  DEFAULT_NODE_QUALITY,
  DEFAULT_NODE_TASK_KIND,
} from './nodeCostProfile.ts';

/**
 * Versions the DERIVATION RULES below, not the arithmetic beneath them.
 *
 * Bump it on any change to a mapping, a clamp or a fallback in this file. A
 * profile derived under different rules is not comparable with one derived under
 * these, and a silently restated history is worse than a versioned one.
 */
export const NODE_COST_REGISTRY_VERSION = 'ai.workflow.nodecost.v1';

/**
 * The declared facts of one approved model profile.
 *
 * STRUCTURALLY the agent runtime's `ModelProfile`, restated here rather than
 * imported, because the workflow tree may borrow only pure contracts from
 * `agents/` — the boundary scan asserts it on the source. The assembly, which is
 * the one module permitted to hold the profile registry, passes the real
 * profiles straight through.
 */
export interface ApprovedModelProfile {
  readonly profileId: string;
  readonly quality: 'baseline' | 'standard' | 'high';
  readonly complexity: 'low' | 'standard' | 'high';
  readonly requiresStructuredOutput: boolean;
  /** What this profile may actually emit. The real completion ceiling. */
  readonly maxCompletionTokens: number;
  readonly rank: number;
}

/** What the assembly resolved about one agent, from its registered definition. */
export interface DeclaredAgentFacts {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly safetyClass: AgentSafetyClass;
  readonly capabilities: readonly AgentCapability[];
  /** The agent's OWN declared ceilings. Read, never widened. */
  readonly limits: WorkflowNodeLimits;
  /** Resolved from `allowedModelProfiles`, in the registry's own order. */
  readonly approvedModelProfiles: readonly ApprovedModelProfile[];
  /**
   * Declared profile ids the registry could not resolve.
   *
   * Non-zero collapses the band list — see rule 2. Counted rather than named so
   * this contract carries no free text a caller could shape a decision with.
   */
  readonly unresolvedModelProfiles: number;
}

/** What the plan already declares about one node. */
export interface DeclaredNodeFacts {
  /** True when the node declares an output contract. See `requiresStructuredOutput`. */
  readonly declaresOutputContract: boolean;
}

export interface NodeCostProfileRegistryOptions {
  /**
   * The agent's declared facts, or `undefined` for an agent nobody registered.
   *
   * `undefined` produces NO profile at all, which leaves `nodeCostProfile.ts`'s
   * conservative defaults in force — and, when the recorder's `limitsFor` also
   * returns nothing, no financial event at all. Both are the honest outcome for
   * a node whose agent the platform cannot describe.
   */
  agentFactsFor(agentId: string): DeclaredAgentFacts | undefined;
  /** The node's declared facts, or `undefined` when the plan cannot supply them. */
  nodeFactsFor(facts: WorkflowNodeFinancialFacts): DeclaredNodeFacts | undefined;
  /**
   * A deployment's own declaration for this node, applied on top.
   *
   * NARROWING ONLY — see `narrowNodeCostProfile`. An override that would raise
   * the maximum band, add a band the derivation did not permit or lower the
   * quality contract is clamped back, and the clamp is reported.
   */
  overrideFor?: (facts: WorkflowNodeFinancialFacts) => WorkflowNodeCostProfile | undefined;
  /** Called when an override was clamped. Loud, never silent. */
  onOverrideNarrowed?: (facts: WorkflowNodeFinancialFacts, detail: string) => void;
}

export interface NodeCostProfileRegistry {
  readonly version: string;
  /** The derived profile for one node attempt, or `undefined` when unknowable. */
  profileFor(facts: WorkflowNodeFinancialFacts): WorkflowNodeCostProfile | undefined;
  /**
   * The ceilings the baseline is priced against.
   *
   * The agent's own limits, with the completion allowance clamped DOWN to what
   * its approved model profiles can emit. `undefined` for an agent nobody
   * registered, which is the signal the recorder reads as "no truthful baseline
   * can be established" and records nothing.
   */
  limitsFor(agentId: string): WorkflowNodeLimits | undefined;
}

/**
 * A declared model-quality band, as a capability band.
 *
 * ANCHORED ON QUALITY, NOT COMPLEXITY, and the choice is the conservative one.
 * `complexity` describes how hard the work is; mapping it upward would price
 * every structured-reasoning agent at `reasoning` and hand the platform a
 * routing saving on nodes nobody declared a band for. `quality` describes the
 * band of ANSWER the profile is certified to produce, which is the thing a
 * capability band means.
 *
 * `advanced_reasoning` is deliberately absent. See rule 1.
 */
const CAPABILITY_FOR_MODEL_QUALITY: Readonly<
  Record<ApprovedModelProfile['quality'], CapabilityProfile>
> = {
  baseline: 'economy',
  standard: 'standard',
  high: 'reasoning',
};

/** The quality contract a declared model-quality band satisfies. */
const QUALITY_FOR_MODEL_QUALITY: Readonly<
  Record<ApprovedModelProfile['quality'], QualityProfile>
> = {
  baseline: 'best_effort',
  standard: 'standard',
  high: 'high',
};

function ascendingBands(bands: readonly CapabilityProfile[]): readonly CapabilityProfile[] {
  return [...new Set(bands)].sort((a, b) => CAPABILITY_RANK[a] - CAPABILITY_RANK[b]);
}

function highestQuality(profiles: readonly ApprovedModelProfile[]): QualityProfile | undefined {
  let best: QualityProfile | undefined;
  for (const profile of profiles) {
    const quality = QUALITY_FOR_MODEL_QUALITY[profile.quality];
    if (quality === undefined) continue;
    if (best === undefined || QUALITY_RANK[quality] > QUALITY_RANK[best]) best = quality;
  }
  return best;
}

/**
 * The completion allowance a node may actually reach.
 *
 * The smaller of the agent's own ceiling and the largest allowance any approved
 * model profile declares. A narrowing, always: an agent limited to 4,000 tokens
 * whose approved profiles emit at most 1,200 cannot produce 4,000, and pricing
 * its baseline at 4,000 would be an inflated denominator wearing a limit's
 * clothes.
 *
 * Unresolved profiles suppress the narrowing entirely, because the largest
 * allowance among the profiles the registry CAN see is not the largest among the
 * profiles the agent declared — and narrowing on a partial view could understate
 * a ceiling the agent really has.
 */
function narrowedLimits(agent: DeclaredAgentFacts): WorkflowNodeLimits {
  const limits = agent.limits;
  if (agent.approvedModelProfiles.length === 0 || agent.unresolvedModelProfiles > 0) {
    return limits;
  }
  let ceiling = 0;
  for (const profile of agent.approvedModelProfiles) {
    ceiling = Math.max(ceiling, Math.max(0, Math.floor(profile.maxCompletionTokens)));
  }
  if (ceiling <= 0 || ceiling >= limits.maxCompletionTokens) return limits;

  return {
    maxPromptTokens: limits.maxPromptTokens,
    maxCompletionTokens: ceiling,
    // The total falls with the completion it contains, but never below what the
    // prompt alone already permits — a total under the prompt ceiling would make
    // the baseline's prompt room negative and price a call with no input.
    maxTotalTokens: Math.min(limits.maxTotalTokens, limits.maxPromptTokens + ceiling),
    maxActualCostMicroUsd: limits.maxActualCostMicroUsd,
  };
}

/**
 * The bands an agent may be routed to, and the one it would have used.
 *
 * A single-band result is the common case and the honest one: it makes
 * `downgraded` unreachable, so the platform claims NO routing saving for that
 * node. A two-band result appears only when the agent genuinely declares two
 * approved profiles at two declared quality bands, which is a real, reviewed,
 * deployment-authored narrowing and a defensible saving.
 */
function bandsFor(agent: DeclaredAgentFacts): {
  readonly allowed: readonly CapabilityProfile[];
  readonly maximum: CapabilityProfile;
} {
  const derived = ascendingBands(
    agent.approvedModelProfiles
      .map((profile) => CAPABILITY_FOR_MODEL_QUALITY[profile.quality])
      .filter((band): band is CapabilityProfile => band !== undefined),
  );
  if (derived.length === 0) {
    // No resolvable profile at all. The conservative single band, which is the
    // same one an undeclared node already gets.
    return { allowed: [DEFAULT_NODE_CAPABILITY_PROFILE], maximum: DEFAULT_NODE_CAPABILITY_PROFILE };
  }

  const maximum = derived[derived.length - 1];
  // RULE 2. A partial view of the agent's profiles cannot support a claim that a
  // cheaper band is available, so the list collapses to the maximum and no
  // routing saving is reachable.
  if (agent.unresolvedModelProfiles > 0) return { allowed: [maximum], maximum };
  return { allowed: derived, maximum };
}

export function createNodeCostProfileRegistry(
  options: NodeCostProfileRegistryOptions,
): NodeCostProfileRegistry {
  return {
    version: NODE_COST_REGISTRY_VERSION,

    limitsFor(agentId) {
      const agent = options.agentFactsFor(agentId);
      return agent === undefined ? undefined : narrowedLimits(agent);
    },

    profileFor(facts) {
      const agent = options.agentFactsFor(facts.agentId);
      if (agent === undefined) return undefined;

      const node = options.nodeFactsFor(facts);
      const { allowed, maximum } = bandsFor(agent);

      const derived: WorkflowNodeCostProfile = {
        // NOT DERIVED. Nothing an agent or a node declares says what KIND of task
        // this is, and the classifier's reproducibility depends on the kind being
        // declared rather than guessed. The default's floor matches the default
        // band, so it neither downgrades nor escalates on its own.
        kind: DEFAULT_NODE_TASK_KIND,
        // The STRICTEST quality any approved profile is certified for. Raising
        // the contract raises the capability floor, which forecloses a downgrade
        // rather than enabling one — the direction that claims less.
        quality: highestQuality(agent.approvedModelProfiles) ?? DEFAULT_NODE_QUALITY,
        // A node that declares an output contract requires a structured answer.
        // So does an agent every one of whose approved profiles demands one.
        requiresStructuredOutput:
          node?.declaresOutputContract === true ||
          (agent.approvedModelProfiles.length > 0 &&
            agent.approvedModelProfiles.every((profile) => profile.requiresStructuredOutput)),
        // An effect outside the platform is safety-critical work by declaration.
        // It protects the node from the stop control and from being labelled
        // waste; it creates no saving and reduces no cost.
        safetyCritical: agent.safetyClass === 'external_effect',
        // NEVER DERIVED. See the header — an inferred deterministic capability is
        // an avoided call nobody authorised.
        deterministicCapabilities: [],
        allowedCapabilityProfiles: allowed,
        maximumCapabilityProfile: maximum,
      };

      const override = options.overrideFor?.(facts);
      if (override === undefined) return derived;

      const narrowed = narrowNodeCostProfile(derived, override);
      if (narrowed.clamped.length > 0) {
        options.onOverrideNarrowed?.(facts, narrowed.clamped.join('; '));
      }
      return narrowed.profile;
    },
  };
}

/**
 * Apply a deployment's declaration on top of the derived one, NARROWING ONLY.
 *
 * The Batch 2 deployment-envelope rule, applied to node economics: operational
 * configuration may narrow what a deployment permits and may never widen it. The
 * three clamps below are exactly the three ways an override could inflate a
 * denominator, and each one is refused and reported rather than accepted:
 *
 *   A HIGHER MAXIMUM BAND is the inflated-baseline attack. Clamped down to the
 *   derived maximum.
 *
 *   A BAND THE DERIVATION DID NOT PERMIT would price or route the node at a
 *   capability its agent has no approved profile for. Dropped from the list.
 *
 *   A LOWER QUALITY CONTRACT lowers the capability floor, which is how a
 *   downgrade gets manufactured without touching a single band. Clamped up to
 *   the derived contract.
 *
 * Everything else an override declares is accepted as the deployment's own
 * statement about the work — including `deterministicCapabilities`, which is an
 * authorisation a human wrote down and the one thing this file will not infer.
 */
export function narrowNodeCostProfile(
  derived: WorkflowNodeCostProfile,
  override: WorkflowNodeCostProfile,
): { readonly profile: WorkflowNodeCostProfile; readonly clamped: readonly string[] } {
  const clamped: string[] = [];

  const derivedAllowed = derived.allowedCapabilityProfiles ?? [DEFAULT_NODE_CAPABILITY_PROFILE];
  const derivedMaximum =
    derived.maximumCapabilityProfile ?? derivedAllowed[derivedAllowed.length - 1];

  let allowed = derivedAllowed;
  if (override.allowedCapabilityProfiles !== undefined) {
    const permitted = override.allowedCapabilityProfiles.filter((band) =>
      derivedAllowed.includes(band),
    );
    if (permitted.length !== override.allowedCapabilityProfiles.length) {
      clamped.push('allowedCapabilityProfiles contained a band the agent has no approved profile for');
    }
    // An override that narrowed everything away narrows to nothing usable, so
    // the derived list stands. Refusing to run is not this file's decision.
    allowed = permitted.length > 0 ? ascendingBands(permitted) : derivedAllowed;
  }

  let maximum = derivedMaximum;
  if (override.maximumCapabilityProfile !== undefined) {
    if (CAPABILITY_RANK[override.maximumCapabilityProfile] > CAPABILITY_RANK[derivedMaximum]) {
      clamped.push('maximumCapabilityProfile exceeded the derived maximum');
    } else {
      maximum = override.maximumCapabilityProfile;
    }
  }
  // The maximum must still be inside the permitted list, or the baseline would
  // be priced at a band the node may not use.
  if (!allowed.includes(maximum)) {
    maximum = allowed[allowed.length - 1];
  }

  const derivedQuality = derived.quality ?? DEFAULT_NODE_QUALITY;
  let quality = derivedQuality;
  if (override.quality !== undefined) {
    if (QUALITY_RANK[override.quality] < QUALITY_RANK[derivedQuality]) {
      clamped.push('quality was below the contract the agent is certified for');
    } else {
      quality = override.quality;
    }
  }

  return {
    profile: {
      ...derived,
      ...override,
      quality,
      allowedCapabilityProfiles: allowed,
      maximumCapabilityProfile: maximum,
    },
    clamped,
  };
}
