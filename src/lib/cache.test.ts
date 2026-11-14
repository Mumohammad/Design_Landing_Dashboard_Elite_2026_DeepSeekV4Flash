import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const store = new Map<string, string>()
let failing = false
const redis = {
  eval: vi.fn(async (script: string, keys: string[], args: (string | number)[]) => {
    if (failing) throw new Error("down")
    if (script.includes("cache-generation-read")) { if (!store.has(keys[0])) store.set(keys[0], String(args[0])); return store.get(keys[0]) }
    if (script.includes("cache-generation-invalidate")) { store.set(keys[0], String(args[0])); return store.delete(keys[1]) ? 1 : 0 }
    if (script.includes("cache-generation-write")) { if (store.get(keys[0]) !== args[0]) return 0; store.set(keys[1], String(args[1])); return 1 }
    throw new Error("Unexpected Redis script")
  }),
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
    expect(store.get(`ed:v2:${key}`)).toBe(JSON.stringify({ total: 5 }))
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("cache-generation-write"), [`edg:v2:${key}`, `ed:v2:${key}`], [expect.any(String), JSON.stringify({ total: 5 }), 60])
    expect(await cacheGet(key, async () => ({ total: 9 }), 60)).toEqual({ total: 5 })
    await cacheInvalidateTenant(T1)
    expect(redis.scan).toHaveBeenCalled()
    expect(store.has(`ed:v2:${key}`)).toBe(false)
  })

  it("fails open when Redis is unavailable", async () => {
    failing = true
    const key = cacheKey("dashboard", T1, U1, {})
    expect(await cacheGet(key, async () => "fresh", 60)).toBe("fresh")
    expect(await cacheInvalidate(`dashboard:${T1}:*`)).toBe(0)
  })
})

for (const provider of ["memory", "redis"] as const) {
  describe(provider + " fresh requests", () => {
    beforeEach(() => { if (provider === "redis") { vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic") } })
    it("does not join an older in-flight snapshot or let it overwrite fresh data", async () => {
      const key = cacheKey("dashboard", T1, U1)
      let finish!: (value: string) => void
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      const old = cacheGet(key, () => { started(); return new Promise<string>(resolve => { finish = resolve }) })
      await ready
      expect(await cacheGet(key, async () => "fresh", 60, { fresh: true })).toBe("fresh")
      finish("old")
      expect(await old).toBe("old")
      expect(await cacheGet(key, async () => "unexpected")).toBe("fresh")
    })
    it("prevents an invalidated fetch from repopulating the stored entry", async () => {
      const key = cacheKey("dashboard", T1, U1)
      let finish!: (value: string) => void
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      const old = cacheGet(key, () => { started(); return new Promise<string>(resolve => { finish = resolve }) })
      await ready
      await cacheInvalidateTenant(T1)
      finish("old")
      await old
      expect(await cacheGet(key, async () => "new")).toBe("new")
    })
  })
}

describe("Redis generation across application instances", () => {
  beforeEach(() => { vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic") })
  it("rejects a pre-refresh fetch from another module instance", async () => {
    const key = cacheKey("dashboard", T1, U1)
    let finish!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const old = cacheGet(key, () => { started(); return new Promise<string>(resolve => { finish = resolve }) })
    await ready
    vi.resetModules()
    const other = await import("./cache")
    expect(await other.cacheGet(key, async () => "fresh", 60, { fresh: true })).toBe("fresh")
    finish("old")
    await old
    expect(await other.cacheGet(key, async () => "unexpected")).toBe("fresh")
    other.__resetCacheForTests()
  })
  it("does not reuse a cached payload when the generation cannot be read", async () => {
    const key = cacheKey("dashboard", T1, U1)
    await cacheGet(key, async () => "cached")
    redis.eval.mockRejectedValueOnce(new Error("generation unavailable"))
    expect(await cacheGet(key, async () => "uncached")).toBe("uncached")
    expect(store.get(`ed:v2:${key}`)).toBe(JSON.stringify("cached"))
  })
})

describe("distributed wildcard and expired generation", () => {
  beforeEach(() => { vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic") })
  it.each(["wildcard", "expired"] as const)("does not join or store an old pending fetch after %s on another instance", async kind => {
    const key = cacheKey("dashboard", T1, U1)
    let finish!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const old = cacheGet(key, () => { started(); return new Promise<string>(resolve => { finish = resolve }) })
    await ready
    const token = store.get(`edg:v2:${key}`)
    vi.resetModules()
    const other = await import("./cache")
    if (kind === "wildcard") await other.cacheInvalidateTenant(T1)
    else store.delete(`edg:v2:${key}`)
    // This request still runs in instance A with its earlier pending entry.
    expect(await cacheGet(key, async () => "new")).toBe("new")
    expect(store.get(`edg:v2:${key}`)).not.toBe(token)
    finish("old"); await old
    expect(await other.cacheGet(key, async () => "unexpected")).toBe("new")
    other.__resetCacheForTests()
  })
  it("scans past 100 pages, deduplicates keys and keeps marker namespace separate", async () => {
    const key = cacheKey("dashboard", T1, U1)
    await cacheGet(key, async () => "cached")
    for (let page = 0; page < 102; page++) redis.scan.mockImplementationOnce(async () => [page === 101 ? "0" : String(page + 1), [`ed:v2:${key}`]])
    expect(await cacheInvalidate(`*:${T1}:*`)).toBe(1)
    expect(redis.scan).toHaveBeenCalledTimes(103)
    expect([...store.keys()]).toEqual([`edg:v2:${key}`])
  })
})

it("does not share unverified Redis fetches when generation initialization repeatedly fails", async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io")
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "synthetic")
  const key = cacheKey("dashboard", T1, U1)
  let finish!: (value: string) => void
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  redis.eval.mockRejectedValueOnce(new Error("init failed"))
  const old = cacheGet(key, () => { started(); return new Promise<string>(resolve => { finish = resolve }) })
  await ready
  vi.resetModules()
  const other = await import("./cache")
  await other.cacheInvalidate(key)
  redis.eval.mockRejectedValueOnce(new Error("init failed again"))
  expect(await cacheGet(key, async () => "new")).toBe("new")
  finish("old"); await old
  expect(store.has(`ed:v2:${key}`)).toBe(false)
  other.__resetCacheForTests()
})
