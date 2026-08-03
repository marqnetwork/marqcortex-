/**
 * AI execution-path boundary scan.
 *
 * These tests are structural rather than behavioural, and that is deliberate:
 * every other guarantee in AI-01 — audit, budget, redaction, fact lock, tenant
 * scoping — holds only if there is exactly ONE way to reach a model provider.
 * A second path does not weaken those guarantees, it removes them for whatever
 * flows through it.
 *
 * Behavioural tests cannot catch that. A newly added `fetch('https://api.openai.com/...')`
 * in a feature module passes every existing test, because the tests exercise
 * the governed path and the new code simply is not on it. So this suite asserts
 * on the source tree itself:
 *
 *   - vendor hostnames appear only inside `ai/providers/`
 *   - nothing outside the provider boundary reads a provider credential
 *   - no gateway-bypass flag exists
 *   - no legacy handler has come back
 *   - server code enters the plane through `ai/index.ts`, not its internals
 *
 * A source scan is a weak form of proof for behaviour and a strong one for
 * absence, which is exactly the shape of the claim being made here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SERVER_ROOT = join('supabase', 'functions', 'server');
const PROVIDER_DIR = join(SERVER_ROOT, 'ai', 'providers') + sep;
const AI_DIR = join(SERVER_ROOT, 'ai') + sep;

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function collect(dir: string): SourceFile[] {
  if (!existsSync(dir)) return [];
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const serverSources = collect(SERVER_ROOT);
const isTest = (file: SourceFile) =>
  file.path.includes('__tests__') || file.path.endsWith('.test.ts');
const isProviderAdapter = (file: SourceFile) => file.path.startsWith(PROVIDER_DIR);

/** Report offending files with their names, so a failure names the culprit. */
function offenders(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(file.text))
    .map((file) => relative(SERVER_ROOT, file.path));
}

describe('AI provider boundary', () => {
  it('has server sources to scan', () => {
    // A scan over zero files passes vacuously, which would make every other
    // assertion here meaningless.
    assert.ok(serverSources.length > 20, `expected server sources, found ${serverSources.length}`);
  });

  it('confines vendor hostnames to the provider adapters', () => {
    const VENDOR_HOST = /https?:\/\/[^\s'"`]*(openai\.com|anthropic\.com|googleapis\.com|azure\.com)/i;
    const candidates = serverSources.filter((file) => !isProviderAdapter(file) && !isTest(file));
    assert.deepEqual(
      offenders(candidates, VENDOR_HOST),
      [],
      'a model vendor URL appears outside supabase/functions/server/ai/providers/',
    );
  });

  it('confines provider credential reads to the provider adapters', () => {
    const CREDENTIAL = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENAI_KEY|AZURE_OPENAI_KEY)\b/;
    const candidates = serverSources.filter((file) => !isProviderAdapter(file) && !isTest(file));
    assert.deepEqual(
      offenders(candidates, CREDENTIAL),
      [],
      'a provider credential is read outside supabase/functions/server/ai/providers/',
    );
  });

  it('has no gateway-bypass feature flag', () => {
    // The rollback mechanism for AI-01 is a deployment rollback or a provider
    // configuration change — never a second code path guarded by a flag.
    const BYPASS = /INTELLIGENCE_USE_GATEWAY|USE_LEGACY_AI|AI_BYPASS|SKIP_AI_GUARD|DISABLE_AI_GUARD/;
    assert.deepEqual(offenders(serverSources, BYPASS), []);
  });

  it('has no legacy direct-provider handler', () => {
    const LEGACY = [
      'blockAiAssist.ts',
      'copilotPatch.ts',
      'cortexAnalysis.ts',
      'cortexChat.ts',
      'cortexNarrative.ts',
      'proposalSectionCopilot.ts',
    ];
    for (const name of LEGACY) {
      assert.equal(
        existsSync(join(SERVER_ROOT, name)),
        false,
        `${name} is a pre-Batch-1 direct-provider handler and must not exist`,
      );
    }
    assert.equal(
      existsSync(join(SERVER_ROOT, 'intelligence')),
      false,
      'the intelligence/ gateway is superseded by ai/ and must not exist',
    );
  });

  it('routes server code into the plane through its public surface', () => {
    // Reaching past ai/index.ts into ai/pipeline/ or ai/providers/ is how a
    // caller skips the guard while still looking like it uses the plane.
    const DEEP_IMPORT = /from\s+['"]\.\/ai\/(pipeline|providers|policy|security|governance)\//;
    const candidates = serverSources.filter(
      (file) => !file.path.startsWith(AI_DIR) && !isTest(file),
    );
    assert.deepEqual(
      offenders(candidates, DEEP_IMPORT),
      [],
      'server code imports a control plane internal instead of ai/index.ts',
    );
  });

  it('invokes a provider adapter only from the execution pipeline', () => {
    const INVOKE = /\.\s*invoke\s*\(\s*\{/;
    const candidates = serverSources.filter(
      (file) =>
        !isTest(file) &&
        !isProviderAdapter(file) &&
        !file.path.endsWith(join('pipeline', 'executionPipeline.ts')),
    );
    assert.deepEqual(offenders(candidates, INVOKE), []);
  });
});

describe('AI source hygiene', () => {
  const aiSources = serverSources.filter((file) => file.path.startsWith(AI_DIR));

  it('scans a non-empty AI tree', () => {
    assert.ok(aiSources.length > 30, `expected the AI tree, found ${aiSources.length} files`);
  });

  it('carries no type-checker suppressions', () => {
    const SUPPRESSION = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/;
    assert.deepEqual(offenders(aiSources, SUPPRESSION), []);
  });

  it('carries no unresolved work markers', () => {
    const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/;
    assert.deepEqual(offenders(aiSources, MARKER), []);
  });

  it('does not defeat the type system with `as any`', () => {
    const AS_ANY = /\bas\s+any\b/;
    assert.deepEqual(offenders(aiSources, AS_ANY), []);
  });

  it('logs no raw prompt or completion content', () => {
    // Audit and logs record digests and metadata. A `messages` or `completion`
    // value reaching a log sink turns the observability layer into an
    // uncontrolled copy of every client's business data.
    const RAW = /logger\.(debug|info|warn|error)\([^)]*\b(messages|completion|promptText|rawContent)\b/s;
    assert.deepEqual(offenders(aiSources, RAW), []);
  });
});
