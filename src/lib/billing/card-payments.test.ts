import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))

import { toHalalas, verifyMoyasarInvoice } from "./card-payments"
import { parseMoyasarInvoice, type MoyasarInvoice } from "./moyasar"

const attempt = { id: "a1", platform_invoice_id: "i1", tenant_id: "t1", amount_halalas: 34500 }
const remote = (patch: Partial<MoyasarInvoice> = {}): MoyasarInvoice => ({
  id: "0f0f0f0f-0000-4000-8000-000000000001", status: "paid", amount: 34500, currency: "SAR", url: "https://checkout.moyasar.com/x",
  metadata: { attempt_id: "a1", platform_invoice_id: "i1", tenant_id: "t1" },
  payments: [{ id: "pay-1", status: "paid", amount: 34500 }], ...patch,
})

describe("toHalalas", () => {
  it("converts SAR to integer halalas without float drift", () => {
    expect(toHalalas(345)).toBe(34500)
    expect(toHalalas("199.99")).toBe(19999)
    expect(toHalalas(0.1 + 0.2)).toBe(30)
  })
  it.each([0, -1, NaN, "abc"])("rejects %s", (v) => expect(() => toHalalas(v as number)).toThrow())
})

describe("verifyMoyasarInvoice", () => {
  it("accepts a paid invoice that matches the attempt", () => {
    expect(verifyMoyasarInvoice(remote(), attempt)).toEqual({ ok: true, paymentId: "pay-1" })
  })
  it.each([
    [{ status: "initiated" as const }, "status:initiated"],
    [{ amount: 100 }, "amount"],
    [{ currency: "USD" }, "currency"],
    [{ metadata: { attempt_id: "other", platform_invoice_id: "i1", tenant_id: "t1" } }, "metadata"],
    [{ metadata: { attempt_id: "a1", platform_invoice_id: "i1", tenant_id: "evil" } }, "metadata"],
    [{ metadata: null }, "metadata"],
  ])("rejects %j", (patch, reason) => {
    expect(verifyMoyasarInvoice(remote(patch), attempt)).toEqual({ ok: false, reason })
  })
})

describe("parseMoyasarInvoice", () => {
  it("parses a provider response", () => {
    const p = parseMoyasarInvoice({ id: "0f0f0f0f-0000-4000-8000-000000000001", status: "paid", amount: 500, currency: "sar", url: "https://checkout.moyasar.com/i", metadata: { attempt_id: 1 } })
    expect(p.currency).toBe("SAR")
    expect(p.metadata).toEqual({ attempt_id: "1" })
  })
  it.each([
    { id: "x", status: "paid", amount: 1, currency: "SAR", url: "https://a" },
    { id: "0f0f0f0f-0000-4000-8000-000000000001", status: "weird", amount: 1, currency: "SAR", url: "https://a" },
    { id: "0f0f0f0f-0000-4000-8000-000000000001", status: "paid", amount: 1.5, currency: "SAR", url: "https://a" },
    { id: "0f0f0f0f-0000-4000-8000-000000000001", status: "paid", amount: 1, currency: "SAR", url: "http://a" },
  ])("rejects malformed %j", (v) => expect(() => parseMoyasarInvoice(v)).toThrow())
})
