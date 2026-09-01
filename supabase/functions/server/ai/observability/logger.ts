/**
 * Structured logging for the AI Control Plane.
 *
 * One JSON object per line, with the trace identity on every record. That is
 * what makes a production incident answerable: given a correlation id from a
 * support ticket, every log line for that user action is retrievable with a
 * single query, across features and retries.
 *
 * The logger will not emit prompt content or model output. Those belong in the
 * audit store, which is access-controlled and retention-bounded; a log stream is
 * neither. `sanitize` enforces this at the boundary rather than trusting each
 * call site to remember.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that stamps `fields` onto every record it emits. */
  child(fields: LogFields): Logger;
}

export interface LogSink {
  write(level: LogLevel, line: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names whose values are never logged, regardless of caller. */
const FORBIDDEN_FIELDS = new Set([
  'prompt',
  'system',
  'user',
  'content',
  'completion',
  'output',
  'messages',
  'apiKey',
  'authorization',
  'token',
  // AI-01 Batch 4D. Customer BYOK adds a second population of callers who hold
  // vendor key material — the customer credential service and the tenant-aware
  // resolver — so the names a key could arrive under are withheld here as well.
  //
  // NOTHING CURRENTLY LOGS ANY OF THESE, and that is the point: the service
  // logs a keyed FINGERPRINT and never a value, and its suite asserts the
  // plaintext appears in no log line. This is belt to those braces, so the
  // failure mode of a future caller writing `logger.info('...', { secret })` is
  // a withheld field rather than a credential in a log aggregator.
  'secret',
  'credential',
  'credentialValue',
  'plaintext',
  'password',
]);

const MAX_FIELD_CHARS = 512;

function sanitize(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (FORBIDDEN_FIELDS.has(key)) {
      out[key] = '[withheld]';
      continue;
    }
    out[key] = typeof value === 'string' && value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…`
      : value;
  }
  return out;
}

export const consoleSink: LogSink = {
  write(level, line) {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
};

/** Collects lines in memory. Used by the test suite to assert on log output. */
export function createMemorySink(): LogSink & { lines: { level: LogLevel; line: string }[] } {
  const lines: { level: LogLevel; line: string }[] = [];
  return {
    lines,
    write(level, line) {
      lines.push({ level, line });
    },
  };
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly structured: boolean;
  readonly sink?: LogSink;
  readonly base?: LogFields;
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? consoleSink;
  const threshold = LEVEL_ORDER[options.level];
  const base = options.base ?? {};

  function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const record = { level, msg: message, ...sanitize({ ...base, ...fields }) };
    if (options.structured) {
      sink.write(level, JSON.stringify(record));
      return;
    }
    const suffix = Object.entries(record)
      .filter(([key]) => key !== 'level' && key !== 'msg')
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    sink.write(level, `[ai:${level}] ${message}${suffix ? ` ${suffix}` : ''}`);
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, sink, base: { ...base, ...fields } }),
  };
}
