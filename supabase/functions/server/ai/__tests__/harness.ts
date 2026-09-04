/**
 * Test harness for the AI Control Plane.
 *
 * Builds a real control plane — the same `createControlPlane` production uses —
 * with every non-deterministic dependency replaced: a hand-driven clock,
 * sequential ids, an in-memory log sink, an immediate sleep and a stub
 * authenticator. Nothing is mocked out of the path under test: the guard, the
 * policy engine, the pipeline, the governance layer, the audit writer and the
 * metrics recorder are all the production implementations.
 *
 * That is the point of the dependency-injection design. These tests exercise
 * production code end to end with no network, no globals and no shared state
 * between cases.
 */

import type { AIControlPlane } from '../controlPlane.ts';
import type { AIAuthenticator, AuthenticatedSubject, SubjectMembership } from '../security/actor.ts';
import type { AIControlPlaneConfig } from '../runtime/config.ts';
import type { AIOperationalSettings } from '../runtime/operationalSettings.ts';
import type { MutableClock } from '../runtime/clock.ts';
import type { LogSink } from '../observability/logger.ts';
import type { MockProviderHandle } from '../providers/mockProvider.ts';
import type { AIAdministration } from '../admin/administration.ts';
import type { AdminSettingsStore } from '../admin/settingsStore.ts';
import { createControlPlane } from '../controlPlane.ts';
import { loadControlPlaneConfig } from '../runtime/config.ts';
import { recordEnv } from '../runtime/env.ts';
import { createTestClock } from '../runtime/clock.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createMemorySink } from '../observability/logger.ts';
import { createMockProvider } from '../providers/mockProvider.ts';
import { createAIAdministration } from '../admin/administration.ts';
import { createMemorySettingsStore } from '../admin/settingsStore.ts';
import type { AIProviderCredentialPolicy } from '../contracts/provider.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { ExecutionFundingResolver } from '../providers/credentials/executionFunding.ts';
import type { SpendStore } from '../policy/spendLedger.ts';
import { createProviderCredentialResolver } from '../providers/credentials/resolver.ts';
import type { SecretCipher } from '../providers/credentials/secretCipher.ts';
import {
  createSecretCipher,
  parseRootKey,
  unavailableSecretCipher,
} from '../providers/credentials/secretCipher.ts';
import { createMemoryProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import type { SelfHostedRegistrar } from '../providers/selfHosted/registrar.ts';
import { createSelfHostedRegistrar } from '../providers/selfHosted/registrar.ts';
import { exposureReport, judgeExposureChange } from '../policy/exposure.ts';

export interface StubSubjectOptions {
  readonly subjectId?: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly memberships?: readonly SubjectMembership[];
  readonly actorType?: AuthenticatedSubject['actorType'];
}

/** Authenticator that accepts one token and rejects everything else. */
export function stubAuthenticator(
  token: string,
  options: StubSubjectOptions = {},
): AIAuthenticator {
  const subject: AuthenticatedSubject = {
    subjectId: options.subjectId ?? 'user-1',
    email: options.email ?? 'consultant@marq.test',
    actorType: options.actorType ?? 'team_user',
    globalRoles: options.roles ?? ['consultant'],
    memberships: options.memberships ?? [
      { organizationId: 'acme', slug: 'acme', tier: 'enterprise', roles: ['consultant'] },
    ],
  };
  return {
    authenticate: (authorization) =>
      Promise.resolve(authorization === `Bearer ${token}` ? subject : null),
  };
}

export interface TestPlane {
  readonly plane: AIControlPlane;
  readonly clock: MutableClock;
  readonly provider: MockProviderHandle;
  /** Secondary provider, registered after the primary. Used for failover. */
  readonly backup: MockProviderHandle;
  readonly logs: { level: string; line: string }[];
  readonly config: AIControlPlaneConfig;
  /** Transport for an authenticated team caller. */
  authorized(): { authorization: string; clientIp: string };
}

export const TEST_TOKEN = 'valid-team-token';

export interface TestPlaneOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly authenticator?: AIAuthenticator;
  /**
   * Declare the two mock providers as CREDENTIALED (AI-01 Batch 4C).
   *
   * Off by default, so every suite written before Batch 4C sees exactly the
   * plane it always saw. On, the mocks declare a credential policy and answer
   * `hasCredentials` through the injected resolver — the same port the real
   * adapters use — which is what lets the provider administration suites drive
   * the production credential path without a vendor account.
   */
  readonly credentialedProviders?: {
    readonly resolver: ProviderCredentialResolver;
    readonly policy: AIProviderCredentialPolicy;
  };
  /**
   * Extra model ids the primary mock declares, so a suite can exercise a model
   * allow list. Default: none, which is the plane every pre-4C suite sees.
   */
  readonly additionalPrimaryModelIds?: readonly string[];
  /** Provider registration order. Defaults to primary then backup. */
  readonly providersEnabled?: boolean;
  /**
   * Durable settings the plane re-reads from, so a test can model a second
   * isolate picking up a change it did not make.
   */
  readonly settingsSource?: { load(): Promise<AIOperationalSettings | undefined> };
  /**
   * Whose credentials a request may reach (AI-01 Batch 4D remediation).
   *
   * Off by default, so every suite written before 4D sees exactly the plane it
   * always saw: no resolver, every request `platform_allowed`. On, the plane
   * resolves funding once per request and carries it to the spend guard and to
   * every provider attempt — which is the wiring the BLOCKER-1 end-to-end case
   * exists to prove, and which cannot be proved by calling the resolver and the
   * credential layer separately.
   */
  readonly funding?: ExecutionFundingResolver;
  /**
   * Durable spend storage, so a suite can read the ledger the plane actually
   * reserved against rather than infer it.
   */
  readonly spendStore?: SpendStore;
}

export function buildTestPlane(options: TestPlaneOptions = {}): TestPlane {
  const clock = createTestClock();
  const sink: LogSink & { lines: { level: string; line: string }[] } = createMemorySink();

  const config = loadControlPlaneConfig(
    recordEnv({
      AI_PROVIDER_PREFERENCE: 'primary,backup',
      AI_LOG_LEVEL: 'debug',
      AI_RETRY_BASE_DELAY_MS: '0',
      AI_RETRY_JITTER_PERCENT: '0',
      AI_DEFAULT_ORGANIZATION_ID: 'acme',
      ...options.env,
    }),
  );

  const credentialed = options.credentialedProviders;
  const provider = createMockProvider({
    providerId: 'primary',
    priority: 1,
    ...(options.additionalPrimaryModelIds
      ? { additionalModelIds: options.additionalPrimaryModelIds }
      : {}),
    ...(credentialed
      ? { credentialPolicy: credentialed.policy, credentialResolver: credentialed.resolver }
      : {}),
  });
  const backup = createMockProvider({
    providerId: 'backup',
    priority: 2,
    ...(credentialed
      ? { credentialPolicy: credentialed.policy, credentialResolver: credentialed.resolver }
      : {}),
  });

  const plane = createControlPlane({
    config,
    authenticator: options.authenticator ?? stubAuthenticator(TEST_TOKEN),
    providers: [
      { adapter: provider, certification: 'certified' },
      { adapter: backup, certification: 'certified' },
    ],
    clock,
    ids: createSequentialIdFactory(),
    logSink: sink,
    settingsSource: options.settingsSource,
    funding: options.funding,
    spendStore: options.spendStore,
    // Backoff is asserted directly in the retry unit tests; here it only needs
    // to not spend real time.
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  return {
    plane,
    clock,
    provider,
    backup,
    logs: sink.lines,
    config,
    authorized: () => ({ authorization: `Bearer ${TEST_TOKEN}`, clientIp: '203.0.113.10' }),
  };
}

// ── AI administration harness (AI-01 Batch 2) ───────────────────────────────

/**
 * Tokens for the administrative role matrix.
 *
 * Every one of these resolves through the SAME authenticator port production
 * uses, so an RBAC test exercises the real `resolveAdminActor` against the real
 * subject shape rather than a hand-built actor. A test that constructs its own
 * `AIAdminActor` proves the capability table works and proves nothing about
 * whether a real Supabase user would ever reach it.
 */
export const ADMIN_TOKEN = {
  /** Platform operator. Global `super_admin`. */
  superAdmin: 'token-super-admin',
  /** Organization operator at `acme`. Global `admin`. */
  organizationAdmin: 'token-org-admin',
  /** Team operator at `acme`. Global `consultant` — read-only by design. */
  teamAdmin: 'token-team-admin',
  /** An authenticated team member with no administrative role at all. */
  member: 'token-member',
  /** Organization operator at a DIFFERENT tenant, for scope isolation. */
  otherOrganizationAdmin: 'token-other-org-admin',
  /** An owner of one organization — deliberately NOT the platform operator. */
  organizationOwner: 'token-org-owner',
  /**
   * A membership row with NO trusted team role behind it.
   *
   * The state an unstamped account with a leftover membership is in, and the
   * state a demotion leaves for as long as the row is stale. `app_metadata` is
   * the authority, so this subject administers nothing (H-A / HIGH-2).
   */
  membershipOnly: 'token-membership-only',
} as const;

const ADMIN_SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [ADMIN_TOKEN.superAdmin]: {
    subjectId: 'user-super',
    email: 'ops@marq.test',
    actorType: 'team_user',
    globalRoles: ['super_admin'],
    memberships: [{ organizationId: 'acme', tier: 'internal', roles: ['owner'] }],
  },
  [ADMIN_TOKEN.organizationAdmin]: {
    subjectId: 'user-org-admin',
    email: 'admin@acme.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['admin'] }],
  },
  [ADMIN_TOKEN.teamAdmin]: {
    subjectId: 'user-team-admin',
    email: 'lead@acme.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['consultant'] }],
  },
  [ADMIN_TOKEN.member]: {
    subjectId: 'user-member',
    email: 'member@acme.test',
    actorType: 'team_user',
    globalRoles: ['reviewer'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['reviewer'] }],
  },
  [ADMIN_TOKEN.otherOrganizationAdmin]: {
    subjectId: 'user-globex-admin',
    email: 'admin@globex.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [{ organizationId: 'globex', tier: 'standard', roles: ['admin'] }],
  },
  [ADMIN_TOKEN.organizationOwner]: {
    subjectId: 'user-org-owner',
    email: 'owner@acme.test',
    actorType: 'team_user',
    // The trusted team role and the membership row AGREE, which is the only
    // state a working account is in. It used to be `globalRoles: []` with the
    // row alone carrying `owner` — a membership standing in for authority, and
    // the fixture is now explicit that authority comes from the trusted field.
    // The membership-only shape is covered by `membershipOnly` below, where it
    // grants nothing.
    globalRoles: ['owner'],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['owner'] }],
  },
  [ADMIN_TOKEN.membershipOnly]: {
    subjectId: 'user-membership-only',
    email: 'stale@acme.test',
    actorType: 'team_user',
    globalRoles: [],
    memberships: [{ organizationId: 'acme', tier: 'enterprise', roles: ['org_admin'] }],
  },
};

/** Authenticator over the administrative role matrix. Unknown tokens fail. */
export function adminAuthenticator(): AIAuthenticator {
  return {
    authenticate(authorization) {
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
        return Promise.resolve(null);
      }
      return Promise.resolve(ADMIN_SUBJECTS[authorization.slice('Bearer '.length)] ?? null);
    },
  };
}

export interface TestAdministration extends TestPlane {
  readonly admin: AIAdministration;
  readonly settingsStore: AdminSettingsStore & { readonly saves: number };
  /**
   * Provider administration storage (AI-01 Batch 4C), exposed so a suite can
   * assert on what STORAGE holds rather than only on what the API returns.
   *
   * That distinction is the whole point of exposing it: "the response carries
   * no plaintext" and "no plaintext was persisted" are different claims, and a
   * test that only reads the API can make the first one.
   */
  readonly providerStore: ReturnType<typeof createMemoryProviderAdministrationStore>;
  readonly credentialCipher: SecretCipher;
  /**
   * The self-hosted provider registrar (AI-01 Batch 4E), when the suite asked
   * for one. Exposed so a test can assert on hydration outcomes directly.
   */
  readonly selfHostedProviders?: SelfHostedRegistrar;
  /** Endpoints the injected transport saw. Empty unless a suite drove one. */
  readonly selfHostedOutbound: string[];
  /** Authorize by role token. Rejects exactly as production would. */
  actor(token: string): ReturnType<AIAdministration['authorize']>;
}

export interface TestAdministrationOptions extends TestPlaneOptions {
  readonly settingsStore?: AdminSettingsStore & { readonly saves: number };
  /**
   * Withhold managed credential storage, to model a deployment that has not
   * configured it. Every read still works; every credential write refuses.
   */
  readonly withoutProviderStore?: boolean;
  /**
   * Withhold the encryption root key, to model a deployment with no
   * `AI_CREDENTIAL_ENCRYPTION_KEY`. The cipher then REFUSES rather than
   * degrading, which is the behaviour under test.
   */
  readonly withoutCredentialCipher?: boolean;
  /**
   * Leave the mock providers keyless, as they are outside Batch 4C.
   *
   * The administration harness declares them credentialed by DEFAULT, because
   * that is the state the provider administration surface exists to manage. A
   * suite asserting what happens to a provider that accepts no credential turns
   * it off.
   */
  readonly keylessProviders?: boolean;
  /**
   * Enable self-hosted provider administration (AI-01 Batch 4E).
   *
   * OFF BY DEFAULT, exactly as the deployment switch is, so every existing
   * suite keeps the estate it had. On, the harness builds the real registrar
   * over the same provider store the administration service writes to — which
   * is what production wires — and injects a transport that records the URL and
   * never reaches a network.
   */
  readonly selfHostedProviders?: boolean;
  /** Pass the local-development endpoint exception through to the policy. */
  readonly allowPrivateEndpoints?: boolean;
}

/**
 * A deterministic 32-byte root key for tests.
 *
 * A FIXED value, and only ever in this file. It is a test constant, not a
 * secret: the suites that use it assert that a sealed record is unreadable
 * WITHOUT it, which is a claim you cannot make against a key you do not know.
 * Production reads its key from the deployment environment and shares nothing
 * with this.
 */
export const TEST_CREDENTIAL_ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

/**
 * Build a real control plane with a real administration service over it.
 *
 * Nothing between the test and production behaviour is stubbed except time,
 * identifiers and durable storage. The plane, the RBAC resolver, the settings
 * overlay, the provider registry, the spend ledger, the policy engine and the
 * administrative audit writer are all the production implementations.
 */
export function buildTestAdministration(
  options: TestAdministrationOptions = {},
): TestAdministration {
  const settingsStore = options.settingsStore ?? createMemorySettingsStore();

  // Provider administration storage and cipher (AI-01 Batch 4C). Built BEFORE
  // the plane, because the credential resolver the adapters take reads them and
  // the adapters are constructed with the plane.
  const providerStore = createMemoryProviderAdministrationStore();
  const credentialCipher = options.withoutCredentialCipher
    ? unavailableSecretCipher()
    : createSecretCipher(parseRootKey(TEST_CREDENTIAL_ROOT_KEY));

  /**
   * The credential policy the harness's mock providers declare.
   *
   * `MOCK_PROVIDER_KEY` is a fictional variable name — it is not any vendor's
   * contract, and the boundary scan's list of real credential variables does
   * not contain it. Naming one at all matters: it makes the ENVIRONMENT
   * compatibility source reachable in tests, so the precedence rule (managed
   * beats environment, environment beats nothing) is exercised rather than
   * asserted.
   */
  const credentialPolicy: AIProviderCredentialPolicy = {
    required: true,
    manageable: true,
    environmentVariable: 'MOCK_PROVIDER_KEY',
  };
  /**
   * Declared BEFORE the resolver and assigned after, so the resolver can read
   * the registrar's profiles lazily (AI-01 Batch 4E remediation).
   *
   * This is the same cycle `bootstrap.ts` breaks, for the same reason: the
   * resolver needs the registrar's profiles and the registrar needs a plane
   * that needs the resolver. Production resolves it with a getter; so does
   * this. An independent review found the harness omitted the wiring
   * altogether, which made a credential-optional self-hosted provider report
   * `configured: false` here and `true` in production — the sort of gap that
   * lets a suite pass on behaviour the deployment does not have.
   */
  let selfHostedProviders: SelfHostedRegistrar | undefined;
  const credentialResolver = createProviderCredentialResolver({
    profiles: ['primary', 'backup'].map((providerId) => ({
      providerId,
      required: true,
      manageable: true,
      environmentVariable: credentialPolicy.environmentVariable,
    })),
    clock: createTestClock(),
    env: recordEnv({ MOCK_PROVIDER_KEY: 'harness-environment-credential' }),
    store: options.withoutProviderStore ? undefined : providerStore,
    cipher: credentialCipher,
    // EXACTLY `bootstrap.ts`. Profiles for providers registered after this
    // resolver was built, read on every call, and beaten by the static
    // profiles above on any conflict — so no stored definition can change how
    // a reviewed adapter resolves.
    additionalProfiles: () => selfHostedProviders?.profiles() ?? [],
  });
  // ONE authenticator instance, shared by the plane and the administration
  // service. Production shares it for a reason — two credential paths for one
  // platform is two things to get wrong — and the harness must not accidentally
  // make a test pass that production's single path would fail.
  const authenticator = options.authenticator ?? adminAuthenticator();
  // The plane re-reads settings from the same store the administration service
  // writes to. Production wires exactly this, for exactly this reason: an
  // administrator's change has to reach isolates that did not serve the change.
  const base = buildTestPlane({
    ...options,
    authenticator,
    settingsSource: settingsStore,
    ...(options.keylessProviders
      ? {}
      : { credentialedProviders: { resolver: credentialResolver, policy: credentialPolicy } }),
  });

  // ── Self-hosted provider registrar (AI-01 Batch 4E) ───────────────────────
  //
  // The SAME store the administration service writes to and the SAME resolver
  // the adapters hold — which is what `bootstrap.ts` wires. Its transport
  // records and never dials.
  const selfHostedOutbound: string[] = [];
  selfHostedProviders = options.selfHostedProviders
    ? createSelfHostedRegistrar({
        registry: () => base.plane.providers,
        credentials: () => credentialResolver,
        store: options.withoutProviderStore ? undefined : providerStore,
        enabled: true,
        allowPrivateEndpoints: options.allowPrivateEndpoints,
        fetchImpl: (url) => {
          selfHostedOutbound.push(String(url));
          return Promise.resolve(
            Response.json({
              choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          );
        },
        now: () => base.clock.isoNow(),
        // The SAME exposure decision `bootstrap.ts` wires. A harness that
        // omitted it would let a suite pass on a path production refuses.
        admissionGuard: (candidate) => {
          const catalogue = base.plane.providers.list().map((provider) => ({
            providerId: provider.descriptor.providerId,
            billable: provider.descriptor.billable,
            models: provider.descriptor.models,
          }));
          const verdict = judgeExposureChange(
            exposureReport(base.plane.catalog.list(), catalogue),
            exposureReport(base.plane.catalog.list(), [
              ...catalogue.filter((entry) => entry.providerId !== candidate.providerId),
              { providerId: candidate.providerId, billable: true, models: candidate.models },
            ]),
            base.plane.config.spend.maxPlatformMicroUsd,
          );
          return verdict.permitted
            ? undefined
            : `governed spending exposure would exceed the platform ceiling: ${verdict.reason}`;
        },
      })
    : undefined;

  const admin = createAIAdministration({
    plane: base.plane,
    authenticator,
    settingsStore,
    clock: base.clock,
    ids: createSequentialIdFactory('adm'),
    logger: base.plane.logger,
    providerStore: options.withoutProviderStore ? undefined : providerStore,
    credentialCipher,
    selfHostedProviders,
    allowPrivateEndpoints: options.allowPrivateEndpoints,
    // THE SAME resolver the adapters hold. Production wires exactly this, so a
    // credential stored through the console is visible to the runtime without
    // waiting for a snapshot to expire — and a harness that built two would
    // make a test pass that production would fail.
    credentialResolver,
  });

  return {
    ...base,
    admin,
    settingsStore,
    providerStore,
    credentialCipher,
    selfHostedProviders,
    selfHostedOutbound,
    actor: (token) => admin.authorize(`Bearer ${token}`),
  };
}

/** A minimal valid narrative request body. */
export function narrativeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'why_now',
    context: {
      company: 'Acme Industrial',
      industry: 'Manufacturing',
      employee_estimate: 240,
      current_version: 'v3',
      assumptions: { support_tickets_per_week: 180, monthly_revenue: 950_000 },
      top_recommendation: {
        problem_title: 'Manual intake handoffs',
        severity_score: 8,
        confidence_score: 72,
        priority_score: {
          impact_score: 9,
          feasibility_score: 7,
          risk_score: 3,
          computed_priority: 8.1,
        },
        why_first: 'Constraint resolution precedes optimisation.',
      },
      recommendation_count: 5,
    },
    ...overrides,
  };
}

/** A minimal valid section copilot request body with fact-locked fields. */
export function sectionCopilotInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    section: 'next_step_offer',
    section_label: 'Next Step Offer',
    action: 'improve',
    current_content: {
      offer_name: 'Diagnostic Audit',
      price: 12_000,
      currency: 'USD',
      duration: 'Days 1-10',
      primary_cta: 'Get Started',
    },
    context: { company: 'Acme Industrial', industry: 'Manufacturing' },
    ...overrides,
  };
}
