/**
 * Proposal Section Copilot — governance + wiring contract tests
 *
 * The section copilot lets the LLM rewrite narrative for the 6 proposal
 * sections, but it must NEVER alter authoritative fields (price, currency,
 * duration, severity, confidence, evidence).
 *
 * AI-01 Batch 1 moved this feature onto the AI Control Plane. The guarantees it
 * asserts are unchanged; the modules that provide them moved:
 *
 *   fact-lock enforcement   supabase/functions/server/ai/governance/factLock.ts
 *                           applied per section by the feature definition
 *   request vocabulary      ai/features/sectionCopilot.ts (SECTION_KEYS/ACTIONS)
 *   prompt governance       ai/prompts/catalog.ts, rendered by the registry
 *
 * These tests exercise the feature through its real surfaces — the validator,
 * the prompt render and `applyFactLock` — which is the same path a live request
 * takes. Deeper unit coverage lives in
 * supabase/functions/server/ai/__tests__/.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionCopilotFeature,
  LOCKED_FIELDS_BY_SECTION,
  SECTION_KEYS,
  SECTION_ACTIONS,
} from '../../supabase/functions/server/ai/features/sectionCopilot.ts';
import { createPromptRegistry } from '../../supabase/functions/server/ai/prompts/registry.ts';
import { registerCortexPrompts } from '../../supabase/functions/server/ai/prompts/catalog.ts';
import type { AIRequestContext } from '../../supabase/functions/server/ai/contracts/request.ts';

const baseNextStep = {
  offer_name: 'Diagnostic Audit',
  price: 12_000,
  currency: 'USD',
  duration: 'Days 1-10',
  primary_cta: 'Get Started',
  secondary_cta: 'Learn more',
};

const CONTEXT = {
  requestId: 'req_test',
  correlationId: 'cor_test',
  featureId: 'cortex.section_copilot',
  featureVersion: '1.0.0',
  organization: { organizationId: 'acme', tier: 'enterprise', isolationKey: 'org:acme' },
  actor: { actorId: 'user-1', actorType: 'team_user', roles: [], capabilities: [] },
  channel: 'team_console',
  attributes: {},
} as unknown as AIRequestContext;

/** Validate a request the way the AI Guard does, then return the clean input. */
function acceptRequest(request: Record<string, unknown>) {
  const result = sectionCopilotFeature.inputValidator.validate(request);
  assert.equal(result.ok, true, `expected a valid request: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** Run parse + fact lock, as the execution pipeline does after generation. */
function applyModelOutput(request: Record<string, unknown>, proposed: Record<string, unknown>) {
  const input = acceptRequest(request);
  const parsed = sectionCopilotFeature.parseOutput(
    JSON.stringify({ proposed_content: proposed, diff_summary: 'Model revision.' }),
    input,
  );
  const locked = sectionCopilotFeature.applyFactLock?.(parsed, input);
  assert.ok(locked, 'the section copilot must apply a fact lock');
  return { content: locked.output.proposed_content, restored: [...locked.restored] };
}

describe('section copilot — fact-lock enforcement', () => {
  it('reverts an AI attempt to change next_step_offer price/currency/duration', () => {
    const { content, restored } = applyModelOutput(
      {
        section: 'next_step_offer',
        section_label: 'Next Step Offer',
        action: 'improve',
        current_content: baseNextStep,
        context: { company: 'ExampleCo' },
      },
      {
        ...baseNextStep,
        offer_name: 'Premium Blueprint', // narrative — allowed to change
        price: 25_000, // LOCKED — must revert
        currency: 'EUR', // LOCKED — must revert
        duration: 'Days 1-30', // LOCKED — must revert
        primary_cta: 'Confirm the Engagement', // narrative — allowed
      },
    );

    assert.equal(content.price, 12_000);
    assert.equal(content.currency, 'USD');
    assert.equal(content.duration, 'Days 1-10');
    // Narrative edits survive.
    assert.equal(content.offer_name, 'Premium Blueprint');
    assert.equal(content.primary_cta, 'Confirm the Engagement');
    // Every locked field the model touched is reported.
    assert.deepEqual(restored.sort(), ['currency', 'duration', 'price']);
  });

  it('reverts diagnosis severity/confidence/evidence but keeps the description rewrite', () => {
    const current = {
      title: 'Bottleneck',
      description: 'Original description.',
      severity: 'high',
      confidence: 0.82,
      evidence: [{ source: 'diagnostic', ref: 'Q3' }],
      operational_impact: ['a', 'b'],
      financial_impact: ['x'],
    };

    const { content, restored } = applyModelOutput(
      {
        section: 'diagnosis_1',
        section_label: 'Diagnosis 2',
        action: 'improve',
        current_content: current,
        context: { company: 'ExampleCo' },
      },
      {
        ...current,
        description: 'Sharper, boardroom-grade description.',
        severity: 'critical', // LOCKED
        confidence: 0.99, // LOCKED
        evidence: [], // LOCKED
      },
    );

    assert.equal(content.description, 'Sharper, boardroom-grade description.');
    assert.equal(content.severity, 'high');
    assert.equal(content.confidence, 0.82);
    assert.deepEqual(content.evidence, [{ source: 'diagnostic', ref: 'Q3' }]);
    assert.deepEqual(restored.sort(), ['confidence', 'evidence', 'severity']);
  });

  it('reports no restored fields when the model respects the locks', () => {
    const { content, restored } = applyModelOutput(
      {
        section: 'next_step_offer',
        section_label: 'Next Step Offer',
        action: 'improve',
        current_content: baseNextStep,
        context: { company: 'ExampleCo' },
      },
      { ...baseNextStep, offer_name: 'Renamed Offer' },
    );
    assert.equal(restored.length, 0);
    assert.equal(content.offer_name, 'Renamed Offer');
    assert.equal(content.price, 12_000);
  });

  it('leaves sections without locked fields untouched (executive_brief, scope_boundaries)', () => {
    assert.equal(LOCKED_FIELDS_BY_SECTION.executive_brief, undefined);
    assert.equal(LOCKED_FIELDS_BY_SECTION.scope_boundaries, undefined);

    const proposed = { strategic_context: 'new', why_now: 'new' };
    const { content, restored } = applyModelOutput(
      {
        section: 'executive_brief',
        section_label: 'Executive Brief',
        action: 'improve',
        current_content: { strategic_context: 'old', why_now: 'old' },
        context: { company: 'ExampleCo' },
      },
      proposed,
    );
    assert.deepEqual(restored, []);
    assert.deepEqual(content, proposed);
  });

  it('does not fabricate a locked field that is absent from current content', () => {
    // If current has no price (unexpected), enforcement must not inject one.
    const { content, restored } = applyModelOutput(
      {
        section: 'next_step_offer',
        section_label: 'Next Step Offer',
        action: 'improve',
        current_content: { offer_name: 'a' },
        context: { company: 'ExampleCo' },
      },
      { offer_name: 'x', primary_cta: 'y' },
    );
    assert.equal('price' in content, false);
    assert.deepEqual(restored, []);
  });
});

describe('section copilot — validation vocabulary', () => {
  it('exposes exactly the 6 sections and 5 actions', () => {
    assert.deepEqual([...SECTION_KEYS], [
      'executive_brief',
      'diagnosis_0',
      'diagnosis_1',
      'diagnosis_2',
      'scope_boundaries',
      'next_step_offer',
    ]);
    assert.deepEqual([...SECTION_ACTIONS], ['improve', 'expand', 'simplify', 'fix_gate', 'custom']);
  });

  it('rejects a section or action outside the vocabulary at the guard boundary', () => {
    for (const invalid of [{ section: 'made_up' }, { action: 'rewrite_everything' }]) {
      const result = sectionCopilotFeature.inputValidator.validate({
        section: 'next_step_offer',
        section_label: 'Next Step Offer',
        action: 'improve',
        current_content: baseNextStep,
        context: { company: 'ExampleCo' },
        ...invalid,
      });
      assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(invalid)}`);
    }
  });
});

describe('section copilot — prompt governance', () => {
  const registry = createPromptRegistry();
  registerCortexPrompts(registry);

  const request = {
    section: 'next_step_offer',
    section_label: 'Next Step Offer',
    action: 'improve',
    current_content: baseNextStep,
    rejection_contexts: ['Too generic — reference the real pipeline gap'],
    context: {
      company: 'ExampleCo',
      industry: 'Finance',
      locked_facts: { price: 12_000, currency: 'USD', duration: 'Days 1-10' },
    },
  };

  /** Render the prompt the way the execution pipeline does. */
  function render(overrides: Record<string, unknown> = {}) {
    const input = acceptRequest({ ...request, ...overrides });
    const variables = sectionCopilotFeature.buildVariables(input, CONTEXT);
    const rendered = registry.render(sectionCopilotFeature.descriptor.promptId, variables);
    return `${rendered.system}\n${rendered.user}`;
  }

  it('embeds the safety rules, fact-lock list, and rejection context', () => {
    const prompt = render();
    assert.match(prompt, /MATH DECIDES, YOU EXPLAIN/);
    assert.match(prompt, /NO FABRICATION/);
    assert.match(prompt, /rewrite and explain narrative text/);
    assert.match(
      prompt,
      /FACT-LOCKED FIELDS for this section \(leave exactly as-is[^)]*\): price, currency, duration/,
    );
    assert.match(prompt, /PREVIOUSLY REJECTED SUGGESTIONS/);
    assert.match(prompt, /ExampleCo/);
    assert.match(prompt, /"proposed_content"/);
  });

  it('includes the user instruction only for the custom action', () => {
    assert.doesNotMatch(render(), /USER INSTRUCTION:/);
    assert.match(
      render({ action: 'custom', custom_prompt: 'make it punchier' }),
      /USER INSTRUCTION: "make it punchier"/,
    );
  });

  it('tells the model the server restores locked fields regardless', () => {
    // The prompt asks; the fact lock guarantees. Stating both is deliberate —
    // a model that knows the restore happens has no reason to try.
    assert.match(render(), /the server restores them regardless/);
  });
});
