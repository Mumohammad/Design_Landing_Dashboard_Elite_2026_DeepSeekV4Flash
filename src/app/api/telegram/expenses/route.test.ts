import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

const io = vi.hoisted(() => ({
  rpc: vi.fn(), storage: vi.fn(), upload: vi.fn(), download: vi.fn(),
  settings: vi.fn(), downloadTelegramFile: vi.fn(), sendMessage: vi.fn(),
  rateLimit: vi.fn(), extract: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: io.rpc,
    storage: { from: io.storage },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: io.settings }) }) }),
  }),
}))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: io.rateLimit }))
vi.mock("@/lib/expense-claims/telegram", () => ({
  downloadTelegramFile: io.downloadTelegramFile, sendMessage: io.sendMessage,
}))
vi.mock("@/lib/expense-claims/extract", () => ({
  extractReceiptDataWithin: io.extract,
  claimPayload: () => ({ fields: {}, payload: { supplier_name: "Fixture supplier" } }),
  readSummary: () => "",
}))

const tenant = "17700000-0000-4000-8000-000000000001"
const claimId = "17700000-0000-4000-8000-000000000002"
const receiptId = "17700000-0000-4000-8000-000000000003"
const path = `${tenant}/${claimId}/17700000-0000-4000-8000-000000000004.pdf`
const secret = "test-only-webhook-secret-177"
const pdf = new TextEncoder().encode("%PDF-1.7\nTest receipt")
const ledger = { receipt_id: receiptId, claim_id: claimId, path, completed: false }
const identity = { ok: true, tenant_id: tenant, user_id: "17700000-0000-4000-8000-000000000005", link_id: "17700000-0000-4000-8000-000000000006" }
const committed = { claim_id: claimId, claim_no: "EXP-TEST", created: true, duplicate_status: "none" }

function request(key = secret) {
  return new Request("https://example.test/api/telegram/expenses", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": key },
    body: JSON.stringify({
      update_id: 2001,
      message: {
        message_id: 21, date: 1795680000, from: { id: 120 }, chat: { id: 120, type: "private" },
        document: { file_id: "file-21", file_name: "receipt.pdf" }, caption: "Fixture",
      },
    }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", secret)
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "901:fake_TEST_ONLY_value_177")
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test")
  io.rateLimit.mockResolvedValue({ success: true })
  io.downloadTelegramFile.mockResolvedValue(pdf)
  io.storage.mockReturnValue({ upload: io.upload, download: io.download })
  io.upload.mockResolvedValue({ error: null })
  io.settings.mockResolvedValue({ data: { categories: [] }, error: null })
  io.extract.mockResolvedValue({ source: [] })
  const responses: Record<string, unknown> = {
    expense_telegram_identity: identity,
    expense_telegram_reserve_receipt: ledger,
    expense_telegram_finish_receipt: committed,
  }
  io.rpc.mockImplementation(async (name: string) => ({ data: responses[name], error: null }))
})

afterEach(() => vi.unstubAllEnvs())

describe("Telegram receipt webhook", () => {
  it("rejects requests without the webhook secret before contacting a provider", async () => {
    expect((await POST(request("invalid"))).status).toBe(401)
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.downloadTelegramFile).not.toHaveBeenCalled()
  })

  it("reserves a message, uploads the original, and confirms only a committed claim", async () => {
    expect((await POST(request())).status).toBe(200)
    expect(io.rpc).toHaveBeenNthCalledWith(2, "expense_telegram_reserve_receipt", expect.objectContaining({
      p_bot_id: 901, p_update_id: 2001, p_message_id: 21, p_chat_id: 120,
      p_message_date: 1795680000, p_link_id: identity.link_id,
      p_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_file: expect.objectContaining({ filename: "receipt.pdf", size: pdf.byteLength }),
    }))
    expect(io.upload).toHaveBeenCalledWith(path, pdf, { contentType: "application/pdf", upsert: false })
    expect(io.rpc).toHaveBeenNthCalledWith(3, "expense_telegram_finish_receipt", {
      p_receipt_id: receiptId, p_fields: { supplier_name: "Fixture supplier" },
    })
    expect(io.sendMessage).toHaveBeenCalledWith(120, expect.stringContaining(`/expenses/claims/${claimId}`))
  })

  it("acknowledges a completed Telegram retry without uploading or announcing it again", async () => {
    io.rpc.mockResolvedValueOnce({ data: identity }).mockResolvedValueOnce({ data: { ...ledger, completed: true } })
    expect((await POST(request())).status).toBe(200)
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(io.upload).not.toHaveBeenCalled()
    expect(io.sendMessage).not.toHaveBeenCalled()
  })

  it("uses a previous upload only after verifying the exact bytes", async () => {
    io.upload.mockResolvedValue({ error: { statusCode: "409" } })
    io.download.mockResolvedValueOnce({ data: new Blob(["%PDF-1.7\nOther receipt"]) })
    const incomplete = await POST(request())
    expect(incomplete.status).toBe(503)
    expect(incomplete.headers.get("Retry-After")).toBe("60")
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(io.sendMessage).not.toHaveBeenCalled()

    io.download.mockResolvedValueOnce({ data: new Blob([pdf]) })
    expect((await POST(request())).status).toBe(200)
    expect(io.upload).toHaveBeenNthCalledWith(2, path, pdf, expect.anything())
    expect(io.sendMessage).toHaveBeenCalledTimes(1)
  })

  it("returns a retryable response for a missing provider or commit response", async () => {
    io.downloadTelegramFile.mockRejectedValueOnce(Error("provider unavailable"))
    expect((await POST(request())).status).toBe(503)
    io.rpc.mockResolvedValueOnce({ data: identity }).mockResolvedValueOnce({ data: ledger })
      .mockResolvedValueOnce({ error: { message: "backend unavailable" } })
    expect((await POST(request())).status).toBe(503)
    expect(io.sendMessage).not.toHaveBeenCalled()
  })
})
