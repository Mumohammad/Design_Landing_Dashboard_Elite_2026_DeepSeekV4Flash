// FX-11 (J9) — regression tests pinning audit invariant #1 flavor:
// "Load-test route fails closed when LOAD_TEST_SECRET is missing."
//
// The cron route already has a fail-closed suite (cron-route.test.ts);
// the load-test route did not. The gate only arms when NODE_ENV=production,
// so the tests stub NODE_ENV — mirroring the route's own documented model
// ("Non-production (local/staging): open for profiling").
//
// Mutation check (FX-11): deleting the `if (!secret) → 503` block makes
// "returns 503…" FAIL (the request proceeds into the scenarios instead).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const { adminFromMock } = vi.hoisted(() => ({
  adminFromMock: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

// moduleLogger is imported by the route; stub it to keep test output clean.
vi.mock("@/lib/logger", () => ({
  moduleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logPerformance: vi.fn(),
}))

import { GET } from "./route"

const SECRET = "test-load-secret"

function req(): Request {
  return new Request("https://example.test/api/load-test?scenario=dashboard")
}

// The scenario queries run `.select(...).limit(...)` style builder chains.
// Every chain ends in an awaited thenable; stub a minimal universal builder.
function stubQueryBuilder() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of [
    "select",
    "eq",
    "is",
    "in",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "single",
  ]) {
    builder[method] = chain
  }
  builder.then = (resolve: (v: unknown) => void) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
  return builder
}

describe("GET /api/load-test — fail-closed gate", () => {
  beforeEach(() => {
    adminFromMock.mockReset()
    adminFromMock.mockImplementation(() => stubQueryBuilder())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns 503 in production when LOAD_TEST_SECRET is not configured (fail closed)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOAD_TEST_SECRET", "")
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Service unavailable" })
    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it("returns 401 in production with a missing authorization header", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOAD_TEST_SECRET", SECRET)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it("returns 401 in production with a wrong bearer token", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOAD_TEST_SECRET", SECRET)
    const wrong = new Request("https://example.test/api/load-test", {
      headers: { authorization: `Bearer wrong-secret` },
    })
    const res = await GET(wrong)
    expect(res.status).toBe(401)
    expect(adminFromMock).not.toHaveBeenCalled()
  })

  it("rejects a matching secret sent without the Bearer scheme", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOAD_TEST_SECRET", SECRET)
    const raw = new Request("https://example.test/api/load-test", {
      headers: { authorization: SECRET },
    })
    const res = await GET(raw)
    expect(res.status).toBe(401)
  })

  it("runs the scenario once the gate passes (200, dashboard results)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LOAD_TEST_SECRET", SECRET)
    const authed = new Request("https://example.test/api/load-test?scenario=dashboard", {
      headers: { authorization: `Bearer ${SECRET}` },
    })
    const res = await GET(authed)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scenarios: Array<{ scenario: string }> }
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0].scenario).toBe("dashboard")
    expect(adminFromMock).toHaveBeenCalled()
  })

  it("stays open in non-production without a secret (documented profiling mode)", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("LOAD_TEST_SECRET", "")
    const res = await GET(req())
    expect(res.status).toBe(200)
  })
})
