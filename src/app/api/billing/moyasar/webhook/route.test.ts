import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const reconcile = vi.fn()
vi.mock("server-only", () => ({}))
vi.mock("@/lib/billing/card-payments", () => ({ reconcileAttempt: (...a: unknown[]) => reconcile(...a) }))
vi.mock("@/lib/billing/moyasar", () => ({
  moyasarConfigured: () => Boolean(process.env.MOYASAR_SECRET_KEY),
  fetchMoyasarPaymentInvoiceId: vi.fn(async () => "0f0f0f0f-0000-4000-8000-000000000009"),
}))

import { POST } from "./route"

const req = (body: unknown) => new Request("https://x/api/billing/moyasar/webhook", { method: "POST", body: JSON.stringify(body) })

describe("moyasar webhook", () => {
  beforeEach(() => {
    process.env.MOYASAR_SECRET_KEY = "sk_test_abc"
    process.env.MOYASAR_WEBHOOK_SECRET = "whsec-0123456789abcdef"
    reconcile.mockReset().mockResolvedValue("settled")
  })
  afterEach(() => {
    delete process.env.MOYASAR_SECRET_KEY
    delete process.env.MOYASAR_WEBHOOK_SECRET
  })

  it("fails closed without configuration", async () => {
    delete process.env.MOYASAR_WEBHOOK_SECRET
    expect((await POST(req({}))).status).toBe(503)
  })
  it("rejects a wrong secret token", async () => {
    expect((await POST(req({ secret_token: "nope", type: "payment_paid", data: { invoice_id: "x" } }))).status).toBe(401)
    expect(reconcile).not.toHaveBeenCalled()
  })
  it("reconciles by invoice id from the API, not the body status", async () => {
    const res = await POST(req({ secret_token: "whsec-0123456789abcdef", type: "payment_paid", data: { id: "p", invoice_id: "0f0f0f0f-0000-4000-8000-000000000001", status: "paid", amount: 1 } }))
    expect(res.status).toBe(200)
    expect(reconcile).toHaveBeenCalledWith({ providerInvoiceId: "0f0f0f0f-0000-4000-8000-000000000001" })
  })
  it("looks up the invoice from the payment when absent", async () => {
    await POST(req({ secret_token: "whsec-0123456789abcdef", type: "payment_paid", data: { id: "0f0f0f0f-0000-4000-8000-00000000000a" } }))
    expect(reconcile).toHaveBeenCalledWith({ providerInvoiceId: "0f0f0f0f-0000-4000-8000-000000000009" })
  })
  it("asks Moyasar to retry on failure", async () => {
    reconcile.mockRejectedValue(new Error("db down"))
    expect((await POST(req({ secret_token: "whsec-0123456789abcdef", data: { invoice_id: "0f0f0f0f-0000-4000-8000-000000000001" } }))).status).toBe(500)
  })
})
