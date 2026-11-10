// Financial Phase 13 (IMPLEMENTATION-PLAN Phase 12) — pure A4 financial
// statement report HTML builder (bilingual, RTL). Mirrors vat-report-html.ts:
// no server-only imports, safe to import anywhere and testable.
//
// One builder serves the three statements (P&L, Balance Sheet, Cash Flow):
// each renders a title, period line, a table of rows, a totals block, and
// signatures.

export type StatementKind = "profit_loss" | "balance_sheet" | "cash_flow"

export interface StatementRow {
  code: string
  nameAr: string
  nameEn: string
  amount: number
  kind?: "positive" | "negative" | "neutral"
}

export interface StatementTotalsRow {
  labelAr: string
  labelEn: string
  amount: number
  bold?: boolean
  negative?: boolean
  positive?: boolean
}

export interface StatementReportData {
  companyNameAr: string
  companyNameEn: string
  companyVatNumber: string
  generatedAt: string
  kind: StatementKind
  period: string
  rows: StatementRow[]
  totals: StatementTotalsRow[]
  balanceOk?: boolean
  note?: string
}

const KIND_TITLES: Record<StatementKind, { ar: string; en: string }> = {
  profit_loss: { ar: "قائمة الدخل (الأرباح والخسائر)", en: "Profit & Loss Statement" },
  balance_sheet: { ar: "الميزانية العمومية", en: "Balance Sheet" },
  cash_flow: { ar: "قائمة التدفقات النقدية", en: "Cash Flow Statement" },
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

export function buildStatementHtml(d: StatementReportData): string {
  const title = KIND_TITLES[d.kind]
  const rowRows = d.rows
    .map((r) => {
      const cls = r.kind === "positive" ? "pos" : r.kind === "negative" ? "neg" : ""
      return `<tr>
    <td class="code" dir="ltr">${esc(r.code)}</td>
    <td>${esc(r.nameAr)}<div dir="ltr" class="lbl-en">${esc(r.nameEn)}</div></td>
    <td class="num ${cls}">${money(r.amount)}</td>
  </tr>`
    })
    .join("")

  const totalRows = d.totals
    .map((t) => `<tr class="${t.bold ? "grand" : ""}">
    <td colspan="2" class="lbl">${esc(t.labelAr)}<div dir="ltr" class="lbl-en">${esc(t.labelEn)}</div></td>
    <td class="num ${t.negative ? "neg" : t.positive ? "pos" : ""}">${money(t.amount)}</td>
  </tr>`)
    .join("")

  const balanceOk = d.balanceOk === undefined
    ? ""
    : d.balanceOk
      ? `<div class="ok">متوازنة: الأصول = الخصوم + حقوق الملكية — Balanced: Assets = Liabilities + Equity</div>`
      : `<div class="bad">غير متوازنة: الأصول ≠ الخصوم + حقوق الملكية — NOT balanced: Assets ≠ Liabilities + Equity</div>`

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(title.ar)} / ${esc(title.en)}</title>
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
  td.code { width: 70px; text-align: center; font-family: Consolas, monospace; font-size: 10.5px; color: #475569; }
  td.lbl { font-weight: 600; }
  .lbl-en { font-size: 9.5px; color: #64748b; font-weight: 400; direction: ltr; text-align: right; }
  td.num { direction: ltr; text-align: right; font-family: Consolas, monospace; white-space: nowrap; width: 150px; font-weight: 600; }
  td.pos { color: #047857; }
  td.neg { color: #b91c1c; }
  tr.grand td { background: #1E5A99; color: #fff; font-size: 13px; }
  tr.grand td.num { color: #fff; }
  tr.grand .lbl-en { color: #cbd5e1; }
  .ok { margin-top: 10px; padding: 6px 10px; border-radius: 6px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 11px; }
  .bad { margin-top: 10px; padding: 6px 10px; border-radius: 6px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 11px; }
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
      ${esc(title.ar)} / ${esc(title.en)}
      <b dir="ltr">${d.kind.toUpperCase()}-${esc(d.period)}</b>
    </div>
  </header>

  <h1>${esc(title.ar)} — الفترة ${esc(d.period)}</h1>
  <div class="sub" dir="ltr">${esc(title.en)} — period ${esc(d.period)}</div>

  <table>
    <thead>
      <tr>
        <th>الرمز / Code</th>
        <th>الحساب / Account</th>
        <th>المبلغ / Amount</th>
      </tr>
    </thead>
    <tbody>${rowRows}</tbody>
  </table>

  <table class="totals">
    <tbody>${totalRows}</tbody>
  </table>

  ${balanceOk}

  <div class="note">
    ${esc(d.note ?? "تُبنى الأرقام من القيود المرحّلة فقط — Figures are built from posted journal entries only.")}
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
