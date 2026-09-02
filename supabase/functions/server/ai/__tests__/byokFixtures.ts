/**
 * Fixtures for the customer BYOK suites — AI-01 Batch 4D.
 *
 * WHAT IS AND IS NOT SUBSTITUTED, STATED FIRST, BECAUSE IT DECIDES WHAT A GREEN
 * RUN MEANS.
 *
 * Substituted: time, identifiers, the storage backend, and the identity
 * provider's answer about who a bearer token belongs to.
 *
 * NOT substituted: the real BYOK service, the real capability table, the real
 * `resolveOrganization`, the real `flooredRolesFor`, the real AES-256-GCM
 * cipher, the real credential resolver with its real precedence, the real
 * audited-mutation runner and the real append-only trail. A test that passes
 * here is making a claim about production.
 *
 * The memory store has the same one-active-credential semantics the durable one
 * enforces with a partial unique index, and the same tenant-keyed lookups —
 * both of which are independently proved against a real PostgreSQL by
 * `scripts/ai-customer-byok-scenarios.mjs`. Neither suite is sufficient alone:
 * this one proves the service asks the right questions, that one proves the
 * schema gives the right answers.
 *
 * ── THREE TENANTS, AND WHY THREE ──────────────────────────────────────────
 *
 *   acme     A customer with an administrator.
 *   globex   A SECOND customer with their own administrator. Every isolation
 *            claim is meaningless with one tenant: a query with no tenant
 *            predicate returns the right answer when there is only one
 *            customer, and returns everybody's when there are two.
 *   marq     The platform. Its operator holds `super_admin` and, on this
 *            surface, deliberately holds nothing.
 */

import type { AIAuthenticator, AuthenticatedSubject } from '../security/actor.ts';
import type { OrganizationResolutionOptions } from '../security/tenancy.ts';
import type { AdminAuditRecord } from '../admin/adminAudit.ts';
import type { ByokProviderCatalogueEntry } from '../byok/byokAdministration.ts';
import type { ByokService } from '../byok/byokService.ts';
import type { ByokSpendSource } from '../byok/byokAdministration.ts';
import type { ProviderCredentialResolver } from '../providers/credentials/contracts.ts';
import type { ProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import type { SecretCipher } from '../providers/credentials/secretCipher.ts';

import { createAdminAuditWriter, createMemoryAdminAuditStore } from '../admin/adminAudit.ts';
import { createByokAdministration } from '../byok/byokAdministration.ts';
import { createByokService } from '../byok/byokService.ts';
import { createMemoryProviderAdministrationStore } from '../providers/credentials/credentialStore.ts';
import { createProviderCredentialResolver } from '../providers/credentials/resolver.ts';
import {
  createSecretCipher,
  parseRootKey,
  unavailableSecretCipher,
} from '../providers/credentials/secretCipher.ts';
import { createSequentialIdFactory } from '../contracts/ids.ts';
import { createTestClock } from '../runtime/clock.ts';
import { recordEnv } from '../runtime/env.ts';
import { createLogger, createMemorySink } from '../observability/logger.ts';

/** The root key every BYOK suite seals under. Fictional, and test-local. */
export const BYOK_ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

/**
 * A SECOND, entirely fictional root key.
 *
 * Used to produce the one state the root key policy exists for: a stored
 * credential sealed under a key the deployment no longer holds.
 */
export const BYOK_PREVIOUS_ROOT_KEY = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';

export const ORG = { acme: 'acme', globex: 'globex', marq: 'marq' } as const;

/** The provider the customer surface administers in these suites. */
export const BYOK_PROVIDER = 'openai';

/** A plausible-looking, entirely fictional credential. Never a real key. */
export const ACME_SECRET = 'sk-acme-4d-0123456789abcdefghijklmnop';
export const ACME_ROTATED = 'sk-acme-4d-rotated-zyxwvutsrqponmlkji';
export const GLOBEX_SECRET = 'sk-globex-4d-abcdefghijklmnopqrstuv';
export const PLATFORM_SECRET = 'sk-marq-4d-platform-000000000000000';
export const ENVIRONMENT_SECRET = 'sk-marq-4d-environment-0000000000';

export const BYOK_REASON = 'batch 4d verification';

export const BYOK_TOKEN = {
  /** Administrator of Acme. Holds `ai.byok.view` and `ai.byok.manage`. */
  acmeAdmin: 'token-acme-admin',
  /** Administrator of Globex. The other customer. */
  globexAdmin: 'token-globex-admin',
  /** An ordinary member of Acme. Holds NOTHING on this surface. */
  acmeMember: 'token-acme-member',
  /** A consultant at Acme — a real role, and not an administrative one. */
  acmeConsultant: 'token-acme-consultant',
  /**
   * The MARQ platform operator. `super_admin`, no customer membership.
   *
   * Deliberately holds nothing here: a platform operator has no tenant
   * identity, so there is no organization whose BYOK they administer.
   */
  platformOperator: 'token-platform-operator',
  /**
   * An account with an `org_admin` MEMBERSHIP ROW and no trusted team role.
   *
   * The state a demotion leaves for as long as the row is stale, and the state
   * an unstamped account with a leftover membership is in. `app_metadata` is
   * the authority, so this subject administers nothing.
   */
  membershipOnly: 'token-membership-only',
  /** An administrator of BOTH customers. Must name which one they mean. */
  dualAdmin: 'token-dual-admin',
  /** Authenticates, belongs to no organization at all. */
  orphan: 'token-orphan',
} as const;

const SUBJECTS: Readonly<Record<string, AuthenticatedSubject>> = {
  [BYOK_TOKEN.acmeAdmin]: {
    subjectId: 'user-acme-admin',
    email: 'admin@acme.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [{ organizationId: ORG.acme, tier: 'enterprise', roles: ['org_admin'] }],
  },
  [BYOK_TOKEN.globexAdmin]: {
    subjectId: 'user-globex-admin',
    email: 'admin@globex.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [{ organizationId: ORG.globex, tier: 'standard', roles: ['org_admin'] }],
  },
  [BYOK_TOKEN.acmeMember]: {
    subjectId: 'user-acme-member',
    email: 'member@acme.test',
    actorType: 'team_user',
    globalRoles: ['reviewer'],
    memberships: [{ organizationId: ORG.acme, tier: 'enterprise', roles: ['team_member'] }],
  },
  [BYOK_TOKEN.acmeConsultant]: {
    subjectId: 'user-acme-consultant',
    email: 'consultant@acme.test',
    actorType: 'team_user',
    globalRoles: ['consultant'],
    memberships: [{ organizationId: ORG.acme, tier: 'enterprise', roles: ['team_member'] }],
  },
  [BYOK_TOKEN.platformOperator]: {
    subjectId: 'user-platform-operator',
    email: 'ops@marq.test',
    actorType: 'team_user',
    globalRoles: ['platform_admin'],
    memberships: [],
  },
  [BYOK_TOKEN.membershipOnly]: {
    subjectId: 'user-membership-only',
    email: 'stale@acme.test',
    actorType: 'team_user',
    globalRoles: [],
    memberships: [{ organizationId: ORG.acme, tier: 'enterprise', roles: ['org_admin'] }],
  },
  [BYOK_TOKEN.dualAdmin]: {
    subjectId: 'user-dual-admin',
    email: 'consultant@both.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [
      { organizationId: ORG.acme, tier: 'enterprise', roles: ['org_admin'] },
      { organizationId: ORG.globex, tier: 'standard', roles: ['org_admin'] },
    ],
  },
  [BYOK_TOKEN.orphan]: {
    subjectId: 'user-orphan',
    email: 'nobody@nowhere.test',
    actorType: 'team_user',
    globalRoles: ['admin'],
    memberships: [],
  },
};

/** Authenticator over the BYOK role matrix. Unknown tokens fail. */
export function byokAuthenticator(): AIAuthenticator {
  return {
    authenticate(authorization) {
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
        return Promise.resolve(null);
      }
      return Promise.resolve(SUBJECTS[authorization.slice('Bearer '.length)] ?? null);
    },
  };
}

/**
 * An authenticator whose memberships are marked as coming from a CACHE.
 *
 * Not a shortcut: `membershipsFromCache` is a real field the Supabase
 * authenticator sets when it answers an ordinary request from its snapshot, and
 * this surface must refuse it. Building it here rather than mutating a subject
 * keeps the refusal a property of the code under test.
 */
export function cachedMembershipAuthenticator(): AIAuthenticator {
  const inner = byokAuthenticator();
  return {
    async authenticate(authorization, context) {
      const subject = await inner.authenticate(authorization, context);
      return subject === null ? null : { ...subject, membershipsFromCache: true };
    },
  };
}

export const BYOK_ORGANIZATION_OPTIONS: OrganizationResolutionOptions = {
  defaultOrganizationId: ORG.marq,
  allowList: [],
  // FALSE, which is production's own default and the only setting under which
  // "a subject with no membership resolves no tenant" is testable at all.
  // `allowDefaultOrganization` is exercised separately, where the point is that
  // it still buys no BYOK authority.
  allowDefaultOrganization: false,
};

/** The catalogue the BYOK service reads. Non-secret descriptor facts only. */
export function byokCatalogue(
  overrides: Partial<ByokProviderCatalogueEntry> = {},
): readonly ByokProviderCatalogueEntry[] {
  return [
    {
      providerId: BYOK_PROVIDER,
      displayName: 'OpenAI',
      billable: true,
      certification: 'certified',
      enabled: true,
      // The runtime can serve it. Suites that need the opposite say so through
      // `degradeCatalogue({ runtimeSelectable: false })`, which is the state a
      // deployment is in by default — `AI_ALLOW_REAL_REQUESTS` is false unless
      // an operator turns it on.
      runtimeSelectable: true,
      credential: {
        required: true,
        manageable: true,
        credentialFormatHint: 'OpenAI secret API key',
      },
      ...overrides,
    },
    {
      providerId: 'anthropic',
      displayName: 'Anthropic',
      billable: true,
      certification: 'certified',
      enabled: true,
      runtimeSelectable: true,
      credential: { required: true, manageable: true },
    },
    {
      // The synthetic provider. `manageable: false`, so it must never appear on
      // the customer surface and must never accept a credential — refused by
      // DESCRIPTOR rather than by a provider-id comparison, so a future keyless
      // adapter is refused too with no edit anywhere.
      providerId: 'mock',
      displayName: 'Synthetic',
      billable: false,
      certification: 'testing',
      enabled: true,
      runtimeSelectable: true,
      credential: { required: false, manageable: false },
    },
  ];
}

export interface ByokHarness {
  readonly byok: ByokService;
  readonly store: ReturnType<typeof createMemoryProviderAdministrationStore>;
  readonly cipher: SecretCipher;
  readonly resolver: ProviderCredentialResolver;
  /** The append-only administrative trail, newest first. */
  trail(limit?: number): readonly AdminAuditRecord[];
  /** Every log line the service emitted, as JSON text. */
  readonly logs: readonly string[];
  readonly clock: ReturnType<typeof createTestClock>;
  /** Authorize by role token, for one organization. Rejects as production does. */
  actor(token: string, organizationHint?: string): ReturnType<ByokService['authorize']>;
  /** Provider-neutral credential resolution failures the resolver reported. */
  readonly resolutionErrors: readonly string[];
  /**
   * Change what MARQ's catalogue says about the BYOK provider, mid-flight.
   *
   * The catalogue is read on EVERY call rather than captured at construction,
   * exactly as production reads the live registry — so this models what
   * actually happens when MARQ decertifies or disables a provider after a
   * customer has already stored a key for it. Arranging that state any other
   * way would mean building a second harness, which could not hold the
   * credential the first one stored.
   */
  degradeCatalogue(overrides: Partial<ByokProviderCatalogueEntry>): void;
}

export interface ByokHarnessOptions {
  /** Model a deployment with no root key: every credential write refuses. */
  readonly withoutCipher?: boolean;
  /** Model a deployment with no durable storage. */
  readonly withoutStore?: boolean;
  /** Override the provider catalogue's first entry. */
  readonly catalogueOverrides?: Partial<ByokProviderCatalogueEntry>;
  readonly authenticator?: AIAuthenticator;
  readonly organizationOptions?: OrganizationResolutionOptions;
  /** Deployment environment, for the compatibility source. */
  readonly env?: Record<string, string>;
  /** Seal the root key under a DIFFERENT key than the one the resolver holds. */
  readonly resolverRootKey?: string;
  /**
   * The store the RUNTIME reads through, when it must differ from the one the
   * administration surface writes through (BLOCKER-1 adversarial suite).
   *
   * The certified defect is a STORAGE FAULT on the execution path, and proving
   * containment against it requires arranging real state — a real `tenant_only`
   * declaration, a real sealed credential, written by the real service — and
   * then making the runtime's own read of that state fail. One store cannot do
   * both: a store that refuses the write cannot hold the row the test is about.
   *
   * So this substitutes ONLY the read path, and only where a test asks for it.
   * `harness.store` and the BYOK service keep the real memory store, so every
   * fixture arrangement still goes through production code.
   */
  readonly resolverStore?: ProviderAdministrationStore;
  /**
   * The organization's own spend ledger, for the HIGH-1 customer read.
   *
   * Absent, the spend operation refuses with a stated reason — the behaviour a
   * deployment without a ledger gets, and the behaviour every suite written
   * before HIGH-1 continues to see.
   */
  readonly spend?: ByokSpendSource;
}

/**
 * Build the BYOK surface over real everything.
 *
 * The store, the cipher and the resolver are ONE of each, shared exactly as
 * production shares them. Two stores would let the console write a credential
 * the runtime reads through a different snapshot; two ciphers would let one be
 * sealed under a key the other does not hold. A harness that built two would
 * make a test pass that production would fail.
 */
export function buildByokHarness(options: ByokHarnessOptions = {}): ByokHarness {
  const clock = createTestClock();
  const sink = createMemorySink();
  // STRUCTURED, so a "does the secret appear anywhere in what was written"
  // scan reads the same JSON a production log aggregator would receive rather
  // than a formatted line that might have dropped a field.
  const logger = createLogger({ sink, level: 'debug', structured: true });
  const store = createMemoryProviderAdministrationStore();
  const cipher = options.withoutCipher
    ? unavailableSecretCipher()
    : createSecretCipher(parseRootKey(BYOK_ROOT_KEY));

  const resolutionErrors: string[] = [];
  const resolver = createProviderCredentialResolver({
    profiles: byokCatalogue().map((entry) => ({
      providerId: entry.providerId,
      required: entry.credential.required,
      manageable: entry.credential.manageable,
      environmentVariable: 'MOCK_PROVIDER_KEY',
    })),
    clock,
    env: recordEnv(options.env ?? {}),
    store: options.withoutStore ? undefined : (options.resolverStore ?? store),
    // The resolver may hold a DIFFERENT root key than the one the service seals
    // under, which is the only way to produce a credential that exists and will
    // not open without corrupting a record by hand.
    cipher: options.resolverRootKey
      ? createSecretCipher(parseRootKey(options.resolverRootKey))
      : cipher,
    scope: 'platform',
    onError: (providerId, detail) => resolutionErrors.push(`${providerId}: ${detail}`),
  });

  const trailStore = createMemoryAdminAuditStore(200);
  const ids = createSequentialIdFactory('byok');
  const trail = createAdminAuditWriter({
    store: trailStore,
    clock,
    newAuditId: () => ids.next('adm'),
  });

  let catalogueOverrides = options.catalogueOverrides ?? {};

  const byok = createByokService({
    authenticator: options.authenticator ?? byokAuthenticator(),
    organizationOptions: options.organizationOptions ?? BYOK_ORGANIZATION_OPTIONS,
    trail,
    administration: createByokAdministration({
      catalogue: () => byokCatalogue(catalogueOverrides),
      store: options.withoutStore ? undefined : store,
      cipher,
      credentials: resolver,
      trail,
      spend: options.spend,
      clock,
      ids,
      logger,
    }),
  });

  return {
    byok,
    store,
    cipher,
    resolver,
    clock,
    trail: (limit = 100) => trail.recent(limit),
    logs: sink.lines.map((entry) => entry.line),
    degradeCatalogue(overrides) {
      catalogueOverrides = { ...catalogueOverrides, ...overrides };
    },
    resolutionErrors,
    actor: (token, organizationHint) => byok.authorize(`Bearer ${token}`, organizationHint),
  };
}

/**
 * Store a credential for one tenant, the way the surface does.
 *
 * A helper for arranging state, deliberately going through the REAL service
 * rather than writing a row: a fixture that inserted storage directly would let
 * a suite arrange a state the service cannot actually produce, and then assert
 * something about it.
 */
export async function configureFor(
  harness: ByokHarness,
  token: string,
  secret: string,
  providerId: string = BYOK_PROVIDER,
): Promise<void> {
  const actor = await harness.actor(token);
  await harness.byok.configureCredential(
    actor,
    providerId,
    { secret },
    BYOK_REASON,
  );
}

/** Every JSON log line and audit record, flattened for a "does X appear" scan. */
export function everythingWritten(harness: ByokHarness): string {
  return [...harness.logs, JSON.stringify(harness.trail(500))].join('\n');
}
