// Application error type and global error handler.
//
// `AppError` is the single error type thrown by Server Actions and Route
// Handlers. Every `AppError` carries a bilingual envelope
// `{ code, message_ar, message_en }` plus an HTTP `statusCode`.
//
// The error code constants live in `./error-codes` (single source of truth).
//
// Reference: docs/phase-2-auth-plan.md section 8 (Error code taxonomy mapping).

import {
  ERROR_CODES,
  getErrorDefinition,
  type ErrorCode,
} from "./error-codes"

export { ERROR_CODES, getErrorDefinition } from "./error-codes"
export type { ErrorCode, ErrorDefinition } from "./error-codes"

/**
 * The single error type thrown by Server Actions and Route Handlers.
 *
 * Construct it from a known code:
 *   `throw new AppError("AUTH004")`
 * or with an explicit override (e.g. an interpolated message):
 *   `throw new AppError("AUTH004", { messageAr, messageEn })`
 *
 * The HTTP status and default messages come from `ERROR_CODES`.
 */
export class AppError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly messageAr: string
  readonly messageEn: string

  constructor(
    code: ErrorCode,
    overrides?: {
      statusCode?: number
      messageAr?: string
      messageEn?: string
    }
  ) {
    const def = getErrorDefinition(code)
    super(overrides?.messageEn ?? def.messageEn)
    this.name = "AppError"
    this.code = code
    this.statusCode = overrides?.statusCode ?? def.httpStatus
    this.messageAr = overrides?.messageAr ?? def.messageAr
    this.messageEn = overrides?.messageEn ?? def.messageEn
  }

  /** Serialize to the bilingual envelope returned to the client. */
  toJSON(): { code: string; message_ar: string; message_en: string } {
    return {
      code: this.code,
      message_ar: this.messageAr,
      message_en: this.messageEn,
    }
  }
}

/**
 * The response shape returned by `errorToResponse` / `handleError`.
 * `statusCode` is included so Route Handlers can set the HTTP status.
 */
export type ErrorResponse = {
  code: string
  message_ar: string
  message_en: string
  statusCode: number
}

/**
 * Convert an `AppError` to the bilingual response envelope (plus the HTTP
 * status so the Route Handler can set it).
 */
export function errorToResponse(error: AppError): ErrorResponse {
  return {
    code: error.code,
    message_ar: error.messageAr,
    message_en: error.messageEn,
    statusCode: error.statusCode,
  }
}

/**
 * Structural check for any error that carries the AppError envelope
 * (`code`, `statusCode`, `messageAr`, `messageEn`). This lets `handleError`
 * recognize `AuthorizationError` and `RateLimitError` (which intentionally
 * extend `Error` rather than `AppError`) without importing their classes.
 */
type ErrorLike = {
  code: string
  statusCode: number
  messageAr: string
  messageEn: string
}

function isErrorLike(value: unknown): value is ErrorLike {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.code === "string" &&
    typeof v.statusCode === "number" &&
    typeof v.messageAr === "string" &&
    typeof v.messageEn === "string"
  )
}

/**
 * Convert ANY thrown value to the bilingual error envelope.
 *
 * - `AppError` → use directly.
 * - Any object shaped like `{ code, statusCode, messageAr, messageEn }`
 *   (e.g. `AuthorizationError`, `RateLimitError`) → convert to the envelope.
 * - Anything else → `ERR_INTERNAL` (500). The original message is NOT exposed
 *   to the client; it is logged for Sentry.
 */
export function handleError(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return errorToResponse(error)
  }

  if (isErrorLike(error)) {
    return {
      code: error.code,
      message_ar: error.messageAr,
      message_en: error.messageEn,
      statusCode: error.statusCode,
    }
  }

  // Unknown error — log the original (server-side only) and return the generic
  // envelope. The client never sees the raw message.
  // TODO: forward `error` to Sentry when SENTRY_DSN is configured.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error("[handleError] unhandled error:", error)
  }
  const internal = ERROR_CODES.ERR_INTERNAL
  return {
    code: internal.code,
    message_ar: internal.messageAr,
    message_en: internal.messageEn,
    statusCode: internal.httpStatus,
  }
}
