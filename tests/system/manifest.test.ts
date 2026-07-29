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
    // Imported from the canonical module (as part of the session import block)
    // and re-exported so existing consumers are unaffected.
    assert.match(ctx, /type ClientSession,?\n\} from '@\/app\/lib\/session'/);
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

  /**
   * Task 5 required this module to be types-only. Task 6 deliberately widened
   * it to carry the one canonical expiry predicate, so a pure function and a
   * constant are now expected. What must never appear is anything with a side
   * effect or an environment dependency — that is what this guard now pins.
   */
  it('the session contract stays free of side effects', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['react import', /from ['"]react['"]/],
      ['storage access', /localStorage|sessionStorage|document\.cookie/],
      ['timers', /setTimeout|setInterval/],
      ['default export', /export\s+default\b/],
      ['module-level side effect', /^\s*(console|window|document)\./m],
    ];

    const violations = forbidden.filter(([, re]) => re.test(session)).map(([name]) => name);
    assert.deepEqual(violations, [], `session.ts must stay side-effect free; found: ${violations.join(', ')}`);
  });
});

/**
 * Phase 1B — client session expiry enforcement.
 *
 * Structural guards only; the behaviour of the predicate itself is pinned in
 * tests/features/clientSessionExpiry.test.ts. What matters here is that there
 * is exactly ONE expiry implementation and that every consumer routes to it.
 */
describe('client session expiry wiring', () => {
  const contract = repoFile('src/app/lib/session.ts');
  const ctx = repoFile('src/app/contexts/AppContext.tsx');
  const portal = repoFile('src/app/pages/ClientPortalRoute.tsx');
  const login = repoFile('src/app/pages/ClientLoginRoute.tsx');

  it('the canonical expiry check lives in the session contract', () => {
    assert.match(contract, /export function isClientSessionExpired\(/);
    assert.match(contract, /export const CLIENT_SESSION_TTL_MS\b/);
  });

  it('no module re-derives expiry independently', () => {
    // Only session.ts may compare against an expiry deadline for the client
    // session. Everywhere else must call the canonical predicate.
    const rederivers = [
      'src/app/contexts/AppContext.tsx',
      'src/app/pages/ClientPortalRoute.tsx',
      'src/app/pages/ClientLoginRoute.tsx',
      'src/app/components/ClientPortal.tsx',
      'src/app/components/ClientLogin.tsx',
    ].filter(p => /Date\.now\(\)\s*[<>]=?\s*\w*[eE]xpir|expiresAt\s*[<>]=?/.test(repoFile(p)));

    assert.deepEqual(rederivers, [], `Duplicate expiry logic in: ${rederivers.join(', ')}`);
  });

  it('AppContext issues, persists and restores the expiry deadline', () => {
    assert.match(ctx, /expiresAt: Date\.now\(\) \+ CLIENT_SESSION_TTL_MS/, 'login must stamp expiresAt');
    assert.match(ctx, /localStorage\.setItem\(CLIENT_SESSION_KEY, JSON\.stringify\(session\)\)/, 'session persists with its expiry');
    assert.match(ctx, /checkClientSessionExpired\(restored\)/, 'restore must re-check expiry');
  });

  it('an expired session is cleared from storage at restore', () => {
    // The guard redirects before the route-level logout effect can mount, so
    // rejection must also clear the record here or it survives indefinitely.
    const restoreBlock = ctx.slice(ctx.indexOf('const restored'), ctx.indexOf('} catch'));
    assert.match(restoreBlock, /localStorage\.removeItem\(CLIENT_SESSION_KEY\)/);
    assert.match(restoreBlock, /setIsClientSessionExpired\(true\)/);
  });

  it('AppContext exposes isClientSessionExpired through the provider', () => {
    assert.match(ctx, /isClientSessionExpired: boolean/, 'AppState must declare it');
    assert.match(ctx, /isClientSessionExpired,\n\s*logout,/, 'provider value must include it');
  });

  it('logout clears the expiry flag', () => {
    const logoutBody = ctx.slice(ctx.indexOf('const logout = useCallback'));
    assert.match(logoutBody.slice(0, 400), /setIsClientSessionExpired\(false\)/);
    assert.match(logoutBody.slice(0, 400), /localStorage\.removeItem\(CLIENT_SESSION_KEY\)/);
  });

  it('the portal route logs out on expiry from an effect, not during render', () => {
    assert.match(portal, /useEffect\(\(\) => \{\s*if \(isClientSessionExpired && clientSession\) \{\s*logout\(\);/);
    assert.doesNotMatch(portal, /if \(isClientSessionExpired\) logout\(\);/, 'must not call logout during render');
  });

  it('an expired session cannot bounce back into the portal from login', () => {
    assert.match(login, /if \(clientSession && !isClientSessionExpired\)/);
  });
});

/**
 * Phase 1B — ClientPortal `StatusView` lexical scope.
 *
 * `clientAuth` is created inside `ClientPortal`. `StatusView` is a separate
 * top-level component, so it can only see `clientAuth` if the value is
 * threaded through its props. It previously referenced `clientAuth` as a free
 * variable, which is not a compile error under the repository's transpile-only
 * toolchain and therefore surfaced as a runtime `ReferenceError` on the portal
 * default view.
 *
 * These tests pin the binding, not the styling: the last one performs a real
 * scope analysis of the extracted `StatusView` source, so the same class of
 * defect is caught for any identifier, not just `clientAuth`.
 */
describe('ClientPortal StatusView scope', () => {
  const PORTAL_PATH = 'src/app/components/ClientPortal.tsx';
  const portal = repoFile(PORTAL_PATH);

  /** Split a top-level `function Name({ props }: { types }) { body }` declaration. */
  function splitComponent(src: string, name: string) {
    const start = src.indexOf(`\nfunction ${name}({`);
    assert.notEqual(start, -1, `${name} must be a top-level function component`);
    const sigEnd = src.indexOf('\n}) {', start);
    assert.notEqual(sigEnd, -1, `${name} signature must terminate at column 0`);

    const signature = src.slice(start, sigEnd + '\n}) {'.length);
    const bodyOpen = sigEnd + '\n}) '.length;          // index of the body's `{`

    let depth = 0;
    let i = bodyOpen;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    assert.equal(depth, 0, `${name} body braces must balance`);

    const destructure = signature.slice(signature.indexOf('({') + 2, signature.indexOf('}: {'));
    const propTypes = signature.slice(signature.indexOf('}: {') + 4);

    return { signature, body: src.slice(bodyOpen, i + 1), destructure, propTypes };
  }

  const statusView = splitComponent(portal, 'StatusView');

  const propNames = statusView.destructure
    .split(',')
    .map(s => s.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean)
    .map(s => s.split(':')[0].trim());

  it('StatusView declares clientAuth as a prop', () => {
    assert.ok(
      propNames.includes('clientAuth'),
      `StatusView must destructure clientAuth; got: ${propNames.join(', ')}`,
    );
    assert.match(
      statusView.propTypes,
      /clientAuth\?:\s*ClientAuthContext;/,
      'StatusView props must type clientAuth as the canonical ClientAuthContext',
    );
  });

  it('every StatusView invocation passes clientAuth', () => {
    const invocations = [...portal.matchAll(/<StatusView\b([\s\S]*?)\/>/g)].map(m => m[1]);
    assert.ok(invocations.length > 0, 'expected at least one <StatusView /> invocation');
    for (const [idx, props] of invocations.entries()) {
      assert.match(
        props,
        /\bclientAuth=\{clientAuth\}/,
        `<StatusView /> invocation #${idx + 1} must pass clientAuth`,
      );
    }
  });

  it('StatusView still consumes clientAuth for the engagement feed', () => {
    // Guards against "fixing" the ReferenceError by deleting the usage.
    assert.match(statusView.body, /<EngagementActivityFeed[\s\S]*?clientAuth=\{clientAuth\}/);
  });

  it('reuses the canonical ClientAuthContext rather than redeclaring it', () => {
    assert.match(portal, /type ClientAuthContext,\n\} from '@\/app\/services\/dataService'/);
    assert.doesNotMatch(
      portal,
      /(?:export\s+)?(?:interface|type)\s+ClientAuthContext\b\s*[={]/,
      'ClientPortal must not declare its own ClientAuthContext',
    );
  });

  it('StatusView references no unbound identifiers', () => {
    // Real scope analysis: every identifier StatusView evaluates must resolve
    // to a prop, a module-scope binding, a local, or a known global.
    const bound = new Set<string>(propNames);

    // Module imports.
    for (const m of portal.matchAll(/import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
      if (m[1]) bound.add(m[1]);
      for (const spec of (m[2] ?? '').split(',')) {
        const name = spec.replace(/^\s*type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (name) bound.add(name);
      }
    }
    // Module-scope declarations.
    for (const m of portal.matchAll(/^(?:export\s+)?(?:default\s+)?(?:function|const|let|type|interface)\s+(\w+)/gm)) {
      bound.add(m[1]);
    }
    // Locals introduced inside the body (arrow params, loop/map callbacks).
    for (const m of statusView.body.matchAll(/\(\s*([\w\s,]*?)\s*\)\s*=>/g)) {
      for (const p of m[1].split(',')) if (p.trim()) bound.add(p.trim());
    }

    // Not identifiers to resolve: language keywords and platform globals.
    const GLOBALS = new Set([
      'Array', 'Boolean', 'Date', 'Infinity', 'JSON', 'Math', 'NaN', 'Number',
      'Object', 'Promise', 'String', 'console', 'document', 'window',
      'async', 'await', 'break', 'case', 'catch', 'const', 'continue', 'delete',
      'else', 'false', 'for', 'function', 'if', 'in', 'let', 'new', 'null', 'of',
      'return', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
      'var', 'void', 'while',
    ]);

    // Identifiers in evaluated position: the head of a JSX expression container
    // or of a template-literal substitution. Object-literal keys are skipped.
    const free = new Set<string>();
    for (const m of statusView.body.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*([:.\w\s$]*)/g)) {
      const ident = m[1];
      if (m[2].startsWith(':')) continue;              // object literal key
      if (GLOBALS.has(ident) || bound.has(ident)) continue;
      free.add(ident);
    }

    assert.deepEqual(
      [...free],
      [],
      `StatusView references identifiers outside its scope: ${[...free].join(', ')}`,
    );
  });
});
