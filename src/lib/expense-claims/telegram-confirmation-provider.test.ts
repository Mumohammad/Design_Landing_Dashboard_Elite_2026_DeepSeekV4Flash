import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deliverTelegramReceiptConfirmation } from "./telegram"

vi.mock("server-only", () => ({}))

beforeEach(() => vi.stubEnv("TELEGRAM_BOT_TOKEN", "120:synthetic_confirmation_fixture"))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function respond(status: number, payload: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

describe("receipt confirmation delivery evidence", () => {
  it("retains a message ID only for an acceptance addressed to the intended chat", async () => {
    const fetch = respond(200, { ok: true, result: { message_id: 42, chat: { id: 120 } } })
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "sent", messageId: 42 })
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toMatchObject({ chat_id: 120, text: "Receipt received" })
    expect(options.redirect).toBe("error")
    expect(await deliverTelegramReceiptConfirmation(121, "Receipt received")).toEqual({ state: "uncertain" })
  })

  it("uses Telegram's explicit flood-control delay", async () => {
    respond(429, { ok: false, error_code: 429, parameters: { retry_after: 119 } })
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "retry", retryAfter: 119 })
  })

  it("treats a clear Telegram rejection as terminal", async () => {
    respond(403, { ok: false, error_code: 403, description: "Synthetic private detail" })
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "rejected" })
  })

  it("keeps a network timeout, gateway failure or unconfirmed rate limit out of automatic retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Synthetic timeout after send") }))
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "uncertain" })
    respond(502, { ok: false, error_code: 502 })
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "uncertain" })
    respond(429, { error: true })
    expect(await deliverTelegramReceiptConfirmation(120, "Receipt received")).toEqual({ state: "uncertain" })
  })
})
