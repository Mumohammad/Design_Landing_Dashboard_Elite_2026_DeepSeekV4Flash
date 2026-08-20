// Application-layer rate limiting for Phase 2.
//
// Enforces the v2.0 rate limits (auth plan section 5):
//   sign-in            10 / minute  per IP
//   forgot-password     3 / hour    per IP
//   2FA verify          5 / minute  per IP
//   reports generate   10 / hour    per user
//   orders import      30 / hour    per user
//
// Rate limiting is enforced at the Server Action / Route Handler entry point,
// NOT in middleware (auth plan 5.7).
//
// REQUIRES: pnpm add @upstash/redis @upstash/ratelimit
//   These are OPTIONAL — when UPSTASH_REDIS_REST_URL /
//   UPSTASH_REDIS_REST_TOKEN are absent, an in-memory Map limiter is used
//   (development only; not safe for multi-instance production).
//
// Reference: docs/phase-2-auth-plan.md section 5 (Rate limiting strategy).

import { ERROR_CODES } from "@/lib/errors/error-codes"

export type RateLimitWindow = "minute" | "hour"

export type RateLimitResult = {
  success: boolean
  remaining: number
  /** Unix epoch (ms) when the window resets. */
  resetAt: number
}

/**
 * Thrown by callers when `rateLimit(...)` returns `success: false`. Carries
 * the bilingual AUTH_RATE_LIMITED envelope (recognized by `handleError` via
 * structural typing) plus `resetAt` / `limit` for a `Retry-After` header.
 */
export class RateLimitError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly messageAr: string
  readonly messageEn: string
  readonly resetAt: number
  readonly limit: number

  constructor(resetAt: number, limit: number) {
    const def = ERROR_CODES.AUTH_RATE_LIMITED
    super(def.messageEn)
    this.name = "RateLimitError"
    this.code = def.code
    this.statusCode = def.httpStatus
    this.messageAr = def.messageAr
    this.messageEn = def.messageEn
    this.resetAt = resetAt
    this.limit = limit
  }
}

// ── Upstash (optional) ─────────────────────────────────────────────────────

// Minimal local type for the @upstash/ratelimit instance. Avoids a hard
// top-level import (the package may not be installed in dev).
type UpstashLimiter = {
  limit: (
    identifier: string
  ) => Promise<{ success: boolean; remaining: number; reset: number }>
}

type UpstashRatelimitModule = {
  Ratelimit: new (config: {
    redis: unknown
    limiter: unknown
    prefix: string
    analytics: boolean
  }) => UpstashLimiter
  slidingWindow: (
    limit: number,
    window: string
  ) => { limit: number; window: string }
}

type UpstashRedisModule = {
  Redis: new (config: { url: string; token: string }) => unknown
}

const upstashLimiters = new Map<string, UpstashLimiter>()
let upstashAvailable: boolean | null = null

/**
 * Dynamic import with a non-literal specifier so TypeScript does not try to
 * resolve the (optional) module at compile time. The package must be installed
 * at runtime for the Upstash path to work.
 */
async function importOptional(name: string): Promise<Record<string, unknown>> {
  const specifier = name as string
  return (await import(specifier)) as Record<string, unknown>
}

async function getUpstashLimiter(
  limit: number,
  windowDuration: string
): Promise<UpstashLimiter | null> {
  if (upstashAvailable === false) return null

  const cacheKey = `${limit}:${windowDuration}`
  const cached = upstashLimiters.get(cacheKey)
  if (cached) return cached

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    upstashAvailable = false
    return null
  }

  try {
    const ratelimitMod = (await importOptional("@upstash/ratelimit")) as unknown as UpstashRatelimitModule
    const redisMod = (await importOptional("@upstash/redis")) as unknown as UpstashRedisModule

    const limiter = new ratelimitMod.Ratelimit({
      redis: new redisMod.Redis({ url, token }),
      limiter: ratelimitMod.slidingWindow(limit, windowDuration),
      prefix: "elitedev",
      analytics: true,
    })
    upstashLimiters.set(cacheKey, limiter)
    upstashAvailable = true
    return limiter
  } catch (err) {
    upstashAvailable = false
    warnInMemoryFallbackOnce(err)
    return null
  }
}

// ── In-memory fallback (dev only) ───────────────────────────────────────────

type MemoryEntry = { count: number; resetAt: number }
const memoryBuckets = new Map<string, MemoryEntry>()
let memoryFallbackWarned = false

function warnInMemoryFallbackOnce(err: unknown): void {
  if (memoryFallbackWarned) return
  memoryFallbackWarned = true
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      "[rate-limit] Upstash Redis is not configured or failed to initialize. " +
        "Falling back to in-memory rate limiting (development only — not safe " +
        "for multi-instance production).",
      err
    )
  }
}

function windowToMs(window: RateLimitWindow): number {
  switch (window) {
    case "minute":
      return 60 * 1000
    case "hour":
      return 60 * 60 * 1000
    default: {
      const _exhaustive: never = window
      return _exhaustive
    }
  }
}

function rateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  if (!memoryFallbackWarned) {
    warnInMemoryFallbackOnce(undefined)
  }

  const now = Date.now()
  const entry = memoryBuckets.get(key)
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowMs
    memoryBuckets.set(key, { count: 1, resetAt })
    return { success: true, remaining: limit - 1, resetAt }
  }
  entry.count += 1
  if (entry.count > limit) {
    return { success: false, remaining: 0, resetAt: entry.resetAt }
  }
  return { success: true, remaining: limit - entry.count, resetAt: entry.resetAt }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check the rate limit for an identifier.
 *
 * @param identifier  IP address (per-IP limits) or user id (per-user limits).
 * @param limit       max requests allowed in the window.
 * @param window      `"minute"` or `"hour"`.
 * @returns `{ success, remaining, resetAt }`. Callers should throw
 *          `RateLimitError` (or `AppError("AUTH_RATE_LIMITED")`) when
 *          `success` is false.
 */
export async function rateLimit(
  identifier: string,
  limit: number,
  window: RateLimitWindow
): Promise<RateLimitResult> {
  const windowDuration = window === "minute" ? "1 m" : "1 h"
  const key = `${windowDuration}:${identifier}`

  const limiter = await getUpstashLimiter(limit, windowDuration)
  if (limiter) {
    const result = await limiter.limit(key)
    return {
      success: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    }
  }

  return rateLimitInMemory(key, limit, windowToMs(window))
}

// ── Convenience wrappers (v2.0 limits) ─────────────────────────────────────

/** Sign-in Server Action: 10 / minute, per IP. */
export function rateLimitSignIn(ip: string): Promise<RateLimitResult> {
  return rateLimit(`signin:${ip}`, 10, "minute")
}

/** Forgot-password Server Action: 3 / hour, per IP. */
export function rateLimitForgotPassword(ip: string): Promise<RateLimitResult> {
  return rateLimit(`forgot:${ip}`, 3, "hour")
}

/** 2FA verify Server Action: 5 / minute, per IP. */
export function rateLimit2FA(ip: string): Promise<RateLimitResult> {
  return rateLimit(`2fa:${ip}`, 5, "minute")
}

/** Reports generate (Server Action / Route Handler): 10 / hour, per user. */
export function rateLimitReports(userId: string): Promise<RateLimitResult> {
  return rateLimit(`reports:${userId}`, 10, "hour")
}

/** Orders import (Server Action): 30 / hour, per user. */
export function rateLimitImports(userId: string): Promise<RateLimitResult> {
  return rateLimit(`imports:${userId}`, 30, "hour")
}

// ── Shared utilities ────────────────────────────────────────────────────────

/** Best-effort client IP from request headers (for per-IP rate limits). */
export async function getClientIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers")
    const h = await headers()
    const fwd = h.get("x-forwarded-for")
    if (fwd) return fwd.split(",")[0].trim()
    return h.get("x-real-ip") ?? "unknown"
  } catch {
    return "unknown"
  }
}

// ── Domain-specific rate limit helpers ──────────────────────────────────────
//
// Limits are deliberately conservative. Adjust in one place if workload
// changes. All per-user limits use the authenticated user's id.

/** Accounting mutations (journal entries, period close, receivables): 60 / minute, per user. */
export function rateLimitAccounting(userId: string): Promise<RateLimitResult> {
  return rateLimit(`accounting:${userId}`, 60, "minute")
}

/** Accounting CSV imports (bulk data): 5 / hour, per user. */
export function rateLimitAccountingImport(userId: string): Promise<RateLimitResult> {
  return rateLimit(`accounting-import:${userId}`, 5, "hour")
}

/** Dashboard snapshot: 30 / minute, per user. */
export function rateLimitDashboard(userId: string): Promise<RateLimitResult> {
  return rateLimit(`dashboard:${userId}`, 30, "minute")
}

/** Application reviews: 30 / minute, per user. */
export function rateLimitApplications(userId: string): Promise<RateLimitResult> {
  return rateLimit(`applications:${userId}`, 30, "minute")
}

/** Driver create/update: 20 / minute, per user. */
export function rateLimitDrivers(userId: string): Promise<RateLimitResult> {
  return rateLimit(`drivers:${userId}`, 20, "minute")
}

/** Expense create/approve: 30 / minute, per user. */
export function rateLimitExpenses(userId: string): Promise<RateLimitResult> {
  return rateLimit(`expenses:${userId}`, 30, "minute")
}

/** Order entry create/delete: 30 / minute, per user. */
export function rateLimitOrders(userId: string): Promise<RateLimitResult> {
  return rateLimit(`orders:${userId}`, 30, "minute")
}

/** Payroll operations (calculate, cancel, export WPS): 10 / minute, per user. */
export function rateLimitPayroll(userId: string): Promise<RateLimitResult> {
  return rateLimit(`payroll:${userId}`, 10, "minute")
}

/** Settings updates: 10 / minute, per user. */
export function rateLimitSettings(userId: string): Promise<RateLimitResult> {
  return rateLimit(`settings:${userId}`, 10, "minute")
}

/** Vehicle create/update: 20 / minute, per user. */
export function rateLimitVehicles(userId: string): Promise<RateLimitResult> {
  return rateLimit(`vehicles:${userId}`, 20, "minute")
}

