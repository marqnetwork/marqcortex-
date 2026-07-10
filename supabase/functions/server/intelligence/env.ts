/**
 * Environment reader — Deno Edge runtime with Node test override.
 */

export type EnvReader = (key: string) => string | undefined;

let overrideReader: EnvReader | null = null;

export function setEnvReaderForTests(reader: EnvReader | null): void {
  overrideReader = reader;
}

export function readEnv(key: string): string | undefined {
  if (overrideReader) return overrideReader(key);
  try {
    // Deno Edge Functions
    // @ts-ignore runtime global
    if (typeof Deno !== 'undefined' && Deno.env?.get) {
      // @ts-ignore
      return Deno.env.get(key);
    }
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
}

export function readEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = readEnv(key);
  if (raw === undefined) return defaultValue;
  return raw !== 'false' && raw !== '0';
}
