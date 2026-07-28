/**
 * PHASE 1A — System manifest identifier & integrity contract
 *
 * Locks the certified manifest invariants so the MQC-MIG-001 class of defect
 * cannot reappear. The certified identifier grammar is
 * `MQC-{PAGE|COMP|CORE|SVC|HOOK|TYPE}-{NNN}` (ARCHITECT.md § Manifest;
 * architecture/system_map.json → manifest.id_format); `MIG` was never a
 * certified type segment.
 *
 * These tests assert current state only — they do not encode any proposed
 * future grammar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { manifest } from '../../src/system/manifest.ts';
import { runValidation } from '../../src/system/validate.ts';

const CERTIFIED_ID_PATTERN = /^MQC-(PAGE|COMP|CORE|SVC|HOOK|TYPE)-\d{3}$/;
const CERTIFIED_NODE_COUNT = 171;
const CERTIFIED_CORE_COUNT = 36;

const entries = Object.entries(manifest.nodes);

describe('manifest identifier grammar', () => {
  it('every node ID matches the certified grammar', () => {
    const invalid = entries
      .map(([, node]) => node.id)
      .filter(id => !CERTIFIED_ID_PATTERN.test(id));

    assert.deepEqual(invalid, [], `Non-certified manifest IDs: ${invalid.join(', ')}`);
  });

  it('every node key matches its own id field', () => {
    const mismatched = entries
      .filter(([key, node]) => key !== node.id)
      .map(([key, node]) => `${key} !== ${node.id}`);

    assert.deepEqual(mismatched, [], `Key/id mismatches: ${mismatched.join(', ')}`);
  });

  it('every ID type segment matches the entry type', () => {
    const mismatched = entries
      .filter(([, node]) => node.id.split('-')[1] !== node.type)
      .map(([, node]) => `${node.id} declares type ${node.type}`);

    assert.deepEqual(mismatched, [], `ID/type mismatches: ${mismatched.join(', ')}`);
  });
});

describe('migration service registration', () => {
  it('MQC-MIG-001 is not an active manifest node', () => {
    assert.equal(manifest.nodes['MQC-MIG-001'], undefined);
    assert.ok(
      !entries.some(([key, node]) => key.startsWith('MQC-MIG') || node.id.startsWith('MQC-MIG')),
      'No MQC-MIG-* identifier may remain in the manifest',
    );
  });

  it('MQC-SVC-019 exists and is the migration orchestrator', () => {
    const node = manifest.nodes['MQC-SVC-019'];
    assert.ok(node, 'MQC-SVC-019 must be registered');
    assert.equal(node.id, 'MQC-SVC-019');
    assert.equal(node.type, 'SVC');
    assert.equal(node.filePath, 'supabase/functions/server/migration/orchestrator.ts');
  });
});

describe('certified manifest counts', () => {
  it('contains exactly 171 unique nodes', () => {
    assert.equal(entries.length, CERTIFIED_NODE_COUNT);
    assert.equal(new Set(entries.map(([, n]) => n.id)).size, CERTIFIED_NODE_COUNT);
  });

  it('contains exactly 36 CORE engines', () => {
    const core = entries.filter(([, n]) => n.type === 'CORE');
    assert.equal(core.length, CERTIFIED_CORE_COUNT);
  });
});

/**
 * Locks the allocated ID range of each entity type. The manifest's section
 * header comments state these ranges in prose; these assertions are the
 * machine-checkable counterpart, so a future range drift fails a test rather
 * than silently rotting a comment. The comments themselves are not parsed —
 * the repository has no idiom for source-comment validation.
 */
describe('entity-type ID ranges', () => {
  const RANGES = [
    { type: 'PAGE', count: 12, min: 'MQC-PAGE-000', max: 'MQC-PAGE-011' },
    { type: 'CORE', count: 36, min: 'MQC-CORE-001', max: 'MQC-CORE-036' },
    { type: 'TYPE', count: 9, min: 'MQC-TYPE-001', max: 'MQC-TYPE-009' },
  ] as const;

  for (const { type, count, min, max } of RANGES) {
    it(`${type}: ${count} nodes spanning ${min} → ${max}`, () => {
      const ids = entries
        .filter(([, n]) => n.type === type)
        .map(([, n]) => n.id)
        .sort();

      assert.equal(ids.length, count, `${type} node count`);
      assert.equal(ids[0], min, `${type} minimum ID`);
      assert.equal(ids[ids.length - 1], max, `${type} maximum ID`);
    });

    it(`${type}: ordinals are contiguous with no gaps or duplicates`, () => {
      const ordinals = entries
        .filter(([, n]) => n.type === type)
        .map(([, n]) => Number(n.id.split('-')[2]))
        .sort((a, b) => a - b);

      assert.equal(new Set(ordinals).size, ordinals.length, `${type} has duplicate ordinals`);

      const gaps = ordinals.filter((v, i) => i > 0 && v !== ordinals[i - 1] + 1);
      assert.deepEqual(gaps, [], `${type} ordinal gaps before: ${gaps.join(', ')}`);
    });
  }
});

describe('manifest referential integrity', () => {
  it('every dependency resolves to an existing node', () => {
    const dangling: string[] = [];
    for (const [, node] of entries) {
      for (const dep of node.dependencies) {
        if (!manifest.nodes[dep]) dangling.push(`${node.id} → ${dep}`);
      }
    }
    assert.deepEqual(dangling, [], `Dangling dependencies: ${dangling.join(', ')}`);
  });

  it('every dependent resolves to an existing node', () => {
    const dangling: string[] = [];
    for (const [, node] of entries) {
      for (const dep of node.dependents) {
        if (!manifest.nodes[dep]) dangling.push(`${node.id} ← ${dep}`);
      }
    }
    assert.deepEqual(dangling, [], `Dangling dependents: ${dangling.join(', ')}`);
  });
});

describe('manifest validator', () => {
  const report = runValidation(manifest);

  it('reports zero errors', () => {
    const errors = report.issues.filter(i => i.severity === 'ERROR');
    assert.deepEqual(
      errors.map(e => `[${e.nodeId}] ${e.field}: ${e.message}`),
      [],
    );
    assert.equal(report.errorCount, 0);
  });

  it('passes', () => {
    assert.equal(report.passed, true);
    assert.equal(report.totalNodes, CERTIFIED_NODE_COUNT);
  });
});
