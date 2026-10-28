import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const store = new Map<string, string>()
let failing = false
const redis = {
  get: vi.fn(async (k: string) => { if (failing) throw new Error("down"); return store.get(k) ?? null }),
  set: vi.fn(async (k: string, v: string) => { if (failing) throw new Error("down"); store.set(k, v); return "OK" }),
  del: vi.fn(async (...keys: string[]) => { if (failing) throw new Error("down"); let n = 0; for (const k of keys) if (store.delete(k)) n++; return n }),
  scan: vi.fn(async (_cursor: number, opts: { match: string }) => {
    const re = new RegExp(`^${opts.match.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
    return ["0", [...store.keys()].filter((k) => re.test(k))] as [string, string[]]
  }),
}
vi.mock("@upstash/redis", () => ({ Redis: vi.fn(function () { return redis }) }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

import { __resetCacheForTests, cacheGet, cacheInvalidate, cacheInvalidateTenant, cacheKey } from "./cache"

const T1 = "11111111-1111-4111-8111-111111111111"
const T2 = "22222222-2222-4222-8222-222222222222"
const U1 = "33333333-3333-4333-8333-333333333333"

beforeEach(() => { __resetCacheForTests(); store.clear(); failing = false; vi.clearAllMocks() })
afterEach(() => vi.unstubAllEnvs())

describe("cache keys", () => {
  it("are tenant/user scoped, order-insensitive and never contain raw params", () => {
    const a = cacheKey("dashboard", T1, U1, { period: "30d", platform: "noon" })
    expect(a).toBe(cacheKey("dashboard", T1, U1, { platform: "noon", period: "30d" }))
    expect(a).not.toBe(cacheKey("dashboard", T2, U1, { period: "30d", platform: "noon" }))
    expect(a).not.toBe(cacheKey("dashboard", T1, null, { period: "30d", platform: "noon" }))
    expect(a).toMatch(new RegExp(`^dashboard:${T1}:${U1}:[A-Za-z0-9_-]{22}$`))
    expect(a).not.toContain("noon")
    expect(() => cacheKey("Bad Scope", T1, null)).toThrow()
    expect(() => cacheKey("dashboard", "*", null)).toThrow()
  })
})

describe("in-memory mode", () => {
  it("reads through, shares concurrent misses and invalidates by glob", async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    const key = cacheKey("dashboard", T1, U1, {})
    const [a, b] = await Promise.all([cacheGet(key, fetcher, 60), cacheGet(key, fetcher, 60)])
    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await cacheGet(key, fetcher, 60)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const other = cacheKey("dashboard", T2, U1, {})
    await cacheGet(other, fetcher, 60)
    expect(await cacheInvalidate(`dashboard:${T1}:*`)).toBe(1)
    await cacheGet(key, fetcher, 60)
    await cacheGet(other, fetcher, 60)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("expires entries and does not cache failures", async () => {
    vi.useFakeTimers()
    const key = cacheKey("coa", T1, null)
    const fetcher = vi.fn(async () => "v")
    await cacheGet(key, fetcher, 1)
    vi.advanceTimersByTime(1500)
    await cacheGet(key, fetcher, 1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
    const boom = cacheKey("coa", T2, null)
    await expect(cacheGet(boom, async () => { throw new Error("db") })).rejects.toThrow("db")
    expect(await cacheGet(boom, async () => "ok")).toBe("ok")
  })
})

describe("redis mode", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic")
  })

  it("stores JSON with a TTL under the ed: prefix and invalidates with SCAN", async () => {
    const key = cacheKey("dashboard", T1, U1, { period: "7d" })
    await cacheGet(key, async () => ({ total: 5 }), 60)
    expect(redis.set).toHaveBeenCalledWith(`ed:${key}`, JSON.stringify({ total: 5 }), { ex: 60 })
    expect(await cacheGet(key, async () => ({ total: 9 }), 60)).toEqual({ total: 5 })
    await cacheInvalidateTenant(T1)
    expect(redis.scan).toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it("fails open when Redis is unavailable", async () => {
    failing = true
    const key = cacheKey("dashboard", T1, U1, {})
    expect(await cacheGet(key, async () => "fresh", 60)).toBe("fresh")
    expect(await cacheInvalidate(`dashboard:${T1}:*`)).toBe(0)
  })
})
