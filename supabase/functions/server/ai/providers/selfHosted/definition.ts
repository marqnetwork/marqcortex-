/**
 * Self-hosted provider definitions — AI-01 Batch 4E.
 *
 * Turns ONE `cortex.ai_provider_configuration` row into a validated runtime
 * definition, or into a refusal that says why. Nothing else in the platform is
 * allowed to interpret that column.
 *
 * ── WHY THE CONFIGURATION IS A FLAT MAP OF STRINGS ─────────────────────────
 *
 * `AIProviderConfigurationRecord.configuration` is
 * `Readonly<Record<string, string>>` and the JSONB column behind it is
 * constrained to an object. This module keeps it FLAT and keeps every value a
 * STRING, and refuses anything else — including a nested object, an array, a
 * number and a null. A nested blob would be a second, unvalidated schema living
 * inside a validated one, and the whole reason this file exists is that a
 * column the runtime dials cannot have an unvalidated corner.
 *
 * Models are therefore declared with indexed keys rather than as JSON:
 *
 *   runtime                        openai_compatible          (the only value)
 *   baseUrl                        https://llm.example.com/v1
 *   credentialRequired             true | false
 *   priority                       1..1000                    (optional)
 *   deploymentId                   a bounded slug             (optional)
 *   model.0.id                     llama-3.3-70b-instruct
 *   model.0.displayName            Llama 3.3 70B              (optional)
 *   model.0.textGeneration         true | false
 *   model.0.structuredOutput       true | false
 *   model.0.chatCompletions        true | false
 *   model.0.zeroDataRetention      true | false
 *   model.0.maxOutputTokens        a positive integer
 *   model.0.maxContextTokens       a positive integer
 *   model.0.promptMicroUsdPer1k    a non-negative integer
 *   model.0.completionMicroUsdPer1k a non-negative integer
 *
 * THE KEY SET IS AN ALLOW LIST. An unrecognised key fails the whole definition
 * rather than being ignored: a key nobody validated is a key somebody expected
 * to have an effect, and silently dropping it is how an operator comes to
 * believe they configured something they did not.
 *
 * ── WHAT THE ROW MAY NOT DECIDE ────────────────────────────────────────────
 *
 * `billable` and `productionReady` are NOT configuration fields, and that is a
 * security decision rather than an omission.
 *
 *   `billable` IS ALWAYS TRUE. A self-hosted endpoint performs a real outbound
 *   request to a real model, and "self-hosted" is a deployment topology, not a
 *   promise that nobody is charging for it — an OpenAI-compatible URL can just
 *   as easily be a paid hosted inference vendor. `AI_ALLOW_REAL_REQUESTS` is
 *   the platform's authoritative kill switch and it is built on this flag, so
 *   letting a configuration row set `billable: false` would be publishing a
 *   documented way to walk around the kill switch. Zero COST remains fully
 *   expressible — a model may declare `0` micro-USD — and that is the honest
 *   place for "this costs us nothing".
 *
 *   `productionReady` IS DERIVED FROM CERTIFICATION, never declared. It is
 *   `certification === 'certified'`, read from the row's own governed column.
 *   The registry promotes a provider out of `unverified` on its first success
 *   and promotes it to `certified` when the descriptor says production ready —
 *   so a self-declared `productionReady` would mean one successful call to an
 *   operator's own endpoint silently certifies it. Connection is not
 *   certification, and this is where that stops being a slogan.
 *
 * ── WHAT A MODEL ROW CAN AND CANNOT DO ─────────────────────────────────────
 *
 * `cortex.ai_provider_model` rows administer ENABLEMENT and certification state
 * for models the definition already declares. They cannot create one: the
 * descriptor's model list comes from here and from nowhere else, and the
 * registry's allow list can only narrow what a descriptor declares. Typing a
 * model id into storage therefore produces an administered row for something
 * the runtime does not serve, which is the correct outcome and is pinned by
 * test.
 */

import type {
  AIModelDescriptor,
  AIProviderDescriptor,
} from '../../contracts/provider.ts';
import type {
  AIProviderCertificationState,
  AIProviderConfigurationRecord,
} from '../credentials/credentialStore.ts';
import type { CredentialProviderProfile } from '../credentials/resolver.ts';
import type { EndpointPolicyOptions, ValidatedEndpoint } from './endpointPolicy.ts';
import { validateEndpoint } from './endpointPolicy.ts';

/**
 * The runtime categories this batch supports.
 *
 * ONE VALUE, and a union rather than a bare string so adding a second runtime
 * is a type error everywhere it has to be handled. "Ollama", "vLLM",
 * "LM Studio" and "LocalAI" are NOT separate values: they are deployments of
 * one wire format, and giving each a vendor branch would rebuild the
 * per-vendor adapter sprawl the control plane exists to prevent.
 */
export const SELF_HOSTED_RUNTIMES = ['openai_compatible'] as const;
export type SelfHostedRuntime = (typeof SELF_HOSTED_RUNTIMES)[number];

/** The key that marks a configuration row as a 4E runtime definition. */
export const RUNTIME_KEY = 'runtime';

const SCALAR_KEYS = [
  RUNTIME_KEY,
  'baseUrl',
  'credentialRequired',
  'priority',
  'deploymentId',
] as const;

const MODEL_FIELDS = [
  'id',
  'displayName',
  'textGeneration',
  'structuredOutput',
  'chatCompletions',
  'zeroDataRetention',
  'maxOutputTokens',
  'maxContextTokens',
  'promptMicroUsdPer1k',
  'completionMicroUsdPer1k',
] as const;

const MODEL_KEY = /^model\.(\d{1,2})\.([A-Za-z0-9]+)$/;

/** Provider ids owned by reviewed adapters. A row may never claim one. */
export const RESERVED_PROVIDER_IDS: readonly string[] = ['openai', 'anthropic', 'mock'];

/** Matches the database's own `provider_key` CHECK constraint, exactly. */
const PROVIDER_ID = /^[a-z][a-z0-9_-]{1,63}$/;

/** Bounded, auditable model identifier. Vendor-neutral by construction. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const MAX_SELF_HOSTED_MODELS = 12;
export const MAX_CONFIGURATION_KEYS = 160;
export const MAX_CONFIGURATION_VALUE_LENGTH = 2_048;
export const DEFAULT_SELF_HOSTED_PRIORITY = 500;

/**
 * Key-shaped configuration names.
 *
 * `configuration` is the NON-SECRET column and the credential table is the
 * secret one. A key called `apiKey` is somebody putting a secret in the wrong
 * place, and the fail-closed answer is to refuse the whole definition rather
 * than to store it and hope nothing prints it.
 */
const SECRET_SHAPED_KEY =
  /(secret|password|passwd|credential|authorization|auth[-_]?header|bearer|api[-_]?key|access[-_]?key|token|private[-_]?key|connection[-_]?string|dsn)/i;

export interface SelfHostedProviderDefinition {
  readonly providerId: string;
  readonly displayName: string;
  readonly runtime: SelfHostedRuntime;
  /** Only producible by the endpoint validator. Carries the URL to dial. */
  readonly endpoint: ValidatedEndpoint;
  readonly credentialRequired: boolean;
  readonly priority: number;
  readonly deploymentId?: string;
  readonly models: readonly AIModelDescriptor[];
  /** MARQ's governance decision, read from the row's own governed column. */
  readonly certification: AIProviderCertificationState;
  /** The operator's enable/disable switch, read from the row. */
  readonly administrativelyEnabled: boolean;
  readonly configurationId: string;
}

export type SelfHostedDefinitionResult =
  | { readonly ok: true; readonly definition: SelfHostedProviderDefinition }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Does this configuration row even claim to be a 4E runtime definition?
 *
 * Deliberately narrow: a Batch 4C row for OpenAI carries `{}` and must be
 * skipped in silence, while a row carrying a `runtime` key is claiming
 * something and must be validated or loudly refused.
 */
export function declaresSelfHostedRuntime(record: AIProviderConfigurationRecord): boolean {
  const configuration = record.configuration as Readonly<Record<string, unknown>> | undefined;
  return (
    configuration !== undefined &&
    configuration !== null &&
    typeof configuration === 'object' &&
    Object.prototype.hasOwnProperty.call(configuration, RUNTIME_KEY)
  );
}

export interface DefinitionOptions extends EndpointPolicyOptions {
  /** Provider ids already owned by a reviewed adapter. Never claimable. */
  readonly reservedProviderIds?: readonly string[];
}

/**
 * Validate one configuration row into a runtime definition.
 *
 * COLLECTS EVERY REASON rather than stopping at the first. An operator fixing a
 * definition should learn all of what is wrong with it in one pass; a validator
 * that reveals one problem per attempt trains people to guess.
 */
export function validateSelfHostedDefinition(
  record: AIProviderConfigurationRecord,
  options: DefinitionOptions = {},
): SelfHostedDefinitionResult {
  const reasons: string[] = [];
  const reserved = new Set(options.reservedProviderIds ?? RESERVED_PROVIDER_IDS);

  // ── Identity ──────────────────────────────────────────────────────────────
  const providerId = typeof record.providerKey === 'string' ? record.providerKey : '';
  if (!PROVIDER_ID.test(providerId)) {
    reasons.push('providerKey is not a valid provider id');
  } else if (reserved.has(providerId)) {
    // A stored row must never be able to shadow a reviewed adapter. This is the
    // difference between "an operator added a provider" and "an operator
    // repointed OpenAI at a host of their choosing".
    reasons.push(`providerKey ${providerId} is reserved for a built-in adapter`);
  }

  const displayName =
    typeof record.displayName === 'string' ? record.displayName.trim().slice(0, 120) : '';
  if (displayName === '') reasons.push('displayName is required');

  // ── The configuration map, structurally ───────────────────────────────────
  const raw = record.configuration as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasons: [...reasons, 'configuration is not an object'] };
  }
  const configuration = raw as Record<string, unknown>;
  const keys = Object.keys(configuration);
  if (keys.length > MAX_CONFIGURATION_KEYS) {
    return { ok: false, reasons: [...reasons, 'configuration declares too many keys'] };
  }

  const scalars = new Set<string>(SCALAR_KEYS);
  const modelFields = new Set<string>(MODEL_FIELDS);
  const modelValues = new Map<number, Map<string, string>>();

  // THE ALLOW LIST IS CONSULTED FIRST, and the order matters. The key set is
  // closed, so an unrecognised key is refused whatever it is called; the
  // key-material scan runs only over keys that were going to be refused anyway,
  // where its whole job is to make the REASON say what actually went wrong.
  // Running it first refused `credentialRequired` and `maxOutputTokens` for
  // containing the substrings "credential" and "token" — a validator that
  // rejects its own schema.
  for (const key of keys) {
    const value = configuration[key];
    const match = MODEL_KEY.exec(key);
    const recognised =
      scalars.has(key) || (match !== null && modelFields.has(match[2]));

    if (!recognised) {
      if (SECRET_SHAPED_KEY.test(key)) {
        // The VALUE is never echoed, here or anywhere downstream.
        reasons.push(`configuration key ${key} is shaped like key material`);
      } else if (match !== null) {
        reasons.push(`configuration key ${key} names an unrecognised model field`);
      } else {
        reasons.push(`configuration key ${key} is not a recognised setting`);
      }
      continue;
    }
    if (typeof value !== 'string') {
      reasons.push(`configuration key ${key} is not a string`);
      continue;
    }
    if (value.length > MAX_CONFIGURATION_VALUE_LENGTH) {
      reasons.push(`configuration key ${key} exceeds the value length bound`);
      continue;
    }
    if (match === null) continue;

    const index = Number.parseInt(match[1], 10);
    const bucket = modelValues.get(index) ?? new Map<string, string>();
    bucket.set(match[2], value);
    modelValues.set(index, bucket);
  }

  // ── Runtime ───────────────────────────────────────────────────────────────
  const runtimeValue = stringOf(configuration[RUNTIME_KEY]);
  const runtime = SELF_HOSTED_RUNTIMES.find((candidate) => candidate === runtimeValue);
  if (runtime === undefined) {
    reasons.push(
      `runtime must be one of ${SELF_HOSTED_RUNTIMES.join(', ')}`,
    );
  }

  // ── Endpoint ──────────────────────────────────────────────────────────────
  const endpointResult = validateEndpoint(configuration.baseUrl, {
    allowPrivateEndpoints: options.allowPrivateEndpoints,
  });
  if (endpointResult.ok !== true) {
    reasons.push(`baseUrl rejected (${endpointResult.code}): ${endpointResult.detail}`);
  }

  // ── Credential requirement ────────────────────────────────────────────────
  //
  // REQUIRED TO BE EXPLICIT. "Does this endpoint need a key?" has no safe
  // default: assuming yes makes a keyless Ollama unusable, assuming no makes a
  // secured endpoint silently unauthenticated. So the row states it.
  const credentialRequired = booleanOf(configuration.credentialRequired);
  if (credentialRequired === undefined) {
    reasons.push('credentialRequired must be explicitly "true" or "false"');
  }

  // ── Priority ──────────────────────────────────────────────────────────────
  let priority = DEFAULT_SELF_HOSTED_PRIORITY;
  if (configuration.priority !== undefined) {
    const parsed = integerOf(configuration.priority, { min: 1, max: 1_000 });
    if (parsed === undefined) reasons.push('priority must be an integer between 1 and 1000');
    else priority = parsed;
  }

  // ── Deployment identifier ─────────────────────────────────────────────────
  let deploymentId: string | undefined;
  if (configuration.deploymentId !== undefined) {
    const value = stringOf(configuration.deploymentId);
    if (value === undefined || !DEPLOYMENT_ID.test(value)) {
      reasons.push('deploymentId is not a valid identifier');
    } else {
      deploymentId = value;
    }
  }

  // ── Models ────────────────────────────────────────────────────────────────
  const models = parseModels(providerId, modelValues, reasons);

  const certification = certificationOf(record.certification);
  if (certification === undefined) {
    reasons.push('certification is not a recognised state');
  }

  if (
    reasons.length > 0 ||
    runtime === undefined ||
    endpointResult.ok !== true ||
    credentialRequired === undefined ||
    certification === undefined ||
    models === undefined
  ) {
    // FAIL CLOSED. A definition with any unresolved question does not become a
    // descriptor, is not registered, and its endpoint is never dialled.
    return { ok: false, reasons: reasons.length > 0 ? reasons : ['the definition is incomplete'] };
  }

  return {
    ok: true,
    definition: {
      providerId,
      displayName,
      runtime,
      endpoint: endpointResult.endpoint,
      credentialRequired,
      priority,
      deploymentId,
      models,
      certification,
      administrativelyEnabled: record.enabled === true,
      configurationId: record.configurationId,
    },
  };
}

/**
 * Parse the indexed model declarations, or `undefined` when any of them fails.
 *
 * Indices must be CONTIGUOUS FROM ZERO. A gap means a key was mistyped or a
 * model was half-deleted, and quietly compacting the list would serve a
 * catalogue nobody wrote.
 */
function parseModels(
  providerId: string,
  buckets: ReadonlyMap<number, ReadonlyMap<string, string>>,
  reasons: string[],
): readonly AIModelDescriptor[] | undefined {
  if (buckets.size === 0) {
    reasons.push('at least one model must be declared');
    return undefined;
  }
  if (buckets.size > MAX_SELF_HOSTED_MODELS) {
    reasons.push(`at most ${MAX_SELF_HOSTED_MODELS} models may be declared`);
    return undefined;
  }
  const indices = [...buckets.keys()].sort((a, b) => a - b);
  if (indices.some((index, position) => index !== position)) {
    reasons.push('model indices must run contiguously from 0');
    return undefined;
  }

  const models: AIModelDescriptor[] = [];
  const seen = new Set<string>();
  let failed = false;

  for (const index of indices) {
    const bucket = buckets.get(index)!;
    const prefix = `model.${index}`;

    const modelId = bucket.get('id');
    if (modelId === undefined || !MODEL_ID.test(modelId)) {
      reasons.push(`${prefix}.id is missing or not a valid model id`);
      failed = true;
      continue;
    }
    if (seen.has(modelId)) {
      // The registry reports duplicates in `validate()`, but by then the
      // provider is registered and serving. Refusing here keeps a definition
      // whose catalogue is ambiguous from ever becoming a descriptor.
      reasons.push(`${prefix}.id duplicates model ${modelId}`);
      failed = true;
      continue;
    }
    seen.add(modelId);

    const capabilities = {
      textGeneration: requiredBoolean(bucket, prefix, 'textGeneration', reasons),
      structuredOutput: requiredBoolean(bucket, prefix, 'structuredOutput', reasons),
      chatCompletions: requiredBoolean(bucket, prefix, 'chatCompletions', reasons),
      zeroDataRetention: requiredBoolean(bucket, prefix, 'zeroDataRetention', reasons),
      maxOutputTokens: requiredInteger(bucket, prefix, 'maxOutputTokens', reasons, {
        min: 1,
        max: 1_000_000,
      }),
      maxContextTokens: requiredInteger(bucket, prefix, 'maxContextTokens', reasons, {
        min: 1,
        max: 10_000_000,
      }),
    };
    // EXPLICIT ZERO, NEVER ACCIDENTAL ZERO. A self-hosted model may genuinely
    // cost nothing per token, and the platform must be able to say so — but the
    // row has to SAY zero. A missing key is a missing price, and a missing price
    // silently read as free is how a budget engine starts lying.
    const promptMicroUsdPer1k = requiredInteger(bucket, prefix, 'promptMicroUsdPer1k', reasons, {
      min: 0,
      max: 10_000_000,
    });
    const completionMicroUsdPer1k = requiredInteger(
      bucket,
      prefix,
      'completionMicroUsdPer1k',
      reasons,
      { min: 0, max: 10_000_000 },
    );

    const displayName = bucket.get('displayName');
    if (displayName !== undefined && displayName.trim() === '') {
      reasons.push(`${prefix}.displayName is empty`);
      failed = true;
    }

    if (
      Object.values(capabilities).some((value) => value === undefined) ||
      promptMicroUsdPer1k === undefined ||
      completionMicroUsdPer1k === undefined
    ) {
      failed = true;
      continue;
    }

    models.push({
      modelId,
      providerId,
      capabilities: {
        textGeneration: capabilities.textGeneration as boolean,
        structuredOutput: capabilities.structuredOutput as boolean,
        chatCompletions: capabilities.chatCompletions as boolean,
        zeroDataRetention: capabilities.zeroDataRetention as boolean,
        maxOutputTokens: capabilities.maxOutputTokens as number,
        maxContextTokens: capabilities.maxContextTokens as number,
      },
      promptMicroUsdPer1k,
      completionMicroUsdPer1k,
    });
  }

  return failed || models.length === 0 ? undefined : models;
}

/**
 * The descriptor a validated definition becomes.
 *
 * THE ONLY PRODUCER OF A SELF-HOSTED `AIProviderDescriptor`. It takes a
 * `SelfHostedProviderDefinition`, which only `validateSelfHostedDefinition`
 * produces, which in turn only produces one when the endpoint validator
 * returned a `ValidatedEndpoint`. So "an invalid stored endpoint cannot become
 * callable" is a property of the types rather than of a code review.
 */
export function selfHostedDescriptor(
  definition: SelfHostedProviderDefinition,
): AIProviderDescriptor {
  return {
    providerId: definition.providerId,
    displayName: definition.displayName,
    priority: definition.priority,
    models: definition.models,
    // DERIVED FROM CERTIFICATION, NEVER DECLARED. See the module comment.
    productionReady: definition.certification === 'certified',
    // ALWAYS TRUE. See the module comment: this is what keeps
    // AI_ALLOW_REAL_REQUESTS authoritative over a provider whose endpoint an
    // operator chose.
    billable: true,
    credential: {
      required: definition.credentialRequired,
      manageable: true,
      // NO ENVIRONMENT VARIABLE. A dynamic provider has no reviewed deployment
      // secret, and fabricating a name like `SELFHOSTED_<ID>_API_KEY` would
      // invent a credential source nobody audited and put its name in a console
      // response. Managed storage is the only path.
      credentialFormatHint: definition.credentialRequired
        ? 'API key accepted by this OpenAI-compatible endpoint'
        : undefined,
    },
  };
}

/** The credential profile the shared resolver works from for this provider. */
export function selfHostedCredentialProfile(
  definition: SelfHostedProviderDefinition,
): CredentialProviderProfile {
  return {
    providerId: definition.providerId,
    required: definition.credentialRequired,
    manageable: true,
    // Deliberately absent — see `selfHostedDescriptor`.
  };
}

/**
 * How a validated definition is registered.
 *
 * ENABLED REQUIRES CERTIFIED, and the two remain separate facts. The row's own
 * `enabled` column is the operator's switch and the row's `certification`
 * column is MARQ's governance decision; a provider serves only when both say
 * yes. Registering an uncertified definition as enabled would make "certified"
 * decorative, and registering it not at all would hide it from the console that
 * exists to certify it.
 */
export function selfHostedRegistration(definition: SelfHostedProviderDefinition): {
  readonly enabled: boolean;
  readonly certification: AIProviderCertificationState;
} {
  return {
    enabled: definition.administrativelyEnabled && definition.certification === 'certified',
    certification: definition.certification,
  };
}

// ── Value readers ───────────────────────────────────────────────────────────

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Strictly `"true"` or `"false"`. Nothing else is a boolean here. */
function booleanOf(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** A strictly-formatted decimal integer inside bounds. No coercion. */
function integerOf(value: unknown, bounds: { min: number; max: number }): number | undefined {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value.trim())) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < bounds.min || parsed > bounds.max) return undefined;
  return parsed;
}

function requiredBoolean(
  bucket: ReadonlyMap<string, string>,
  prefix: string,
  field: string,
  reasons: string[],
): boolean | undefined {
  const parsed = booleanOf(bucket.get(field));
  if (parsed === undefined) reasons.push(`${prefix}.${field} must be "true" or "false"`);
  return parsed;
}

function requiredInteger(
  bucket: ReadonlyMap<string, string>,
  prefix: string,
  field: string,
  reasons: string[],
  bounds: { min: number; max: number },
): number | undefined {
  const parsed = integerOf(bucket.get(field), bounds);
  if (parsed === undefined) {
    // The grammar rejects a leading `-`, so a negative price lands here and is
    // reported as out of range rather than being read as a rebate.
    reasons.push(
      `${prefix}.${field} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
  return parsed;
}

const CERTIFICATIONS: readonly AIProviderCertificationState[] = [
  'unverified',
  'testing',
  'certified',
  'degraded',
  'disabled',
];

function certificationOf(value: unknown): AIProviderCertificationState | undefined {
  return CERTIFICATIONS.find((candidate) => candidate === value);
}
