// Application-layer caching for hot paths.
//
// Uses Upstash Redis when configured (UPSTASH_REDIS_REST_URL/TOKEN),
// falls back to an in-memory Map for development.
//
// REQUIRES: pnpm add @upstash/redis
//   This is OPTIONAL — when env vars are absent, an in-memory cache is used.
//
// Usage:
//   import { cacheGet, cacheSet, cacheInvalidate } from "@/lib/cache"
//
//   // Read with cache
//   const data = await cacheGet<TenantKPIs>(`dashboard:${tenantId}:kpis`, () =>
//     fetchDashboardKPIs(tenantId)
//   )
//
//   // Invalidate on mutation
//   await cacheInvalidate(`dashboard:${tenantId}:*`)
//
//   // Direct set
//   await cacheSet(`coa:${tenantId}`, accounts, 300) // 5 min TTL

import { logger } from "@/lib/logger"

// ── Types ────────────────────────────────────────────────────────────────────

type CacheEntry<T> = { value: T; expiresAt: number }

type UpstashRedisInstance = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, opts?: { ex?: number }) => Promise<"OK">
  del: (...keys: string[]) => Promise<number>
  keys: (pattern: string) => Promise<string[]>
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
    return null
  }

  try {
    // Dynamic import with non-literal specifier so TypeScript does not try
    // to resolve the (optional) module at compile time.
    const specifier = "@upstash/redis" as string
    const mod = (await import(specifier)) as Record<string, unknown>
    const RedisConstructor = mod.Redis as new (config: { url: string; token: string }) => UpstashRedisInstance
    upstashClient = new RedisConstructor({ url, token })
    upstashAvailable = true
    logger.info("Upstash Redis connected for caching")
    return upstashClient
  } catch (err) {
    upstashAvailable = false
    warnMemoryFallback(err)
    return null
  }
}

// ── In-memory fallback (dev only) ───────────────────────────────────────────

const memoryStore = new Map<string, CacheEntry<unknown>>()
let memoryWarned = false

function warnMemoryFallback(err?: unknown): void {
  if (memoryWarned) return
  memoryWarned = true
  logger.warn(
    { err, component: "cache" },
    "Upstash Redis not configured — using in-memory cache (dev only, not safe for multi-instance)"
  )
}

function memoryGet<T>(key: string): T | null {
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return entry.value as T
}

function memorySet<T>(key: string, value: T, ttlSeconds: number): void {
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

function memoryDelete(pattern: string): number {
  // If pattern ends with *, delete all matching keys
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    let count = 0
    for (const key of memoryStore.keys()) {
      if (key.startsWith(prefix)) {
        memoryStore.delete(key)
        count++
      }
    }
    return count
  }
  return memoryStore.delete(pattern) ? 1 : 0
}

// ── Default TTLs (seconds) ──────────────────────────────────────────────────

export const CACHE_TTL = {
  /** Dashboard KPIs — refresh every 60s */
  dashboard: 60,
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

// ── Key prefix ──────────────────────────────────────────────────────────────

const KEY_PREFIX = "ed:"

function prefixedKey(key: string): string {
  return `${KEY_PREFIX}${key}`
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a value from cache. If not found, call `fetcher`, cache the result,
 * and return it.
 *
 * @param key       Cache key (e.g. "dashboard:tenant123:kpis")
 * @param fetcher   Async function to fetch the value on cache miss
 * @param ttlSeconds  TTL in seconds (defaults to CACHE_TTL.default)
 */
export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.default
): Promise<T> {
  const redis = await getUpstashClient()

  if (redis) {
    // Try Redis
    const raw = await redis.get(prefixedKey(key))
    if (raw) {
      try {
        return JSON.parse(raw) as T
      } catch {
        // Corrupted cache — fetch fresh
      }
    }

    // Cache miss — fetch and store
    const value = await fetcher()
    await redis.set(prefixedKey(key), JSON.stringify(value), { ex: ttlSeconds })
    return value
  }

  // In-memory fallback
  const cached = memoryGet<T>(key)
  if (cached !== null) return cached

  const value = await fetcher()
  memorySet(key, value, ttlSeconds)
  return value
}

/**
 * Set a value in cache directly.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = CACHE_TTL.default
): Promise<void> {
  const redis = await getUpstashClient()

  if (redis) {
    await redis.set(prefixedKey(key), JSON.stringify(value), { ex: ttlSeconds })
    return
  }

  memorySet(key, value, ttlSeconds)
}

/**
 * Invalidate cache entries matching a pattern.
 * Use "*" as a wildcard suffix (e.g. "dashboard:tenant123:*").
 */
export async function cacheInvalidate(pattern: string): Promise<number> {
  const redis = await getUpstashClient()

  if (redis) {
    const fullPattern = prefixedKey(pattern)
    if (pattern.endsWith("*")) {
      // Scan for matching keys
      const keys = await redis.keys(prefixedKey(pattern.replace("*", "")) + "*")
      if (keys.length > 0) {
        return await redis.del(...keys)
      }
      return 0
    }
    return await redis.del(fullPattern)
  }

  return memoryDelete(pattern)
}

/**
 * Invalidate all cache entries for a tenant.
 */
export async function cacheInvalidateTenant(tenantId: string): Promise<void> {
  await cacheInvalidate(`*:${tenantId}:*`)
}

/**
 * Get cache stats (for monitoring/debugging).
 */
export async function cacheStats(): Promise<{
  provider: "redis" | "memory"
  keys?: number
  memoryEntries?: number
}> {
  const redis = await getUpstashClient()

  if (redis) {
    const keys = await redis.keys(`${KEY_PREFIX}*`)
    return { provider: "redis", keys: keys.length }
  }

  return { provider: "memory", memoryEntries: memoryStore.size }
}
