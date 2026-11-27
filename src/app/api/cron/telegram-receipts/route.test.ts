import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), bot: vi.fn(), admin: vi.fn() }))
vi.mock("@/lib/expense-claims/telegram-confirmations", () => ({ dispatchTelegramConfirmation: mocks.dispatch }))
vi.mock("@/lib/expense-claims/telegram", () => ({ telegramBotId: mocks.bot }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

const request = (secret = "synthetic-cron") => new Request("https://example.test/api/cron/telegram-receipts", {
  headers: { authorization: `Bearer ${secret}` },
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("CRON_SECRET", "synthetic-cron")
  mocks.bot.mockReturnValue(901)
  mocks.admin.mockReturnValue({})
  mocks.dispatch.mockResolvedValue("empty")
})
afterEach(() => vi.unstubAllEnvs())

describe("scheduled Telegram receipt confirmations", () => {
  it("rejects missing and invalid credentials before claiming any work", async () => {
    expect((await GET(request("wrong"))).status).toBe(401)
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(request())).status).toBe(503)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it("skips delivery if no bot is configured", async () => {
    mocks.bot.mockReturnValue(null)
    expect(await (await GET(request())).json()).toEqual({ skipped: "bot-unconfigured" })
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it("reports delivery state and stops admitting work after a flood limit", async () => {
    mocks.dispatch.mockResolvedValueOnce("sent").mockResolvedValueOnce("uncertain").mockResolvedValueOnce("retry")
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 1, retry: 1, uncertain: 1, rejected: 0, suppressed: 0, deferred: 0 })
    expect(mocks.dispatch).toHaveBeenCalledTimes(3)
    expect(mocks.dispatch).toHaveBeenCalledWith({}, 901, null)
  })

  it("continues draining unrelated work after a confirmation is deferred", async () => {
    mocks.dispatch.mockResolvedValueOnce("deferred").mockResolvedValueOnce("sent")
    expect(await (await GET(request())).json()).toMatchObject({ deferred: 1, sent: 1 })
    expect(mocks.dispatch).toHaveBeenCalledTimes(3)
  })

  it("caps the number of due confirmations in an invocation", async () => {
    mocks.dispatch.mockResolvedValue("sent")
    expect(await (await GET(request())).json()).toMatchObject({ sent: 24 })
    expect(mocks.dispatch).toHaveBeenCalledTimes(24)
  })
})
