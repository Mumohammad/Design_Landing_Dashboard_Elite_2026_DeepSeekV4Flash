// Financial Phase 14 — unit tests for the generic A4 document HTML builder
// (TEST-STRATEGY.md §3.1): driver/vehicle field rows, RTL shell, money
// formatting, XSS escaping, description fallback.
import { describe, expect, it } from "vitest"
import { buildDocumentHtml } from "./document-html"

const COMPANY = {
  companyNameAr: "نخبة التطوير",
  companyNameEn: "EliteDev Co.",
  docNumber: "DOC-2026-000001",
  verifyUrl: "https://example.com/verify-document/DOC-2026-000001",
  generatedAt: "2026-08-12T10:30:00.000Z",
}

describe("buildDocumentHtml — shell and fields", () => {
  it("emits a bilingual RTL A4 document with the template title", () => {
    const html = buildDocumentHtml("خطاب تعريف", "Introduction Letter", null, COMPANY)
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain('@page { size: A4;')
    expect(html).toContain("خطاب تعريف")
    expect(html).toContain("Introduction Letter")
  })

  it("renders driver field rows with salary formatted at 2dp", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, {
      ...COMPANY,
      driver: {
        driver_code: "DRV-0001",
        full_name_ar: "محمد أحمد",
        iqama_number: "2098765432",
        phone: "+966500000000",
        basic_salary: 4000,
        iban: "SA0310000000000000000000",
      },
    })
    expect(html).toContain("DRV-0001")
    expect(html).toContain("محمد أحمد")
    expect(html).toContain("2098765432")
    expect(html).toContain("4,000.00 SAR")
    expect(html).toContain("SA0310000000000000000000")
  })

  it("renders vehicle field rows", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, {
      ...COMPANY,
      vehicle: { vehicle_code: "V-0001", plate_number: "أ ب ج 1234", make: "Toyota", model: "Camry", year: 2024 },
    })
    expect(html).toContain("V-0001")
    expect(html).toContain("أ ب ج 1234")
    expect(html).toContain("Toyota Camry")
    expect(html).toContain("2024")
  })

  it("falls back to the description row when no entity is provided", () => {
    const html = buildDocumentHtml("خطاب", "Letter", "بيان رسمي", COMPANY)
    expect(html).toContain("بيان رسمي")
  })

  it("embeds the verify URL", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, COMPANY)
    expect(html).toContain("https://example.com/verify-document/DOC-2026-000001")
  })

  it("renders the real QR image when qrDataUrl is provided", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, {
      ...COMPANY,
      qrDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    })
    expect(html).toContain('<img class="qr-img" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="QR" />')
    // The dashed placeholder must not render when a real QR exists.
    expect(html).not.toContain('class="qr"')
    expect(html).not.toContain("توثيق")
  })

  it("falls back to the dashed placeholder when no qrDataUrl is provided", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, COMPANY)
    expect(html).toContain('<div class="qr">QR<br/>توثيق</div>')
  })
})

describe("buildDocumentHtml — XSS escaping", () => {
  it("escapes HTML metacharacters in names and fields", () => {
    const html = buildDocumentHtml("خطاب", "Letter", null, {
      ...COMPANY,
      driver: { full_name_ar: '<script>alert(1)</script>', basic_salary: null, iban: 'A&B "x"' },
    })
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("A&amp;B &quot;x&quot;")
  })

  it("escapes template names", () => {
    const html = buildDocumentHtml('عقد <b>', 'X & Y', null, COMPANY)
    expect(html).toContain("عقد &lt;b&gt;")
    expect(html).not.toContain("<b>")
  })
})
