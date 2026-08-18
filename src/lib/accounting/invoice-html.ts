// Financial Phase 6 — pure A4 invoice HTML builder (bilingual, RTL).
// Mirrors src/lib/templates/document-html.ts: no server-only imports, so the
// builder is safe to import anywhere (and testable in isolation).

export interface InvoiceDocLine {
  line_no: number
  description: string
  quantity: number
  unit_price: number
  discount: number
  amount: number
  vat_rate: number
  vat_amount: number
}

export interface InvoiceDocData {
  /** Rendering flavour: full invoice layout, or a credit/debit note. */
  kind: "invoice" | "credit_note" | "debit_note"
  docTypeAr: string
  docTypeEn: string
  invoiceNumber: string
  referenceNumber?: string | null
  companyNameAr: string
  companyNameEn: string
  companyVatNumber: string
  companyAddress: string
  companyCity: string
  partyNameAr: string
  partyNameEn: string
  partyTaxNumber: string
  partyAddress: string
  partyPhone: string
  issueDate: string
  dueDate: string | null
  currency: string
  lines: InvoiceDocLine[]
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  notes?: string | null
  statusLabelAr: string
  statusLabelEn: string
  /** PNG data URL of the verification QR (built with qrcode + TLV payload). */
  qrDataUrl: string
  verifyUrl: string
  generatedAt: string
}

function esc(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function money(v: number | null | undefined, currency = "SAR"): string {
  return `${(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function fieldRow(labelAr: string, labelEn: string, value: string): string {
  return `<tr>
    <td class="lbl">${esc(labelAr)}<span class="en"> / ${esc(labelEn)}</span></td>
    <td class="val" dir="ltr">${esc(value)}</td>
  </tr>`
}

export function buildInvoiceHtml(d: InvoiceDocData): string {
  const linesRows = d.lines
    .map(
      (l) => `<tr>
    <td class="num">${l.line_no}</td>
    <td class="desc">${esc(l.description)}</td>
    <td class="num">${l.quantity}</td>
    <td class="num">${money(l.unit_price)}</td>
    <td class="num">${l.discount > 0 ? money(l.discount) : "—"}</td>
    <td class="num">${money(l.amount)}</td>
    <td class="num">${l.vat_rate}%</td>
    <td class="num">${money(l.vat_amount)}</td>
  </tr>`
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(d.docTypeAr)} ${esc(d.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.55; }
  .doc { max-width: 182mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1E5A99; padding-bottom: 10px; }
  .co-name { font-size: 17px; font-weight: 800; color: #1E5A99; }
  .co-sub { font-size: 11px; color: #64748b; }
  .co-line { font-size: 10.5px; color: #475569; margin-top: 2px; }
  .doc-no { text-align: left; direction: ltr; font-size: 11px; color: #64748b; }
  .doc-no b { display: block; font-size: 13px; color: #0f172a; }
  h1 { font-size: 15px; text-align: center; margin: 14px 0 4px; color: #0f172a; }
  .sub { text-align: center; color: #64748b; font-size: 11px; margin-bottom: 12px; }
  .status { display: inline-block; margin-top: 4px; padding: 3px 12px; border-radius: 999px; background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 700; }
  .party-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
  .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
  .box h3 { font-size: 11px; color: #1E5A99; margin-bottom: 4px; }
  .box p { font-size: 11px; color: #334155; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items th { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 10.5px; color: #334155; text-align: right; }
  table.items td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 11px; }
  td.num { direction: ltr; text-align: right; font-family: Consolas, monospace; white-space: nowrap; }
  td.desc { font-weight: 600; }
  .totals { width: 52%; margin: 10px 0 0 auto; border-collapse: collapse; }
  .totals td { border: 1px solid #e2e8f0; padding: 6px 10px; font-size: 11.5px; }
  .totals td.lbl { background: #f8fafc; font-weight: 600; }
  .totals tr.grand td { background: #1E5A99; color: #fff; font-weight: 800; font-size: 13px; }
  .notes { margin-top: 12px; font-size: 11px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
  .qr-block { display: flex; gap: 14px; align-items: center; margin-top: 16px; }
  .qr-block img { width: 92px; height: 92px; border: 1px solid #cbd5e1; border-radius: 6px; }
  .qr-verify { font-size: 10px; color: #94a3b8; }
  .qr-verify b { display: block; font-size: 10.5px; color: #475569; direction: ltr; }
  .signatures { display: flex; justify-content: space-between; margin-top: 34px; }
  .sig { text-align: center; width: 30%; }
  .sig .line { border-top: 1px solid #0f172a; margin-top: 30px; padding-top: 4px; font-size: 11px; color: #475569; }
  .meta { display: flex; justify-content: space-between; margin-top: 16px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
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
      <div class="co-line">${esc(d.companyAddress)}${d.companyCity ? " — " + esc(d.companyCity) : ""}</div>
    </div>
    <div class="doc-no">
      ${d.docTypeAr} / ${esc(d.docTypeEn)}
      <b dir="ltr">${esc(d.invoiceNumber)}</b>
      ${d.referenceNumber ? `<span>Ref: <b style="display:inline" dir="ltr">${esc(d.referenceNumber)}</b></span>` : ""}
    </div>
  </header>

  <h1>${esc(d.docTypeAr)} <span class="status">${esc(d.statusLabelAr)}</span></h1>
  <div class="sub" dir="ltr">${esc(d.docTypeEn)} — ${esc(d.statusLabelEn)}</div>

  <div class="party-grid">
    <div class="box">
      <h3>المُصدِر / Issuer</h3>
      <p>${esc(d.companyNameAr)}</p>
      <p>${esc(d.companyVatNumber || "—")}</p>
    </div>
    <div class="box">
      <h3>العميل / Party</h3>
      <p>${esc(d.partyNameAr)}</p>
      ${d.partyNameEn ? `<p dir="ltr" style="text-align:right">${esc(d.partyNameEn)}</p>` : ""}
      ${d.partyTaxNumber ? `<p>VAT: <span dir="ltr">${esc(d.partyTaxNumber)}</span></p>` : ""}
      ${d.partyAddress ? `<p>${esc(d.partyAddress)}</p>` : ""}
      ${d.partyPhone ? `<p dir="ltr" style="text-align:right">${esc(d.partyPhone)}</p>` : ""}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:5%">#</th>
        <th>الوصف / Description</th>
        <th style="width:9%">الكمية / Qty</th>
        <th style="width:13%">السعر / Price</th>
        <th style="width:11%">الخصم / Disc.</th>
        <th style="width:13%">الإجمالي / Amount</th>
        <th style="width:8%">الضريبة / VAT</th>
        <th style="width:13%">قيمة الضريبة / VAT Amt</th>
      </tr>
    </thead>
    <tbody>${linesRows}</tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td class="lbl">المجموع الفرعي / Subtotal</td><td dir="ltr">${money(d.subtotal, d.currency)}</td></tr>
      <tr><td class="lbl">الخصم / Discount</td><td dir="ltr">${d.discount > 0 ? money(d.discount, d.currency) : "—"}</td></tr>
      <tr><td class="lbl">ضريبة القيمة المضافة / VAT</td><td dir="ltr">${money(d.vatAmount, d.currency)}</td></tr>
      <tr class="grand"><td>الإجمالي / Total</td><td dir="ltr">${money(d.total, d.currency)}</td></tr>
    </tbody>
  </table>

  <table style="width:100%; border-collapse:collapse; margin-top:10px">
    <tbody>
      ${fieldRow("تاريخ الإصدار", "Issue Date", d.issueDate)}
      ${d.dueDate ? fieldRow("تاريخ الاستحقاق", "Due Date", d.dueDate) : ""}
    </tbody>
  </table>

  ${d.notes ? `<div class="notes"><b>ملاحظات / Notes:</b> ${esc(d.notes)}</div>` : ""}

  <div class="qr-block">
    <img src="${d.qrDataUrl}" alt="QR" />
    <div class="qr-verify">
      رمز التحقق — مسح للتحقق من صحة الوثيقة<br/>
      Verification QR — scan to verify this document
      <b>${esc(d.verifyUrl)}</b>
    </div>
  </div>

  <div class="signatures">
    <div class="sig"><div class="line">توقيع المستلم</div></div>
    <div class="sig"><div class="line">المدير — التوقيع والختم</div></div>
  </div>

  <div class="meta">
    <span dir="ltr">Generated: ${esc(d.generatedAt)}</span>
    <span>وثيقة صادرة من نخبة التطوير</span>
  </div>
</div>
</body>
</html>`
}
