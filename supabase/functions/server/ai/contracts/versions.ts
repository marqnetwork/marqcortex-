/**
 * MARQ Cortex AI Control Plane — version constants.
 *
 * Three independent version axes travel with every AI request so that any
 * historical execution can be reconstructed exactly:
 *
 *   PLATFORM_VERSION  — the control plane implementation itself.
 *   CONTRACT_VERSION  — the wire contract of the AI envelope/result. Callers
 *                       may pin it; the control plane refuses versions it
 *                       cannot honour rather than silently reinterpreting a
 *                       payload.
 *   prompt version    — per prompt, carried on the prompt record (see
 *                       ../prompts/registry.ts). Not global.
 *
 * These are data, not behaviour. Nothing here imports anything.
 */

/** Implementation version of the AI Control Plane. Bump on behaviour change. */
export const PLATFORM_VERSION = '1.0.0';

/** Wire contract version of AIRequestEnvelope / AIExecutionResult. */
export const CONTRACT_VERSION = 'ai.v1';

/**
 * Contract versions this control plane can execute. A request pinned to any
 * other version is rejected with CONTRACT_VERSION_UNSUPPORTED — never coerced.
 */
export const SUPPORTED_CONTRACT_VERSIONS: readonly string[] = [CONTRACT_VERSION];

/** True when the control plane can honour the caller's pinned contract. */
export function isSupportedContractVersion(version: string): boolean {
  return SUPPORTED_CONTRACT_VERSIONS.includes(version);
}
