// Financial Phase 11 — pure A4 VAT reconciliation report HTML builder
// (bilingual, RTL). Mirrors src/lib/templates/document-html.ts: no
// server-only imports, so it is safe to import anywhere and testable.

export interface VatReportRow {
  period: string
  status: string
  outputVat: number
  recoverableInput: number
  nonRecoverable: number
  pendingReview: number
  adjustmentsOutput: number
  adjustmentsInput: number
  netPosition: number
  pendingReviewRows: number
}

export interface VatReconciliationReportData {
  companyNameAr: string
  companyNameEn: string
  companyVatNumber: string
  generatedAt: string
  rows: VatReportRow[]
}

function esc(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function money(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " SAR"
}

export function buildVatReconciliationHtml(d: VatReconciliationReportData): string {
  const totalOutput = d.rows.reduce((s, r) => s + r.outputVat, 0)
  const totalRecoverable = d.rows.reduce((s, r) => s + r.recoverableInput, 0)
  const totalNonRecoverable = d.rows.reduce((s, r) => s + r.nonRecoverable, 0)
  const totalPending = d.rows.reduce((s, r) => s + r.pendingReview, 0)
  const totalAdjOut = d.rows.reduce((s, r) => s + r.adjustmentsOutput, 0)
  const totalAdjIn = d.rows.reduce((s, r) => s + r.adjustmentsInput, 0)
  const totalNet = totalOutput + totalAdjOut - totalRecoverable - totalAdjIn
  const pendingCount = d.rows.reduce((s, r) => s + r.pendingReviewRows, 0)

  const periodRows = d.rows
    .map(
      (r) => `<tr>
    <td class="num">${esc(r.period)}</td>
    <td>${esc(r.status)}</td>
    <td class="num">${money(r.outputVat)}</td>
    <td class="num">${money(r.recoverableInput)}</td>
    <td class="num">${money(r.nonRecoverable)}</td>
    <td class="num">${r.pendingReviewRows > 0 ? `<b>${money(r.pendingReview)}</b> (${r.pendingReviewRows})` : money(r.pendingReview)}</td>
    <td class="num">${money(r.adjustmentsOutput)}</td>
    <td class="num">${money(r.adjustmentsInput)}</td>
    <td class="num ${r.netPosition > 0 ? "pos" : r.netPosition < 0 ? "neg" : ""}"><b>${money(r.netPosition)}</b></td>
  </tr>`
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>تسوية ضريبة القيمة المضافة / VAT Reconciliation</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 11.5px; line-height: 1.5; }
  .doc { max-width: 277mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E5A99; padding-bottom: 8px; }
  .co-name { font-size: 16px; font-weight: 800; color: #1E5A99; }
  .co-sub { font-size: 10.5px; color: #64748b; }
  .co-line { font-size: 10px; color: #475569; margin-top: 2px; }
  .doc-no { text-align: left; direction: ltr; font-size: 10px; color: #64748b; }
  .doc-no b { display: block; font-size: 12px; color: #0f172a; }
  h1 { font-size: 14px; text-align: center; margin: 12px 0 3px; color: #0f172a; }
  .sub { text-align: center; color: #64748b; font-size: 10.5px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 5px 7px; font-size: 10px; color: #334155; }
  td { border: 1px solid #e2e8f0; padding: 5px 7px; font-size: 10.5px; }
  td.num { direction: ltr; text-align: right; font-family: Consolas, monospace; white-space: nowrap; }
  td.pos { color: #b91c1c; }
  td.neg { color: #047857; }
  .totals { margin-top: 8px; }
  .totals td.lbl { background: #f8fafc; font-weight: 600; }
  .totals tr.grand td { background: #1E5A99; color: #fff; font-weight: 800; }
  .note { margin-top: 8px; font-size: 10px; color: #64748b; }
  .meta { display: flex; justify-content: space-between; margin-top: 12px; font-size: 9.5px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 26px; }
  .sig { text-align: center; width: 30%; }
  .sig .line { border-top: 1px solid #0f172a; margin-top: 26px; padding-top: 3px; font-size: 10px; color: #475569; }
  @media print { .doc { max-width: 100%; } }
</style>
</head>
<body>
<div class="doc">
  <header>
    <div>
      <div class="co-name">${esc(d.companyNameAr)}</div>
      <div class="co-sub" dir="ltr">${esc(d.companyNameEn)}</div>
      <div class="co-line">VAT: ${esc(d.companyVatNumber || "—")}</div>
    </div>
    <div class="doc-no">
      تقرير تسوية ضريبة القيمة المضافة / VAT Reconciliation Report
      <b dir="ltr">VAT-RECON-${esc(d.generatedAt.slice(0, 10))}</b>
    </div>
  </header>

  <h1>تسوية ضريبة القيمة المضافة حسب الفترة</h1>
  <div class="sub" dir="ltr">VAT reconciliation by period — output − recoverable input ± adjustments = net position</div>

  <table>
    <thead>
      <tr>
        <th>الفترة / Period</th>
        <th>الحالة / Status</th>
        <th>المخرجات / Output</th>
        <th>مدخلات قابلة للاسترداد / Rec. Input</th>
        <th>غير قابلة للاسترداد / Non-rec.</th>
        <th>قيد المراجعة / Pending</th>
        <th>تسويات مخرجات / Adj. Out</th>
        <th>تسويات مدخلات / Adj. In</th>
        <th>صافي المركز / Net</th>
      </tr>
    </thead>
    <tbody>${periodRows}</tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td class="lbl">الإجمالي / Total Output</td><td class="num">${money(totalOutput)}</td></tr>
      <tr><td class="lbl">إجمالي المدخلات القابلة للاسترداد / Total Recoverable Input</td><td class="num">${money(totalRecoverable)}</td></tr>
      <tr><td class="lbl">إجمالي غير القابلة للاسترداد / Total Non-recoverable</td><td class="num">${money(totalNonRecoverable)}</td></tr>
      <tr><td class="lbl">إجمالي قيد المراجعة / Total Pending Review (${pendingCount} rows)</td><td class="num">${money(totalPending)}</td></tr>
      <tr><td class="lbl">إجمالي تسويات المخرجات / Total Output Adjustments</td><td class="num">${money(totalAdjOut)}</td></tr>
      <tr><td class="lbl">إجمالي تسويات المدخلات / Total Input Adjustments</td><td class="num">${money(totalAdjIn)}</td></tr>
      <tr class="grand"><td>صافي المركز الضريبي / Net VAT Position</td><td class="num">${money(totalNet)}</td></tr>
    </tbody>
  </table>

  <div class="note">
    غير قابلة للاسترداد تُصرف ولا تدخل في صافي المركز — Non-recoverable input is expensed and excluded from the net position.
    العناصر قيد المراجعة تنتظر تصنيفاً يدوياً — Pending-review items wait for manual classification.
  </div>

  <div class="signatures">
    <div class="sig"><div class="line">أعدّ التقرير / Prepared by</div></div>
    <div class="sig"><div class="line">المحاسب / Accountant</div></div>
    <div class="sig"><div class="line">المدير — التوقيع والختم / Manager</div></div>
  </div>

  <div class="meta">
    <span dir="ltr">Generated: ${esc(d.generatedAt)}</span>
    <span>وثيقة صادرة من نخبة التطوير</span>
  </div>
</div>
</body>
</html>`
}
