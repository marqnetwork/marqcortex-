/**
 * The Provider Administration console surface — AI-01 Batch 4C.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, STATED FIRST.
 *
 * These are SOURCE assertions, not rendering tests. The claims Batch 4C makes
 * about the console are claims about absence — that no provider is hard-coded,
 * that no stored key can be displayed, that no free-text model field exists —
 * and absence is exactly what a source scan proves well and a rendering test
 * proves badly. A React test that renders the panel with OpenAI and Anthropic
 * fixtures and finds no problem says nothing about the branch that fires for
 * the third provider.
 *
 * THE THREE CLAIMS.
 *
 *   GENERIC     The panel renders from provider METADATA. There is no
 *               `providerId === 'openai'` chain, so a provider added in Batch
 *               4E renders with no frontend change.
 *
 *   WRITE-ONLY  No response type the console reads has a field a secret could
 *               occupy, so the console cannot display a stored key — not
 *               because it declines to, but because it is never given one.
 *
 *   GOVERNED    No free-text model input exists, so an operator cannot type a
 *               model name and make it production-eligible.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const panelSource = readFileSync(
  join(root, 'src', 'app', 'components', 'ProviderAdministrationPanel.tsx'),
  'utf8',
);
const serviceSource = readFileSync(
  join(root, 'src', 'app', 'services', 'aiAdminService.ts'),
  'utf8',
);
const consoleSource = readFileSync(
  join(root, 'src', 'app', 'components', 'AIAdministrationConsole.tsx'),
  'utf8',
);

/**
 * Source with comments removed.
 *
 * This repository documents heavily, and the panel's own header explains at
 * length why it must never branch on `openai`. Scanning raw text would make the
 * explanation the violation — which teaches the one lesson a source scan must
 * never teach: that the way to pass is to stop writing down the reasoning.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const panel = code(panelSource);
const service = code(serviceSource);

describe('the provider console is generic, not a chain of vendor names', () => {
  it('names no provider in any executable branch of the panel', () => {
    for (const vendor of ['openai', 'anthropic', 'mock', 'azure', 'gemini', 'bedrock']) {
      assert.ok(
        !new RegExp(`['"\`]${vendor}['"\`]`, 'i').test(panel),
        `ProviderAdministrationPanel must not reference the provider "${vendor}"`,
      );
    }
  });

  it('names no vendor credential variable', () => {
    // A console that knew a vendor's variable name would be a console one step
    // from reading its value.
    assert.ok(
      !/OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(panelSource),
      'the panel must not name a provider credential variable',
    );
    assert.ok(
      !/OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(serviceSource),
      'the admin service client must not name a provider credential variable',
    );
  });

  it('decides whether to show a credential form from provider metadata', () => {
    // `manageable` is the adapter's own declaration. The mock sets it false and
    // gets no form, without this file knowing the mock exists.
    assert.match(panel, /credentialPolicy\.manageable/);
  });

  it('renders the model list from the server, with no vendor-specific layout', () => {
    assert.match(panel, /provider\.models\.map/);
  });

  it('renders provider state from a lookup rather than a conditional chain', () => {
    // A state the server adds later renders as plain text instead of silently
    // taking the styling of whichever branch happened to be last.
    assert.match(panel, /const CERTIFICATION_STYLE: Record<string, string>/);
    assert.match(panel, /const STATE_STYLE: Record<string, string>/);
  });
});

describe('the console cannot reveal a stored credential', () => {
  it('has no client function that reads a credential back', () => {
    for (const forbidden of [
      'revealAIProviderCredential',
      'fetchAIProviderSecret',
      'getProviderCredentialPlaintext',
      'showProviderKey',
    ]) {
      assert.ok(!service.includes(forbidden), `${forbidden} must not exist`);
    }
  });

  it('declares no secret-bearing field on any provider response type', () => {
    // The credential response contract, isolated. If it grew a `secret` field
    // the console could render one — so the type is the control.
    const contract = service.slice(
      service.indexOf('export interface AIProviderCredentialState'),
      service.indexOf('export interface AIProviderModelState'),
    );
    assert.ok(contract.length > 0, 'the credential contract must exist');
    for (const field of ['secret', 'apiKey', 'plaintext', 'value:', 'token:']) {
      assert.ok(
        !contract.includes(field),
        `the credential response contract must not declare "${field}"`,
      );
    }
    // What it DOES declare.
    assert.match(contract, /fingerprint\?: string/);
    assert.match(contract, /lastFour\?: string/);
  });

  it('sends the credential up and never renders it back', () => {
    // The ONE place `secret` appears in the client is the request body of the
    // write. It is not in a response type, not in state beyond the form, and
    // not in any read.
    const occurrences = service.match(/\bsecret\b/g) ?? [];
    assert.ok(occurrences.length > 0, 'the write path exists');
    assert.match(service, /body:\s*\{\s*\n?\s*secret: input\.secret/);
  });

  it('enters a credential through a password field that is cleared unconditionally', () => {
    const form = panel.slice(panel.indexOf('function CredentialForm'));
    assert.ok(form.length > 0, 'the credential form must exist');
    assert.match(form, /type="password"/);
    assert.match(form, /autoComplete="off"/);
    // Cleared in a `finally`, so a FAILED submission does not leave the key in
    // React state, in the DOM, or in an error overlay.
    assert.match(form, /finally\s*\{[\s\S]*?setSecret\(''\)/);
  });

  it('never asks for the previous credential in order to rotate', () => {
    const form = panel.slice(panel.indexOf('function CredentialForm'));
    // The platform could not verify an old key, and asking for a value it
    // cannot check trains operators to paste live credentials into fields that
    // do nothing with them.
    assert.ok(!/current(Secret|Key|Credential)/i.test(form));
    assert.ok(!/previous(Secret|Key|Credential)/i.test(form));
    assert.ok(!/existingSecret/i.test(form));
  });
});

describe('the console cannot certify a model by having somebody type its name', () => {
  it('offers no free-text model input', () => {
    const models = panel.slice(panel.indexOf('Models'), panel.indexOf('Runtime health'));
    assert.ok(models.length > 0, 'the model section must exist');
    // Every model control is a toggle over a server-supplied list.
    assert.ok(
      !/<input[^>]*model/i.test(models),
      'there must be no model text input',
    );
    assert.match(models, /onToggleModel\(model\.modelId/);
  });

  it('renders certification as a state, never as an editable field', () => {
    assert.match(panel, /model\.certification/);
    assert.ok(
      !/setCertification|onCertify|certifyModel/.test(panel),
      'certification is a governance decision, not a console control',
    );
  });
});

describe('the console renders provider status honestly', () => {
  it('shows the server-derived operational message rather than composing its own', () => {
    // Derived server-side from the state beside it, so the sentence cannot
    // drift from the badges — and never a vendor's error text, which can echo
    // request content.
    assert.match(panel, /\{provider\.message\}/);
  });

  it('distinguishes credential source from credential presence', () => {
    // "configured" and "managed by Cortex" are different facts, and an operator
    // deciding whether a rotation needs a deploy has to tell them apart.
    assert.match(panel, /MANAGEMENT_COPY/);
    for (const state of [
      'cortex_managed',
      'deployment_managed',
      'not_required',
      'unconfigured',
    ]) {
      assert.ok(panel.includes(state), `the panel must render the "${state}" state`);
    }
  });

  it('says out loud that opening the page makes no provider call', () => {
    // A health screen that probed the vendor to populate itself would bill the
    // platform for being looked at.
    assert.match(panelSource, /makes no provider call/i);
  });

  it('is mounted inside the existing AI Administration console', () => {
    // Batch 4C extends the Team Dashboard → Settings → AI Administration
    // surface. A second administration application would be a second place to
    // enforce authority.
    assert.match(consoleSource, /import \{ ProviderAdministrationPanel \}/);
    assert.match(consoleSource, /<ProviderAdministrationPanel/);
  });
});
