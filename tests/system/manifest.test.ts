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
import { readFileSync } from 'node:fs';
import { manifest } from '../../src/system/manifest.ts';
import { runValidation } from '../../src/system/validate.ts';

const CERTIFIED_ID_PATTERN = /^MQC-(PAGE|COMP|CORE|SVC|HOOK|TYPE)-\d{3}$/;
const CERTIFIED_NODE_COUNT = 171;
const CERTIFIED_CORE_COUNT = 36;

const entries = Object.entries(manifest.nodes);

const repoFile = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/**
 * `DomainType` is a compile-time union and is erased at runtime, so the
 * declared values are read back from the type declaration itself. With no
 * TypeScript toolchain in the repository this is the only way to assert the
 * type contract; the declaration is a flat union of quoted literals, so the
 * extraction is deterministic.
 */
function declaredDomainTypes(): string[] {
  const src = repoFile('src/system/types.ts');
  const start = src.indexOf('export type DomainType');
  assert.notEqual(start, -1, 'DomainType declaration not found in src/system/types.ts');
  const decl = src.slice(start, src.indexOf(';', start));
  return [...decl.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
}

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

/**
 * Aligns the implementation type contract with actual manifest usage.
 *
 * `DomainType` (implementation-layer ownership groups) and the Enterprise
 * Domain Registry (`D01`–`D24`, business domains) are two different grains
 * that share the word "domain". They are deliberately disjoint: no
 * `DomainType` value is a registry ID, and `DATA` is an implementation
 * grouping — it is not, and does not rename, registry domain D17.
 */
describe('DomainType alignment', () => {
  it('every domain used in the manifest is declared in DomainType', () => {
    const declared = new Set(declaredDomainTypes());
    const undeclared = [...new Set(entries.map(([, n]) => n.domain))]
      .filter(d => !declared.has(d))
      .sort();

    assert.deepEqual(undeclared, [], `Manifest domains missing from DomainType: ${undeclared.join(', ')}`);
  });

  it('DATA is declared in DomainType', () => {
    assert.ok(declaredDomainTypes().includes('DATA'), 'DomainType must declare DATA');
  });

  it('every declared DomainType value is actually used by the manifest', () => {
    const used = new Set(entries.map(([, n]) => n.domain));
    const unused = declaredDomainTypes().filter(d => !used.has(d));

    assert.deepEqual(unused, [], `DomainType values with no manifest node: ${unused.join(', ')}`);
  });

  it('DATA is the only implementation domain beyond the twelve originally certified', () => {
    const ORIGINAL_TWELVE = [
      'AUTH', 'DIAGNOSTIC', 'PROPOSAL', 'ROI', 'PORTAL', 'AI',
      'EXECUTION', 'ANALYTICS', 'COMMS', 'LEAD', 'REVIEWER', 'SYSTEM',
    ];
    const added = declaredDomainTypes().filter(d => !ORIGINAL_TWELVE.includes(d));

    assert.deepEqual(added, ['DATA']);
  });

  it('DomainType values are disjoint from Enterprise Domain Registry IDs', () => {
    const overlap = declaredDomainTypes().filter(d => /^D\d{2}$/.test(d));
    assert.deepEqual(overlap, [], 'DomainType must not reuse registry domain IDs');
  });

  it('every DATA node belongs to the persistence layer', () => {
    const offLayer = entries
      .filter(([, n]) => n.domain === 'DATA')
      .filter(([, n]) => !/\/(repositories|migration)\//.test(n.filePath) && !/types/i.test(n.filePath))
      .map(([, n]) => `${n.id} ${n.filePath}`);

    assert.deepEqual(offLayer, [], `DATA nodes outside the persistence layer: ${offLayer.join(', ')}`);
  });
});

/**
 * The certified enterprise registries are not touched by implementation work.
 * These assertions fail loudly if any task edits them.
 */
describe('certified registry totals', () => {
  const uniq = (text: string, re: RegExp) => new Set(text.match(re) ?? []).size;

  const domains = uniq(repoFile('MARQ_CORTEX_ENTERPRISE_DOMAIN_REGISTRY_v1.0.md'), /\bD\d{2}\b/g);
  const modules = uniq(repoFile('MARQ_CORTEX_ENTERPRISE_MODULE_REGISTRY_v1.0.md'), /\bM\d{3}\b/g);
  const capabilities = uniq(repoFile('MARQ_CORTEX_ENTERPRISE_CAPABILITY_REGISTRY_v1.0.md'), /\bC\d{4}\b/g);

  it('24 Domains', () => assert.equal(domains, 24));
  it('186 Modules', () => assert.equal(modules, 186));
  it('561 Capabilities', () => assert.equal(capabilities, 561));
  it('771 registry nodes in total', () => assert.equal(domains + modules + capabilities, 771));
});

/**
 * Phase 1B — canonical session type contract.
 *
 * `src/app/lib/session.ts` is the single declaration site for client session
 * shapes. It is types-only: importing it must never emit runtime code, so the
 * assertions below check both that the contract exists and that it stays inert.
 *
 * These tests assert structure only. Client session *expiry* is deliberately
 * not modelled or asserted here — no expiry exists in the contract or at
 * runtime, and adding one is a separate behaviour-changing task.
 */
describe('canonical session contract', () => {
  const SESSION_PATH = 'src/app/lib/session.ts';
  const session = repoFile(SESSION_PATH);

  it('the canonical session module exists and declares both session types', () => {
    assert.match(session, /export interface ClientSession\b/);
    assert.match(session, /export type ClientAuthContext\b/);
  });

  it('is the only module declaring a session interface', () => {
    const declarers = [
      SESSION_PATH,
      'src/app/contexts/AppContext.tsx',
      'src/app/lib/api.ts',
      'src/app/services/dataService.ts',
      'src/app/pages/ClientPortalRoute.tsx',
      'src/app/components/ClientPortal.tsx',
    ].filter(p => /export\s+(interface|type)\s+(ClientSession|ClientAuthContext)\b/.test(repoFile(p)));

    assert.deepEqual(declarers, [SESSION_PATH], `Session types must be declared only in ${SESSION_PATH}`);
  });

  it('AppContext re-exports ClientSession instead of redeclaring it', () => {
    const ctx = repoFile('src/app/contexts/AppContext.tsx');
    assert.doesNotMatch(ctx, /export interface ClientSession\b/, 'AppContext must not redeclare ClientSession');
    assert.match(ctx, /import type \{ ClientSession \} from '@\/app\/lib\/session'/);
    assert.match(ctx, /export type \{ ClientSession \}/);
  });

  it('dataService re-exports ClientAuthContext from the canonical module', () => {
    const ds = repoFile('src/app/services/dataService.ts');
    assert.match(ds, /export type \{ ClientAuthContext \} from '@\/app\/lib\/session'/);
  });

  it('every consumer resolves ClientAuthContext to the canonical contract', () => {
    // api.ts imports it directly; portal components go through the dataService
    // gateway (Constitution Article 3). Both paths must terminate at session.ts.
    assert.match(
      repoFile('src/app/lib/api.ts'),
      /import type \{ ClientAuthContext \} from '@\/app\/lib\/session'/,
    );

    const viaGateway = [
      'src/app/components/ClientPortal.tsx',
      'src/app/components/ClientMessaging.tsx',
      'src/app/components/ProposalViewer.tsx',
      'src/app/components/EngagementActivityFeed.tsx',
    ];
    for (const p of viaGateway) {
      const src = repoFile(p);
      assert.match(src, /ClientAuthContext/, `${p} should reference ClientAuthContext`);
      assert.match(src, /from '@\/app\/services\/dataService'/, `${p} must import via dataService`);
    }
  });

  it('the session contract carries no runtime code', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['react import', /from ['"]react['"]/],
      ['storage access', /localStorage|sessionStorage|document\.cookie/],
      ['timers', /setTimeout|setInterval/],
      ['value export', /export\s+(const|let|var|function|class|enum)\b/],
      ['default export', /export\s+default\b/],
    ];

    const violations = forbidden.filter(([, re]) => re.test(session)).map(([name]) => name);
    assert.deepEqual(violations, [], `session.ts must stay types-only; found: ${violations.join(', ')}`);
  });
});
