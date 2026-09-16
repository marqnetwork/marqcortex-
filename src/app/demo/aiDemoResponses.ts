/**
 * THE CANNED ASSISTANT.
 *
 * Five keyword-matched replies that stand in for a language model when MARQ
 * Cortex is run as a demo. They lived inside `GlobalAIChat.tsx` and were served
 * whenever `BACKEND_INTEGRATION` was off — which is to say, in the shipped
 * build — in the same message bubble a real model answers in, under the same
 * "MARQ Cortex AI" heading, with no marking of any kind.
 *
 * They are here because a demo needs the assistant to say something. The caller
 * loads this module only in a designated demo, and marks every reply it
 * produces so the transcript can say where it came from.
 */

export function getMockResponse(
  message: string,
  _section: string,
): { reply: string; applyContent?: string } {
  const lower = message.toLowerCase();

  if (lower.includes('polish') || lower.includes('tone')) {
    return {
      reply: "I've polished the tone for a C-suite audience. The language is now more authoritative and the value proposition is front-loaded.",
      applyContent: `This diagnostic engagement identifies a critical operational inflection point for your organisation. The evidence indicates that current systems are creating compounding friction at a rate that will materially affect capacity within the next two quarters.\n\nThe recommended intervention is sequenced for maximum impact with minimum disruption -- targeting the highest-leverage bottleneck first, then systematically removing downstream constraints.`,
    };
  }
  if (lower.includes('urgency') || lower.includes('why now')) {
    return {
      reply: "Here's a strengthened 'why now' argument grounded in operational timing and market context.",
      applyContent: `The timing for this intervention is material. Operational drag of this nature compounds at approximately 15-20% per quarter when left unresolved. Competitors who have already addressed similar bottlenecks are reporting 35-50% efficiency gains within 90 days of structured intervention.\n\nDelaying action by one quarter is not a neutral decision -- it is an active choice to absorb an increasing cost.`,
    };
  }
  if (lower.includes('roi') || lower.includes('return')) {
    return {
      reply: "Here's an executive-ready ROI framing using your existing figures. All numbers intact -- only the narrative framing has been enhanced.",
      applyContent: `The projected return reflects a conservative model applied to your current operational baseline. The primary value drivers are time recovered from manual processes, cost avoided through earlier issue detection, and revenue leakage reduced through improved pipeline visibility.\n\nAt the conservative estimate, the engagement pays for itself within the first engagement cycle.`,
    };
  }
  if (lower.includes('strengthen') || lower.includes('argument') || lower.includes('reasoning')) {
    return {
      reply: "Here's a strengthened version of the recommendation reasoning with 'why this sequencing' logic added.",
      applyContent: `The recommendation follows the Cortex sequencing principle: resolve constraints before optimisation, fix bottlenecks before growth. This is not a generic recommendation -- it is derived directly from your diagnostic data, which identified this as the highest-leverage point of intervention.\n\nAddressing this first creates the conditions for every downstream improvement to be more effective.`,
    };
  }
  return {
    reply: `Understood. The key principle: the most effective proposals anchor every claim in the diagnostic data. The AI's role is to explain and frame -- the math has already decided the priority.\n\nIs there a specific aspect you'd like me to refine? I can improve tone, strengthen argument, simplify language, or generate a specific narrative block.`,
  };
}
