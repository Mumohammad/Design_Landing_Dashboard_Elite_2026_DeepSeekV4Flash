// Centralized structured logging for the EliteDev platform.
//
// Uses pino for high-performance JSON logging. In development, pino-pretty
// formats output for readability. In production, logs are JSON for log
// aggregation (Sentry, Datadog, CloudWatch, etc.).
//
// Every server action and API handler should use a child logger with the
// module name and request context. Example:
//
//   import { logger } from "@/lib/logger"
//   const log = logger.child({ module: "accounting" })
//   log.info({ action: "createJournalDraft", userId }, "Journal entry created")

import pino from "pino"

const isDev = process.env.NODE_ENV !== "production"

/**
 * Base logger. Prefer `logger.child({ module })` for module-scoped logging.
 *
 * In development, uses pino-pretty for human-readable output.
 * In production, outputs JSON for structured log aggregation.
 */
export const logger = pino({
  // NB: `||` not `??` — .env.example ships `LOG_LEVEL=` (empty). After copying
  // it to .env.local, Next.js exposes the var as an EMPTY STRING, which `??`
  // passes straight through; pino then receives level: "" and throws at
  // module evaluation ("default level: must be included in custom levels"),
  // crashing every server action importing this chain. `||` treats "" as
  // unset and falls back correctly.
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
  base: {
    service: "elitedev",
    version: process.env.npm_package_version ?? "unknown",
  },
  redact: {
    // Redact sensitive fields from all log output.
    paths: [
      "password",
      "token",
      "secret",
      "access_token",
      "refresh_token",
      "service_role_key",
      "authorization",
      "cookie",
    ],
    censor: "[REDACTED]",
  },
})

// ── Module-scoped child loggers ──────────────────────────────────────────────

/**
 * Create a child logger bound to a specific module and optional request context.
 *
 * @param module  Module name (e.g. "auth", "accounting", "payroll")
 * @param context  Optional request context (userId, tenantId, requestId, ip)
 */
export function moduleLogger(
  module: string,
  context?: {
    userId?: string
    tenantId?: string
    requestId?: string
    ip?: string
  }
): pino.Logger {
  return logger.child({ module, ...context })
}

// ── Request-scoped logging ───────────────────────────────────────────────────

/**
 * Create a request-scoped logger with a correlation ID. Use in middleware
 * and server actions to tie all log entries to a single request.
 *
 * @param requestId  Unique request identifier (e.g. from crypto.randomUUID())
 * @param meta       Additional context (userId, tenantId, route, method)
 */
export function requestLogger(
  requestId: string,
  meta?: {
    userId?: string
    tenantId?: string
    route?: string
    method?: string
    ip?: string
  }
): pino.Logger {
  return logger.child({ requestId, ...meta })
}

// ── Security event logging ───────────────────────────────────────────────────

/**
 * Log security-relevant events. These are always emitted at "warn" level
 * regardless of the configured log level, so they are never silenced.
 *
 * Events: LOGIN, LOGIN_FAILED, LOGOUT, PASSWORD_RESET, ROLE_CHANGED,
 *         MFA_EVENT, UNAUTHORIZED_ACCESS, RATE_LIMIT_EXCEEDED
 */
export function logSecurityEvent(event: {
  type:
    | "LOGIN"
    | "LOGIN_FAILED"
    | "LOGOUT"
    | "PASSWORD_RESET"
    | "ROLE_CHANGED"
    | "MFA_EVENT"
    | "UNAUTHORIZED_ACCESS"
    | "RATE_LIMIT_EXCEEDED"
  userId?: string
  tenantId?: string
  ip?: string
  userAgent?: string
  requestId?: string
  details?: Record<string, unknown>
}): void {
  logger.warn(
    {
      security: true,
      eventType: event.type,
      userId: event.userId,
      tenantId: event.tenantId,
      ip: event.ip,
      userAgent: event.userAgent,
      requestId: event.requestId,
      ...event.details,
    },
    `[SECURITY] ${event.type}`
  )
}

// ── Performance logging ──────────────────────────────────────────────────────

/**
 * Log slow operations. Operations exceeding the threshold are logged at
 * "warn" level; others at "debug".
 */
export function logPerformance(operation: string, durationMs: number, meta?: Record<string, unknown>): void {
  // Same empty-string trap as LOG_LEVEL above: Number("") === 0 would make
  // EVERY operation "slow". `||` treats an empty value as unset.
  const threshold = Number(process.env.PERF_LOG_THRESHOLD_MS || 1000)
  if (durationMs > threshold) {
    logger.warn({ operation, durationMs, ...meta }, `[SLOW] ${operation} took ${durationMs}ms`)
  } else {
    logger.debug({ operation, durationMs, ...meta }, `[PERF] ${operation} completed in ${durationMs}ms`)
  }
}
