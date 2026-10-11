// Structured JSON logs, one object per line, always on stderr: on stdio the
// MCP protocol owns stdout, so writing anything there would corrupt it.
//
// Privacy: tool calls are logged with the user's id (never the email), the
// tool name, the outcome and the duration. Arguments are not logged.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: Level = "info", sink: (line: string) => void = l => process.stderr.write(l + "\n")): Logger {
  const min = ORDER[level];
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f)
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
