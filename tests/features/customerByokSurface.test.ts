/**
 * The customer AI provider credential console — AI-01 Batch 4D.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, STATED FIRST.
 *
 * These are SOURCE assertions, not rendering tests. The claims Batch 4D makes
 * about the customer console are claims about ABSENCE — that no stored key can
 * be displayed, that no organization is ever named by the client, that no
 * provider is hard-coded, that MARQ's estate never appears — and absence is
 * exactly what a source scan proves well and a rendering test proves badly. A
 * React test that renders the panel with two fixtures and finds no problem says
 * nothing about the branch that fires for the third.
 *
 * THE FIVE CLAIMS.
 *
 *   TENANT-SILENT  The client names no organization, anywhere. The tenant comes
 *                  from the authenticated session, server-side.
 *   WRITE-ONLY     No response type the console reads has a field a secret
 *                  could occupy, so it cannot display a stored key — not
 *                  because it declines to, but because it is never given one.
 *   SEPARATE       The customer panel imports nothing from the MARQ platform
 *                  administration surface, and vice versa.
 *   GENERIC        The panel renders from provider METADATA, with no vendor
 *                  name in any executable branch.
 *   HONEST         Destructive actions confirm, and say what happens next.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const service = read('src', 'app', 'services', 'aiByokService.ts');
const panel = read('src', 'app', 'components', 'OrganizationProviderCredentialsPanel.tsx');
const settings = read('src', 'app', 'components', 'SettingsPage.tsx');
const platformPanel = read('src', 'app', 'components', 'ProviderAdministrationPanel.tsx');

/**
 * The file with comments removed.
 *
 * This repository documents heavily, and a file that explains in prose why it
 * must never display a stored key contains the words "stored key". Scanning the
 * raw text would make the explanation itself the violation — which teaches the
 * only lesson a source scan must never teach, that the way to pass is to stop
 * writing down the reasoning.
 */
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const serviceCode = strip(service);
const panelCode = strip(panel);

describe('the customer credential client never names a tenant', () => {
  it('exposes no function taking an organization identifier', () => {
    // The tenant is resolved from the authenticated session. A client that
    // ACCEPTED one would teach the next reader that the tenant is the client's
    // to choose — and the next endpoint would take it from a body.
    //
    // Scanned over the exported functions' PARAMETER LISTS rather than the
    // whole file: `ByokSummary.organizationId` is a RESPONSE field — the
    // organization the server resolved, echoed back so the console can name it
    // — and banning that would ban the console telling an administrator which
    // organization they are looking at.
    const signatures = [...serviceCode.matchAll(/export (?:async )?function \w+\(([\s\S]*?)\):/g)]
      .map((match) => match[1]);
    assert.ok(signatures.length >= 5, `expected the client functions, found ${signatures.length}`);
    for (const parameters of signatures) {
      assert.ok(
        !/organization|tenant|\borg\b/i.test(parameters),
        `a client function accepts a tenant: ${parameters.replace(/\s+/g, ' ').trim()}`,
      );
    }
    assert.ok(!/organization_id/.test(serviceCode));
  });

  it('puts no organization in any request path', () => {
    const paths = [...serviceCode.matchAll(/`\$\{BYOK_BASE\}([^`]*)`/g)].map((match) => match[1]);
    assert.ok(paths.length >= 3, `expected the customer routes, found ${paths.length}`);
    for (const path of paths) {
      assert.ok(
        !/organization|tenant|org/i.test(path),
        `a customer route names a tenant in its path: ${path}`,
      );
    }
  });

  it('puts no organization in any request body', () => {
    const bodies = [...serviceCode.matchAll(/body:\s*\{[\s\S]*?\}/g)].map((match) => match[0]);
    assert.ok(bodies.length >= 3);
    for (const body of bodies) {
      assert.ok(
        !/organization|tenant/i.test(body),
        `a customer mutation sends a tenant in its body: ${body}`,
      );
    }
  });

  it('reaches only the customer route prefix', () => {
    // `/ai/organization/providers` is the customer surface.
    // `/ai/admin/provider-administration` is MARQ's, guarded by a different
    // capability set. This client must not be able to reach the second.
    assert.match(serviceCode, /BYOK_BASE = '\/ai\/organization\/providers'/);
    assert.ok(
      !/\/ai\/admin/.test(serviceCode),
      'the customer client can reach the platform administration surface',
    );
  });
});

describe('the customer console cannot reveal a stored credential', () => {
  it('has no client function that reads a credential back', () => {
    const READERS = /\b(fetch|get|read|reveal|show|download)[A-Za-z]*(Secret|ApiKey|Plaintext|CredentialValue)\b/i;
    assert.ok(!READERS.test(serviceCode), 'a client function reads a credential back');
  });

  it('declares no secret-bearing field on any response type', () => {
    // Every exported interface in the client, scanned for a field a secret
    // could occupy. `secretVersion` is an integer counter and is allowed by
    // name; everything else in this family is not.
    const interfaces = [...serviceCode.matchAll(/export interface \w+ \{[\s\S]*?\n\}/g)]
      .map((match) => match[0]);
    assert.ok(interfaces.length >= 4, `expected the response types, found ${interfaces.length}`);
    for (const block of interfaces) {
      for (const field of block.matchAll(/^\s{2}(\w+)\??:/gm)) {
        assert.ok(
          !/^(secret|apiKey|api_key|value|plaintext|credentialValue|encrypted|ct|iv|kid|keyId)$/i
            .test(field[1]),
          `a response type declares \`${field[1]}\`, which a secret could occupy`,
        );
      }
    }
  });

  it('is never given MARQ’s root key identity or ciphertext', () => {
    // Even the SHAPE is absent. The server's customer read model omits them,
    // and the client's mirror omits them too, so a server that started sending
    // one would have nowhere to land.
    for (const name of ['keyId', 'encryptedSecret', 'ciphertext', 'sealed']) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(serviceCode), `the client declares ${name}`);
    }
  });

  it('sends the credential up through exactly one function, and reads none back', () => {
    // ONE function carries a secret: its input type declares one and its body
    // forwards one. Two occurrences, both inside
    // `configureOrganizationCredential`, and none anywhere else.
    const configure = serviceCode.match(
      /export async function configureOrganizationCredential[\s\S]*?\n\}/,
    );
    assert.ok(configure, 'the one credential-carrying function exists');
    // `\bsecret\b` and not `/secret/i`: `secretVersion` is an integer counter
    // that legitimately appears on the history type, and a scan that caught it
    // would be a scan that had to be weakened rather than trusted.
    const inConfigure = (configure[0].match(/\bsecret\b/g) ?? []).length;
    const inFile = (serviceCode.match(/\bsecret\b/g) ?? []).length;
    assert.ok(inConfigure > 0);
    assert.equal(
      inFile - inConfigure,
      0,
      'a credential is referenced outside the one function that submits one',
    );
  });

  it('enters a credential through a password field that is cleared unconditionally', () => {
    assert.match(panelCode, /type="password"/);
    assert.match(panelCode, /autoComplete="off"/);
    // Cleared in a `finally`, so a FAILED submission does not leave the key in
    // the DOM, in React state or in any error overlay a browser extension
    // happens to render.
    const submit = panelCode.match(/const submit = async \(\) => \{[\s\S]*?\n  \};/);
    assert.ok(submit, 'the credential form has a submit handler');
    assert.match(submit[0], /finally \{[\s\S]*setSecret\(''\)/);
  });

  it('never asks for the previous credential in order to replace one', () => {
    // The platform cannot verify an old key, and asking for a value it cannot
    // check would train administrators to paste live credentials into fields
    // that do nothing with them.
    assert.ok(!/currentSecret|oldSecret|existingSecret|confirmSecret/i.test(panelCode));
  });
});

describe('the customer console and the MARQ console are separate surfaces', () => {
  it('shares no import between the two panels', () => {
    assert.ok(
      !/aiAdminService/.test(panelCode),
      'the customer panel imports the platform administration client',
    );
    assert.ok(
      !/aiByokService/.test(strip(platformPanel)),
      'the platform panel imports the customer credential client',
    );
    assert.ok(
      !/ProviderAdministrationPanel/.test(panelCode),
      'the customer panel renders the platform panel',
    );
  });

  it('shows a customer nothing about MARQ’s own credential estate', () => {
    // The fields the platform console renders and a customer must never see:
    // the deployment variable's NAME, the root key identity, the governed
    // spending exposure, and MARQ's own management state.
    for (const field of [
      'environmentVariable',
      'environmentCredentialPresent',
      'managedStorageBlocker',
      'maxReservationMicroUsd',
      'cortex_managed',
      'deployment_managed',
    ]) {
      assert.ok(
        !new RegExp(`\\b${field}\\b`).test(panelCode),
        `the customer panel renders \`${field}\`, which is MARQ deployment information`,
      );
      assert.ok(
        !new RegExp(`\\b${field}\\b`).test(serviceCode),
        `the customer client declares \`${field}\`, which is MARQ deployment information`,
      );
    }
  });

  it('names no capability from the platform grant table', () => {
    // The two vocabularies are disjoint server-side. The console must not
    // bridge them by reading a platform capability to decide a customer
    // control.
    assert.ok(!/ai\.providers\./.test(panelCode));
    assert.ok(!/ai\.providers\./.test(serviceCode));
    assert.ok(!/super_admin|platform_admin/.test(panelCode));
  });

  it('is mounted as its own tab beside the platform console, not inside it', () => {
    assert.match(settings, /OrganizationProviderCredentialsPanel/);
    assert.match(settings, /activeTab === 'byok'/);
    // And the platform console is still its own tab. Two estates on one screen
    // is how somebody eventually shows one to the other.
    assert.match(settings, /activeTab === 'ai'/);
    assert.ok(
      !/OrganizationProviderCredentialsPanel/.test(strip(platformPanel)),
      'the customer panel is rendered inside the platform console',
    );
  });
});

describe('the customer console is generic, not a chain of vendor names', () => {
  it('names no provider in any executable branch', () => {
    for (const vendor of ['openai', 'anthropic', 'OpenAI', 'Anthropic', 'gpt-', 'claude-']) {
      assert.ok(
        !panelCode.includes(vendor),
        `the customer panel names ${vendor} in executable code`,
      );
      assert.ok(!serviceCode.includes(vendor), `the customer client names ${vendor}`);
    }
  });

  it('decides whether to show a credential form from server metadata', () => {
    // `available` is derived server-side from MARQ's registration,
    // certification and enablement plus the adapter's own credential policy.
    // The console renders the form when it is true and explains the reason when
    // it is not — with no knowledge of which providers exist.
    assert.match(panelCode, /provider\.available && \(/);
    assert.match(panelCode, /provider\.unavailableReason/);
  });

  it('renders lifecycle state from a lookup rather than a conditional chain', () => {
    // A state the server adds renders as plain text instead of silently taking
    // the styling of whichever branch happened to be last.
    assert.match(panelCode, /const STATUS_COPY: Record<string,/);
    assert.match(panelCode, /const SOURCE_COPY: Record<string,/);
  });

  it('shows the server-derived message rather than composing its own', () => {
    assert.match(panelCode, /\{provider\.message\}/);
  });

  // REGRESSION, FOUND BY AN INDEPENDENT CERTIFICATION GATE. A stored, active,
  // correctly sealed credential is genuinely the key that would authenticate a
  // request — and can be accompanied by no requests at all, because customer
  // BYOK decides which key a SELECTED provider uses and does not by itself
  // bring a provider into service. The panel used to render only the first
  // half, so in a deployment with real provider requests switched off (the
  // default) it told an administrator their key was in service while every
  // request was refused.
  it('warns when the platform cannot serve a provider a credential is stored for', () => {
    assert.match(panelCode, /provider\.serviceable === false/);
    assert.match(panelCode, /provider\.unserviceableReason/);
    // A FALLBACK SENTENCE, so a server that sends the flag without a reason
    // still produces a warning rather than an empty banner.
    assert.match(panelCode, /cannot currently execute requests for this provider/);
  });

  it('learns that state from the server rather than deciding it in the browser', () => {
    // The browser has no way to know whether the runtime can select a provider:
    // it cannot see the platform's credentials and must not be told about them.
    // So the field is read, never derived — and the client type declares it.
    assert.match(service, /serviceable\?: boolean/);
    assert.match(service, /unserviceableReason\?: string/);
    for (const forbidden of ['allowRealRequests', 'AI_ALLOW_REAL_REQUESTS', 'hasCredentials']) {
      assert.ok(
        !panelCode.includes(forbidden) && !serviceCode.includes(forbidden),
        `the customer console reasons about a MARQ deployment fact: ${forbidden}`,
      );
    }
  });
});

describe('the customer console is honest about what it is about to do', () => {
  it('warns, above the form, that a stored credential can never be read back', () => {
    // The two things an administrator most needs to know before pasting a live
    // vendor key belong above the form and not beside the submit button.
    assert.match(panel, /can never be read back/i);
    assert.match(panel, /encrypted before it is stored/i);
  });

  it('confirms every destructive or replacing action before running it', () => {
    // ONE wrapper for every mutation, so no call site can skip the
    // confirmation, the reason, the busy guard or the refresh.
    assert.match(panelCode, /const withConfirmation = useCallback\(/);
    assert.match(panelCode, /window\.confirm\(confirmation\)/);
    // Every mutation goes through it, and none calls the client directly.
    for (const mutation of [
      'configureOrganizationCredential',
      'revokeOrganizationCredential',
      'setOrganizationFallbackPolicy',
    ]) {
      const calls = [...panelCode.matchAll(new RegExp(`${mutation}\\(`, 'g'))];
      assert.equal(calls.length, 1, `${mutation} is called from more than one place`);
    }
    assert.equal(
      (panelCode.match(/withConfirmation\(/g) ?? []).length,
      3,
      'the wrapper is used for exactly the three mutations and nothing else',
    );
  });

  it('says what revocation actually does, including the fallback consequence', () => {
    // Revocation reads as containment. Whether it IS containment depends on the
    // organization's own fallback policy, and the confirmation says which.
    assert.match(panel, /cannot be undone/i);
    assert.match(panel, /will STOP until you add a new one/);
    assert.match(panel, /fall back to the MARQ platform arrangement/);
  });

  it('collects a reason for every change, and says where it goes', () => {
    assert.match(panelCode, /window\.prompt\(/);
    assert.match(panel, /recorded on the credential audit trail/i);
    assert.match(panelCode, /reason\.trim\(\)\.length < 4/);
  });

  it('offers no demo fallback for a credential surface', () => {
    // Every other service in this console falls back to seed data when the
    // backend is off, which is right for a sales demo of a dashboard and wrong
    // for a credential panel: an administrator who "revokes their API key"
    // against fabricated state and sees success has been told a dangerous lie.
    //
    // The backend-off path THROWS. Asserted on the branch rather than on the
    // word "demo", which legitimately appears in the message that explains the
    // refusal to the administrator.
    assert.match(serviceCode, /if \(!isBackendEnabled\(\)\) throw BACKEND_DISABLED/);
    // And there is no second path that could return one. No fabricated array,
    // no seeded object, no catch that swallows a failure into a default.
    assert.ok(
      !/catch\s*\{[^}]*return\s/.test(serviceCode),
      'a client function swallows a failure into a fabricated answer',
    );
    assert.ok(
      !/=\s*\[\s*\{[\s\S]*providerId/.test(serviceCode),
      'the client carries a hard-coded provider list',
    );
  });
});
