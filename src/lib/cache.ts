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

import { createHash, randomUUID } from "node:crypto"
import { logger } from "@/lib/logger"

type CacheEntry<T> = { value: T; expiresAt: number }

type UpstashRedisInstance = {
  eval: (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>
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

const KEY_PREFIX = "ed:v2:"
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

type Inflight = { promise: Promise<unknown>; epoch: number; revision: string | null }
const inflight = new Map<string, Inflight>()
let cacheEpoch = 0
// Serialize writes/deletions so a fetch started before invalidation cannot
// restore old Redis data after the deletion has completed.
let mutations: Promise<unknown> = Promise.resolve()
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutations.then(operation, operation)
  mutations = next.catch(() => undefined)
  return next
}

/** Read through the cache; fresh reads bypass both stored and in-flight data. */
export async function cacheGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.default,
  options?: { fresh?: boolean },
): Promise<T> {
  if (options?.fresh) await cacheInvalidate(key)
  let epoch = cacheEpoch
  const redis = await getUpstashClient()
  const revision = redis ? await redisRevision(redis, key) : null
  if (!options?.fresh) {
    if (redis && revision !== null) {
      try {
        const raw = await redis.get(prefixedKey(key))
        if (epoch === cacheEpoch && typeof raw === "string") return JSON.parse(raw) as T
      } catch (err) { redisFailed(err, "get") }
    } else if (!redis) {
      const cached = memoryGet<T>(key)
      if (epoch === cacheEpoch && cached !== undefined) return cached
    }
  }
  epoch = cacheEpoch
  const pending = inflight.get(key)
  if ((!redis || revision !== null) && pending?.epoch === epoch && pending.revision === revision) return pending.promise as Promise<T>
  const run = (async () => {
    const value = await fetcher()
    if (value !== undefined) await mutate(async () => {
      if (epoch === cacheEpoch) await storeValue(key, value, ttlSeconds, redis, revision)
    })
    return value
  })()
  const entry = { promise: run, epoch, revision }
  inflight.set(key, entry)
  try { return await run }
  finally { if (inflight.get(key) === entry) inflight.delete(key) }
}

/** Store a value directly. Failures are logged and ignored. */
const REVISION_TTL = 86400
const GENERATION_PREFIX = "edg:v2:"
const revisionKey = (key: string) => GENERATION_PREFIX + key
const ENSURE_REVISION = `-- cache-generation-read
local revision = redis.call('GET', KEYS[1])
if not revision then
  revision = ARGV[1]
  redis.call('SET', KEYS[1], revision, 'EX', ARGV[2])
else
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return revision`
const STORE_CURRENT = `-- cache-generation-write
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1`
const INVALIDATE_CURRENT = `-- cache-generation-invalidate
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return redis.call('DEL', KEYS[2])`

async function redisRevision(redis: UpstashRedisInstance, key: string): Promise<string | null> {
  try {
    const revision = await redis.eval(ENSURE_REVISION, [revisionKey(key)], [randomUUID(), REVISION_TTL])
    return typeof revision === "string" && revision.length > 0 ? revision : null
  } catch (err) { redisFailed(err, "generation"); return null }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = CACHE_TTL.default): Promise<void> {
  const redis = await getUpstashClient()
  const revision = redis ? await redisRevision(redis, key) : null
  await mutate(() => storeValue(key, value, ttlSeconds, redis, revision))
}

async function storeValue<T>(key: string, value: T, ttlSeconds: number, redis: UpstashRedisInstance | null, revision: string | null): Promise<void> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))
  if (redis) {
    // A distributed generation check and the payload write are one Redis
    // operation. A different Vercel instance cannot restore pre-refresh data.
    if (revision === null) return
    try { await redis.eval(STORE_CURRENT, [revisionKey(key), prefixedKey(key)], [revision, JSON.stringify(value), ttl]) }
    catch (err) { redisFailed(err, "set") }
    return
  }
  memorySet(key, value, ttl)
}

/** Invalidate one logical key or all keys matching a tenant-scoped glob. */
export async function cacheInvalidate(pattern: string): Promise<number> {
  cacheEpoch++
  return mutate(() => deleteCached(pattern))
}

async function deleteCached(pattern: string): Promise<number> {
  const redis = await getUpstashClient()
  if (!redis) return memoryDelete(pattern)
  try {
    const invalidate = async (key: string) => Number(await redis.eval(INVALIDATE_CURRENT,
      [revisionKey(key), prefixedKey(key)], [randomUUID(), REVISION_TTL]))
    if (!pattern.includes("*")) return await invalidate(pattern)
    const keys = new Set<string>()
    // Disjoint versioned namespaces prevent older deployments from restoring
    // unfenced entries and include misses still being fetched on other instances.
    for (const prefix of [KEY_PREFIX, GENERATION_PREFIX]) {
      let cursor: string | number = 0
      do {
        const [next, found] = await redis.scan(cursor, { match: prefix + pattern, count: 200 })
        for (const key of found) keys.add(key.slice(prefix.length))
        cursor = next
      } while (String(cursor) !== "0")
    }
    let removed = 0
    for (const key of keys) removed += await invalidate(key)
    return removed
  } catch (err) { redisFailed(err, "invalidate"); return 0 }
}

export async function cacheInvalidateTenant(tenantId: string): Promise<void> {
  if (!/^[0-9a-f-]{8,64}$/i.test(tenantId)) return
  await cacheInvalidate(`*:${tenantId}:*`)
}

export async function cacheStats(): Promise<{ provider: "redis" | "memory"; memoryEntries?: number }> {
  const redis = await getUpstashClient()
  return redis ? { provider: "redis" } : { provider: "memory", memoryEntries: memoryStore.size }
}

/** Test seam: reset process-local module state. */
export function __resetCacheForTests(): void {
  upstashClient = null
  upstashAvailable = null
  memoryStore.clear()
  inflight.clear()
  cacheEpoch = 0
  mutations = Promise.resolve()
}
