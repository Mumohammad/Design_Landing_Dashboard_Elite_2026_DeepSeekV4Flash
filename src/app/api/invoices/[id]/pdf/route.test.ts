import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), limit: vi.fn(), generate: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ getCurrentUser: mocks.user, requirePermission: mocks.permission }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimit: mocks.limit }))
vi.mock("@/lib/accounting/invoice-docs", () => ({ generateInvoiceDocument: mocks.generate }))
import { POST } from "./route"

const id = "80111111-1111-4111-8111-111111111111"
const bank = "80222222-2222-4222-8222-222222222222"
const pdf = new TextEncoder().encode("%PDF-1.7\nfixture")
function request(body = "{}", origin: string | null = "https://app.test") {
  return new Request(`https://app.test/api/invoices/${id}/pdf`, { method: "POST", body,
    headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) } })
}
const context = { params: Promise.resolve({ id }) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue({ id: "profile-a", authUserId: "auth-a", tenantId: "tenant-a" })
  mocks.permission.mockResolvedValue(undefined)
  mocks.limit.mockResolvedValue({ success: true })
  mocks.generate.mockResolvedValue({ success: true, pdf, docNumber: "INVDOC-INV-2026-001035" })
})

describe("private invoice PDF endpoint", () => {
  it("returns the generated PDF as a private attachment with the invoice filename", async () => {
    const result = await POST(request(JSON.stringify({ bankAccountId: bank })), context)
    expect(result.status).toBe(200)
    expect(result.headers.get("content-type")).toBe("application/pdf")
    expect(result.headers.get("cache-control")).toBe("private, no-store")
    expect(result.headers.get("content-disposition")).toContain("Invoice-INV-2026-001035.pdf")
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(pdf)
    expect(mocks.permission).toHaveBeenCalledWith("invoices", "print")
    expect(mocks.limit).toHaveBeenCalledWith("invoice-pdf:auth-a", 10, "minute")
    expect(mocks.generate).toHaveBeenCalledWith(id, bank)
  })
  it.each([null, "null", "https://foreign.test"])("rejects missing/cross-origin requests %s before generation", async origin => {
    expect((await POST(request("{}", origin), context)).status).toBe(403)
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("requires an assured session and print permission", async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect((await POST(request(), context)).status).toBe(401)
    mocks.permission.mockRejectedValueOnce(Object.assign(new Error("Private authorization details"), { statusCode: 403 }))
    const denied = await POST(request(), context)
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain("Private authorization details")
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("rejects invalid invoice identifiers", async () => {
    expect((await POST(request(), { params: Promise.resolve({ id: "../other" }) })).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it.each(["null", "1", '"text"', "[]", "{", '{"html":"<script>"}', '{"bankAccountId":"wrong"}', " ".repeat(2049)])("rejects malformed/unknown PDF options", async body => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("fails closed when rate limiting rejects or fails", async () => {
    mocks.limit.mockResolvedValueOnce({ success: false, resetAt: Date.now() + 30_000 })
    const limited = await POST(request(), context)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0)
    mocks.limit.mockRejectedValueOnce(new Error("Backend unavailable"))
    expect((await POST(request(), context)).status).toBe(503)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it("does not return financial or internal details when invoice generation fails", async () => {
    mocks.generate.mockResolvedValueOnce({ success: false, error: "Private database error" })
    const failed = await POST(request(), context)
    expect(failed.status).toBe(422)
    expect(await failed.text()).not.toContain("Private database error")
    mocks.generate.mockResolvedValueOnce({ success: false, retryable: true })
    expect((await POST(request(), context)).status).toBe(503)
  })
  it("encodes filenames without response-header injection", async () => {
    mocks.generate.mockResolvedValueOnce({ success: true, pdf, docNumber: "INVDOC-فاتورة\r\nInjected: text" })
    const result = await POST(request(), context)
    expect(result.status).toBe(200)
    expect(result.headers.get("content-disposition")).not.toMatch(/[\r\n]/)
    expect(result.headers.get("injected")).toBeNull()
  })
})
