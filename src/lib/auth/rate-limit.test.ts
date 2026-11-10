// Unit tests for the shared rate limiter (audit fix H2).
//
// The Postgres backend is exercised through a stateful mock of the 062
// `check_rate_limit` RPC that replicates the migration's upsert semantics
// (single synchronous mutation per call — atomic within the event loop, like
// the real ON CONFLICT statement). The Upstash backend is exercised through a
// stubbed @upstash/redis module.
//
// Run: pnpm exec vitest run src/lib/auth/rate-limit.test.ts

import { describe, expect, it, vi, beforeAll } from "vitest"

// ── Mocks (hoisted) ────────────────────────────────────────────────────────

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

vi.mock("@upstash/redis", () => {
  // Stub Redis whose pipeline/exec replicates INCR + PTTL (+ PEXPIRE).
  const store = new Map<string, { count: number; expiry: number }>()
  let failExec = false
  class RedisStub {
    pipeline() {
      let key = ""
      return {
        incr: (k: string) => {
          key = k
        },
        pttl: () => {},
        exec: async (): Promise<[number, number]> => {
          if (failExec) throw new Error("upstash unavailable")
          const now = Date.now()
          const row = store.get(key)
          let count: number
          let expiry: number
          if (!row || row.expiry <= now) {
            count = 1
            expiry = now + 60_000
          } else {
            count = row.count + 1
            expiry = row.expiry
          }
          store.set(key, { count, expiry })
          return [count, Math.max(expiry - now, 0)]
        },
      }
    }
    async pexpire(key: string, ms: number): Promise<number> {
      const row = store.get(key)
      if (row && row.count === 1) row.expiry = Date.now() + ms
      return 1
    }
  }
  return {
    Redis: RedisStub,
    __setFailExec: (v: boolean) => {
      failExec = v
    },
    __reset: () => store.clear(),
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

type RpcArgs = { p_key: string; p_limit: number; p_window_seconds: number }
type RpcRow = { allowed: boolean; remaining: number; reset_at: string }

/**
 * Stateful emulation of the 062 check_rate_limit upsert. The mutation is
 * synchronous within the handler (no awaits before mutation), so concurrent
 * callers serialize exactly like the SQL ON CONFLICT row lock. Calls are
 * counted LOCALLY (immune to hoisted-mock history resets).
 */
function makeUpsertHandler(fail = false) {
  const table = new Map<string, { hits: number; expiresAt: number }>()
  let callCount = 0
  const handler = (
    fn: string,
    args: RpcArgs
  ): { data: RpcRow[]; error: null } | { data: null; error: { message: string } } => {
    callCount += 1
    if (fail) return { data: null, error: { message: "function check_rate_limit(text, integer, integer) does not exist" } }
    if (fn !== "check_rate_limit") throw new Error(`unexpected rpc: ${fn}`)
    const now = Date.now()
    const row = table.get(args.p_key)
    let hits: number
    let expiresAt: number
    if (!row || row.expiresAt <= now) {
      hits = 1
      expiresAt = now + args.p_window_seconds * 1000
    } else {
      hits = Math.min(row.hits + 1, args.p_limit + 1)
      expiresAt = row.expiresAt
    }
    table.set(args.p_key, { hits, expiresAt })
    return {
      data: [
        {
          allowed: hits <= args.p_limit,
          remaining: Math.max(args.p_limit - hits, 0),
          reset_at: new Date(expiresAt).toISOString(),
        },
      ],
      error: null,
    }
  }
  return { table, handler, get callCount() { return callCount } }
}

function setEnv(upstash: boolean): void {
  if (upstash) {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  }
}

// ── Postgres backend (default ladder layer 2) ──────────────────────────────

describe("rateLimit — Postgres backend (check_rate_limit RPC)", () => {
  let mod: typeof import("./rate-limit")

  beforeAll(async () => {
    setEnv(false)
    // ONE module instance for the whole describe: `upstash` is a module-level
    // const captured at import time, so it must be loaded with env unset.
    mod = await import("./rate-limit")
  })

  it("allows under-threshold requests", async () => {
    const { handler } = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(handler)

    const first = await mod.rateLimit("signin:1.2.3.4", 3, "minute")
    expect(first.success).toBe(true)
    expect(first.remaining).toBe(2)

    const second = await mod.rateLimit("signin:1.2.3.4", 3, "minute")
    expect(second.success).toBe(true)
    expect(second.remaining).toBe(1)
    expect(second.resetAt).toBeGreaterThan(Date.now())
  })

  it("returns success:false over the threshold (429 at the route)", async () => {
    const { handler } = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(handler)

    let last
    for (let i = 0; i < 5; i++) {
      last = await mod.rateLimit("signin:5.6.7.8", 3, "minute")
    }
    expect(last!.success).toBe(false)
    expect(last!.remaining).toBe(0)
    expect(last!.resetAt).toBeGreaterThan(Date.now())
  })

  it("resets the window after expiry", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"))
    try {
      const { handler } = makeUpsertHandler()
      rpcMock.mockClear()
      rpcMock.mockImplementation(handler)

      for (let i = 0; i < 3; i++) {
        await mod.rateLimit("forgot:9.9.9.9", 3, "hour")
      }
      const blocked = await mod.rateLimit("forgot:9.9.9.9", 3, "hour")
      expect(blocked.success).toBe(false)

      // Advance past the 1-hour window.
      vi.setSystemTime(new Date("2026-09-11T11:00:01Z"))
      const afterReset = await mod.rateLimit("forgot:9.9.9.9", 3, "hour")
      expect(afterReset.success).toBe(true)
      expect(afterReset.remaining).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("throws RateLimitUnavailableError when the RPC fails (missing 062) — fail-closed", async () => {
    const { handler } = makeUpsertHandler(true)
    rpcMock.mockClear()
    rpcMock.mockImplementation(handler)

    await expect(mod.rateLimit("signin:1.1.1.1", 10, "minute")).rejects.toBeInstanceOf(
      mod.RateLimitUnavailableError
    )
  })

  it("throws RateLimitUnavailableError when the RPC throws (network outage)", async () => {
    rpcMock.mockClear()
    rpcMock.mockRejectedValue(new Error("fetch failed"))

    await expect(mod.rateLimit("signin:1.1.1.1", 10, "minute")).rejects.toBeInstanceOf(
      mod.RateLimitUnavailableError
    )
  })

  it("throws RateLimitUnavailableError when the RPC returns no row", async () => {
    rpcMock.mockClear()
    rpcMock.mockResolvedValue({ data: null, error: null })

    await expect(mod.rateLimit("signin:1.1.1.1", 10, "minute")).rejects.toBeInstanceOf(
      mod.RateLimitUnavailableError
    )
  })

  it("issues exactly ONE rpc call per check (single atomic statement — no select-then-insert)", async () => {
    const upsert = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(upsert.handler)

    await mod.rateLimit("signin:2.2.2.2", 10, "minute")
    expect(upsert.callCount).toBe(1)

    const [fn, args] = rpcMock.mock.calls[0] as [string, RpcArgs]
    expect(fn).toBe("check_rate_limit")
    expect(args).toEqual({
      p_key: "minute:signin:2.2.2.2",
      p_limit: 10,
      p_window_seconds: 60,
    })
  })

  it("two concurrent bursts against one key allow exactly the limit (RPC atomicity)", async () => {
    const upsert = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(upsert.handler)

    const BURSTS = 2
    const PER_BURST = 12
    const LIMIT = 10

    const results = await Promise.all(
      Array.from({ length: BURSTS * PER_BURST }, () =>
        mod.rateLimit("signin:burst", LIMIT, "minute")
      )
    )

    const allowed = results.filter((r) => r.success).length
    const denied = results.filter((r) => !r.success).length
    // Every call hit the (single-statement) handler exactly once.
    expect(upsert.callCount).toBe(BURSTS * PER_BURST)
    expect(allowed).toBe(LIMIT)
    expect(denied).toBe(BURSTS * PER_BURST - LIMIT)
  }, 15_000)

  it("different windows/identifiers use independent buckets", async () => {
    const { handler } = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(handler)

    await mod.rateLimit("signin:3.3.3.3", 1, "minute")
    const blocked = await mod.rateLimit("signin:3.3.3.3", 1, "minute")
    expect(blocked.success).toBe(false)

    const otherIp = await mod.rateLimit("signin:4.4.4.4", 1, "minute")
    expect(otherIp.success).toBe(true)
    const otherWindow = await mod.rateLimit("forgot:3.3.3.3", 1, "hour")
    expect(otherWindow.success).toBe(true)
  })

  it("truncates overlong identifiers instead of failing", async () => {
    const { handler } = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(handler)

    const result = await mod.rateLimit(`signin:${"x".repeat(500)}`, 10, "minute")
    expect(result.success).toBe(true)
    const [fn, args] = rpcMock.mock.calls[0] as [string, RpcArgs]
    expect(fn).toBe("check_rate_limit")
    expect(args.p_key.length).toBeLessThanOrEqual("minute:signin:".length + 200)
  })
})

// ── Upstash backend (ladder layer 1) ───────────────────────────────────────

describe("rateLimit — Upstash backend (when env is configured)", () => {
  let mod: typeof import("./rate-limit")
  let upstashMock: Record<string, unknown>

  beforeAll(async () => {
    setEnv(true)
    upstashMock = (await import("@upstash/redis")) as unknown as Record<
      string,
      unknown
    >
    // Fresh module instance so the module-level `upstash` const is captured
    // with the env set.
    vi.resetModules()
    mod = await import("./rate-limit")
  })

  it("uses the fixed-window INCR path and allows under-threshold traffic", async () => {
    ;(upstashMock.__reset as () => void)()
    const upsert = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(upsert.handler)

    const r1 = await mod.rateLimit("signin:7.7.7.7", 5, "minute")
    expect(r1.success).toBe(true)
    expect(r1.remaining).toBe(4)

    const r2 = await mod.rateLimit("signin:7.7.7.7", 5, "minute")
    expect(r2.success).toBe(true)
    expect(r2.remaining).toBe(3)
    // Postgres RPC must NOT have been called when Upstash is active.
    expect(upsert.callCount).toBe(0)
  })

  it("blocks over-threshold traffic", async () => {
    ;(upstashMock.__reset as () => void)()
    const upsert = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(upsert.handler)

    let last
    for (let i = 0; i < 7; i++) {
      last = await mod.rateLimit("signin:8.8.8.8", 5, "minute")
    }
    expect(last!.success).toBe(false)
    expect(last!.remaining).toBe(0)
    expect(upsert.callCount).toBe(0)
  })

  it("throws RateLimitUnavailableError when Upstash errors — fail-closed", async () => {
    ;(upstashMock.__reset as () => void)()
    ;(upstashMock.__setFailExec as (v: boolean) => void)(true)
    const upsert = makeUpsertHandler()
    rpcMock.mockClear()
    rpcMock.mockImplementation(upsert.handler)

    await expect(mod.rateLimit("signin:6.6.6.6", 5, "minute")).rejects.toBeInstanceOf(
      mod.RateLimitUnavailableError
    )
    // Fail-closed: it must NOT silently fall through to Postgres.
    expect(upsert.callCount).toBe(0)
  })
})
