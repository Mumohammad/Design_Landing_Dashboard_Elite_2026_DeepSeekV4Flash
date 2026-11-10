// Application-layer rate limiting for Phase 2 (audit fix H2).
//
// Enforces the v2.0 rate limits (auth plan section 5):
//   sign-in            10 / minute  per IP
//   forgot-password     3 / hour    per IP
//   2FA verify          5 / minute  per user
//   reports generate   10 / hour    per user
//   orders import      30 / hour    per user
//   + the domain-specific wrappers below
//
// Rate limiting is enforced at the Server Action / Route Handler entry point,
// NOT in middleware (auth plan 5.7).
//
// BACKEND LADDER (shared across all serverless instances — no in-memory Maps;
// per-instance state is useless on serverless and resets on cold start):
//   1. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set → Upstash Redis
//      fixed-window counter (INCR + PEXPIRE).
//   2. Otherwise → Postgres: the ATOMIC `check_rate_limit` RPC
//      (supabase/migrations/062_auth_rate_limits.sql) via the service-role
//      client. Check-and-increment is a single upsert statement — no
//      SELECT-then-INSERT race under concurrent bursts.
//
// FAIL-CLOSED CONTRACT (audit H2): if the limiter backend itself errors
// (missing 062 migration, Redis/Postgres outage), `rateLimit()` throws
// `RateLimitUnavailableError` → auth routes return 503. An endpoint that
// cannot be counted MUST NOT process the request.
//
// ⚠️  DEPLOYMENT ORDER: apply migration 062 to Supabase BEFORE this code
//     ships (Vercel previews share the project). Code-without-migration =
//     503 on every rate-limited endpoint — by design, not a bug.
//
// Reference: docs/phase-2-auth-plan.md section 5, docs/codebase-audit-2026-09-10.md (H2).

import { Redis } from "@upstash/redis"
import { ERROR_CODES } from "@/lib/errors/error-codes"
import { logger } from "@/lib/logger"

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

/**
 * 503 — the rate-limit backend itself failed (062 migration missing, Redis /
 * Postgres outage). Auth endpoints fail CLOSED: surface the bilingual
 * RATE_LIMIT_UNAVAILABLE envelope with HTTP 503, never proceed uncounted.
 */
export class RateLimitUnavailableError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly messageAr: string
  readonly messageEn: string

  constructor() {
    const def = ERROR_CODES.RATE_LIMIT_UNAVAILABLE
    super(def.messageEn)
    this.name = "RateLimitUnavailableError"
    this.code = def.code
    this.statusCode = def.httpStatus
    this.messageAr = def.messageAr
    this.messageEn = def.messageEn
  }
}

// ── Upstash backend (layer 1, optional) ────────────────────────────────────

const upstash = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
})()

let upstashFailureLogged = false

async function rateLimitUpstash(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redisKey = `elitedev:rl:${key}`
  try {
    // Fixed window: INCR + PTTL in one round trip; set TTL on the first hit.
    const pipeline = upstash!.pipeline()
    pipeline.incr(redisKey)
    pipeline.pttl(redisKey)
    const [count, pttl] = await pipeline.exec<[number, number]>()

    const firstHit = count === 1 || pttl < 0
    if (firstHit) await upstash!.pexpire(redisKey, windowSeconds * 1000)

    return {
      success: count <= limit,
      remaining: Math.max(limit - count, 0),
      resetAt: firstHit
        ? Date.now() + windowSeconds * 1000
        : Date.now() + Math.max(pttl, 0),
    }
  } catch (err) {
    if (!upstashFailureLogged) {
      upstashFailureLogged = true
      logger.warn(
        { err, component: "rate-limit" },
        "Upstash rate-limit backend failed — failing closed"
      )
    }
    throw new RateLimitUnavailableError()
  }
}

// ── Postgres backend (layer 2, default) ────────────────────────────────────

type CheckRateLimitRow = {
  allowed: boolean
  remaining: number
  reset_at: string
}

type AdminClient = { rpc: (...args: unknown[]) => Promise<unknown> }

let pgClient: AdminClient | null = null

async function getPostgresClient(): Promise<AdminClient> {
  if (pgClient) return pgClient
  try {
    // Service-role client (server-only): the RPC is granted to service_role.
    const { createAdminClient } = await import("@/lib/supabase/admin")
    pgClient = createAdminClient() as unknown as AdminClient
    return pgClient
  } catch (err) {
    logger.error(
      { err, component: "rate-limit" },
      "Cannot create Postgres rate-limit client (missing SUPABASE_SERVICE_ROLE_KEY?)"
    )
    throw new RateLimitUnavailableError()
  }
}

async function rateLimitPostgres(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const admin = await getPostgresClient()
  let raw: unknown
  try {
    // A REJECTED rpc call (network outage, pool exhaustion) must fail closed
    // exactly like an error response — never let the raw error escape and
    // never fail open.
    raw = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
  } catch (err) {
    logger.error(
      { err, component: "rate-limit" },
      "Postgres rate-limit backend rejected the call — failing closed"
    )
    throw new RateLimitUnavailableError()
  }
  const { data, error } = raw as {
    data: CheckRateLimitRow[] | CheckRateLimitRow | null
    error: { message: string } | null
  }

  if (error) {
    // Most common cause: migration 062 not applied to this Supabase project.
    logger.error(
      { err: error, component: "rate-limit" },
      "Postgres rate-limit backend failed — failing closed (is migration 062 applied?)"
    )
    throw new RateLimitUnavailableError()
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    logger.error(
      { component: "rate-limit" },
      "check_rate_limit returned no row — failing closed"
    )
    throw new RateLimitUnavailableError()
  }

  const resetAt = new Date(row.reset_at).getTime()
  return {
    success: Boolean(row.allowed),
    remaining: Number(row.remaining) || 0,
    resetAt: Number.isFinite(resetAt)
      ? resetAt
      : Date.now() + windowSeconds * 1000,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

function windowToSeconds(window: RateLimitWindow): number {
  switch (window) {
    case "minute":
      return 60
    case "hour":
      return 3600
    default: {
      const _exhaustive: never = window
      return _exhaustive
    }
  }
}

/**
 * Check the rate limit for an identifier against the shared backend.
 *
 * @param identifier  IP address (per-IP limits) or user id (per-user limits).
 * @param limit       max requests allowed in the window.
 * @param window      `"minute"` or `"hour"`.
 * @returns `{ success, remaining, resetAt }`. Callers should throw
 *          `RateLimitError` (or return the AUTH_RATE_LIMITED envelope) when
 *          `success` is false. Throws `RateLimitUnavailableError` (→ 503)
 *          when the backend itself fails — NEVER fall back to an uncounted
 *          request.
 */
export async function rateLimit(
  identifier: string,
  limit: number,
  window: RateLimitWindow
): Promise<RateLimitResult> {
  // Cap the key length; identifiers are IPs or user ids, but never trust
  // unbounded caller input near a primary-key column.
  const key = `${window}:${identifier.slice(0, 200)}`
  const windowSeconds = windowToSeconds(window)

  if (upstash) return rateLimitUpstash(key, limit, windowSeconds)
  return rateLimitPostgres(key, limit, windowSeconds)
}

// ── Convenience wrappers (v2.0 limits) ─────────────────────────────────────

/** Sign-in endpoint: 10 / minute, per IP. */
export function rateLimitSignIn(ip: string): Promise<RateLimitResult> {
  return rateLimit(`signin:${ip}`, 10, "minute")
}

/** Forgot-password endpoint: 3 / hour, per IP. */
export function rateLimitForgotPassword(ip: string): Promise<RateLimitResult> {
  return rateLimit(`forgot:${ip}`, 3, "hour")
}

/** Public company registration (FX-08): 10 / minute, per IP. */
export function rateLimitRegister(ip: string): Promise<RateLimitResult> {
  return rateLimit(`register:${ip}`, 10, "minute")
}

/** 2FA verify action: 5 / minute, per user id. */
export function rateLimit2FA(userId: string): Promise<RateLimitResult> {
  return rateLimit(`2fa:${userId}`, 5, "minute")
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
