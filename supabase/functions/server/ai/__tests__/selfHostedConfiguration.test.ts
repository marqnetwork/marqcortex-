/**
 * Self-hosted provider CONFIGURATION and ENDPOINT POLICY — AI-01 Batch 4E.
 *
 * Two things are under test here and they are deliberately separable:
 *
 *   the endpoint policy      the SSRF defence, attacked directly. Every family
 *                            of unsafe target gets its own case, because a
 *                            single "rejects bad URLs" test passes for the
 *                            wrong reason the moment one branch regresses.
 *
 *   the definition validator the parser that turns one stored configuration row
 *                            into a runtime definition — and, far more
 *                            importantly, the thing that refuses to.
 *
 * The governing property both halves serve: NOTHING BECOMES CALLABLE THAT WAS
 * NOT VALIDATED. `selfHostedDescriptor` takes a `SelfHostedProviderDefinition`,
 * which only the validator produces, which needs a `ValidatedEndpoint`, which
 * only the policy produces. These tests hold each link.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateEndpoint } from '../providers/selfHosted/endpointPolicy.ts';
import {
  DEFAULT_SELF_HOSTED_PRIORITY,
  declaresSelfHostedRuntime,
  selfHostedCredentialProfile,
  selfHostedDescriptor,
  selfHostedRegistration,
  validateSelfHostedDefinition,
} from '../providers/selfHosted/definition.ts';
import type {
  AIProviderCertificationState,
  AIProviderConfigurationRecord,
} from '../providers/credentials/credentialStore.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MODEL_0: Readonly<Record<string, string>> = {
  'model.0.id': 'llama-3.3-70b-instruct',
  'model.0.displayName': 'Llama 3.3 70B Instruct',
  'model.0.textGeneration': 'true',
  'model.0.structuredOutput': 'true',
  'model.0.chatCompletions': 'true',
  'model.0.zeroDataRetention': 'true',
  'model.0.maxOutputTokens': '8192',
  'model.0.maxContextTokens': '128000',
  'model.0.promptMicroUsdPer1k': '0',
  'model.0.completionMicroUsdPer1k': '0',
};

function configuration(
  overrides: Readonly<Record<string, string>> = {},
  removals: readonly string[] = [],
): Readonly<Record<string, string>> {
  const base: Record<string, string> = {
    runtime: 'openai_compatible',
    baseUrl: 'https://inference.marq.example.com/v1',
    credentialRequired: 'false',
    ...MODEL_0,
    ...overrides,
  };
  for (const key of removals) delete base[key];
  return base;
}

function record(
  overrides: Partial<AIProviderConfigurationRecord> = {},
): AIProviderConfigurationRecord {
  return {
    configurationId: 'pvc_selfhosted1',
    providerKey: 'marq_inference',
    displayName: 'MARQ Inference',
    scope: 'platform',
    enabled: true,
    certification: 'certified' as AIProviderCertificationState,
    configuration: configuration(),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'operator',
    updatedBy: 'operator',
    ...overrides,
  };
}

/**
 * The reasons a refused definition produced, joined for readable asserts.
 *
 * Asserts NOTHING itself: it is passed as the message argument of `assert.equal`
 * on the accepting cases too, and an assertion inside a message argument fires
 * on the happy path.
 */
function reasonsOf(result: ReturnType<typeof validateSelfHostedDefinition>): string {
  return result.ok === false ? result.reasons.join(' | ') : '(the definition was accepted)';
}

// ── Endpoint policy ─────────────────────────────────────────────────────────

describe('self-hosted endpoint policy — accepted shapes', () => {
  it('accepts an https endpoint and composes the chat completions URL', () => {
    const result = validateEndpoint('https://inference.marq.example.com/v1');
    assert.equal(result.ok, true);
    if (result.ok !== true) return;
    assert.equal(result.endpoint.baseUrl, 'https://inference.marq.example.com/v1');
    assert.equal(
      result.endpoint.chatCompletionsUrl,
      'https://inference.marq.example.com/v1/chat/completions',
    );
    assert.equal(result.endpoint.scheme, 'https');
  });

  it('normalizes a trailing slash, a bare root and an explicit port', () => {
    const trailing = validateEndpoint('https://inference.example.com/v1/');
    const root = validateEndpoint('https://inference.example.com/');
    const ported = validateEndpoint('https://inference.example.com:8443/openai/v1');
    assert.equal(trailing.ok && trailing.endpoint.baseUrl, 'https://inference.example.com/v1');
    assert.equal(root.ok && root.endpoint.baseUrl, 'https://inference.example.com');
    assert.equal(
      root.ok && root.endpoint.chatCompletionsUrl,
      'https://inference.example.com/chat/completions',
    );
    assert.equal(
      ported.ok && ported.endpoint.baseUrl,
      'https://inference.example.com:8443/openai/v1',
    );
  });

  it('accepts a public IPv4 literal', () => {
    const result = validateEndpoint('https://203.0.114.10/v1');
    assert.equal(result.ok, true);
  });
});

describe('self-hosted endpoint policy — scheme and transport', () => {
  it('rejects http when the local-development exception is off', () => {
    const result = validateEndpoint('http://inference.example.com/v1');
    assert.equal(result.ok === false && result.code, 'insecure_transport');
  });

  it('admits http only under the explicit local-development exception', () => {
    const result = validateEndpoint('http://127.0.0.1:11434/v1', {
      allowPrivateEndpoints: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.endpoint.scheme, 'http');
  });

  for (const raw of [
    'file:///etc/passwd',
    'ftp://inference.example.com/v1',
    'gopher://inference.example.com/v1',
    'ws://inference.example.com/v1',
    'data:text/plain,hello',
  ]) {
    it(`rejects the unsupported scheme in ${raw}`, () => {
      const result = validateEndpoint(raw);
      assert.equal(result.ok, false);
      assert.equal(
        result.ok === false &&
          ['unsupported_scheme', 'malformed_url', 'secret_like'].includes(result.code),
        true,
        `unexpected code for ${raw}`,
      );
    });
  }

  it('rejects a malformed URL', () => {
    assert.equal(validateEndpoint('not-a-url').ok === false, true);
    assert.equal(validateEndpoint('https://').ok === false, true);
    assert.equal(validateEndpoint('//inference.example.com/v1').ok === false, true);
  });

  it('rejects a non-string, an empty value and one that is too long', () => {
    assert.equal(validateEndpoint(undefined).ok === false, true);
    assert.equal(validateEndpoint(42).ok === false, true);
    assert.equal(validateEndpoint({ href: 'https://x.example.com' }).ok === false, true);
    assert.equal(validateEndpoint('   ').ok === false, true);
    assert.equal(validateEndpoint(`https://x.example.com/${'a'.repeat(4_000)}`).ok === false, true);
  });
});

describe('self-hosted endpoint policy — credential material', () => {
  it('rejects credentials embedded in the authority', () => {
    const withBoth = validateEndpoint('https://admin:hunter2@inference.example.com/v1');
    assert.equal(withBoth.ok === false, true);
    // The refusal must never echo what it rejected.
    assert.equal(withBoth.ok === false && withBoth.detail.includes('hunter2'), false);
  });

  it('rejects a username with no password', () => {
    // `password` is a secret-shaped token, so a bare username is the case that
    // proves the authority check itself works rather than the text scan.
    const result = validateEndpoint('https://serviceaccount@inference.example.com/v1');
    assert.equal(result.ok === false && result.code, 'embedded_credentials');
  });

  it('rejects any query string, which is where a key would be pasted', () => {
    const plain = validateEndpoint('https://inference.example.com/v1?region=eu');
    assert.equal(plain.ok === false && plain.code, 'query_string');
  });

  it('rejects key-shaped text anywhere in the URL', () => {
    for (const raw of [
      'https://inference.example.com/v1?api_key=abc123',
      'https://inference.example.com/v1?access-key=abc123',
      'https://inference.example.com/sk-ABCDEFGH12345678/v1',
      'https://inference.example.com/v1?token=abc',
      'https://inference.example.com/v1?signature=abc',
    ]) {
      const result = validateEndpoint(raw);
      assert.equal(result.ok, false, raw);
      assert.equal(
        result.ok === false && result.detail.includes('abc'),
        false,
        'the refusal must not echo the suspected secret',
      );
    }
  });

  it('rejects a fragment', () => {
    assert.equal(validateEndpoint('https://inference.example.com/v1#x').ok === false, true);
  });
});

describe('self-hosted endpoint policy — network targets', () => {
  const LOOPBACK = [
    'https://localhost/v1',
    'https://localhost:8000/v1',
    'https://api.localhost/v1',
    'https://inference.local/v1',
    'https://127.0.0.1/v1',
    'https://127.9.9.9/v1',
    'https://[::1]/v1',
    // Alternate integer and octal spellings the URL parser normalizes to
    // 127.0.0.1 — the reason this validator classifies AFTER parsing.
    'https://2130706433/v1',
    'https://0177.0.0.1/v1',
  ];
  for (const raw of LOOPBACK) {
    it(`rejects the loopback target ${raw}`, () => {
      const result = validateEndpoint(raw);
      assert.equal(result.ok, false, raw);
    });
  }

  const PRIVATE_V4 = [
    'https://10.0.0.5/v1',
    'https://10.255.255.255/v1',
    'https://172.16.0.1/v1',
    'https://172.31.255.1/v1',
    'https://192.168.1.1/v1',
    'https://100.64.0.1/v1',
  ];
  for (const raw of PRIVATE_V4) {
    it(`rejects the private IPv4 target ${raw}`, () => {
      const result = validateEndpoint(raw);
      assert.equal(result.ok === false && result.code, 'private_address', raw);
    });
  }

  it('does not reject a public address that merely looks adjacent', () => {
    assert.equal(validateEndpoint('https://172.32.0.1/v1').ok, true);
    assert.equal(validateEndpoint('https://11.0.0.1/v1').ok, true);
  });

  const UNSAFE_V6 = [
    ['https://[::1]/v1', 'loopback_host'],
    ['https://[::]/v1', 'unspecified_address'],
    ['https://[fd12:3456:789a::1]/v1', 'private_address'],
    ['https://[fc00::1]/v1', 'private_address'],
    ['https://[fe80::1]/v1', 'link_local_address'],
    ['https://[fec0::1]/v1', 'private_address'],
    ['https://[ff02::1]/v1', 'reserved_address'],
    // IPv4-mapped: the classification must follow the embedded quad rather
    // than treating the whole thing as an opaque v6 address.
    ['https://[::ffff:127.0.0.1]/v1', 'loopback_host'],
    ['https://[::ffff:10.0.0.1]/v1', 'private_address'],
    ['https://[::ffff:169.254.169.254]/v1', 'metadata_address'],
  ] as const;
  for (const [raw, code] of UNSAFE_V6) {
    it(`rejects the IPv6 target ${raw} as ${code}`, () => {
      const result = validateEndpoint(raw);
      assert.equal(result.ok, false, raw);
      assert.equal(result.ok === false && result.code, code, raw);
    });
  }

  it('accepts a public IPv6 literal', () => {
    assert.equal(validateEndpoint('https://[2606:4700::1111]/v1').ok, true);
  });

  const METADATA = [
    'https://169.254.169.254/v1',
    'https://169.254.170.2/v1',
    'https://100.100.100.200/v1',
    'https://metadata.google.internal/v1',
    'https://metadata/v1',
    'https://[fd00:ec2::254]/v1',
  ];
  for (const raw of METADATA) {
    it(`rejects the cloud metadata target ${raw}`, () => {
      const result = validateEndpoint(raw);
      assert.equal(result.ok, false, raw);
    });

    it(`still rejects ${raw} under the local-development exception`, () => {
      // THE EXCEPTION NEVER WAIVES METADATA. No development scenario needs it,
      // and every SSRF chain that matters ends there.
      const result = validateEndpoint(raw, { allowPrivateEndpoints: true });
      assert.equal(result.ok, false, raw);
    });
  }

  it('rejects link-local IPv4 even under the local-development exception', () => {
    const result = validateEndpoint('https://169.254.10.10/v1', {
      allowPrivateEndpoints: true,
    });
    assert.equal(result.ok === false && result.code, 'link_local_address');
  });

  const MALFORMED_HOSTS = [
    'https://inference_server.example.com/v1',
    'https://-inference.example.com/v1',
    'https://inference..example.com/v1',
    'https://inference.example.com./v1',
    'https://[not:an:address/v1',
  ];
  for (const raw of MALFORMED_HOSTS) {
    it(`rejects the malformed host in ${raw}`, () => {
      assert.equal(validateEndpoint(raw).ok, false, raw);
    });
  }

  it('rejects whitespace and control characters before parsing', () => {
    assert.equal(validateEndpoint('https://inference.example .com/v1').ok === false, true);
    assert.equal(validateEndpoint('https://inference.example.com/v1\n').ok === false, true);
    assert.equal(validateEndpoint(' https://inference.example.com/v1').ok === false, true);
  });
});

describe('self-hosted endpoint policy — path safety', () => {
  const PATH_TRICKS = [
    'https://inference.example.com/v1/../../admin',
    'https://inference.example.com/v1/%2e%2e/admin',
    'https://inference.example.com/v1/%2fadmin',
    'https://inference.example.com/v1/%5cadmin',
    'https://inference.example.com/v1/admin space',
  ];
  for (const raw of PATH_TRICKS) {
    it(`rejects the path trick in ${raw}`, () => {
      assert.equal(validateEndpoint(raw).ok, false, raw);
    });
  }

  it('collapses redundant separators rather than trusting them', () => {
    const result = validateEndpoint('https://inference.example.com//v1//');
    assert.equal(result.ok === true && result.endpoint.baseUrl, 'https://inference.example.com/v1');
  });

  it('refuses a base that already names the chat completions path', () => {
    const result = validateEndpoint('https://inference.example.com/v1/chat/completions');
    assert.equal(result.ok === false && result.code, 'redundant_chat_completions_path');
  });
});

// ── Definition validation ───────────────────────────────────────────────────

describe('self-hosted definition — the valid case', () => {
  it('validates a complete OpenAI-compatible definition', () => {
    const result = validateSelfHostedDefinition(record());
    assert.equal(result.ok, true, reasonsOf(result));
    if (result.ok !== true) return;

    const definition = result.definition;
    assert.equal(definition.providerId, 'marq_inference');
    assert.equal(definition.runtime, 'openai_compatible');
    assert.equal(definition.credentialRequired, false);
    assert.equal(definition.priority, DEFAULT_SELF_HOSTED_PRIORITY);
    assert.equal(definition.models.length, 1);
    assert.equal(definition.models[0].modelId, 'llama-3.3-70b-instruct');
    assert.equal(definition.models[0].providerId, 'marq_inference');
    assert.equal(definition.models[0].capabilities.maxOutputTokens, 8_192);
    assert.equal(
      definition.endpoint.chatCompletionsUrl,
      'https://inference.marq.example.com/v1/chat/completions',
    );
  });

  it('reads an explicit priority and deployment identifier', () => {
    const result = validateSelfHostedDefinition(
      record({ configuration: configuration({ priority: '7', deploymentId: 'vllm-eu-1' }) }),
    );
    assert.equal(result.ok, true, reasonsOf(result));
    assert.equal(result.ok === true && result.definition.priority, 7);
    assert.equal(result.ok === true && result.definition.deploymentId, 'vllm-eu-1');
  });

  it('recognises a row as a runtime definition only when it declares one', () => {
    assert.equal(declaresSelfHostedRuntime(record()), true);
    // Every Batch 4C row: OpenAI's and Anthropic's configurations carry `{}`.
    assert.equal(declaresSelfHostedRuntime(record({ configuration: {} })), false);
  });
});

describe('self-hosted definition — identity and runtime', () => {
  it('rejects an unknown runtime type', () => {
    const result = validateSelfHostedDefinition(
      record({ configuration: configuration({ runtime: 'triton_grpc' }) }),
    );
    assert.match(reasonsOf(result), /runtime must be one of openai_compatible/);
  });

  it('rejects an invalid provider id', () => {
    for (const providerKey of ['', 'A', 'Uppercase', '1leading', 'has space', 'x'.repeat(80)]) {
      const result = validateSelfHostedDefinition(record({ providerKey }));
      assert.match(reasonsOf(result), /providerKey is not a valid provider id/, providerKey);
    }
  });

  it('refuses a row that claims a built-in provider id', () => {
    // A stored row must never be able to repoint a reviewed adapter.
    for (const providerKey of ['openai', 'anthropic', 'mock']) {
      const result = validateSelfHostedDefinition(record({ providerKey }));
      assert.match(reasonsOf(result), /reserved for a built-in adapter/, providerKey);
    }
  });

  it('rejects a missing display name', () => {
    assert.match(reasonsOf(validateSelfHostedDefinition(record({ displayName: '  ' }))), /displayName/);
  });

  it('rejects an unrecognised certification state', () => {
    const result = validateSelfHostedDefinition(
      record({ certification: 'production' as AIProviderCertificationState }),
    );
    assert.match(reasonsOf(result), /certification is not a recognised state/);
  });
});

describe('self-hosted definition — endpoint refusals reach the definition', () => {
  const CASES: readonly (readonly [string, string, RegExp])[] = [
    ['a malformed URL', 'inference.example.com', /malformed_url/],
    ['http where https is required', 'http://inference.example.com/v1', /insecure_transport/],
    ['embedded credentials', 'https://svc@inference.example.com/v1', /embedded_credentials/],
    ['localhost', 'https://localhost:8000/v1', /loopback_host/],
    ['loopback IPv4', 'https://127.0.0.1/v1', /loopback_host/],
    ['private IPv4', 'https://10.1.2.3/v1', /private_address/],
    ['unsafe IPv6', 'https://[fd00::1]/v1', /private_address/],
    ['metadata IPv4', 'https://169.254.169.254/latest', /metadata_address/],
    ['a query secret', 'https://inference.example.com/v1?api_key=x', /secret_like/],
    ['a path traversal', 'https://inference.example.com/v1/../admin', /path_traversal/],
  ];
  for (const [label, baseUrl, pattern] of CASES) {
    it(`refuses ${label}`, () => {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ baseUrl }) }),
      );
      assert.match(reasonsOf(result), pattern, baseUrl);
    });
  }

  it('accepts a private endpoint only when the exception is passed through', () => {
    const withException = validateSelfHostedDefinition(
      record({ configuration: configuration({ baseUrl: 'http://127.0.0.1:11434/v1' }) }),
      { allowPrivateEndpoints: true },
    );
    assert.equal(withException.ok, true, reasonsOf(withException));

    const without = validateSelfHostedDefinition(
      record({ configuration: configuration({ baseUrl: 'http://127.0.0.1:11434/v1' }) }),
    );
    assert.equal(without.ok, false);
  });
});

describe('self-hosted definition — the configuration map itself', () => {
  it('rejects an unrecognised configuration key rather than ignoring it', () => {
    const result = validateSelfHostedDefinition(
      record({ configuration: configuration({ proxyUrl: 'https://proxy.example.com' }) }),
    );
    assert.match(reasonsOf(result), /proxyUrl is not a recognised setting/);
  });

  it('rejects a key shaped like credential material', () => {
    for (const key of ['apiKey', 'api_key', 'authHeader', 'password', 'connectionString']) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ [key]: 'value-that-must-not-be-echoed' }) }),
      );
      const reasons = reasonsOf(result);
      assert.match(reasons, /shaped like key material/, key);
      assert.equal(
        reasons.includes('value-that-must-not-be-echoed'),
        false,
        'a refusal must never echo the suspected secret',
      );
    }
  });

  it('rejects a non-string value on a recognised key', () => {
    // A JSONB column can hold a number or an object even though the record type
    // says string, so the validator checks the runtime type rather than
    // trusting the declaration.
    const typed = {
      ...configuration(),
      baseUrl: { href: 'https://inference.example.com/v1' } as unknown as string,
    };
    assert.match(
      reasonsOf(validateSelfHostedDefinition(record({ configuration: typed }))),
      /is not a string/,
    );
  });

  it('rejects nested JSON smuggled in under an unknown key', () => {
    const nested = {
      ...configuration(),
      models: [{ id: 'x' }] as unknown as string,
    };
    assert.match(
      reasonsOf(validateSelfHostedDefinition(record({ configuration: nested }))),
      /models is not a recognised setting/,
    );
  });

  it('rejects a configuration that is not an object at all', () => {
    const result = validateSelfHostedDefinition(
      record({ configuration: 'openai_compatible' as unknown as Record<string, string> }),
    );
    assert.match(reasonsOf(result), /configuration is not an object/);
  });

  it('rejects an over-long value', () => {
    const result = validateSelfHostedDefinition(
      record({ configuration: configuration({ deploymentId: 'x'.repeat(5_000) }) }),
    );
    assert.match(reasonsOf(result), /exceeds the value length bound/);
  });

  it('requires credentialRequired to be stated explicitly', () => {
    const missing = validateSelfHostedDefinition(
      record({ configuration: configuration({}, ['credentialRequired']) }),
    );
    assert.match(reasonsOf(missing), /credentialRequired must be explicitly/);

    const fuzzy = validateSelfHostedDefinition(
      record({ configuration: configuration({ credentialRequired: 'yes' }) }),
    );
    assert.match(reasonsOf(fuzzy), /credentialRequired must be explicitly/);
  });

  it('rejects a priority outside the bound', () => {
    for (const priority of ['0', '1001', '-5', 'high', '1.5']) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ priority }) }),
      );
      assert.match(reasonsOf(result), /priority must be an integer/, priority);
    }
  });
});

describe('self-hosted definition — model capabilities and pricing', () => {
  it('requires at least one model', () => {
    const bare = configuration();
    const stripped = Object.fromEntries(
      Object.entries(bare).filter(([key]) => !key.startsWith('model.')),
    );
    assert.match(
      reasonsOf(validateSelfHostedDefinition(record({ configuration: stripped }))),
      /at least one model must be declared/,
    );
  });

  it('rejects malformed capability values', () => {
    for (const [key, value] of [
      ['model.0.structuredOutput', 'maybe'],
      ['model.0.chatCompletions', '1'],
      ['model.0.textGeneration', ''],
      ['model.0.zeroDataRetention', 'TRUE'],
      ['model.0.maxOutputTokens', 'lots'],
      ['model.0.maxContextTokens', '-1'],
      ['model.0.maxOutputTokens', '0'],
    ] as const) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ [key]: value }) }),
      );
      assert.equal(result.ok, false, `${key}=${value}`);
    }
  });

  it('rejects a missing capability rather than defaulting it', () => {
    for (const key of [
      'model.0.textGeneration',
      'model.0.structuredOutput',
      'model.0.chatCompletions',
      'model.0.zeroDataRetention',
      'model.0.maxOutputTokens',
      'model.0.maxContextTokens',
    ]) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({}, [key]) }),
      );
      assert.equal(result.ok, false, key);
    }
  });

  it('accepts EXPLICIT zero pricing', () => {
    const result = validateSelfHostedDefinition(record());
    assert.equal(result.ok, true, reasonsOf(result));
    assert.equal(result.ok === true && result.definition.models[0].promptMicroUsdPer1k, 0);
    assert.equal(result.ok === true && result.definition.models[0].completionMicroUsdPer1k, 0);
  });

  it('rejects ABSENT pricing, so zero can never be accidental', () => {
    for (const key of ['model.0.promptMicroUsdPer1k', 'model.0.completionMicroUsdPer1k']) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({}, [key]) }),
      );
      assert.match(reasonsOf(result), /must be an integer between 0/, key);
    }
  });

  it('rejects negative pricing', () => {
    for (const key of ['model.0.promptMicroUsdPer1k', 'model.0.completionMicroUsdPer1k']) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ [key]: '-1' }) }),
      );
      assert.match(reasonsOf(result), /must be an integer between 0/, key);
    }
  });

  it('accepts non-zero pricing for a paid OpenAI-compatible endpoint', () => {
    const result = validateSelfHostedDefinition(
      record({
        configuration: configuration({
          'model.0.promptMicroUsdPer1k': '120',
          'model.0.completionMicroUsdPer1k': '480',
        }),
      }),
    );
    assert.equal(result.ok, true, reasonsOf(result));
    assert.equal(result.ok === true && result.definition.models[0].promptMicroUsdPer1k, 120);
  });

  it('rejects duplicate model ids', () => {
    const duplicated: Record<string, string> = { ...configuration() };
    for (const [key, value] of Object.entries(MODEL_0)) {
      duplicated[key.replace('model.0.', 'model.1.')] = value;
    }
    const result = validateSelfHostedDefinition(record({ configuration: duplicated }));
    assert.match(reasonsOf(result), /duplicates model llama-3\.3-70b-instruct/);
  });

  it('rejects a non-contiguous model index', () => {
    const gapped: Record<string, string> = { ...configuration() };
    for (const [key, value] of Object.entries(MODEL_0)) {
      gapped[key.replace('model.0.', 'model.4.')] = value;
    }
    gapped['model.4.id'] = 'mistral-small';
    const result = validateSelfHostedDefinition(record({ configuration: gapped }));
    assert.match(reasonsOf(result), /model indices must run contiguously/);
  });

  it('rejects a malformed model id', () => {
    for (const modelId of ['', 'has space', '-leading', 'x'.repeat(200)]) {
      const result = validateSelfHostedDefinition(
        record({ configuration: configuration({ 'model.0.id': modelId }) }),
      );
      assert.match(reasonsOf(result), /is missing or not a valid model id/, modelId);
    }
  });
});

// ── What a validated definition becomes ─────────────────────────────────────

describe('self-hosted descriptor — governed, not declared', () => {
  function definitionOf(overrides: Partial<AIProviderConfigurationRecord> = {}) {
    const result = validateSelfHostedDefinition(record(overrides));
    assert.equal(result.ok, true, reasonsOf(result));
    if (result.ok !== true) throw new Error('unreachable');
    return result.definition;
  }

  it('is ALWAYS billable, so the kill switch stays authoritative over it', () => {
    // There is no configuration key that reaches this, and that is the point:
    // a self-hosted endpoint performs a real outbound request, and letting a
    // stored row declare `billable: false` would publish a documented way to
    // walk around AI_ALLOW_REAL_REQUESTS.
    const descriptor = selfHostedDescriptor(definitionOf());
    assert.equal(descriptor.billable, true);

    const zeroPriced = descriptor.models.every(
      (model) => model.promptMicroUsdPer1k === 0 && model.completionMicroUsdPer1k === 0,
    );
    assert.equal(zeroPriced, true, 'zero COST and non-billable are different claims');
  });

  it('derives productionReady from certification rather than from configuration', () => {
    assert.equal(selfHostedDescriptor(definitionOf()).productionReady, true);
    for (const certification of ['unverified', 'testing', 'degraded', 'disabled'] as const) {
      const descriptor = selfHostedDescriptor(definitionOf({ certification }));
      assert.equal(descriptor.productionReady, false, certification);
    }
  });

  it('registers an uncertified definition inert, and a certified one live', () => {
    // Enabled and certified stay SEPARATE facts; serving requires both.
    assert.deepEqual(selfHostedRegistration(definitionOf()), {
      enabled: true,
      certification: 'certified',
    });
    assert.deepEqual(selfHostedRegistration(definitionOf({ certification: 'testing' })), {
      enabled: false,
      certification: 'testing',
    });
    assert.deepEqual(selfHostedRegistration(definitionOf({ certification: 'unverified' })), {
      enabled: false,
      certification: 'unverified',
    });
    assert.deepEqual(selfHostedRegistration(definitionOf({ enabled: false })), {
      enabled: false,
      certification: 'certified',
    });
  });

  it('declares no environment variable for a dynamic provider', () => {
    const descriptor = selfHostedDescriptor(definitionOf());
    assert.equal(descriptor.credential.environmentVariable, undefined);
    assert.equal(descriptor.credential.manageable, true);

    const profile = selfHostedCredentialProfile(definitionOf());
    assert.equal(profile.environmentVariable, undefined);
    assert.equal(profile.providerId, 'marq_inference');
    assert.equal(profile.required, false);
  });

  it('carries the credential requirement through to the descriptor', () => {
    const required = definitionOf({
      configuration: configuration({ credentialRequired: 'true' }),
    });
    assert.equal(selfHostedDescriptor(required).credential.required, true);
    assert.equal(selfHostedCredentialProfile(required).required, true);
  });
});
