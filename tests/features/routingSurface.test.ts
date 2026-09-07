/**
 * The Routing console surface — AI-01 Batch 4F.
 *
 * SOURCE assertions, for the same reason the Batch 4C surface suite gives: the
 * claims this batch makes about the console are claims about ABSENCE, and a
 * rendering test that feeds the panel two providers proves nothing about the
 * branch that fires for a third.
 *
 * THE FOUR CLAIMS.
 *
 *   GENERIC       The panel renders from what the server reports. There is no
 *                 `providerId === 'openai'` chain, so a provider registered by
 *                 a later batch appears with no frontend change.
 *
 *   NO WRITE PATH No routing mutation exists on this surface. The strategy and
 *                 the breadth are fields of the SETTINGS patch, so they pass
 *                 through the same authorisation, normalisation, deployment
 *                 envelope and audit trail every other setting does — there is
 *                 no `/ai/admin/routing` write for a route table to bind.
 *
 *   GOVERNED      No free-text strategy field exists. The console offers the
 *                 declared strategies and nothing else.
 *
 *   NO SECRETS    No type the console reads for routing has a field a secret,
 *                 a prompt or a completion could occupy.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const panelSource = readFileSync(
  join(root, 'src', 'app', 'components', 'RoutingPanel.tsx'),
  'utf8',
);
const serviceSource = readFileSync(
  join(root, 'src', 'app', 'services', 'aiAdminService.ts'),
  'utf8',
);
const routeSource = readFileSync(
  join(root, 'supabase', 'functions', 'server', 'aiAdminRoutes.ts'),
  'utf8',
);

/**
 * Source with comments removed.
 *
 * The panel's header explains at length why it must never branch on a vendor
 * name, and scanning raw text would make the explanation the violation — which
 * teaches the one lesson a source scan must never teach: that the way to pass
 * is to stop writing down the reasoning.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const panelCode = code(panelSource);
const routeCode = code(routeSource);

describe('Batch 4F surface — the panel names no vendor', () => {
  it('has no provider identity in any executable branch', () => {
    for (const vendor of ['openai', 'anthropic', 'gpt-', 'claude-', 'mock']) {
      assert.ok(
        !panelCode.toLowerCase().includes(vendor),
        `the routing panel branches on ${vendor}; it must render from what the server reports`,
      );
    }
  });

  it('renders provider rows from the server list rather than a fixed set', () => {
    assert.match(panelCode, /summary\.providers\.map/);
    assert.match(panelCode, /view\.recent\.map/);
  });
});

describe('Batch 4F surface — routing has no write path of its own', () => {
  it('exposes exactly one routing endpoint, and it is a read', () => {
    assert.match(routeCode, /app\.get\(`\$\{prefix\}\/ai\/admin\/routing`/);
    for (const method of ['post', 'patch', 'put', 'delete']) {
      assert.ok(
        !new RegExp(`${method}\\(\`\\$\\{prefix\\}/ai/admin/routing`).test(routeCode),
        `a ${method} route on /ai/admin/routing would bypass the settings patch's governance`,
      );
    }
  });

  it('changes routing only through the audited settings patch', () => {
    // The panel's only mutation is `updateAISettings`, which carries a reason,
    // is authorised per FIELD by the server and is recorded on the change trail.
    assert.match(panelCode, /updateAISettings\(/);
    assert.ok(
      !/fetch\(|XMLHttpRequest/.test(panelCode),
      'the panel must reach the server through the typed client, not a bare fetch',
    );
  });

  it('demands a reason for every routing change', () => {
    // `withReason` prompts, refuses an empty reason and is what puts the change
    // on the administrative trail. A routing mutation outside it would be a
    // change nobody could later explain.
    const mutations = panelCode.match(/updateAISettings\(/g) ?? [];
    const reasoned = panelCode.match(/withReason\(/g) ?? [];
    assert.ok(mutations.length > 0, 'the panel makes no routing change at all');
    assert.ok(
      reasoned.length >= mutations.length,
      'a routing change is made outside `withReason`, so it would carry no audit reason',
    );
  });
});

describe('Batch 4F surface — the strategy is governed, not typed', () => {
  it('offers no free-text strategy input', () => {
    assert.ok(
      !/<input[^>]*strategy/i.test(panelCode),
      'a free-text strategy field would send a value the server rejects',
    );
  });

  it('declares the same strategies the server does', () => {
    assert.match(
      serviceSource,
      /AIRoutingStrategy\s*=\s*'preference'\s*\|\s*'cost'\s*\|\s*'latency'\s*\|\s*'resilience'/,
    );
  });

  it('bounds the breadth control by what the deployment permits', () => {
    // The buttons are generated from `deploymentMaxProviders`, so the console
    // cannot offer a breadth the envelope would refuse.
    assert.match(panelCode, /length:\s*view\.deploymentMaxProviders/);
  });
});

describe('Batch 4F surface — nothing sensitive can reach the console', () => {
  it('declares no routing field a secret, prompt or completion could occupy', () => {
    const contract = serviceSource.slice(
      serviceSource.indexOf('export interface AIRoutingOutcome'),
      serviceSource.indexOf('export interface AIAdminSettings'),
    );
    assert.ok(contract.length > 0, 'the routing contracts were not found');
    for (const forbidden of [
      'apiKey',
      'api_key',
      'secret',
      'credential',
      'messages',
      'prompt',
      'completion',
      'content',
      'actorId',
    ]) {
      assert.ok(
        !contract.includes(forbidden),
        `the routing contract declares ${forbidden}, so the console could be handed one`,
      );
    }
  });
});
