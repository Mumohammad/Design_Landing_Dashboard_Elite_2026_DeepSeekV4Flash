import { afterEach, describe, expect, it, vi } from "vitest"
import { requestInvoicePdf } from "./invoice-pdf-download"
afterEach(() => vi.unstubAllGlobals())
function respond(body: string | Blob, headers: Record<string, string>, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(body, { headers, status }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}
describe("invoice PDF downloads", () => {
  it("requests the invoice and selected bank with session credentials and preserves the PDF filename", async () => {
    const fetch = respond("%PDF-1.7\nfixture", { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=UTF-8''Invoice-INV-2026-001035.pdf" })
    const result = await requestInvoicePdf("invoice-a", "bank-a")
    expect(result.filename).toBe("Invoice-INV-2026-001035.pdf")
    expect(await result.blob.text()).toBe("%PDF-1.7\nfixture")
    expect(fetch).toHaveBeenCalledWith("/api/invoices/invoice-a/pdf", expect.objectContaining({
      method: "POST", credentials: "same-origin", body: JSON.stringify({ bankAccountId: "bank-a" }),
    }))
  })
  it("does not save a login page or malformed response as a PDF", async () => {
    respond("<html>Sign in</html>", { "Content-Type": "text/html" })
    await expect(requestInvoicePdf("id")).rejects.toThrow("did not return a PDF")
    respond("HTML error", { "Content-Type": "application/pdf" })
    await expect(requestInvoicePdf("id")).rejects.toThrow("Invalid invoice PDF")
  })
  it("surfaces permission/rate-limit errors without starting a download", async () => {
    respond(JSON.stringify({ error: "Print permission required" }), { "Content-Type": "application/json" }, 403)
    await expect(requestInvoicePdf("id")).rejects.toThrow("Print permission required")
  })
  it("uses a safe fallback for invalid filenames", async () => {
    respond("%PDF-1.7", { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=UTF-8''..%2Fprivate.pdf" })
    expect((await requestInvoicePdf("id")).filename).toBe("Invoice.pdf")
  })
  it("shows Arabic errors when Arabic is selected", async () => {
    respond(JSON.stringify({ error: "Print permission required", errorAr: "صلاحية الطباعة مطلوبة" }), { "Content-Type": "application/json" }, 403)
    await expect(requestInvoicePdf("id", undefined, "ar")).rejects.toThrow("صلاحية الطباعة مطلوبة")
  })
})
