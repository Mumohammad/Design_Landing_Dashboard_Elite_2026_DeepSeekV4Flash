// Financial Phase 14 — unit tests for the A4 invoice HTML builder
// (TEST-STRATEGY.md §3.1): RTL root, XSS escaping of dynamic fields,
// totals rendering, QR + verify URL.
import { describe, expect, it } from "vitest"
import { buildInvoiceHtml, type InvoiceDocData } from "./invoice-html"

const BASE: InvoiceDocData = {
  kind: "invoice",
  docTypeAr: "فاتورة بيع",
  docTypeEn: "Sales Invoice",
  invoiceNumber: "INV-2026-000001",
  referenceNumber: null,
  companyNameAr: "نخبة التطوير",
  companyNameEn: "EliteDev Co.",
  companyVatNumber: "310122223500003",
  companyAddress: "الرياض",
  companyCity: "Riyadh",
  partyNameAr: "شركة التجزئة التجريبية",
  partyNameEn: "Demo Retail Co.",
  partyTaxNumber: "310122223500004",
  partyAddress: "جدة",
  partyPhone: "+966500000000",
  issueDate: "2026-08-12",
  dueDate: "2026-09-11",
  currency: "SAR",
  lines: [
    { line_no: 1, description: "خدمات نقل", quantity: 1, unit_price: 100_000, discount: 0, amount: 100_000, vat_rate: 15, vat_amount: 15_000 },
  ],
  subtotal: 100_000,
  discount: 0,
  vatAmount: 15_000,
  total: 115_000,
  notes: null,
  statusLabelAr: "معتمدة",
  statusLabelEn: "Finalized",
  qrDataUrl: "data:image/png;base64,AAAA",
  verifyUrl: "https://example.com/verify-document/INVDOC-INV-2026-000001",
  generatedAt: "2026-08-12T10:30:00.000Z",
}

describe("buildInvoiceHtml — document shell", () => {
  it("emits a bilingual RTL A4 document", () => {
    const html = buildInvoiceHtml(BASE)
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('@page { size: A4;')
    // Sales invoices use "فاتورة ضريبية" (Tax Invoice) — the ZATCA standard term
    expect(html).toContain("فاتورة ضريبية")
    expect(html).toContain("TAX Invoice")
  })

  it("renders the invoice number, parties, and totals", () => {
    const html = buildInvoiceHtml(BASE)
    expect(html).toContain("INV-2026-000001")
    expect(html).toContain("نخبة التطوير")
    expect(html).toContain("شركة التجزئة التجريبية")
    expect(html).toContain("100,000.00 SAR") // subtotal
    expect(html).toContain("15,000.00 SAR") // VAT
    expect(html).toContain("115,000.00 SAR") // total
  })

  it("embeds the QR image and verify URL", () => {
    const html = buildInvoiceHtml(BASE)
    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
    expect(html).toContain("https://example.com/verify-document/INVDOC-INV-2026-000001")
  })

  it("renders an em-dash for zero discount", () => {
    const html = buildInvoiceHtml(BASE)
    expect(html).toContain("—")
  })
})

describe("buildInvoiceHtml — XSS escaping", () => {
  it("escapes HTML metacharacters in line descriptions", () => {
    const html = buildInvoiceHtml({
      ...BASE,
      lines: [{ ...BASE.lines[0], description: '<script>alert(1)</script>' }],
    })
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
  })

  it("escapes ampersands and quotes in dynamic fields", () => {
    const html = buildInvoiceHtml({
      ...BASE,
      companyNameAr: "A&B Co",
      partyNameAr: 'قال "مرحباً"',
      notes: '"><img src=x onerror=alert(1)>',
    })
    expect(html).toContain("A&amp;B Co")
    expect(html).toContain("قال &quot;مرحباً&quot;")
    expect(html).not.toContain("<img src=x onerror=alert(1)>")
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;")
  })

  it("escapes the verify URL and generated-at stamp", () => {
    const html = buildInvoiceHtml({ ...BASE, verifyUrl: 'https://x.test/a"<b>' })
    expect(html).not.toContain('href="https://x.test/a"')
    expect(html).toContain("&quot;&lt;b&gt;")
  })
})

describe("buildInvoiceHtml — notes and reference", () => {
  it("renders the notes block only when present", () => {
    expect(buildInvoiceHtml(BASE)).not.toContain("ملاحظات / Notes:")
    const withNotes = buildInvoiceHtml({ ...BASE, notes: "شكراً لتعاملكم" })
    expect(withNotes).toContain("شكراً لتعاملكم")
  })

  it("renders a reference number when provided", () => {
    expect(buildInvoiceHtml(BASE)).not.toContain("Ref:")
    const withRef = buildInvoiceHtml({ ...BASE, referenceNumber: "PINV-2026-000002" })
    expect(withRef).toContain("PINV-2026-000002")
  })
})
