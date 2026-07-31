/**
 * PHASE 1B TASK 31 — valid BlockSource for the demo AI-assist block
 *
 * `buildMockBlockAIAssistApiResponse` assembles a `Block` to feed the demo-mode
 * revision builder, and stamped its provenance as:
 *
 *     source: 'system',
 *
 * `BlockSource` is `'human' | 'ai' | 'mixed'` — there is no `'system'` member —
 * so the literal raised TS2322. This block is the AI-assist output, so the
 * correct member was always `'ai'`.
 *
 * The fix changes that one value. `BlockSource` is not widened, the live API path
 * is untouched, and every other field of the mock block is unchanged.
 *
 * The bad value was not purely cosmetic: `EditableBlockCard` renders the
 * provenance chip from `block.source`, indexing `SOURCE_COLORS` (keyed by
 * `BlockSource`) for its colour and switching on `'ai' | 'human' | 'mixed'` for
 * its icon. `'system'` matched no key and no branch, so the chip rendered with an
 * undefined colour and no icon. `'ai'` restores the Bot icon and the purple.
 *
 * TESTING APPROACH (documented limitation — the established pattern in
 * frontendRuntimeDefects.test.ts and teamSessionKeys.test.ts)
 *   aiAssistEngine cannot be loaded by the test runner: it *value*-imports
 *   `'./blockEngine'` without the `.ts` extension that Node ESM requires, so
 *   `import()` throws ERR_MODULE_NOT_FOUND. Adding the extension is a source
 *   change outside this task's approved scope. The guarantees are therefore
 *   enforced structurally against the production source, with the assignability
 *   half proven where it belongs, by `typecheck:web`. Assertions are
 *   pattern-based, never line-number-based.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

const ENGINE_REL = 'src/app/core/aiAssistEngine.ts';
const BLOCK_ENGINE_REL = 'src/app/core/blockEngine.ts';
const CARD_REL = 'src/app/components/EditableBlockCard.tsx';

const engineSource = readSource(ENGINE_REL);
const blockEngineSource = readSource(BLOCK_ENGINE_REL);

/** The `const block: Block = { … };` literal inside the demo response builder. */
function mockBlockLiteral(): string {
  const fn = engineSource.indexOf('export function buildMockBlockAIAssistApiResponse(');
  assert.notEqual(fn, -1, 'buildMockBlockAIAssistApiResponse was renamed or removed');
  const start = engineSource.indexOf('const block: Block = {', fn);
  assert.notEqual(start, -1, 'the demo mock block was renamed or removed');
  const end = engineSource.indexOf('\n  };', start);
  assert.notEqual(end, -1, 'the demo mock block literal is unterminated');
  return engineSource.slice(start, end);
}

// ---------------------------------------------------------------------------

describe('demo AI-assist block source', () => {
  it('is ai', () => {
    assert.match(
      mockBlockLiteral(),
      /^\s*source:\s+'ai',$/m,
      'the demo AI-assist block no longer declares source: ai',
    );
  });

  it('is no longer the invalid system value', () => {
    assert.equal(
      mockBlockLiteral().includes("source:              'system'"),
      false,
      "the demo block is back on the invalid 'system' source",
    );
  });

  it('declares source exactly once', () => {
    const occurrences = [...mockBlockLiteral().matchAll(/^\s*source:/gm)].length;
    assert.equal(occurrences, 1, `expected one source field, found ${occurrences}`);
  });
});

describe('BlockSource contract is untouched', () => {
  it('remains exactly human | ai | mixed', () => {
    assert.ok(
      blockEngineSource.includes("export type BlockSource    = 'human' | 'ai' | 'mixed';"),
      'the BlockSource union changed',
    );
  });

  it('does not admit system anywhere in the union or its colour map', () => {
    const start = blockEngineSource.indexOf('export type BlockSource');
    const end = blockEngineSource.indexOf('\n', start);
    assert.equal(
      blockEngineSource.slice(start, end).includes("'system'"),
      false,
      "'system' was added to BlockSource",
    );

    const colours = blockEngineSource.indexOf('export const SOURCE_COLORS: Record<BlockSource, string> = {');
    assert.notEqual(colours, -1, 'SOURCE_COLORS was renamed or removed');
    const coloursEnd = blockEngineSource.indexOf('\n};', colours);
    const body = blockEngineSource.slice(colours, coloursEnd);
    assert.deepEqual([...body.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]), ['human', 'ai', 'mixed']);
  });

  it('is never assigned system anywhere in the AI-assist engine', () => {
    assert.equal(
      /source:\s*'system'/.test(engineSource),
      false,
      "a 'system' source is back in the AI-assist engine",
    );
  });
});

describe('every other mock block field is unchanged', () => {
  it('keeps the exact field list', () => {
    assert.deepEqual([...mockBlockLiteral().matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]), [
      'block_id',
      'block_type',
      'title',
      'content',
      'content_format',
      'status',
      'source',
      'owner_user_id',
      'created_at',
      'updated_at',
      'current_revision_id',
      'version',
    ]);
  });

  it('keeps every other field value verbatim', () => {
    const literal = mockBlockLiteral();
    for (const line of [
      'block_id:            req.block_id,',
      'block_type:          req.block_type as BlockType,',
      'title:               req.title,',
      'content:             req.current_content,',
      "content_format:      'text' in req.current_content ? 'rich_text' : 'structured_json',",
      "status:              'draft',",
      "owner_user_id:       'demo',",
      'created_at:          new Date().toISOString(),',
      'updated_at:          new Date().toISOString(),',
      "current_revision_id: 'rev-demo',",
      'version:             1,',
    ]) {
      assert.ok(literal.includes(line), `the mock block lost or changed: ${line}`);
    }
  });

  it('keeps the demo response shape unchanged', () => {
    for (const line of [
      'proposed_content: revision.proposed_content,',
      'diff_summary:     revision.diff_summary,',
      'change_type:      req.action,',
      "model:            'demo-mode',",
      'generated_at:     revision.created_at,',
    ]) {
      assert.ok(engineSource.includes(line), `the demo response lost or changed: ${line}`);
    }
  });

  it('leaves the live API path alone', () => {
    assert.ok(
      engineSource.includes(
        "import { blockAIAssist as requestBlockAIAssist, type BlockAIAssistRequest, type BlockAIAssistResponse } from '@/app/services/dataService';",
      ),
      'the live AI-assist import changed',
    );
  });
});

describe('provenance chip can render the demo block', () => {
  const cardSource = readSource(CARD_REL);

  it('colours the chip by indexing SOURCE_COLORS with block.source', () => {
    assert.ok(
      cardSource.includes('style={{ color: SOURCE_COLORS[block.source] }}'),
      'the provenance chip no longer colours from SOURCE_COLORS',
    );
  });

  it('has an icon branch for ai, which the demo block now hits', () => {
    assert.ok(
      cardSource.includes("{block.source === 'ai'    && <Bot  className=\"size-2.5\" />}"),
      'the ai provenance icon branch changed',
    );
    for (const member of ['human', 'mixed']) {
      assert.ok(
        cardSource.includes(`{block.source === '${member}'`),
        `the ${member} provenance icon branch changed`,
      );
    }
    assert.equal(
      cardSource.includes("block.source === 'system'"),
      false,
      "the card grew a 'system' provenance branch",
    );
  });
});
