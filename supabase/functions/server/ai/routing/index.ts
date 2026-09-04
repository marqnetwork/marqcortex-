/**
 * The Routing Authority — AI-01 Batch 4F.
 *
 * One module for how the platform chooses BETWEEN providers it has already
 * decided it may use, how far a single request may fail over, and what that
 * choice costs. Eligibility stays where it is: the provider registry decides
 * operational state, and the selector applies the kill switch, certification,
 * credentials and capability matching. Nothing here can widen any of that.
 */

export type {
  RoutedCandidate,
  RoutingDecision,
  RoutingOutcome,
  RoutingSignal,
  RoutingStrategy,
  RoutingWorkload,
} from './contracts/routing.ts';
export { ROUTING_STRATEGIES, isRoutingStrategy } from './contracts/routing.ts';
export {
  ROUTING_BOUNDS,
  clampMaxProviders,
  healthScore,
  routeCandidates,
} from './engine/routingPolicy.ts';
export type { RoutingPolicyOptions } from './engine/routingPolicy.ts';
export {
  planCeilingMicroUsd,
  projectAttemptCostMicroUsd,
  projectRequestCostMicroUsd,
  reconcileRouting,
} from './engine/economics.ts';
export type { RealizedExecution } from './engine/economics.ts';
export { createRoutingLedger } from './routingLedger.ts';
export type {
  RoutingLedger,
  RoutingLedgerOptions,
  RoutingProviderSummary,
  RoutingSummary,
} from './routingLedger.ts';
