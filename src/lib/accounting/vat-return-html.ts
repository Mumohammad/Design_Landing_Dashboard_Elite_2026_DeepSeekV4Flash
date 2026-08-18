// Financial Phase 12 (IMPLEMENTATION-PLAN Phase 11) — pure A4 VAT return
// report HTML builder (bilingual, RTL) for a SINGLE period. Mirrors
// src/lib/templates/document-html.ts and vat-report-html.ts: no server-only
// imports, safe to import anywhere and testable.
//
// The return is a preparation/summary document only — there is NO submission
// API (submission stays out of scope until the ZATCA adapter phase).

export interface VatReturnFieldRow {
  labelAr: string
  labelEn: string
  value: number
  negative?: boolean // render red (payable)
  positive?: boolean // render green (receivable)
  bold?: boolean
  noteAr?: string
  noteEn?: string
}

export interface VatReturnReportData {
  companyNameAr: string
  companyNameEn: string
  companyVatNumber: string
  generatedAt: string
  period: string // "2026-08"
  periodStatus: string | null
  rows: VatReturnFieldRow[]
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

export function buildVatReturnHtml(d: VatReturnReportData): string {
  const fieldRows = d.rows
    .map((r) => {
      const note = r.noteAr || r.noteEn
        ? `<div class="note2">${esc(r.noteAr)} — ${esc(r.noteEn)}</div>`
        : ""
      return `<tr class="${r.bold ? "grand" : ""}">
    <td class="lbl">${esc(r.labelAr)}<div dir="ltr" class="lbl-en">${esc(r.labelEn)}</div></td>
    <td class="num ${r.negative ? "neg" : r.positive ? "pos" : ""}">${money(r.value)}</td>
  </tr>${note}`
    })
    .join("")

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>إقرار ضريبة القيمة المضافة / VAT Return</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.5; }
  .doc { max-width: 182mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E5A99; padding-bottom: 8px; }
  .co-name { font-size: 17px; font-weight: 800; color: #1E5A99; }
  .co-sub { font-size: 10.5px; color: #64748b; }
  .co-line { font-size: 10px; color: #475569; margin-top: 2px; }
  .doc-no { text-align: left; direction: ltr; font-size: 10px; color: #64748b; }
  .doc-no b { display: block; font-size: 12px; color: #0f172a; }
  h1 { font-size: 15px; text-align: center; margin: 12px 0 3px; color: #0f172a; }
  .sub { text-align: center; color: #64748b; font-size: 11px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 10.5px; color: #334155; }
  td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11.5px; }
  td.lbl { font-weight: 600; }
  .lbl-en { font-size: 9.5px; color: #64748b; font-weight: 400; direction: ltr; text-align: right; }
  td.num { direction: ltr; text-align: right; font-family: Consolas, monospace; white-space: nowrap; width: 140px; font-weight: 600; }
  td.pos { color: #047857; }
  td.neg { color: #b91c1c; }
  tr.grand td { background: #1E5A99; color: #fff; font-size: 13px; }
  tr.grand td.num { color: #fff; }
  tr.grand .lbl-en { color: #cbd5e1; }
  .note2 { font-size: 10px; color: #94a3b8; padding: 1px 0 4px; }
  .note { margin-top: 10px; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .meta { display: flex; justify-content: space-between; margin-top: 12px; font-size: 9.5px; color: #94a3b8; }
  .signatures { display: flex; justify-content: space-between; margin-top: 30px; }
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
      إقرار ضريبة القيمة المضافة / VAT Return
      <b dir="ltr">VAT-RET-${esc(d.period)}</b>
    </div>
  </header>

  <h1>إقرار ضريبة القيمة المضافة — الفترة ${esc(d.period)}</h1>
  <div class="sub" dir="ltr">VAT return — period ${esc(d.period)} · status: ${esc(d.periodStatus ?? "—")}</div>

  <table>
    <thead>
      <tr><th>البند / Item</th><th>القيمة / Amount</th></tr>
    </thead>
    <tbody>${fieldRows}</tbody>
  </table>

  <div class="note">
    وثيقة تحضيرية فقط — لا يوجد إرسال إلكتروني في هذا الإصدار. تُعد الضريبة غير القابلة للاسترداد مصروفاً ولا تدخل في صافي المركز.
    — Preparation document only — no electronic submission in this release. Non-recoverable input VAT is expensed and excluded from the net position.
  </div>

  <div class="signatures">
    <div class="sig"><div class="line">أعدّ الإقرار / Prepared by</div></div>
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
