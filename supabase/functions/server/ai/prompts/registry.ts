/**
 * Prompt Registry.
 *
 * Every production prompt is registered here, versioned, hashed and owned. No
 * prompt text may be written inline at a call site — a feature names a
 * `promptId` and the registry resolves it.
 *
 * Why this matters beyond tidiness: the prompt is the largest uncontrolled
 * input to an AI system's behaviour. Registering it makes four things possible
 * that inline strings make impossible —
 *
 *   provenance   every completion records the exact prompt hash that produced
 *                it, so a regression can be attributed to a prompt change;
 *   review       prompt changes are a diff in one directory with a named owner;
 *   versioning   an old version stays resolvable for replaying historic runs;
 *   governance   safety clauses are composed from shared fragments instead of
 *                being re-typed (and drifting) per feature.
 *
 * Rendering is intentionally minimal: `{{variable}}` substitution only. No
 * conditionals, no loops, no expressions. A prompt template is a document, not
 * a program — anything that needs logic belongs in the feature's
 * `buildVariables`, where it is typed and testable.
 */

import { AIError } from '../contracts/errors.ts';
import { promptFingerprint, sha256Hex } from './hash.ts';

export interface PromptDefinition {
  readonly promptId: string;
  /** Monotonic integer version. Bump on any text change. */
  readonly version: number;
  /** Accountable team or individual. Required — prompts are never unowned. */
  readonly owner: string;
  /** Why this prompt exists and what it must never do. */
  readonly purpose: string;
  /** System role content. Composed from shared governance fragments. */
  readonly system: string;
  /** User role template. `{{name}}` placeholders are substituted at render. */
  readonly template: string;
  /** Variables the template requires. A missing one fails the render. */
  readonly variables: readonly string[];
}

export interface RegisteredPrompt extends PromptDefinition {
  /** Full SHA-256 of `system` + template, for audit. */
  readonly hash: string;
  /** Short quotable fingerprint of the same content. */
  readonly fingerprint: string;
  /** `promptId@version`, the stable reference used in results and audit. */
  readonly reference: string;
}

export interface RenderedPrompt {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly system: string;
  readonly user: string;
}

export interface PromptRegistry {
  register(definition: PromptDefinition): RegisteredPrompt;
  /** Latest version of a prompt. Throws PROMPT_NOT_FOUND when unknown. */
  require(promptId: string): RegisteredPrompt;
  /** A specific historical version, for replay. */
  requireVersion(promptId: string, version: number): RegisteredPrompt;
  render(promptId: string, variables: Readonly<Record<string, string>>): RenderedPrompt;
  list(): readonly RegisteredPrompt[];
  size(): number;
  clear(): void;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function createPromptRegistry(): PromptRegistry {
  /** promptId → version → prompt. Every version stays resolvable. */
  const versions = new Map<string, Map<number, RegisteredPrompt>>();
  const latest = new Map<string, RegisteredPrompt>();

  function assertDeclaredVariables(definition: PromptDefinition): void {
    const used = new Set<string>();
    for (const match of definition.template.matchAll(PLACEHOLDER)) used.add(match[1]);
    for (const match of definition.system.matchAll(PLACEHOLDER)) used.add(match[1]);

    const declared = new Set(definition.variables);
    const undeclared = [...used].filter((name) => !declared.has(name)).sort();
    const unused = [...declared].filter((name) => !used.has(name)).sort();

    const problems: string[] = [];
    if (undeclared.length > 0) problems.push(`undeclared placeholders: ${undeclared.join(', ')}`);
    if (unused.length > 0) problems.push(`declared but unused: ${unused.join(', ')}`);
    if (problems.length > 0) {
      throw new AIError('INTERNAL_ERROR', 'Prompt definition is inconsistent.', {
        diagnostics: `${definition.promptId}@${definition.version}: ${problems.join('; ')}`,
      });
    }
  }

  return {
    register(definition) {
      if (!definition.owner.trim()) {
        throw new AIError('INTERNAL_ERROR', 'Prompt definition is inconsistent.', {
          diagnostics: `${definition.promptId}: owner is required`,
        });
      }
      if (!Number.isInteger(definition.version) || definition.version < 1) {
        throw new AIError('INTERNAL_ERROR', 'Prompt definition is inconsistent.', {
          diagnostics: `${definition.promptId}: version must be a positive integer`,
        });
      }
      assertDeclaredVariables(definition);

      const byVersion = versions.get(definition.promptId) ?? new Map<number, RegisteredPrompt>();
      if (byVersion.has(definition.version)) {
        throw new AIError('INTERNAL_ERROR', 'Prompt version is already registered.', {
          diagnostics: `${definition.promptId}@${definition.version}`,
        });
      }

      // Hash system and template together with an unambiguous separator, so a
      // change that only moves text between the two still changes the hash.
      const content = `${definition.system}\n---\n${definition.template}`;
      const registered: RegisteredPrompt = {
        ...definition,
        hash: sha256Hex(content),
        fingerprint: promptFingerprint(content),
        reference: `${definition.promptId}@${definition.version}`,
      };

      byVersion.set(definition.version, registered);
      versions.set(definition.promptId, byVersion);

      const current = latest.get(definition.promptId);
      if (!current || current.version < registered.version) {
        latest.set(definition.promptId, registered);
      }
      return registered;
    },

    require(promptId) {
      const prompt = latest.get(promptId);
      if (!prompt) {
        throw new AIError('PROMPT_NOT_FOUND', 'The prompt for this AI feature is not available.', {
          diagnostics: `promptId=${promptId}`,
        });
      }
      return prompt;
    },

    requireVersion(promptId, version) {
      const prompt = versions.get(promptId)?.get(version);
      if (!prompt) {
        throw new AIError('PROMPT_NOT_FOUND', 'The requested prompt version is not available.', {
          diagnostics: `promptId=${promptId} version=${version}`,
        });
      }
      return prompt;
    },

    render(promptId, variables) {
      const prompt = this.require(promptId);
      const missing = prompt.variables.filter(
        (name) => variables[name] === undefined || variables[name] === null,
      );
      if (missing.length > 0) {
        throw new AIError('PROMPT_RENDER_FAILED', 'The AI request could not be prepared.', {
          diagnostics: `${prompt.reference} missing variables: ${missing.join(', ')}`,
        });
      }

      const substitute = (text: string): string =>
        text.replace(PLACEHOLDER, (_match, name: string) => variables[name] ?? '');

      return {
        promptId: prompt.promptId,
        promptVersion: String(prompt.version),
        promptHash: prompt.fingerprint,
        system: substitute(prompt.system),
        user: substitute(prompt.template),
      };
    },

    list() {
      return [...latest.values()].sort((a, b) => a.promptId.localeCompare(b.promptId));
    },

    size() {
      return latest.size;
    },

    clear() {
      versions.clear();
      latest.clear();
    },
  };
}
