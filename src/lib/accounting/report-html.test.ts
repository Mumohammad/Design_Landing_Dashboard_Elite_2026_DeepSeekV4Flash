// Financial Phase 14 — unit tests for the three report HTML builders
// (VAT return, VAT reconciliation, financial statements): rendering of the
// net math, payable/receivable colour classes, balance indicators, and
// XSS escaping.
import { describe, expect, it } from "vitest"
import { buildVatReconciliationHtml, type VatReconciliationReportData } from "./vat-report-html"
import { buildVatReturnHtml, type VatReturnReportData } from "./vat-return-html"
import { buildStatementHtml, type StatementReportData } from "./statement-html"

describe("buildVatReturnHtml", () => {
  const data: VatReturnReportData = {
    companyNameAr: "نخبة التطوير",
    companyNameEn: "EliteDev Co.",
    companyVatNumber: "310122223500003",
    generatedAt: "2026-08-12T10:30:00.000Z",
    period: "2026-08",
    periodStatus: "open",
    rows: [
      { labelAr: "ضريبة المخرجات", labelEn: "Output VAT", value: 20_000 },
      { labelAr: "مدخلات قابلة للاسترداد", labelEn: "Recoverable input", value: 10_000 },
      { labelAr: "صافي مستحق الدفع", labelEn: "Net payable", value: 9_375.5, negative: true, bold: true },
    ],
  }

  it("renders the period, company, and doc reference", () => {
    const html = buildVatReturnHtml(data)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain("VAT-RET-2026-08")
    expect(html).toContain("الفترة 2026-08")
    expect(html).toContain("310122223500003")
    expect(html).toContain("status: open")
  })

  it("marks payable rows negative (red) and receivable rows positive (green)", () => {
    const html = buildVatReturnHtml(data)
    expect(html).toContain('class="num neg"')
    const receivable = buildVatReturnHtml({ ...data, rows: [{ labelAr: "مستحق الاسترداد", labelEn: "Receivable", value: -1_500, positive: true }] })
    expect(receivable).toContain('class="num pos"')
  })

  it("marks the grand-total row", () => {
    const html = buildVatReturnHtml(data)
    expect(html).toContain('class="grand"')
  })

  it("escapes row labels and notes", () => {
    const html = buildVatReturnHtml({ ...data, rows: [{ labelAr: "<b>خطر</b>", labelEn: "&", value: 1, noteAr: "<i>ملاحظة</i>", noteEn: "note" }] })
    expect(html).toContain("&lt;b&gt;خطر&lt;/b&gt;")
    expect(html).toContain("&amp;")
    expect(html).not.toContain("<b>خطر</b>")
  })
})

describe("buildVatReconciliationHtml", () => {
  const data: VatReconciliationReportData = {
    companyNameAr: "نخبة التطوير",
    companyNameEn: "EliteDev Co.",
    companyVatNumber: "310122223500003",
    generatedAt: "2026-08-12T10:30:00.000Z",
    rows: [
      {
        period: "2026-08", status: "open",
        outputVat: 20_000, recoverableInput: 10_000, nonRecoverable: 1_999.99, pendingReview: 1_500.01,
        adjustmentsOutput: -750, adjustmentsInput: -125.5, netPosition: 9_375.5, pendingReviewRows: 1,
      },
      {
        period: "2026-07", status: "closed",
        outputVat: 5_000, recoverableInput: 5_000, nonRecoverable: 0, pendingReview: 0,
        adjustmentsOutput: 0, adjustmentsInput: 0, netPosition: 0, pendingReviewRows: 0,
      },
    ],
  }

  it("renders an A4 landscape reconciliation with per-period rows", () => {
    const html = buildVatReconciliationHtml(data)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain("@page { size: A4 landscape;")
    expect(html).toContain("2026-08")
    expect(html).toContain("2026-07")
  })

  it("computes the grand total net from the same canonical formula", () => {
    const html = buildVatReconciliationHtml(data)
    // 20,000 + (−750) − 10,000 − (−125.5) + (5,000 + 0 − 5,000 − 0) = 9,375.5
    expect(html).toContain("9,375.50 SAR")
  })

  it("marks positive net payable red and negative net receivable green", () => {
    const html = buildVatReconciliationHtml(data)
    expect(html).toContain('class="num pos"') // 9,375.5 > 0 → payable (red)
    const negative = buildVatReconciliationHtml({ ...data, rows: [{ ...data.rows[0], netPosition: -1_500 }] })
    expect(negative).toContain('class="num neg"')
  })

  it("surfaces pending-review rows with their count", () => {
    const html = buildVatReconciliationHtml(data)
    expect(html).toContain("<b>1,500.01 SAR</b> (1)")
  })

  it("escapes row status and period values", () => {
    const html = buildVatReconciliationHtml({ ...data, rows: [{ ...data.rows[0], status: "<script>x</script>" }] })
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;")
    expect(html).not.toContain("<script>x</script>")
  })
})

describe("buildStatementHtml", () => {
  const data: StatementReportData = {
    companyNameAr: "نخبة التطوير",
    companyNameEn: "EliteDev Co.",
    companyVatNumber: "310122223500003",
    generatedAt: "2026-08-12T10:30:00.000Z",
    kind: "balance_sheet",
    period: "2026-08",
    rows: [
      { code: "1000", nameAr: "النقدية", nameEn: "Cash", amount: 110_000, kind: "positive" },
      { code: "3000", nameAr: "رأس المال", nameEn: "Capital", amount: 110_000, kind: "negative" },
    ],
    totals: [{ labelAr: "الأصول", labelEn: "Assets", amount: 110_000, bold: true }],
    balanceOk: true,
  }

  it("renders the statement title and doc reference for each kind", () => {
    const html = buildStatementHtml(data)
    expect(html).toContain('<html lang="ar" dir="rtl">')
    expect(html).toContain("الميزانية العمومية")
    expect(html).toContain("BALANCE_SHEET-2026-08")
    const pl = buildStatementHtml({ ...data, kind: "profit_loss", balanceOk: undefined })
    expect(pl).toContain("قائمة الدخل (الأرباح والخسائر)")
    expect(pl).toContain("PROFIT_LOSS-2026-08")
  })

  it("renders the balance-ok indicator when provided", () => {
    expect(buildStatementHtml(data)).toContain('class="ok"')
    const bad = buildStatementHtml({ ...data, balanceOk: false })
    expect(bad).toContain('class="bad"')
    // Not provided → no indicator block.
    expect(buildStatementHtml({ ...data, balanceOk: undefined })).not.toContain('class="ok"')
  })

  it("renders account rows with kind colour classes", () => {
    const html = buildStatementHtml(data)
    expect(html).toContain('class="num pos"')
    expect(html).toContain('class="num neg"')
  })

  it("escapes account names and notes", () => {
    const html = buildStatementHtml({ ...data, rows: [{ ...data.rows[0], nameAr: '<img src=x>' }], note: "<script>alert(1)</script>" })
    expect(html).toContain("&lt;img src=x&gt;")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
  })
})
