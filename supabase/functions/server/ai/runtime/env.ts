/**
 * Environment access for the AI Control Plane.
 *
 * The control plane core never touches a runtime global. It reads configuration
 * through an injected `EnvSource`, which makes every module here runnable and
 * testable under plain Node while production wires in the Deno environment at
 * the edge (see ../bootstrap.ts).
 *
 * This is a deliberate improvement over the previous intelligence module, whose
 * `readEnv()` probed the `Deno` global from inside the request path and needed
 * a mutable module-level override to be testable at all.
 */

export interface EnvSource {
  get(key: string): string | undefined;
}

/** Env backed by a plain record. The only source the core ever sees in tests. */
export function recordEnv(values: Readonly<Record<string, string | undefined>>): EnvSource {
  return { get: (key) => values[key] };
}

/**
 * Env backed by whichever runtime global is present. Called once at bootstrap,
 * never from the request path.
 */
export function runtimeEnv(): EnvSource {
  const denoGlobal = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  if (denoGlobal?.env?.get) {
    const env = denoGlobal.env;
    return { get: (key) => env.get(key) };
  }
  const nodeGlobal = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (nodeGlobal?.env) {
    const env = nodeGlobal.env;
    return { get: (key) => env[key] };
  }
  return { get: () => undefined };
}

export function readString(env: EnvSource, key: string, fallback: string): string {
  const raw = env.get(key);
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

export function readOptionalString(env: EnvSource, key: string): string | undefined {
  const raw = env.get(key);
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/**
 * Bounded integer read. An unparseable or out-of-range value falls back to the
 * default rather than propagating a NaN timeout or a negative rate limit into
 * the request path.
 */
export function readInt(
  env: EnvSource,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = env.get(key);
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < bounds.min || parsed > bounds.max) return fallback;
  return parsed;
}

export function readBool(env: EnvSource, key: string, fallback: boolean): boolean {
  const raw = env.get(key);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

/** Comma-separated list read. Empty entries are dropped. */
export function readList(env: EnvSource, key: string, fallback: readonly string[]): readonly string[] {
  const raw = env.get(key);
  if (raw === undefined || raw.trim() === '') return fallback;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length > 0 ? items : fallback;
}
