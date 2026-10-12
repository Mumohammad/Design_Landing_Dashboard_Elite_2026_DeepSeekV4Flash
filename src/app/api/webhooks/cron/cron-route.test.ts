// Route-level tests for GET /api/webhooks/cron (audit fix FX-05):
// fail-closed auth (503 without CRON_SECRET, 401 with a wrong bearer),
// the combined retry+retention run on success, and 500 on backend failure.
//
// Run: pnpm exec vitest run src/app/api/webhooks/cron/cron-route.test.ts

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const { processRetriesMock, cleanOldDeliveriesMock } = vi.hoisted(() => ({
  processRetriesMock: vi.fn(),
  cleanOldDeliveriesMock: vi.fn(),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  processRetries: (...args: unknown[]) => processRetriesMock(...args),
}))

vi.mock("@/lib/webhooks/store", () => ({
  cleanOldDeliveries: (...args: unknown[]) => cleanOldDeliveriesMock(...args),
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

const SECRET = "test-cron-secret"

function req(auth?: string): Request {
  return new Request("https://example.test/api/webhooks/cron", {
    headers: auth ? { authorization: auth } : {},
  })
}

describe("GET /api/webhooks/cron", () => {
  beforeEach(() => {
    processRetriesMock.mockReset()
    cleanOldDeliveriesMock.mockReset()
    vi.stubEnv("CRON_SECRET", SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns 503 when CRON_SECRET is not configured (fail closed)", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    expect(processRetriesMock).not.toHaveBeenCalled()
  })

  it("returns 401 without an authorization header", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(processRetriesMock).not.toHaveBeenCalled()
  })

  it("returns 401 with a wrong bearer token", async () => {
    const res = await GET(req("Bearer wrong-secret"))
    expect(res.status).toBe(401)
    expect(processRetriesMock).not.toHaveBeenCalled()
  })

  it("returns 401 with a non-Bearer scheme", async () => {
    const res = await GET(req(`Basic ${SECRET}`))
    expect(res.status).toBe(401)
    expect(processRetriesMock).not.toHaveBeenCalled()
  })

  it("processes retries and purges old deliveries with 30-day retention", async () => {
    processRetriesMock.mockResolvedValue({ processed: 2, succeeded: 1, failed: 1 })
    cleanOldDeliveriesMock.mockResolvedValue(7)

    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(processRetriesMock).toHaveBeenCalledTimes(1)
    // Retention sweep runs in the same cron run with the 30-day default.
    expect(cleanOldDeliveriesMock).toHaveBeenCalledWith(30)
    expect(cleanOldDeliveriesMock).toHaveBeenCalledTimes(1)

    const body = (await res.json()) as {
      processed: number
      succeeded: number
      failed: number
      deletedDeliveries: number
    }
    expect(body).toEqual({
      processed: 2,
      succeeded: 1,
      failed: 1,
      deletedDeliveries: 7,
    })
  })

  it("still reports deletedDeliveries when there is nothing to retry", async () => {
    processRetriesMock.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0 })
    cleanOldDeliveriesMock.mockResolvedValue(0)

    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      deletedDeliveries: 0,
    })
  })

  it("returns 500 when retry processing throws", async () => {
    processRetriesMock.mockRejectedValue(new Error("db down"))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
  })
})

vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => true, INTEGRATION_UNAVAILABLE: "Unavailable" }))
