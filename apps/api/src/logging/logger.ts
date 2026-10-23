/**
 * 작은 구조화 로거.
 *
 * 운영에서는 한 줄에 JSON 하나(level, time, msg, context)를 찍는다 — docker 로그를 grep 하거나
 * 수집기로 넘길 때 "어느 방의 어떤 라운드였나"를 문장에서 다시 긁어낼 필요가 없게. 개발에서는
 * 사람이 읽기 쉬운 한 줄로 찍는다. 외부 라이브러리를 들이지 않은 이유: 필요한 건 레벨과 문맥
 * 필드뿐이고, 로그 경로에서 예외가 나 서버를 흔드는 일은 없어야 하므로 코드가 작을수록 좋다.
 *
 * 형식은 LOG_FORMAT=json|pretty 로 강제할 수 있다. 기본값은 NODE_ENV=production 이면 json.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

export interface LogRecord {
  level: LogLevel;
  time: string;
  msg: string;
  context?: LogContext;
}

export interface LoggerOptions {
  format?: "json" | "pretty";
  minLevel?: LogLevel;
  /** 테스트에서 출력을 가로채려고 둔다. 기본은 stdout/stderr. */
  write?: (line: string, level: LogLevel) => void;
}

/** Error 는 JSON.stringify 하면 {} 가 된다. 스택까지 남겨야 원인을 찾을 수 있다. */
function serializeError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack };
  const code = (error as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  const detail = (error as { detail?: unknown }).detail;
  if (detail !== undefined) out.detail = detail;
  if (error.cause !== undefined) out.cause = error.cause instanceof Error ? serializeError(error.cause) : error.cause;
  return out;
}

function normalize(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  return value;
}

function normalizeContext(context: LogContext | undefined): LogContext | undefined {
  if (!context) return undefined;
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) out[key] = normalize(value);
  return out;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  });
}

function defaultWrite(line: string, level: LogLevel): void {
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function prettyLine(record: LogRecord): string {
  const time = record.time.slice(11, 23);
  const tag = record.level.toUpperCase().padEnd(5);
  if (!record.context) return `${time} ${tag} ${record.msg}`;
  const { err, error, ...rest } = record.context;
  const extras = Object.keys(rest).length ? ` ${safeStringify(rest)}` : "";
  const failure = (err ?? error) as { stack?: string; message?: string } | undefined;
  const stack = failure ? `\n${failure.stack ?? failure.message ?? safeStringify(failure)}` : "";
  return `${time} ${tag} ${record.msg}${extras}${stack}`;
}

export class Logger {
  constructor(
    private readonly options: Required<Pick<LoggerOptions, "format" | "minLevel">> & Pick<LoggerOptions, "write">,
    private readonly bound: LogContext = {},
  ) {}

  /** 같은 문맥(방 코드 등)을 매번 넘기지 않도록 묶어 둔 자식 로거. */
  child(context: LogContext): Logger {
    return new Logger(this.options, { ...this.bound, ...context });
  }

  debug(msg: string, context?: LogContext): void { this.log("debug", msg, context); }
  info(msg: string, context?: LogContext): void { this.log("info", msg, context); }
  warn(msg: string, context?: LogContext): void { this.log("warn", msg, context); }
  error(msg: string, context?: LogContext): void { this.log("error", msg, context); }
  fatal(msg: string, context?: LogContext): void { this.log("fatal", msg, context); }

  log(level: LogLevel, msg: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.options.minLevel]) return;
    const merged = normalizeContext(Object.keys(this.bound).length || context ? { ...this.bound, ...context } : undefined);
    const record: LogRecord = { level, time: new Date().toISOString(), msg, ...(merged && Object.keys(merged).length ? { context: merged } : {}) };
    // 로그를 쓰다가 난 예외가 호출한 쪽(정산 경로일 수도 있다)으로 번지면 안 된다.
    try {
      const line = this.options.format === "json" ? safeStringify(record) : prettyLine(record);
      (this.options.write ?? defaultWrite)(line, level);
    } catch {
      // 마지막 수단: 로그 한 줄을 잃는 편이 요청 하나를 잃는 것보다 낫다.
    }
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const envFormat = process.env.LOG_FORMAT;
  const format = options.format ?? (envFormat === "json" || envFormat === "pretty" ? envFormat : process.env.NODE_ENV === "production" ? "json" : "pretty");
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  const minLevel = options.minLevel ?? (envLevel && envLevel in LEVEL_ORDER ? envLevel : "info");
  return new Logger({ format, minLevel, write: options.write });
}

/** 프로세스 전체가 같이 쓰는 로거. */
export const logger = createLogger();
