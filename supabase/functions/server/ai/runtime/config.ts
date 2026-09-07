/**
 * AI Control Plane runtime configuration.
 *
 * A pure function of an `EnvSource`: same environment in, same configuration
 * out, no globals read. Every value is bounded, so a malformed environment
 * variable degrades to a safe default instead of propagating NaN into a timeout
 * or a negative ceiling into a rate limiter.
 *
 * There are deliberately NO per-feature "use the gateway" switches here. Batch 1
 * establishes exactly one governed execution path; a flag that bypasses it would
 * be a second path by definition.
 */

import type { RoutingStrategy } from '../routing/contracts/routing.ts';
import { isRoutingStrategy } from '../routing/contracts/routing.ts';
import { ROUTING_BOUNDS } from '../routing/engine/routingPolicy.ts';
import type { EnvSource } from './env.ts';
import { readBool, readInt, readList, readOptionalString, readString } from './env.ts';
import {
  DEFAULT_RESERVATION_TTL_MS,
  UNBOUNDED_SPEND_CAP_MICRO_USD,
} from '../policy/spendLedger.ts';

export interface AIControlPlaneConfig {
  /** Ordered provider preference. First healthy, capable provider wins. */
  readonly providerPreference: readonly string[];
  /** Provider used when no other provider can serve a request. */
  readonly fallbackProviderId?: string;
  /** Allow failover to the next preferred provider on a failoverable error. */
  readonly failoverEnabled: boolean;
  /**
   * The real-request kill switch. FALSE BY DEFAULT.
   *
   * While false, no provider that spends money with an external vendor may be
   * selected — the platform serves synthetic completions from the mock adapter
   * and cannot produce a bill. Turning it on is a deliberate, explicit act, and
   * it is deliberately not implied by "an API key is configured": a key present
   * in the environment must not by itself start spending.
   */
  readonly allowRealRequests: boolean;
  /** Refuse providers whose certification has not been established. */
  readonly requireCertifiedProviders: boolean;
  /**
   * Refuse AGENTS whose certification has not been established (AI-01 Batch 3A).
   *
   * A separate switch from the provider one, and separate for a reason an
   * independent review found the hard way: the agent runtime originally read
   * `requireCertifiedProviders`, so one operator action silently governed three
   * different populations. A setting whose name describes one thing and governs
   * three is a setting nobody can reason about during an incident.
   */
  readonly requireCertifiedAgents: boolean;
  /** Refuse TOOLS whose certification has not been established. */
  readonly requireCertifiedTools: boolean;
  /**
   * How long an isolate may serve a cached copy of the operational settings
   * before re-reading them from durable storage.
   *
   * Zero — the default — means every AI request re-reads, so an administrator's
   * kill switch reaches every warm isolate on its next request. Raising it
   * trades that immediacy for fewer key-value reads, and a deployment that
   * raises it is choosing to let a stopped platform keep serving for up to
   * this long.
   */
  readonly settingsRefreshMs: number;
  /**
   * Whole-workflow deadline, covering every attempt against every provider.
   * Distinct from the per-attempt timeout, which bounds one call.
   */
  readonly workflowDeadlineMs: number;

  readonly circuit: {
    readonly failureThreshold: number;
    readonly openMs: number;
    readonly halfOpenSuccessesToClose: number;
  };

  readonly retry: {
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    /** Proportion of the delay randomised, 0–100 percent. */
    readonly jitterPercent: number;
  };

  readonly budget: {
    readonly organizationDailyMicroUsd: number;
    readonly actorDailyMicroUsd: number;
    /** Percentage of the ceiling that raises a threshold event. */
    readonly alertThresholdPercent: number;
    readonly enforce: boolean;
  };

  readonly spend: {
    /**
     * The MARQ-funded lifetime ceiling, in micro-USD. Set from
     * `AI_MAX_SPEND_USD` (default 9). It never resets on a timer — clearing it
     * requires an explicit, authorised, audited action.
     */
    readonly maxPlatformMicroUsd: number;
    /**
     * The lifetime ceiling for ONE organization's own spend, in micro-USD
     * (AI-01 Batch 4D remediation, HIGH-1). Set from `AI_ORG_MAX_SPEND_USD`.
     *
     * ── WHY THIS IS NOT `AI_MAX_SPEND_USD`, AND WHY ITS DEFAULT IS UNBOUNDED ─
     *
     * The two ceilings govern two different people's money and the platform
     * must not conflate them:
     *
     *   `maxPlatformMicroUsd` bounds MARQ'S OWN exposure at model vendors. It
     *   is a spending control on a MARQ decision, and $9 is deliberately small
     *   because MARQ is the one being invoiced.
     *
     *   THIS bounds a customer's spend at THEIR OWN vendor account, on a key
     *   they supplied, under a contract MARQ is not a party to. MARQ is never
     *   billed for it.
     *
     * Reusing the first number for the second is what the certification found:
     * an organization that declared `tenant_only` — the act of taking MARQ off
     * their invoice entirely — silently inherited MARQ's $9 lifetime ceiling
     * and had their AI stop permanently once their own spend crossed it, with
     * no operator surface able to see or raise it.
     *
     * THE DEFAULT IS THEREFORE UNBOUNDED, AND UNBOUNDED IS A GOVERNED STATE
     * RATHER THAN AN ABSENT ONE. It is a real number on a real record; the
     * scope is created, read, reserved against and settled exactly like any
     * other, it appears on the administration surface with `unbounded: true`,
     * and an operator who wants a ceiling sets one — platform-wide here, or per
     * organization through the governed cap-raise.
     *
     * CONTAINMENT DOES NOT DEPEND ON THIS NUMBER. A tenant-funded execution is
     * still bounded by the per-organization ROLLING DAILY allowance in
     * `budget.ts` (`AI_BUDGET_ORGANIZATION_DAILY_MICRO_USD`), which applies to
     * every organization on every request and is the instrument sized for a
     * tenant's own consumption. What a lifetime ceiling adds on top of that is
     * a permanent stop, and a permanent stop on money MARQ does not pay is a
     * decision to make deliberately, per customer, rather than to inherit.
     */
    readonly maxOrganizationMicroUsd: number;
    /** Refuse requests at the ceiling. False records spend without refusing. */
    readonly enforce: boolean;
    /** Persist the ledger to durable storage. Off makes it isolate-local. */
    readonly durable: boolean;
    /**
     * How long a spend reservation stays valid before another isolate may
     * reclaim its headroom. Must outlast the longest request the platform will
     * admit, so the control plane floors it at twice the workflow deadline —
     * reclaiming a hold from a request that is still running would let the same
     * money be reserved twice.
     */
    readonly reservationTtlMs: number;
  };

  /**
   * Managed provider credentials (AI-01 Batch 4C).
   *
   * NOTHING HERE IS A SECRET, AND NOTHING HERE CAN WIDEN ANYTHING. The root key
   * is read once at bootstrap and handed straight to the cipher; it is
   * deliberately not a field on this configuration object, because this object
   * is passed to the settings store, reported by the diagnostics endpoint and
   * spread into log context in half a dozen places.
   */
  readonly credentials: {
    /**
     * How long an isolate may serve a cached NON-SECRET credential
     * availability snapshot before re-reading it.
     *
     * Bounds only the console's view of "is this provider configured, and by
     * what?". It bounds nothing about execution: the authoritative resolution
     * reads storage and decrypts on every attempt, so a revoked credential
     * stops working on the next request regardless of this value.
     */
    readonly snapshotTtlMs: number;
  };

  /**
   * Provider routing and failover breadth (AI-01 Batch 4F).
   *
   * ── NEITHER FIELD CAN ADMIT A PROVIDER ────────────────────────────────────
   *
   * `strategy` decides the ORDER of candidates the selector has already found
   * eligible, and `maxProviders` decides how many of them one request may be
   * routed across. Eligibility — the kill switch, certification, credentials,
   * the circuit and capability matching — is untouched by both, which is why a
   * routing strategy is a tuning decision and not a permission.
   *
   * `maxProviders` IS a spend bound, and it is a NARROWING of what the platform
   * did before this batch: failover walked every eligible candidate, so a
   * request could be routed across as many providers as happened to be
   * registered. The deployment's value is the ceiling an administrator may not
   * raise past — see `runtime/envelope.ts`.
   */
  readonly routing: {
    readonly strategy: RoutingStrategy;
    /** Providers ONE request may be routed across, at most. */
    readonly maxProviders: number;
  };

  /**
   * Self-hosted / OpenAI-compatible providers (AI-01 Batch 4E).
   *
   * Both switches are DEPLOYMENT-level and neither is reachable from a request
   * body, a configuration row or the administration surface. A control an
   * administrator can flip is a control an attacker who reaches the
   * administration surface can flip, and these two decide whether the runtime
   * will dial an operator-supplied URL at all.
   */
  readonly selfHosted: {
    /**
     * Whether persisted self-hosted provider definitions are hydrated.
     *
     * OFF BY DEFAULT. With it off the registry holds exactly what it held
     * before this batch, no stored endpoint is read and none can be dialled —
     * which makes it the emergency stop for the whole capability as well as its
     * opt-in.
     */
    readonly enabled: boolean;
    /**
     * The narrowly-scoped local-development exception: admits `http` and
     * private/loopback endpoints so a developer can point Cortex at an Ollama
     * or LM Studio server on their own machine.
     *
     * OFF BY DEFAULT, reported loudly by bootstrap when it is on, and it never
     * admits a cloud metadata address. See `providers/selfHosted/endpointPolicy.ts`.
     */
    readonly allowPrivateEndpoints: boolean;
  };

  readonly audit: {
    /** Persist audit records to durable storage as well as the buffer. */
    readonly durable: boolean;
    /** Retention for durable audit records, in days. */
    readonly retentionDays: number;
    /** In-memory ring buffer size for the operational audit endpoint. */
    readonly bufferSize: number;
  };

  /**
   * Production optimization wiring (AI-01 Batch 3B).
   *
   * ── NARROW ONLY. THESE SWITCHES CANNOT WIDEN A PERMISSION ─────────────────
   *
   * Every field here either turns an EXISTING, already-governed component ON or
   * bounds how far it may go. There is deliberately no setting that grants an
   * authority, admits a provider, raises a ceiling, relaxes an eligibility
   * dimension or overrides a certification — the Batch 2 deployment-envelope
   * rule, applied to the optimisation path.
   *
   * In particular there is NO "reuse anyway" switch and no compatibility list
   * an operator can widen from the environment. The kill switch and the
   * administrative posture keep the authority they already had; `reuseEnabled`
   * is a NARROWER switch beside them, and turning it on cannot make reuse
   * eligible for anything the Part 6B gate refuses.
   */
  readonly optimization: {
    /**
     * Persist financial events to durable storage. On by default.
     *
     * Off makes the ledger isolate-local, which is correct for a local tool and
     * wrong for a deployment. Neither setting suppresses the degraded report:
     * an isolate that wanted durability and did not get it says so, loudly, in
     * exactly the way the spend ledger and the agent stores already do.
     */
    readonly financialDurable: boolean;
    /**
     * Refuse to serve at all if durable financial storage cannot be assembled.
     *
     * OFF by default, and the default is the considered position. A reporting
     * layer that can stop a platform is an execution authority; a deployment
     * that genuinely wants finance-or-nothing turns this on deliberately and
     * accepts that an unreachable key-value store now takes AI down with it.
     */
    readonly financialRequired: boolean;
    /**
     * Consult the Part 6B reuse engine before a node creates a child.
     *
     * OFF by default. Reuse is a behaviour change a deployment opts into, and
     * defaulting it on would mean every deployment silently acquired a cache in
     * front of its model calls the day it upgraded.
     */
    readonly exactReuseEnabled: boolean;
    /**
     * Permit SEMANTIC candidate discovery.
     *
     * Reading true here is a request, not a grant. Discovery runs only when a
     * certified discovery port also exists, and this repository ships none —
     * see `reuse/discovery/semanticDiscoveryPort.ts`. With the switch on and no
     * port, production reuse stays exact-only and the health read reports the
     * discovery path as unavailable rather than as enabled.
     */
    readonly semanticReuseEnabled: boolean;
    /**
     * The freshness bound a reusing caller imposes, in milliseconds.
     *
     * NARROWS a record's own TTL and never extends it: Part 6B takes the
     * stricter of the two. Zero means the caller imposes none of its own and
     * the record's declared freshness stands.
     */
    readonly reuseMaxAgeMs: number;
    /** Minimum similarity a discovered candidate must reach. 0–100. */
    readonly reuseMinimumSimilarity: number;
    /** Candidates the eligibility gate will be asked to evaluate, at most. */
    readonly reuseMaximumCandidates: number;
  };

  /**
   * Certified business capabilities a deployment has ACTIVATED (Part 7E).
   *
   * ── CERTIFICATION AND ACTIVATION ARE DIFFERENT DECISIONS ──────────────────
   *
   * Certification is a judgement about a definition, made by a person and
   * recorded in the definition itself. Activation is a judgement about a
   * DEPLOYMENT: whether this environment, with this data and these operators,
   * should have the capability registered at all. A certified capability that
   * registered itself everywhere the moment it was certified would collapse the
   * two, and the first business agent is the wrong place to establish that.
   *
   * So every switch here is OFF by default and NARROW: it registers one already
   * certified capability into the runtimes that already exist. There is no
   * setting that certifies anything, grants a capability, adds a tool to an
   * agent's allow list or widens an approver role — those live in the
   * definitions, where they were reviewed.
   */
  readonly business: {
    /**
     * Register the certified diagnostic readiness review capability.
     *
     * OFF by default. On, the capability is registered only if the deployment
     * ALSO supplies durable key-value storage and a submission source; a switch
     * that could half-assemble a capability would be a switch that produced a
     * console entry for something that cannot run.
     */
    readonly diagnosticReviewEnabled: boolean;
  };

  readonly observability: {
    readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Emit one structured JSON line per log record. */
    readonly structuredLogs: boolean;
    readonly metricsBufferSize: number;
  };

  readonly governance: {
    /** Master switch for PII redaction. Off is a deliberate, audited choice. */
    readonly redactionEnabled: boolean;
    /** Reject rather than redact when input contains PII. */
    readonly strictInputGuard: boolean;
  };

  /** Default organization for single-tenant deployments of the console. */
  readonly defaultOrganizationId: string;
  /** Organizations allowed to call AI features. Empty means "all". */
  readonly organizationAllowList: readonly string[];
  /**
   * Permit a subject with no verified membership to fall back to the default
   * organization. False fails such requests closed. See `security/tenancy.ts`
   * for why this defaults to false.
   */
  readonly allowDefaultOrganization: boolean;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function readLogLevel(env: EnvSource): AIControlPlaneConfig['observability']['logLevel'] {
  const raw = readString(env, 'AI_LOG_LEVEL', 'info').toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as AIControlPlaneConfig['observability']['logLevel'])
    : 'info';
}

/**
 * Default provider order, which follows the real-request kill switch.
 *
 * With real requests OFF, mock is first: the deployment cannot spend money and
 * should serve the only thing it is permitted to serve.
 *
 * With real requests ON, mock goes LAST. Keeping it first would mean a
 * deployment that had explicitly authorised real spending still answered every
 * request with a synthetic completion — the platform would look healthy, cost
 * nothing, and be wrong about every answer it gave. The mock stays registered
 * as a last resort rather than being removed, so a total vendor outage degrades
 * to something rather than nothing.
 *
 * An operator who sets `AI_PROVIDER_PREFERENCE` explicitly overrides all of
 * this and gets exactly the order they asked for.
 */
function defaultProviderPreference(env: EnvSource): readonly string[] {
  return readBool(env, 'AI_ALLOW_REAL_REQUESTS', false)
    ? ['openai', 'anthropic', 'mock']
    : ['mock', 'openai', 'anthropic'];
}

/** The MARQ-funded ceiling, in micro-USD. Default $9. */
export const DEFAULT_MAX_SPEND_USD = 9;

/**
 * Read `AI_MAX_SPEND_USD` as dollars and convert to micro-USD.
 *
 * Read as a decimal string rather than through `readInt` so an operator can set
 * a ceiling of `2.50`. A malformed or negative value falls back to the default
 * rather than to "no limit" — a typo in a spending cap must never widen it.
 */
function readMaxSpendMicroUsd(env: EnvSource): number {
  const raw = env.get('AI_MAX_SPEND_USD');
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_SPEND_USD * 1_000_000;
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_SPEND_USD * 1_000_000;
  // Ten thousand dollars is far beyond any Batch 1 authorisation; a value above
  // it is far more likely a units mistake (micro-USD pasted into a USD field)
  // than an intention, so it is clamped rather than honoured.
  return Math.round(Math.min(parsed, 10_000) * 1_000_000);
}

/**
 * Read `AI_ORG_MAX_SPEND_USD` as dollars and convert to micro-USD.
 *
 * UNSET MEANS UNBOUNDED, which is the opposite of how `AI_MAX_SPEND_USD` reads
 * an absent value, and the asymmetry is the point: an absent MARQ ceiling must
 * fall back to a small number because the risk of getting it wrong is MARQ's
 * own invoice, and an absent customer ceiling must not invent one because the
 * risk of getting THAT wrong is stopping a paying customer's AI on money MARQ
 * never paid.
 *
 * A malformed or negative value is also unbounded rather than the MARQ default:
 * a typo must not silently impose a $9 lifetime cap on a customer's own vendor
 * account, which is the certified defect arriving through a different door.
 * Zero IS honoured — an operator writing `0` is deliberately stopping
 * tenant-funded execution, and that is a decision, not a typo.
 */
function readMaxOrganizationSpendMicroUsd(env: EnvSource): number {
  const raw = env.get('AI_ORG_MAX_SPEND_USD');
  if (raw === undefined || raw.trim() === '') return UNBOUNDED_SPEND_CAP_MICRO_USD;
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return UNBOUNDED_SPEND_CAP_MICRO_USD;
  // The same units-mistake clamp the platform ceiling applies, for the same
  // reason — except that here the clamp is a FLOOR on nothing and a ceiling on
  // a configured value, so a deployment wanting more than $10,000 per tenant
  // leaves the variable unset and administers per-organization caps instead.
  return Math.round(Math.min(parsed, 10_000) * 1_000_000);
}

/**
 * The default failover breadth.
 *
 * Three, which is the number of providers a certified MARQ deployment
 * registers (OpenAI, Anthropic and the mock last resort) — so the default
 * bounds a previously unbounded walk without narrowing the estate that exists.
 * A deployment registering more providers raises it deliberately.
 */
export const DEFAULT_ROUTING_MAX_PROVIDERS = 3;

/**
 * Read `AI_ROUTING_STRATEGY`, falling back to `preference`.
 *
 * An unrecognised value falls back rather than failing the load, and the
 * fallback is the strategy that reproduces the pre-4F order exactly: a typo in
 * a routing knob must not silently start steering traffic somewhere else.
 */
function readRoutingStrategy(env: EnvSource): RoutingStrategy {
  const raw = readString(env, 'AI_ROUTING_STRATEGY', 'preference').trim().toLowerCase();
  return isRoutingStrategy(raw) ? raw : 'preference';
}

export function loadControlPlaneConfig(env: EnvSource): AIControlPlaneConfig {
  return {
    providerPreference: readList(env, 'AI_PROVIDER_PREFERENCE', defaultProviderPreference(env)),
    fallbackProviderId: readOptionalString(env, 'AI_FALLBACK_PROVIDER'),
    failoverEnabled: readBool(env, 'AI_FAILOVER_ENABLED', true),
    allowRealRequests: readBool(env, 'AI_ALLOW_REAL_REQUESTS', false),
    requireCertifiedProviders: readBool(env, 'AI_REQUIRE_CERTIFIED_PROVIDERS', true),
    // Default true, like providers: an uncertified agent or tool has never been
    // shown to behave against this platform's contract, and production traffic
    // is not the place to find out.
    requireCertifiedAgents: readBool(env, 'AI_REQUIRE_CERTIFIED_AGENTS', true),
    requireCertifiedTools: readBool(env, 'AI_REQUIRE_CERTIFIED_TOOLS', true),
    settingsRefreshMs: readInt(env, 'AI_SETTINGS_REFRESH_MS', 0, { min: 0, max: 300_000 }),
    workflowDeadlineMs: readInt(env, 'AI_WORKFLOW_DEADLINE_MS', 90_000, {
      min: 1_000,
      max: 600_000,
    }),

    circuit: {
      failureThreshold: readInt(env, 'AI_CIRCUIT_FAILURE_THRESHOLD', 5, { min: 1, max: 100 }),
      openMs: readInt(env, 'AI_CIRCUIT_OPEN_MS', 30_000, { min: 1_000, max: 600_000 }),
      halfOpenSuccessesToClose: readInt(env, 'AI_CIRCUIT_HALF_OPEN_SUCCESSES', 2, {
        min: 1,
        max: 20,
      }),
    },

    retry: {
      baseDelayMs: readInt(env, 'AI_RETRY_BASE_DELAY_MS', 250, { min: 0, max: 10_000 }),
      maxDelayMs: readInt(env, 'AI_RETRY_MAX_DELAY_MS', 4_000, { min: 0, max: 60_000 }),
      jitterPercent: readInt(env, 'AI_RETRY_JITTER_PERCENT', 20, { min: 0, max: 100 }),
    },

    budget: {
      organizationDailyMicroUsd: readInt(env, 'AI_BUDGET_ORG_DAILY_MICRO_USD', 50_000_000, {
        min: 0,
        max: 100_000_000_000,
      }),
      actorDailyMicroUsd: readInt(env, 'AI_BUDGET_ACTOR_DAILY_MICRO_USD', 5_000_000, {
        min: 0,
        max: 100_000_000_000,
      }),
      alertThresholdPercent: readInt(env, 'AI_BUDGET_ALERT_PERCENT', 80, { min: 1, max: 100 }),
      enforce: readBool(env, 'AI_BUDGET_ENFORCE', true),
    },

    spend: {
      maxPlatformMicroUsd: readMaxSpendMicroUsd(env),
      maxOrganizationMicroUsd: readMaxOrganizationSpendMicroUsd(env),
      enforce: readBool(env, 'AI_SPEND_ENFORCE', true),
      durable: readBool(env, 'AI_SPEND_DURABLE', true),
      reservationTtlMs: readInt(
        env,
        'AI_SPEND_RESERVATION_TTL_MS',
        DEFAULT_RESERVATION_TTL_MS,
        { min: 60_000, max: 3_600_000 },
      ),
    },

    credentials: {
      snapshotTtlMs: readInt(env, 'AI_CREDENTIAL_SNAPSHOT_TTL_MS', 30_000, {
        min: 0,
        max: 300_000,
      }),
    },

    routing: {
      strategy: readRoutingStrategy(env),
      maxProviders: readInt(env, 'AI_ROUTING_MAX_PROVIDERS', DEFAULT_ROUTING_MAX_PROVIDERS, {
        min: ROUTING_BOUNDS.maxProviders.min,
        max: ROUTING_BOUNDS.maxProviders.max,
      }),
    },

    selfHosted: {
      enabled: readBool(env, 'AI_SELF_HOSTED_PROVIDERS_ENABLED', false),
      allowPrivateEndpoints: readBool(env, 'AI_SELF_HOSTED_ALLOW_PRIVATE_ENDPOINTS', false),
    },

    audit: {
      durable: readBool(env, 'AI_AUDIT_DURABLE', true),
      retentionDays: readInt(env, 'AI_AUDIT_RETENTION_DAYS', 400, { min: 1, max: 3_650 }),
      bufferSize: readInt(env, 'AI_AUDIT_BUFFER_SIZE', 200, { min: 10, max: 5_000 }),
    },

    optimization: {
      financialDurable: readBool(env, 'AI_FINANCIAL_DURABLE', true),
      financialRequired: readBool(env, 'AI_FINANCIAL_REQUIRED', false),
      exactReuseEnabled: readBool(env, 'AI_REUSE_EXACT_ENABLED', false),
      semanticReuseEnabled: readBool(env, 'AI_REUSE_SEMANTIC_ENABLED', false),
      // Zero — the default — means the caller imposes no bound of its own and a
      // record's declared freshness stands. Capped at thirty days because a
      // caller-side bound wider than any TTL Part 6B accepts narrows nothing.
      reuseMaxAgeMs: readInt(env, 'AI_REUSE_MAX_AGE_MS', 0, { min: 0, max: 2_592_000_000 }),
      reuseMinimumSimilarity: readInt(env, 'AI_REUSE_MIN_SIMILARITY', 80, { min: 1, max: 100 }),
      reuseMaximumCandidates: readInt(env, 'AI_REUSE_MAX_CANDIDATES', 5, { min: 1, max: 25 }),
    },

    business: {
      diagnosticReviewEnabled: readBool(env, 'AI_DIAGNOSTIC_REVIEW_ENABLED', false),
    },

    observability: {
      logLevel: readLogLevel(env),
      structuredLogs: readBool(env, 'AI_STRUCTURED_LOGS', true),
      metricsBufferSize: readInt(env, 'AI_METRICS_BUFFER_SIZE', 500, { min: 50, max: 10_000 }),
    },

    governance: {
      redactionEnabled: readBool(env, 'AI_REDACTION_ENABLED', true),
      strictInputGuard: readBool(env, 'AI_STRICT_INPUT_GUARD', false),
    },

    defaultOrganizationId: readString(env, 'AI_DEFAULT_ORGANIZATION_ID', 'marq-cortex'),
    organizationAllowList: readList(env, 'AI_ORGANIZATION_ALLOW_LIST', []),
    allowDefaultOrganization: readBool(env, 'AI_ALLOW_DEFAULT_ORGANIZATION', false),
  };
}
