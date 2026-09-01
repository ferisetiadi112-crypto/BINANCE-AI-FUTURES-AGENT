/**
 * Structured logger — BINANCE AI FUTURES AGENT v0.1
 *
 * Levels: DEBUG, INFO, WARN, ERROR
 * Each log entry includes: timestamp, level, component, message
 *
 * Future: integrate with observability platform (OpenTelemetry, etc.)
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MIN_LEVEL: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'INFO';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, component: string, message: string): string {
  return `[${formatTimestamp()}] [${level}] [${component}] ${message}`;
}

export const logger = {
  debug(component: string, message: string): void {
    if (shouldLog("DEBUG")) {
      console.debug(formatMessage("DEBUG", component, message));
    }
  },

  info(component: string, message: string): void {
    if (shouldLog("INFO")) {
      console.log(formatMessage("INFO", component, message));
    }
  },

  warn(component: string, message: string): void {
    if (shouldLog("WARN")) {
      console.warn(formatMessage("WARN", component, message));
    }
  },

  error(component: string, message: string, error?: unknown): void {
    if (shouldLog("ERROR")) {
      const suffix = error instanceof Error ? ` — ${error.message}` : "";
      console.error(formatMessage("ERROR", component, message + suffix));
    }
  },
};
