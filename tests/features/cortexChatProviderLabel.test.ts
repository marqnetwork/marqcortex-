/**
 * AI-01 Batch 4B — the Cortex chat panel may not name a vendor.
 *
 * THE DEFECT. During the Batch 4A production proof the chat header read
 * "GPT-4o-mini · Live" while the request had actually been served by the mock
 * provider. Three independent things made that label wrong, and any one of them
 * was enough on its own:
 *
 *   1. The model name was HARD-CODED into the JSX. The platform selects between
 *      OpenAI, Anthropic and the mock per request; a literal vendor string in a
 *      component cannot be right for more than one of them, and after Batch 4B
 *      certifies Anthropic it is wrong more often than it is right.
 *
 *   2. "Live" was `isBackendEnabled()` — a BUILD-TIME configuration flag. It
 *      answers "is a backend URL configured?", which is a different question
 *      from "did a model produce this text?". With
 *      `AI_ALLOW_REAL_REQUESTS=false` the server answers every request from the
 *      mock and the flag stays true, which is exactly the state production was
 *      in when the label was observed.
 *
 *   3. The panel's own `catch` falls back to a locally generated narrative when
 *      the API call fails. The flag stays true through that too, so text this
 *      file wrote was labelled as live model output.
 *
 * The repair is a contract change, not a string change: the server reports the
 * provider and the model together, the client contract carries them, and the
 * badge renders what it was told. These assertions guard the shape of that
 * repair so the literal cannot come back.
 *
 * TESTING APPROACH (documented limitation)
 *   `CortexChatPanel.tsx` is a .tsx component. The repository ships no React
 *   test renderer, and the test runner (`node --experimental-strip-types`)
 *   erases type annotations but does not transform JSX, so the component cannot
 *   be imported and rendered here. Following the established pattern in
 *   `frontendRuntimeDefects.test.ts` and `teamSessionKeys.test.ts`, each
 *   guarantee is enforced structurally against the production source.
 *   Assertions are pattern-based, never line-number-based.
 *
 *   The BEHAVIOUR these labels depend on — that the server actually reports
 *   `meta.provider` and `meta.model` for every provider — is proved end to end
 *   in `ai/__tests__/anthropicGovernedPath.test.ts` and
 *   `ai/__tests__/openaiGovernedPath.test.ts`, against the real HTTP adapter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const repoFile = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const PANEL = repoFile('src/app/components/CortexChatPanel.tsx');
const API = repoFile('src/app/lib/api.ts');
const HTTP_ADAPTER = repoFile('supabase/functions/server/ai/http/httpAdapter.ts');

/** Comment blocks explain the defect by name; only code may be scanned. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('Cortex chat panel — no vendor is named in the UI', () => {
  it('contains no hard-coded model name in its code', () => {
    const code = codeOnly(PANEL);
    for (const literal of ['GPT-4o-mini', 'gpt-4o-mini', 'claude-', 'Claude ', 'OpenAI', 'Anthropic']) {
      assert.equal(
        code.includes(literal),
        false,
        `CortexChatPanel names a vendor or model ("${literal}"). The provider is a runtime fact reported by the control plane, not a constant.`,
      );
    }
  });

  it('does not derive a liveness claim from the build-time backend flag', () => {
    const code = codeOnly(PANEL);
    assert.equal(
      /isLive\s*:\s*isBackendEnabled\(\)/.test(code),
      false,
      '`isLive: isBackendEnabled()` reports configuration as if it were provenance.',
    );
    assert.equal(
      /isLive/.test(code),
      false,
      'the isLive flag is gone entirely — a two-state label cannot describe three outcomes',
    );
  });

  it('carries the reported provider and model on each narrative message', () => {
    const code = codeOnly(PANEL);
    assert.match(code, /provider\?:\s*string/, 'the message type carries a provider');
    assert.match(code, /model\?:\s*string/, 'the message type carries a model');
    // Read from the response, with the legacy top-level `model` as the fallback
    // so an older server still labels itself correctly.
    assert.match(code, /response\.meta\?\.provider/);
    assert.match(code, /response\.meta\?\.model\s*\?\?\s*response\.model/);
  });

  it('distinguishes a synthetic completion and a local fallback from a live one', () => {
    const code = codeOnly(PANEL);
    assert.match(code, /function narrativeSourceLabel/);
    assert.match(code, /function describeEngine/);
    // Three outcomes, each named: a governed provider, the mock, and nothing.
    assert.match(code, /'mock'/, 'the mock provider is recognised by name');
    assert.match(code, /synthetic/i, 'a mock completion is labelled synthetic');
    assert.match(code, /local/i, 'a browser-generated narrative is labelled local');
  });

  it('drives the header indicator from the transcript rather than asserting it', () => {
    const code = codeOnly(PANEL);
    // The old header hard-coded a green pulsing dot and the word "Live".
    assert.equal(
      /<div className="size-2 rounded-full bg-\[#10B981\] animate-pulse" \/>\s*<span[^>]*>Live<\/span>/.test(
        code.replace(/\s+/g, ' '),
      ),
      false,
      'the header states its status unconditionally',
    );
    assert.match(code, /engineStatus\.label/);
    assert.match(code, /engineStatus\.dotClass/);
  });
});

describe('AI response contract — provider and model travel together', () => {
  it('declares execution provenance on the client contract', () => {
    assert.match(API, /interface AIExecutionMeta/);
    assert.match(API, /provider\?:\s*string/);
    assert.match(API, /model\?:\s*string/);
  });

  it('exposes that provenance on both AI response shapes the panel reads', () => {
    for (const shape of ['NarrativeResponse', 'AIChatResponse']) {
      const start = API.indexOf(`export interface ${shape} {`);
      assert.notEqual(start, -1, `${shape} must exist`);
      const body = API.slice(start, API.indexOf('}', start));
      assert.match(body, /meta\?:\s*AIExecutionMeta/, `${shape} must carry meta`);
    }
  });

  it('reports the model beside the provider in the server response', () => {
    // The Batch 4A defect in one line: `meta` had a provider and no model, so a
    // caller reading provenance from the one object that holds provenance got
    // `model: null` for a request whose model was recorded correctly elsewhere.
    const start = HTTP_ADAPTER.indexOf('meta: {');
    assert.notEqual(start, -1, 'the success body must carry a meta block');
    const meta = codeOnly(HTTP_ADAPTER.slice(start, HTTP_ADAPTER.indexOf('\n    },', start)));
    assert.match(meta, /provider:\s*result\.execution\.providerId/);
    assert.match(meta, /model:\s*result\.execution\.modelId/);
  });

  it('keeps the legacy top-level model field where its existing clients read it', () => {
    // Additive, never a replacement: pre-Batch-1 clients read `model` at the
    // top level and a platform change must not break a client contract.
    assert.match(HTTP_ADAPTER, /success:\s*true,[\s\S]*?model:\s*result\.execution\.modelId/);
  });
});
