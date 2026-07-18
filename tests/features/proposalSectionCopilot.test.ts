/**
 * BATCH 5 — ProposalSectionCopilot governance + wiring contract tests
 *
 * The section copilot lets the LLM rewrite/explain narrative for the 6 proposal
 * sections, but it must NEVER alter authoritative fields (price, currency,
 * duration, severity, confidence, evidence). These tests lock:
 *   - the deterministic fact-lock enforcement (defence that reverts any change),
 *   - request validation vocabulary (VALID_SECTIONS / VALID_ACTIONS),
 *   - the prompt carries the safety rules + fact-lock instruction,
 *   - the client-side engine assembles a live response into demo-parity shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceFactLock,
  buildSectionCopilotPrompt,
  LOCKED_FIELDS_BY_SECTION,
  VALID_SECTIONS,
  VALID_ACTIONS,
  type ProposalSectionCopilotRequest,
} from '../../supabase/functions/server/proposalSectionCopilot.ts';

const baseNextStep = {
  offer_name: 'Diagnostic Audit',
  price: 12_000,
  currency: 'USD',
  duration: 'Days 1-10',
  primary_cta: 'Get Started',
  secondary_cta: 'Learn more',
};

describe('section copilot — fact-lock enforcement', () => {
  it('reverts an AI attempt to change next_step_offer price/currency/duration', () => {
    const proposed = {
      ...baseNextStep,
      offer_name: 'Premium Blueprint',      // narrative — allowed to change
      price: 25_000,                          // LOCKED — must revert
      currency: 'EUR',                        // LOCKED — must revert
      duration: 'Days 1-30',                  // LOCKED — must revert
      primary_cta: 'Confirm the Engagement',  // narrative — allowed
    };
    const { content, restored } = enforceFactLock('next_step_offer', proposed, baseNextStep);

    assert.equal(content.price, 12_000);
    assert.equal(content.currency, 'USD');
    assert.equal(content.duration, 'Days 1-10');
    // Narrative edits survive.
    assert.equal(content.offer_name, 'Premium Blueprint');
    assert.equal(content.primary_cta, 'Confirm the Engagement');
    // Every locked field the model touched is reported.
    assert.deepEqual(restored.sort(), ['currency', 'duration', 'price']);
  });

  it('reverts diagnosis severity/confidence/evidence but keeps description rewrite', () => {
    const current = {
      title: 'Bottleneck',
      description: 'Original description.',
      severity: 'high',
      confidence: 0.82,
      evidence: [{ source: 'diagnostic', ref: 'Q3' }],
      operational_impact: ['a', 'b'],
      financial_impact: ['x'],
    };
    const proposed = {
      ...current,
      description: 'Sharper, boardroom-grade description.',
      severity: 'critical',            // LOCKED
      confidence: 0.99,                // LOCKED
      evidence: [],                    // LOCKED
    };
    const { content, restored } = enforceFactLock('diagnosis_1', proposed, current);

    assert.equal(content.description, 'Sharper, boardroom-grade description.');
    assert.equal(content.severity, 'high');
    assert.equal(content.confidence, 0.82);
    assert.deepEqual(content.evidence, [{ source: 'diagnostic', ref: 'Q3' }]);
    assert.deepEqual(restored.sort(), ['confidence', 'evidence', 'severity']);
  });

  it('reports no restored fields when the model respects the locks', () => {
    const proposed = { ...baseNextStep, offer_name: 'Renamed Offer' };
    const { content, restored } = enforceFactLock('next_step_offer', proposed, baseNextStep);
    assert.equal(restored.length, 0);
    assert.equal(content.offer_name, 'Renamed Offer');
    assert.equal(content.price, 12_000);
  });

  it('leaves sections without locked fields untouched (executive_brief, scope_boundaries)', () => {
    assert.equal(LOCKED_FIELDS_BY_SECTION.executive_brief, undefined);
    assert.equal(LOCKED_FIELDS_BY_SECTION.scope_boundaries, undefined);
    const proposed = { strategic_context: 'new', why_now: 'new' };
    const { content, restored } = enforceFactLock('executive_brief', proposed, { strategic_context: 'old', why_now: 'old' });
    assert.deepEqual(restored, []);
    assert.deepEqual(content, proposed);
  });

  it('does not fabricate a locked field that is absent from current content', () => {
    // If current has no price (unexpected), enforcement must not inject one.
    const proposed = { offer_name: 'x', primary_cta: 'y' };
    const { content, restored } = enforceFactLock('next_step_offer', proposed, { offer_name: 'a' });
    assert.equal('price' in content, false);
    assert.deepEqual(restored, []);
  });
});

describe('section copilot — validation vocabulary', () => {
  it('exposes exactly the 6 sections and 5 actions', () => {
    assert.deepEqual(VALID_SECTIONS, [
      'executive_brief', 'diagnosis_0', 'diagnosis_1', 'diagnosis_2',
      'scope_boundaries', 'next_step_offer',
    ]);
    assert.deepEqual(VALID_ACTIONS, ['improve', 'expand', 'simplify', 'fix_gate', 'custom']);
  });
});

describe('section copilot — prompt governance', () => {
  const req: ProposalSectionCopilotRequest = {
    section: 'next_step_offer',
    section_label: 'Next Step Offer',
    action: 'improve',
    current_content: baseNextStep,
    rejection_contexts: ['Too generic — reference the real pipeline gap'],
    context: { company: 'ExampleCo', industry: 'Finance', locked_facts: { price: 12_000, currency: 'USD', duration: 'Days 1-10' } },
  };

  it('embeds the safety rules, fact-lock list, and rejection context', () => {
    const p = buildSectionCopilotPrompt(req);
    assert.match(p, /ABSOLUTE SAFETY RULES/);
    assert.match(p, /rewrite or explain narrative text/);
    assert.match(p, /FACT-LOCKED FIELDS for this section \(leave EXACTLY as-is\): price, currency, duration/);
    assert.match(p, /PREVIOUSLY REJECTED SUGGESTIONS/);
    assert.match(p, /ExampleCo/);
    assert.match(p, /"proposed_content"/);
  });

  it('includes the user instruction only for the custom action', () => {
    const withoutCustom = buildSectionCopilotPrompt(req);
    assert.doesNotMatch(withoutCustom, /USER INSTRUCTION:/);
    const custom = buildSectionCopilotPrompt({ ...req, action: 'custom', custom_prompt: 'make it punchier' });
    assert.match(custom, /USER INSTRUCTION: "make it punchier"/);
  });
});
