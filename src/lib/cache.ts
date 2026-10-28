// Application-layer caching for hot, read-mostly paths.
//
// * Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set; otherwise a
//   bounded in-memory store (development / single instance only).
// * Fail-open: a Redis outage never breaks a request — reads fall back to
//   the fetcher and writes are skipped.
// * Single-flight: concurrent misses for the same key share one fetch.
// * Invalidation uses SCAN (never KEYS) so it is safe on large keyspaces.
//
// Keys MUST be scoped by tenant (and by user when the fetcher reads through
// the caller's RLS client) — use cacheKey() to build them.
//
//   const data = await cacheGet(cacheKey("dashboard", tenantId, userId, filters), fetcher, CACHE_TTL.dashboard)
//   await cacheInvalidate(`dashboard:${tenantId}:*`)

import { createHash } from "node:crypto"
import { logger } from "@/lib/logger"

type CacheEntry<T> = { value: T; expiresAt: number }

type UpstashRedisInstance = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<unknown>
  del: (...keys: string[]) => Promise<number>
  scan: (cursor: string | number, opts?: { match?: string; count?: number }) => Promise<[string | number, string[]]>
}

// ── Upstash (optional) ──────────────────────────────────────────────────────

let upstashClient: UpstashRedisInstance | null = null
let upstashAvailable: boolean | null = null

async function getUpstashClient(): Promise<UpstashRedisInstance | null> {
  if (upstashAvailable === false) return null
  if (upstashClient) return upstashClient

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    upstashAvailable = false
    warnMemoryFallback()
    return null
  }

  try {
    const mod = (await import("@upstash/redis")) as unknown as Record<string, unknown>
    const RedisConstructor = mod.Redis as new (config: { url: string; token: string; automaticDeserialization?: boolean }) => UpstashRedisInstance
    upstashClient = new RedisConstructor({ url, token, automaticDeserialization: false })
    upstashAvailable = true
    return upstashClient
  } catch (err) {
    upstashAvailable = false
    warnMemoryFallback(err)
    return null
  }
}

let redisErrorLoggedAt = 0
function redisFailed(err: unknown, op: string): void {
  // Rate-limit the log line; an outage would otherwise log on every request.
  if (Date.now() - redisErrorLoggedAt > 60_000) {
    redisErrorLoggedAt = Date.now()
    logger.warn({ err, component: "cache", op }, "Redis cache unavailable — serving uncached")
  }
}

// ── In-memory fallback ──────────────────────────────────────────────────────

const MEMORY_MAX_ENTRIES = 500
const memoryStore = new Map<string, CacheEntry<unknown>>()
let memoryWarned = false

function warnMemoryFallback(err?: unknown): void {
  if (memoryWarned || process.env.NODE_ENV === "test") return
  memoryWarned = true
  logger.warn({ err, component: "cache" }, "Upstash Redis not configured — using in-memory cache (single instance only)")
}

function memoryGet<T>(key: string): T | undefined {
  const entry = memoryStore.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return undefined
  }
  return entry.value as T
}

function memorySet<T>(key: string, value: T, ttlSeconds: number): void {
  memoryStore.delete(key)
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  // Map preserves insertion order: evict the oldest entries first.
  while (memoryStore.size > MEMORY_MAX_ENTRIES) {
    const oldest = memoryStore.keys().next().value
    if (oldest === undefined) break
    memoryStore.delete(oldest)
  }
}

/** Glob with `*` wildcards only (the subset Redis MATCH and we both support). */
function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
}

function memoryDelete(pattern: string): number {
  if (!pattern.includes("*")) return memoryStore.delete(pattern) ? 1 : 0
  const re = globToRegExp(pattern)
  let count = 0
  for (const key of [...memoryStore.keys()]) {
    if (re.test(key)) {
      memoryStore.delete(key)
      count++
    }
  }
  return count
}

// ── Default TTLs (seconds) ──────────────────────────────────────────────────

export const CACHE_TTL = {
  /** Dashboard snapshot — refresh every 60s */
  dashboard: 60,
  /** Financial KPIs — refresh every 60s */
  financialKpis: 60,
  /** Chart of Accounts — refresh every 5 min */
  chartOfAccounts: 300,
  /** Drivers list — refresh every 2 min */
  drivers: 120,
  /** Vehicles list — refresh every 2 min */
  vehicles: 120,
  /** Roles/Permissions — refresh every 10 min */
  roles: 600,
  /** System settings — refresh every 5 min */
  settings: 300,
  /** Delivery platforms — refresh every 10 min */
  platforms: 600,
  /** Lookup data (leave types, violation types) — refresh every 10 min */
  lookups: 600,
  /** Default for unspecified */
  default: 120,
} as const

// ── Keys ────────────────────────────────────────────────────────────────────

const KEY_PREFIX = "ed:"
const prefixedKey = (key: string) => `${KEY_PREFIX}${key}`

/**
 * Builds `scope:tenant[:user]:<digest>` — stable for equal inputs, never
 * leaks raw filter values into Redis key names.
 */
export function cacheKey(scope: string, tenantId: string, userId: string | null, params?: unknown): string {
  if (!/^[a-z][a-z0-9-]*$/.test(scope)) throw new Error("Invalid cache scope")
  if (!/^[0-9a-f-]{8,64}$/i.test(tenantId) || (userId !== null && !/^[0-9a-f-]{8,64}$/i.test(userId))) {
    throw new Error("Invalid cache owner")
  }
  const digest = createHash("sha256").update(stableJson(params ?? null)).digest("base64url").slice(0, 22)
  return [scope, tenantId, userId ?? "_", digest].join(":")
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`
}

// ── Public API ──────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>()

/**
 * Read-through cache. On a miss (or any cache failure) the fetcher runs and
 * its result is stored for `ttlSeconds`. `undefined` results are not cached.
 */
export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.default
): Promise<T> {
  const redis = await getUpstashClient()

  if (redis) {
    try {
      const raw = await redis.get(prefixedKey(key))
      if (typeof raw === "string") return JSON.parse(raw) as T
    } catch (err) {
      redisFailed(err, "get")
    }
  } else {
    const cached = memoryGet<T>(key)
    if (cached !== undefined) return cached
  }

  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending

  const run = (async () => {
    const value = await fetcher()
    if (value !== undefined) await cacheSet(key, value, ttlSeconds)
    return value
  })()
  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}

/** Store a value directly. Failures are logged and ignored. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL.default): Promise<void> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))
  const redis = await getUpstashClient()
  if (redis) {
    try {
      await redis.set(prefixedKey(key), JSON.stringify(value), { ex: ttl })
    } catch (err) {
      redisFailed(err, "set")
    }
    return
  }
  memorySet(key, value, ttl)
}

/**
 * Invalidate one key, or every key matching a `*` glob
 * (e.g. "dashboard:<tenant>:*"). Returns the number of keys removed.
 */
export async function cacheInvalidate(pattern: string): Promise<number> {
  const redis = await getUpstashClient()
  if (!redis) return memoryDelete(pattern)

  try {
    if (!pattern.includes("*")) return await redis.del(prefixedKey(pattern))
    let cursor: string | number = 0
    let removed = 0
    let rounds = 0
    do {
      const [next, keys]: [string | number, string[]] = await redis.scan(cursor, { match: prefixedKey(pattern), count: 200 })
      if (keys.length) removed += await redis.del(...keys)
      cursor = next
    } while (String(cursor) !== "0" && ++rounds < 100)
    return removed
  } catch (err) {
    redisFailed(err, "invalidate")
    return 0
  }
}

/** Invalidate every cached entry for a tenant (all scopes). */
export async function cacheInvalidateTenant(tenantId: string): Promise<void> {
  if (!/^[0-9a-f-]{8,64}$/i.test(tenantId)) return
  await cacheInvalidate(`*:${tenantId}:*`)
}

/** Cache stats for monitoring/debugging. */
export async function cacheStats(): Promise<{ provider: "redis" | "memory"; memoryEntries?: number }> {
  const redis = await getUpstashClient()
  return redis ? { provider: "redis" } : { provider: "memory", memoryEntries: memoryStore.size }
}

/** Test seam: reset module state. */
export function __resetCacheForTests(): void {
  upstashClient = null
  upstashAvailable = null
  memoryStore.clear()
  inflight.clear()
}
