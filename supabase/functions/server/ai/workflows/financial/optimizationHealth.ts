/**
 * The optimisation health read
 * (AI-01 Batch 3B, Production Optimization Wiring).
 *
 * ── WHY A DEPLOYMENT NEEDS THIS TO BE A FIRST-CLASS READ ───────────────────
 *
 * Every degradation in this subsystem is SILENT BY CONSTRUCTION. The recorder
 * fails open, so a financial store that is down does not fail a run. The reuse
 * resolver treats every failure as a miss, so a cache that is down does not fail
 * a node. Those are the right decisions — a reporting layer that could stop
 * execution would be an execution authority — and they have exactly one cost:
 * from the outside, a platform whose financial evidence has stopped being
 * durable looks identical to one whose evidence is perfect.
 *
 * This is the read that tells them apart. It answers the questions an operator
 * actually asks during an incident, and it answers them from what was ASSEMBLED
 * rather than from what was configured:
 *
 *   is the financial ledger durable, or is it isolate-local right now?
 *   is reuse switched on, and does it have a store to read?
 *   is semantic discovery available, or is exact reuse all there is?
 *   which cost-profile derivation produced the events I am looking at?
 *
 * ── DECLARED INTENT AND ASSEMBLED REALITY ARE REPORTED SEPARATELY ──────────
 *
 * `configured` is what the deployment asked for; `available` is what it got.
 * Collapsing them into one boolean is precisely how "we turned durability on"
 * becomes indistinguishable from "durability is on", and the gap between the
 * two IS the degradation. `degraded` is true exactly when something was asked
 * for and not obtained.
 *
 * ── WHAT IT DELIBERATELY CANNOT LEAK ───────────────────────────────────────
 *
 * Booleans, counts and version strings. No credential, no key material, no
 * prompt, no completion, no output, no tenant identifier, no run identifier and
 * no figure derived from one tenant's spend. It is safe to expose to an operator
 * surface without a tenancy check because there is nothing tenant-shaped in it —
 * which is a property of the type, not a rule about the caller.
 *
 * NO SURFACE HERE. This produces the value an operator surface will read and
 * produces no route, no dashboard and no admin page. Those are a later batch's.
 */

/** What a deployment asked for, and what the assembly actually obtained. */
export interface OptimizationCapabilityHealth {
  /** The deployment asked for it. */
  readonly configured: boolean;
  /** The assembly obtained it. */
  readonly available: boolean;
}

export interface OptimizationHealth {
  /**
   * True when anything was configured and not obtained.
   *
   * The single field an alert should watch. It says nothing about whether
   * execution is healthy — execution is unaffected by every degradation here —
   * and everything about whether the figures a report is about to publish are
   * complete.
   */
  readonly degraded: boolean;

  /**
   * Durable financial evidence.
   *
   * `available: false` with `configured: true` means events are being written to
   * an isolate-local store and will not survive a recycle. Any coverage or
   * savings figure computed while this is true is a figure over one isolate's
   * memory, and reporting it as the platform's is the exact failure Part 6C
   * exists to prevent.
   */
  readonly durableFinancialStore: OptimizationCapabilityHealth;

  /**
   * The Part 6B reusable-result store.
   *
   * `configured` follows the reuse switch; `available` follows whether a store
   * was actually assembled. Reuse with no store is not an outage — every node
   * simply executes and pays — but it is not the platform the deployment asked
   * for either.
   */
  readonly reuseStore: OptimizationCapabilityHealth;

  /** Exact reuse is switched on AND a resolver is wired to the recorder. */
  readonly exactReuse: OptimizationCapabilityHealth;

  /**
   * Semantic candidate discovery.
   *
   * `configured: true, available: false` is the HONEST steady state for this
   * repository and is not a fault: no certified embedding or retrieval path
   * exists, and Part 6B added none deliberately. Reporting it as available
   * because a switch is on would be the one place this read could lie.
   */
  readonly semanticDiscovery: OptimizationCapabilityHealth;

  /** The derivation rules the node cost profiles were produced under. */
  readonly costProfileRegistryVersion: string;
  /** The optimisation policy version stamped on every event. */
  readonly optimizationPolicyVersion: string;
  /** The financial event policy version stamped on every event. */
  readonly financialEventPolicyVersion: string;
}

export interface OptimizationHealthInput {
  readonly financialDurableConfigured: boolean;
  readonly financialDurableAvailable: boolean;
  readonly reuseConfigured: boolean;
  readonly reuseStoreAvailable: boolean;
  readonly exactReuseWired: boolean;
  readonly semanticConfigured: boolean;
  readonly semanticDiscoveryAvailable: boolean;
  readonly costProfileRegistryVersion: string;
  readonly optimizationPolicyVersion: string;
  readonly financialEventPolicyVersion: string;
}

const capability = (
  configured: boolean,
  available: boolean,
): OptimizationCapabilityHealth => ({ configured, available });

/**
 * Fold the assembly's facts into the health read.
 *
 * Pure. No clock, no store, no probe — it reports what the assembly established
 * at construction and what the caller observed since, so two readers of the same
 * runtime see the same answer and a health endpoint cannot itself become a
 * source of load or of nondeterminism.
 */
export function summarizeOptimizationHealth(
  input: OptimizationHealthInput,
): OptimizationHealth {
  const durableFinancialStore = capability(
    input.financialDurableConfigured,
    input.financialDurableAvailable,
  );
  const reuseStore = capability(input.reuseConfigured, input.reuseStoreAvailable);
  const exactReuse = capability(input.reuseConfigured, input.exactReuseWired);
  const semanticDiscovery = capability(
    input.semanticConfigured,
    input.semanticDiscoveryAvailable,
  );

  // ASKED FOR AND NOT OBTAINED, in each of the four dimensions. A capability
  // nobody asked for and nobody got is not a degradation, and reporting it as
  // one would make the flag useless on the deployment that reads it most.
  const degraded = [durableFinancialStore, reuseStore, exactReuse, semanticDiscovery].some(
    (entry) => entry.configured && !entry.available,
  );

  return {
    degraded,
    durableFinancialStore,
    reuseStore,
    exactReuse,
    semanticDiscovery,
    costProfileRegistryVersion: input.costProfileRegistryVersion,
    optimizationPolicyVersion: input.optimizationPolicyVersion,
    financialEventPolicyVersion: input.financialEventPolicyVersion,
  };
}
