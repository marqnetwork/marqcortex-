/**
 * Feature definition tests.
 *
 * Each feature is a binding of validator → prompt variables → output parser →
 * fact lock. These tests exercise those four surfaces directly, against
 * adversarial model output, without going through the pipeline.
 *
 * The analysis sanitizer gets the most attention here, because it is the one
 * place where structured model output is persisted and then read back by
 * deterministic engines. If it lets an out-of-range value through, the model has
 * effectively decided an outcome — which is what Constitution Article 6 forbids.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createFeatureCatalog } from '../policy/featureCatalog.ts';
import { registerCortexFeatures, FEATURE } from '../features/index.ts';
import { narrativeFeature } from '../features/narrative.ts';
import { analysisFeature, sanitizeAnalysis } from '../features/analysis.ts';
import { chatFeature } from '../features/chat.ts';
import { blockAssistFeature, REFERENCE_BLOCK_TYPE } from '../features/blockAssist.ts';
import { copilotPlanFeature } from '../features/copilotPlan.ts';
import { sectionCopilotFeature, LOCKED_FIELDS_BY_SECTION } from '../features/sectionCopilot.ts';
import { createPromptRegistry } from '../prompts/registry.ts';
import { registerCortexPrompts } from '../prompts/catalog.ts';
import { AIError } from '../contracts/errors.ts';
import type { AIRequestContext } from '../contracts/request.ts';
import { narrativeInput, sectionCopilotInput } from './harness.ts';

const CONTEXT = {
  requestId: 'req_1',
  correlationId: 'cor_1',
  receivedAt: '2026-01-01T00:00:00.000Z',
  platformVersion: '1.0.0',
  contractVersion: 'ai.v1',
  featureId: 'test',
  featureVersion: '1.0.0',
  actor: { actorId: 'user-1', actorType: 'team_user', roles: ['consultant'], capabilities: [] },
  organization: { organizationId: 'acme', tier: 'enterprise', isolationKey: 'org:acme' },
  channel: 'team_console',
  attributes: {},
} as unknown as AIRequestContext;

/** Validate through the feature's own validator, as the guard would. */
function accept<T>(feature: { inputValidator: { validate(v: unknown): unknown } }, input: unknown): T {
  const result = feature.inputValidator.validate(input) as
    | { ok: true; value: T }
    | { ok: false; issues: { path: string; message: string }[] };
  assert.equal(result.ok, true, `expected valid input: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function reject(feature: { inputValidator: { validate(v: unknown): unknown } }, input: unknown): string[] {
  const result = feature.inputValidator.validate(input) as
    | { ok: true }
    | { ok: false; issues: { path: string }[] };
  assert.equal(result.ok, false, 'expected the input to be rejected');
  if (result.ok) throw new Error('unreachable');
  return result.issues.map((issue) => issue.path);
}

describe('feature catalog', () => {
  const catalog = createFeatureCatalog();
  registerCortexFeatures(catalog);

  it('registers every Cortex feature exactly once', () => {
    assert.equal(catalog.size(), 6);
    assert.deepEqual(
      catalog.list().map((descriptor) => descriptor.featureId).sort(),
      Object.values(FEATURE).slice().sort(),
    );
  });

  it('rejects a duplicate registration', () => {
    assert.throws(() => registerCortexFeatures(catalog), AIError);
  });

  it('reports an unknown feature rather than returning undefined', () => {
    assert.throws(
      () => catalog.require('cortex.does_not_exist'),
      (error: AIError) => error.code === 'FEATURE_NOT_FOUND',
    );
  });

  it('gives every feature an owner, a capability and bounded limits', () => {
    for (const descriptor of catalog.list()) {
      assert.ok(descriptor.owner.trim().length > 0, `${descriptor.featureId} has no owner`);
      assert.ok(descriptor.capability.startsWith('ai.'), `${descriptor.featureId} capability`);
      assert.ok(descriptor.limits.perActor.limit > 0);
      assert.ok(descriptor.limits.perOrganization.limit >= descriptor.limits.perActor.limit);
      assert.ok(descriptor.limits.timeoutMs >= 1_000);
      assert.ok(descriptor.limits.maxInputBytes > 0);
    }
  });

  it('every feature references a registered prompt', () => {
    const prompts = createPromptRegistry();
    registerCortexPrompts(prompts);
    for (const descriptor of catalog.list()) {
      assert.doesNotThrow(
        () => prompts.require(descriptor.promptId),
        `${descriptor.featureId} references an unregistered prompt`,
      );
    }
  });

  it('rejects a descriptor whose organization limit is below its actor limit', () => {
    const fresh = createFeatureCatalog();
    assert.throws(
      () =>
        fresh.register({
          ...narrativeFeature,
          descriptor: {
            ...narrativeFeature.descriptor,
            featureId: 'broken',
            limits: {
              ...narrativeFeature.descriptor.limits,
              perActor: { limit: 100, windowMs: 60_000 },
              perOrganization: { limit: 10, windowMs: 60_000 },
            },
          },
        } as never),
      (error: AIError) => String(error.diagnostics).includes('perOrganization limit'),
    );
  });

  it('rejects a JSON feature that does not require structured output', () => {
    const fresh = createFeatureCatalog();
    assert.throws(
      () =>
        fresh.register({
          ...analysisFeature,
          descriptor: {
            ...analysisFeature.descriptor,
            featureId: 'broken',
            requiredCapabilities: { structuredOutput: false, chatCompletions: true },
          },
        } as never),
      (error: AIError) => String(error.diagnostics).includes('structuredOutput'),
    );
  });
});

describe('narrative feature', () => {
  it('selects the prompt matching the requested narrative type', () => {
    for (const [type, promptId] of [
      ['why_now', 'narrative.why_now'],
      ['confidence_reasoning', 'narrative.confidence_reasoning'],
      ['strategic_decision', 'narrative.strategic_decision'],
    ] as const) {
      const input = accept<never>(narrativeFeature, narrativeInput({ type }));
      assert.equal(narrativeFeature.resolvePromptId?.(input), promptId);
    }
  });

  it('rejects an unknown narrative type', () => {
    assert.deepEqual(reject(narrativeFeature, narrativeInput({ type: 'make_it_up' })), ['type']);
  });

  it('requires a company name', () => {
    const input = narrativeInput() as { context: Record<string, unknown> };
    input.context.company = '';
    assert.deepEqual(reject(narrativeFeature, input), ['context.company']);
  });

  it('renders every declared variable of every narrative prompt', () => {
    // A missing variable is a PROMPT_RENDER_FAILED at runtime; catching it here
    // means a prompt edit cannot ship a feature that cannot render.
    const prompts = createPromptRegistry();
    registerCortexPrompts(prompts);
    for (const type of ['why_now', 'confidence_reasoning', 'strategic_decision'] as const) {
      const input = accept<never>(narrativeFeature, narrativeInput({ type }));
      const variables = narrativeFeature.buildVariables(input, CONTEXT);
      const promptId = narrativeFeature.resolvePromptId?.(input) ?? '';
      assert.doesNotThrow(() => prompts.render(promptId, variables), `render failed for ${type}`);
    }
  });

  it('distinguishes an absent figure from zero', () => {
    // Formatting a missing metric as "0" would have the model explain a number
    // the engine never produced.
    const input = accept<never>(
      narrativeFeature,
      narrativeInput({ context: { company: 'Acme', assumptions: {}, recommendation_count: 0 } }),
    );
    const variables = narrativeFeature.buildVariables(input, CONTEXT);
    assert.equal(variables.supportTicketsPerWeek, 'not recorded');
    assert.equal(variables.monthlyRevenue, 'not recorded');
  });

  it('formats revenue as currency for the prompt', () => {
    const input = accept<never>(narrativeFeature, narrativeInput());
    assert.equal(narrativeFeature.buildVariables(input, CONTEXT).monthlyRevenue, '$950,000');
  });

  it('returns the trimmed narrative with its type', () => {
    const input = accept<{ type: string }>(narrativeFeature, narrativeInput());
    const output = narrativeFeature.parseOutput('  Because the backlog compounds.  ', input as never);
    assert.deepEqual(output, { type: 'why_now', narrative: 'Because the backlog compounds.' });
  });
});

describe('analysis feature — sanitizer', () => {
  it('clamps a score the model returned outside its scale', () => {
    // The defect this prevents: urgencyLevel 47 on a 0–10 scale would distort
    // every downstream ranking built on the stored record.
    const result = sanitizeAnalysis({ urgencyLevel: 47, aiScore: 500, qualityScore: -20 }, 'sub-1');
    assert.equal(result.urgencyLevel, 10);
    assert.equal(result.aiScore, 100);
    assert.equal(result.qualityScore, 0);
  });

  it('coerces a numeric string and falls back for nonsense', () => {
    assert.equal(sanitizeAnalysis({ urgencyLevel: '7' }, 'sub-1').urgencyLevel, 7);
    assert.equal(sanitizeAnalysis({ urgencyLevel: 'high' }, 'sub-1').urgencyLevel, 0);
    assert.equal(sanitizeAnalysis({ urgencyLevel: null }, 'sub-1').urgencyLevel, 0);
  });

  it('replaces an invented service with the safe default', () => {
    const result = sanitizeAnalysis(
      { recommendation: { primaryService: 'blockchain-transformation' } },
      'sub-1',
    );
    const recommendation = result.recommendation as Record<string, unknown>;
    assert.equal(recommendation.primaryService, 'operations-audit');
    assert.equal(recommendation.primaryServiceLabel, 'Operations Audit');
  });

  it('replaces an invented risk type and severity', () => {
    const result = sanitizeAnalysis(
      { riskFlags: [{ type: 'alien-invasion', severity: 'apocalyptic', label: 'x' }] },
      'sub-1',
    );
    const flags = result.riskFlags as Record<string, unknown>[];
    assert.equal(flags[0].type, 'scale-risk');
    assert.equal(flags[0].severity, 'medium');
  });

  it('caps list lengths so one response cannot bloat the stored record', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ title: `p${i}`, urgencyScore: 5 }));
    const result = sanitizeAnalysis({ coreProblems: many, riskFlags: many }, 'sub-1');
    assert.equal((result.coreProblems as unknown[]).length, 3);
    assert.equal((result.riskFlags as unknown[]).length, 4);
  });

  it('truncates over-long strings rather than storing them', () => {
    const result = sanitizeAnalysis({ primaryPainSignal: 'x'.repeat(5_000) }, 'sub-1');
    assert.equal(String(result.primaryPainSignal).length, 300);
  });

  it('survives a response that is structurally wrong throughout', () => {
    const result = sanitizeAnalysis(
      {
        coreProblems: 'not an array',
        pillarHeatmap: 'not an object',
        recommendation: null,
        roiEstimate: [],
        callPrep: 42,
      },
      'sub-1',
    );
    assert.deepEqual(result.coreProblems, []);
    assert.deepEqual(result.pillarHeatmap, {
      operationsExecution: 0,
      revenueGrowth: 0,
      systemsAutomation: 0,
      aiReadinessGovernance: 0,
    });
    assert.equal((result.recommendation as Record<string, unknown>).primaryService, 'operations-audit');
  });

  it('drops fields the model invented outside the schema', () => {
    const result = sanitizeAnalysis({ injectedField: 'should not persist', aiScore: 50 }, 'sub-1');
    assert.equal('injectedField' in result, false);
  });

  it('stamps the submission id it was called with, not one from the model', () => {
    const result = sanitizeAnalysis({ submissionId: 'attacker-controlled' }, 'sub-real');
    assert.equal(result.submissionId, 'sub-real');
    assert.equal((result.callPrep as Record<string, unknown>).leadId, 'sub-real');
  });

  it('parses a full model response end to end', () => {
    const input = accept<never>(analysisFeature, {
      submissionId: 'sub-1',
      company: 'Acme',
      answers: { '1': 'Intake is manual.' },
    });
    const output = analysisFeature.parseOutput(
      JSON.stringify({
        urgencyLevel: 8,
        aiScore: 77,
        priority: 'high',
        coreProblems: [{ title: 'Manual intake', urgencyScore: 8 }],
        recommendation: { primaryService: 'automation-sprint' },
      }),
      input,
    );
    assert.equal(output.aiScore, 77);
    assert.equal(output.priority, 'high');
    assert.equal(output.status, 'complete');
  });

  it('bounds the answers map the caller may submit', () => {
    const answers: Record<string, string> = {};
    for (let i = 0; i < 100; i += 1) answers[`q${i}`] = 'x';
    assert.deepEqual(reject(analysisFeature, { submissionId: 's', answers }), ['answers']);
  });
});

describe('chat feature', () => {
  it('bounds conversation history to the recent turns', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }));
    const input = accept<never>(chatFeature, { message: 'next', history });
    const conversation = chatFeature.buildConversation?.(input) ?? [];
    // One acknowledgement turn + 10 history turns + the new message.
    assert.equal(conversation.length, 12);
    assert.equal(conversation[conversation.length - 1].content, 'next');
    assert.equal(conversation.some((turn) => turn.content === 'turn 0'), false);
  });

  it('rejects an oversized history rather than truncating silently', () => {
    const history = Array.from({ length: 200 }, () => ({ role: 'user', content: 'x' }));
    assert.deepEqual(reject(chatFeature, { message: 'hi', history }), ['history']);
  });

  it('rejects an unknown turn role', () => {
    assert.deepEqual(
      reject(chatFeature, { message: 'hi', history: [{ role: 'system', content: 'x' }] }),
      ['history[0].role'],
    );
  });

  it('marks supplied section content as engine-computed fact', () => {
    const input = accept<never>(chatFeature, {
      message: 'tighten this',
      section: 'roi',
      sectionLabel: 'ROI',
      sectionContent: 'Payback is 14 weeks.',
    });
    const variables = chatFeature.buildVariables(input, CONTEXT);
    assert.match(variables.context, /engine-computed facts/);
    assert.match(variables.context, /Payback is 14 weeks\./);
  });

  it('extracts an apply block and strips it from the reply', () => {
    const output = chatFeature.parseOutput(
      'Here is a tighter version.\n[APPLY_START]\nThe programme is projected to pay back in 14 weeks.\n[APPLY_END]',
      {} as never,
    );
    assert.equal(output.reply, 'Here is a tighter version.');
    assert.equal(output.applyContent, 'The programme is projected to pay back in 14 weeks.');
  });

  it('omits applyContent entirely for a conversational reply', () => {
    const output = chatFeature.parseOutput('Happy to help.', {} as never);
    assert.equal('applyContent' in output, false);
  });
});

describe('block assist feature', () => {
  const base = {
    block_id: 'b1',
    block_type: 'proposal_executive_brief',
    title: 'Executive Brief',
    current_content: { text: 'Current narrative.' },
    action: 'ai_improve',
    context: { company: 'Acme', industry: 'Manufacturing' },
  };

  it('refuses the ROI reference block at the security boundary', () => {
    // A 400 from the guard, not a 500 from deep inside the pipeline.
    const paths = reject(blockAssistFeature, { ...base, block_type: REFERENCE_BLOCK_TYPE });
    assert.deepEqual(paths, ['block_type']);
  });

  it('rejects an unknown action', () => {
    assert.deepEqual(reject(blockAssistFeature, { ...base, action: 'delete_everything' }), ['action']);
  });

  it('supplies expand-specific output requirements for expandable block types', () => {
    const improve = accept<never>(blockAssistFeature, base);
    const expand = accept<never>(blockAssistFeature, { ...base, action: 'ai_expand' });
    assert.notEqual(
      blockAssistFeature.buildVariables(improve, CONTEXT).outputRequirements,
      blockAssistFeature.buildVariables(expand, CONTEXT).outputRequirements,
    );
  });

  it('falls back to a generic requirement for an unmapped block type', () => {
    const input = accept<never>(blockAssistFeature, { ...base, block_type: 'some_new_block' });
    assert.match(
      blockAssistFeature.buildVariables(input, CONTEXT).outputRequirements,
      /same JSON structure/,
    );
  });

  it('marks the ROI snapshot read-only when one is supplied', () => {
    const input = accept<never>(blockAssistFeature, {
      ...base,
      context: { ...base.context, roi_snapshot: { payback_weeks: 14 } },
    });
    assert.match(
      blockAssistFeature.buildVariables(input, CONTEXT).roiSnapshot,
      /read-only — these figures cannot change/,
    );
  });

  it('rejects model output with no editable content, retryably', () => {
    const input = accept<never>(blockAssistFeature, base);
    assert.throws(
      () => blockAssistFeature.parseOutput(JSON.stringify({ diff_summary: 'x' }), input),
      (error: AIError) => error.code === 'INVALID_MODEL_OUTPUT' && error.retryable,
    );
  });

  it('supplies a diff summary when the model omits one', () => {
    const input = accept<never>(blockAssistFeature, base);
    const output = blockAssistFeature.parseOutput(
      JSON.stringify({ proposed_content: { text: 'better' } }),
      input,
    );
    assert.equal(output.change_type, 'ai_improve');
    assert.match(output.diff_summary, /proposal_executive_brief/);
  });
});

describe('copilot plan feature', () => {
  const blocks = [
    { block_id: 'b1', block_type: 'proposal_solution', title: 'Solution', status: 'draft' },
    { block_id: 'b2', block_type: REFERENCE_BLOCK_TYPE, title: 'ROI', status: 'approved' },
    { block_id: 'b3', block_type: 'contract_clause', title: 'Clause', status: 'draft' },
    { block_id: 'b4', block_type: 'proposal_diagnosis', title: 'Diagnosis', status: 'draft', is_locked: true },
    { block_id: 'b5', block_type: 'crm_note', title: 'Note', status: 'draft', has_pending: true },
  ];
  const request = {
    user_input: 'tighten the solution',
    scope: 'proposal',
    entity_id: 'p1',
    block_summaries: blocks,
    context: { company: 'Acme', industry: 'Manufacturing' },
  };

  it('never shows the model a block it is not allowed to target', () => {
    // Not showing an excluded item is a guarantee; asking a model to respect an
    // exclusion list is only a request.
    const input = accept<never>(copilotPlanFeature, request);
    const variables = copilotPlanFeature.buildVariables(input, CONTEXT);
    assert.match(variables.targetableBlocks, /b1/);
    for (const excluded of ['b2', 'b3', 'b4', 'b5']) {
      assert.equal(variables.targetableBlocks.includes(excluded), false, `${excluded} was offered`);
      assert.match(variables.skippedBlocks, new RegExp(excluded));
    }
  });

  it('discards a target the model invented', () => {
    const input = accept<never>(copilotPlanFeature, request);
    const output = copilotPlanFeature.parseOutput(
      JSON.stringify({
        intent: 'rewrite_tone',
        targets: [
          { block_id: 'b1', action: 'ai_improve' },
          { block_id: 'b2', action: 'ai_improve' },
          { block_id: 'does-not-exist', action: 'ai_improve' },
        ],
      }),
      input,
    );
    assert.deepEqual(output.targets.map((target) => target.block_id), ['b1']);
    assert.equal(output.skipped.some((entry) => entry.block_id === 'b2'), true);
  });

  it('collapses duplicate targets to one action per block', () => {
    const input = accept<never>(copilotPlanFeature, request);
    const output = copilotPlanFeature.parseOutput(
      JSON.stringify({
        intent: 'rewrite_tone',
        targets: [
          { block_id: 'b1', action: 'ai_improve' },
          { block_id: 'b1', action: 'ai_expand' },
        ],
      }),
      input,
    );
    assert.equal(output.targets.length, 1);
  });

  it('recomputes the ROI recalculation flag rather than trusting the model', () => {
    const input = accept<never>(copilotPlanFeature, request);
    const output = copilotPlanFeature.parseOutput(
      JSON.stringify({
        intent: 'rewrite_tone',
        targets: [{ block_id: 'b1', action: 'ai_improve' }],
        roi_recalc_required: false,
      }),
      input,
    );
    // b1 is a proposal_solution, so a recalculation is required whatever the
    // model claimed.
    assert.equal(output.roi_recalc_required, true);
  });

  it('falls back to a supported intent when the model invents one', () => {
    const input = accept<never>(copilotPlanFeature, request);
    const output = copilotPlanFeature.parseOutput(
      JSON.stringify({ intent: 'delete_the_proposal', targets: [] }),
      input,
    );
    assert.equal(output.intent, 'rewrite_tone');
  });

  it('rejects a response with no plan at all, retryably', () => {
    const input = accept<never>(copilotPlanFeature, request);
    assert.throws(
      () => copilotPlanFeature.parseOutput(JSON.stringify({ notes: 'sorry' }), input),
      (error: AIError) => error.code === 'INVALID_MODEL_OUTPUT',
    );
  });
});

describe('section copilot feature', () => {
  it('names the section fact-lock fields in the rendered instruction', () => {
    const input = accept<never>(sectionCopilotFeature, sectionCopilotInput());
    const variables = sectionCopilotFeature.buildVariables(input, CONTEXT);
    assert.match(variables.lockedFieldsLine, /FACT-LOCKED FIELDS/);
    for (const field of LOCKED_FIELDS_BY_SECTION.next_step_offer) {
      assert.match(variables.lockedFieldsLine, new RegExp(field));
    }
  });

  it('states that a section without locked fields still may not invent numbers', () => {
    const input = accept<never>(
      sectionCopilotFeature,
      sectionCopilotInput({ section: 'scope_boundaries', section_label: 'Scope', current_content: { text: 'x' } }),
    );
    assert.match(
      sectionCopilotFeature.buildVariables(input, CONTEXT).lockedFieldsLine,
      /never invent a number/,
    );
  });

  it('reverts commercial terms the model rewrote and reports every one', () => {
    const input = accept<{ current_content: Record<string, unknown> }>(
      sectionCopilotFeature,
      sectionCopilotInput(),
    );
    const parsed = sectionCopilotFeature.parseOutput(
      JSON.stringify({
        proposed_content: {
          offer_name: 'Premium Blueprint',
          price: 25_000,
          currency: 'EUR',
          duration: 'Days 1-30',
          primary_cta: 'Confirm the Engagement',
        },
        diff_summary: 'Sharpened the offer language.',
      }),
      input as never,
    );
    const locked = sectionCopilotFeature.applyFactLock?.(parsed, input as never);
    assert.ok(locked);
    assert.equal(locked.output.proposed_content.price, 12_000);
    assert.equal(locked.output.proposed_content.currency, 'USD');
    assert.equal(locked.output.proposed_content.duration, 'Days 1-10');
    // Narrative changes survive.
    assert.equal(locked.output.proposed_content.offer_name, 'Premium Blueprint');
    assert.deepEqual([...locked.restored], ['price', 'currency', 'duration']);
    assert.deepEqual([...locked.output.fact_lock_enforced], ['price', 'currency', 'duration']);
  });

  it('protects diagnosis scoring fields', () => {
    const input = accept<never>(
      sectionCopilotFeature,
      sectionCopilotInput({
        section: 'diagnosis_0',
        section_label: 'Diagnosis 1',
        current_content: {
          description: 'Intake is manual.',
          severity: 8,
          confidence: 72,
          evidence: ['ticket volume', 'cycle time'],
        },
      }),
    );
    const parsed = sectionCopilotFeature.parseOutput(
      JSON.stringify({
        proposed_content: {
          description: 'Intake is manual and compounding.',
          severity: 10,
          confidence: 99,
          evidence: ['fabricated benchmark'],
        },
      }),
      input,
    );
    const locked = sectionCopilotFeature.applyFactLock?.(parsed, input);
    assert.ok(locked);
    assert.equal(locked.output.proposed_content.severity, 8);
    assert.equal(locked.output.proposed_content.confidence, 72);
    assert.deepEqual(locked.output.proposed_content.evidence, ['ticket volume', 'cycle time']);
    assert.equal(locked.output.proposed_content.description, 'Intake is manual and compounding.');
  });

  it('reports nothing restored when the model complied', () => {
    const input = accept<never>(sectionCopilotFeature, sectionCopilotInput());
    const parsed = sectionCopilotFeature.parseOutput(
      JSON.stringify({
        proposed_content: {
          offer_name: 'Diagnostic Audit',
          price: 12_000,
          currency: 'USD',
          duration: 'Days 1-10',
          primary_cta: 'Begin',
        },
      }),
      input,
    );
    const locked = sectionCopilotFeature.applyFactLock?.(parsed, input);
    assert.deepEqual([...(locked?.restored ?? ['unexpected'])], []);
  });

  it('rejects an unknown section and an unknown action', () => {
    assert.deepEqual(reject(sectionCopilotFeature, sectionCopilotInput({ section: 'made_up' })), [
      'section',
    ]);
    assert.deepEqual(reject(sectionCopilotFeature, sectionCopilotInput({ action: 'rewrite_all' })), [
      'action',
    ]);
  });

  it('carries a custom instruction only for the custom action', () => {
    const custom = accept<never>(
      sectionCopilotFeature,
      sectionCopilotInput({ action: 'custom', custom_prompt: 'Make it shorter.' }),
    );
    const improve = accept<never>(
      sectionCopilotFeature,
      sectionCopilotInput({ custom_prompt: 'Make it shorter.' }),
    );
    assert.match(sectionCopilotFeature.buildVariables(custom, CONTEXT).customInstruction, /shorter/);
    assert.equal(sectionCopilotFeature.buildVariables(improve, CONTEXT).customInstruction, '');
  });
});
