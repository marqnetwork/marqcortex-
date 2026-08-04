/**
 * Feature registration.
 *
 * The complete list of AI capabilities the MARQ Cortex platform offers. Adding a
 * capability is one entry here plus one definition file — no change to the
 * guard, the policy engine, the pipeline or any route handler.
 */

import type { AIFeatureDefinition, FeatureCatalog } from '../policy/featureCatalog.ts';
import { narrativeFeature } from './narrative.ts';
import { analysisFeature } from './analysis.ts';
import { chatFeature } from './chat.ts';
import { blockAssistFeature } from './blockAssist.ts';
import { copilotPlanFeature } from './copilotPlan.ts';
import { sectionCopilotFeature } from './sectionCopilot.ts';
import { agentStepCompactFeature, agentStepFeature } from './agentStep.ts';

/** Feature ids, so callers reference a constant rather than a literal. */
export const FEATURE = {
  narrative: 'cortex.narrative',
  analysis: 'cortex.analysis',
  chat: 'cortex.chat',
  blockAssist: 'cortex.block_assist',
  copilotPlan: 'cortex.copilot_plan',
  sectionCopilot: 'cortex.section_copilot',
  /**
   * The governed model step of an agent run (AI-01 Batch 3A). Reached only
   * through the agent orchestrator's model profiles — there is no HTTP route
   * that invokes it directly, because an agent step outside a run has no
   * limits, no ledger and no audit trail of its own.
   */
  agentStep: 'cortex.agent_step',
  agentStepCompact: 'cortex.agent_step_compact',
} as const;

export type CortexFeatureId = (typeof FEATURE)[keyof typeof FEATURE];

export function registerCortexFeatures(catalog: FeatureCatalog): void {
  const definitions = [
    narrativeFeature,
    analysisFeature,
    chatFeature,
    blockAssistFeature,
    copilotPlanFeature,
    sectionCopilotFeature,
    agentStepFeature,
    agentStepCompactFeature,
  ] as unknown as AIFeatureDefinition<never, never>[];

  for (const definition of definitions) catalog.register(definition);
}

export { narrativeFeature, NARRATIVE_TYPES, type NarrativeInput, type NarrativeOutput } from './narrative.ts';
export { analysisFeature, sanitizeAnalysis, type AnalysisInput, type AnalysisOutput } from './analysis.ts';
export { chatFeature, type ChatInput, type ChatOutput } from './chat.ts';
export {
  blockAssistFeature,
  BLOCK_ACTIONS,
  REFERENCE_BLOCK_TYPE,
  type BlockAction,
  type BlockAssistInput,
  type BlockAssistOutput,
} from './blockAssist.ts';
export {
  copilotPlanFeature,
  COPILOT_INTENTS,
  type CopilotIntent,
  type CopilotPlanInput,
  type CopilotPlanOutput,
} from './copilotPlan.ts';
export {
  agentStepFeature,
  agentStepCompactFeature,
  type AgentStepInput,
  type AgentStepOutput,
} from './agentStep.ts';
export {
  sectionCopilotFeature,
  SECTION_KEYS,
  SECTION_ACTIONS,
  LOCKED_FIELDS_BY_SECTION,
  type SectionKey,
  type SectionAction,
  type SectionCopilotInput,
  type SectionCopilotOutput,
} from './sectionCopilot.ts';
