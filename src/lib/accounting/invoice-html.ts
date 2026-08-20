// Financial Phase 6 — pure A4 invoice HTML builder (bilingual, RTL).
// Designed to match the standard Saudi ZATCA tax invoice format exactly.
// Mirrors src/lib/templates/document-html.ts: no server-only imports.

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
  companyCrNumber?: string | null
  companyPhone?: string | null
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
  paidAmount?: number
  notes?: string | null
  statusLabelAr: string
  statusLabelEn: string
  /** PNG data URL of the verification QR (built with qrcode + TLV payload). */
  qrDataUrl: string
  verifyUrl: string
  generatedAt: string
  /** Optional bank account IBAN for payment details */
  bankIban?: string | null
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

function moneyNoCurrency(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildInvoiceHtml(d: InvoiceDocData): string {
  const linesRows = d.lines
    .map(
      (l) => `<tr>
    <td class="num">${l.line_no}</td>
    <td class="desc">${esc(l.description)}</td>
    <td class="num">${money(l.unit_price)}</td>
    <td class="num">${l.quantity.toLocaleString("en-US")}</td>
    <td class="num">${l.vat_rate}%</td>
    <td class="num">${money(l.vat_amount)}</td>
    <td class="num">${money(l.amount)}</td>
  </tr>`
    )
    .join("")

  const dueAmount = Math.max(0, d.total - (d.paidAmount ?? 0))

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>فاتورة ضريبية — ${esc(d.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Tahoma, 'Cairo', Arial, sans-serif;
    color: #1a1a2e;
    font-size: 11px;
    line-height: 1.45;
    background: #fff;
  }
  .doc { max-width: 190mm; margin: 0 auto; padding: 0; }

  /* ── Header ── */
  header {
    text-align: center;
    border-bottom: 2px solid #1a1a2e;
    padding-bottom: 8px;
    margin-bottom: 6px;
  }
  .title-tax {
    font-size: 20px;
    font-weight: 800;
    color: #1a1a2e;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .co-info {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 6px;
    font-size: 10.5px;
    color: #475569;
    direction: ltr;
  }
  .co-info span { white-space: nowrap; }
  .co-info b { color: #1a1a2e; }

  /* ── Invoice meta row ── */
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin: 10px 0;
    font-size: 11px;
  }
  .meta-left {
    text-align: right;
  }
  .meta-right {
    text-align: left;
    direction: ltr;
  }
  .meta-label {
    font-size: 10px;
    color: #94a3b8;
    display: block;
  }
  .meta-value {
    font-size: 13px;
    font-weight: 700;
    color: #1a1a2e;
    display: block;
    direction: ltr;
  }

  /* ── Client box ── */
  .client-box {
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 8px 12px;
    margin: 8px 0;
    background: #f8fafc;
  }
  .client-box h3 {
    font-size: 10px;
    color: #94a3b8;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .client-box p {
    font-size: 11px;
    color: #1a1a2e;
    margin-bottom: 2px;
  }

  /* ── Items table ── */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  table.items th {
    background: #1a1a2e;
    color: #fff;
    border: 1px solid #111;
    padding: 6px 5px;
    font-size: 9.5px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
  }
  table.items td {
    border: 1px solid #e2e8f0;
    padding: 5px 5px;
    font-size: 10.5px;
  }
  table.items tr:nth-child(even) td {
    background: #f8fafc;
  }
  td.num {
    direction: ltr;
    text-align: right;
    font-family: 'Consolas', 'Courier New', monospace;
    white-space: nowrap;
  }
  td.desc {
    font-weight: 600;
  }

  /* ── Totals section ── */
  .totals-section {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    gap: 20px;
  }
  .totals-left {
    flex: 1;
  }
  .totals-right {
    width: 50%;
  }
  .totals-table {
    width: 100%;
    border-collapse: collapse;
  }
  .totals-table td {
    border: 1px solid #e2e8f0;
    padding: 5px 8px;
    font-size: 11px;
  }
  .totals-table td.lbl {
    background: #f1f5f9;
    font-weight: 600;
    text-align: right;
  }
  .totals-table td.val {
    direction: ltr;
    text-align: right;
    font-family: 'Consolas', monospace;
    font-weight: 600;
  }
  .totals-table tr.grand td {
    background: #1a1a2e;
    color: #fff;
    font-weight: 800;
    font-size: 12px;
  }
  .totals-table tr.paid td {
    background: #f0fdf4;
    color: #15803d;
  }
  .totals-table tr.due td {
    background: #fef2f2;
    color: #dc2626;
    font-weight: 800;
  }

  /* ── Payment / Bank info ── */
  .payment-info {
    margin-top: 10px;
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    background: #f8fafc;
    font-size: 10.5px;
    color: #475569;
  }
  .payment-info .iban {
    direction: ltr;
    font-family: 'Consolas', monospace;
    font-weight: 600;
    color: #1a1a2e;
  }

  /* ── QR + Footer ── */
  .bottom-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 14px;
    gap: 16px;
  }
  .qr-block {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .qr-block img {
    width: 72px;
    height: 72px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
  }
  .qr-verify {
    font-size: 9px;
    color: #94a3b8;
    line-height: 1.4;
  }
  .qr-verify b {
    display: block;
    font-size: 9.5px;
    color: #475569;
    direction: ltr;
  }
  .signatures {
    display: flex;
    gap: 24px;
  }
  .sig {
    text-align: center;
    width: 110px;
  }
  .sig .line {
    border-top: 1px solid #1a1a2e;
    margin-top: 24px;
    padding-top: 4px;
    font-size: 10px;
    color: #475569;
  }

  /* ── Notes ── */
  .notes {
    margin-top: 8px;
    font-size: 10.5px;
    color: #475569;
    border-top: 1px dashed #cbd5e1;
    padding-top: 6px;
  }

  /* ── Meta footer ── */
  .meta-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    font-size: 9px;
    color: #94a3b8;
    border-top: 1px solid #e2e8f0;
    padding-top: 5px;
  }

  @media print {
    .doc { max-width: 100%; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="doc">
  <!-- ── Header: TAX INVOICE title + company info ── -->
  <header>
    <div class="title-tax">فاتورة ضريبية / TAX Invoice</div>
    <div class="co-info">
      <span>${esc(d.companyNameAr)} ${esc(d.companyNameEn)}</span>
      <span>VAT: <b>${esc(d.companyVatNumber || "—")}</b></span>
      ${d.companyCrNumber ? `<span>CR: <b>${esc(d.companyCrNumber)}</b></span>` : ""}
      ${d.companyPhone ? `<span>${esc(d.companyPhone)}</span>` : ""}
    </div>
  </header>

  <!-- ── Invoice meta: number + date + client ── -->
  <div class="meta-row">
    <div class="meta-left">
      <span class="meta-label">Invoice Date / تاريخ الإصدار</span>
      <span class="meta-value">${esc(d.issueDate)}</span>
      ${d.dueDate ? `<span class="meta-label" style="margin-top:4px;display:block">Due Date / تاريخ الاستحقاق</span>
      <span class="meta-value" style="font-size:11px">${esc(d.dueDate)}</span>` : ""}
    </div>
    <div style="text-align:center">
      <span class="meta-label">Invoice NO / رقم الفاتورة</span>
      <span class="meta-value" style="font-size:16px">${esc(d.invoiceNumber)}</span>
      ${d.referenceNumber ? `<span class="meta-label" style="margin-top:4px;display:block">Ref / مرجع</span>
      <span class="meta-value" style="font-size:11px;direction:ltr">${esc(d.referenceNumber)}</span>` : ""}
    </div>
    <div class="meta-right">
      <span class="meta-label">Client / العميل</span>
      <span class="meta-value">${esc(d.partyTaxNumber || "—")}</span>
    </div>
  </div>

  <!-- ── Client details box ── -->
  <div class="client-box">
    <h3>بيانات المشتري / Buyer Details</h3>
    <p><b>${esc(d.partyNameAr)}</b> ${d.partyNameEn ? `— ${esc(d.partyNameEn)}` : ""}</p>
    ${d.partyTaxNumber ? `<p>VAT: <span style="direction:ltr;display:inline">${esc(d.partyTaxNumber)}</span></p>` : ""}
    ${d.partyAddress ? `<p>${esc(d.partyAddress)}</p>` : ""}
    ${d.partyPhone ? `<p>Phone: <span style="direction:ltr;display:inline">${esc(d.partyPhone)}</span></p>` : ""}
  </div>

  <!-- ── Items table (RTL columns: right to left) ── -->
  <table class="items">
    <thead>
      <tr>
        <th style="width:4%">#</th>
        <th>Item / الصنف</th>
        <th style="width:12%">Price / السعر</th>
        <th style="width:7%">Qty / الكمية</th>
        <th style="width:8%">VAT%</th>
        <th style="width:12%">VAT Amount / الضريبة</th>
        <th style="width:13%">Total With VAT / الإجمالي</th>
      </tr>
    </thead>
    <tbody>${linesRows}</tbody>
  </table>

  <!-- ── Totals section ── -->
  <div class="totals-section">
    <div class="totals-left">
      ${d.notes ? `<div class="notes"><b>ملاحظات / Notes:</b> ${esc(d.notes)}</div>` : ""}
      ${d.bankIban ? `<div class="payment-info">
        <b>تفاصيل الدفع / Payment Details</b><br/>
        IBAN: <span class="iban">${esc(d.bankIban)}</span>
      </div>` : ""}
    </div>
    <div class="totals-right">
      <table class="totals-table">
        <tbody>
          <tr>
            <td class="lbl">Total Before VAT / المجموع قبل الضريبة</td>
            <td class="val">${moneyNoCurrency(d.subtotal)} ${esc(d.currency)}</td>
          </tr>
          ${d.discount > 0 ? `<tr>
            <td class="lbl">Discount / الخصم</td>
            <td class="val">-${moneyNoCurrency(d.discount)} ${esc(d.currency)}</td>
          </tr>` : ""}
          <tr>
            <td class="lbl">VAT (${d.lines[0]?.vat_rate ?? 15}%) / ضريبة القيمة المضافة</td>
            <td class="val">${moneyNoCurrency(d.vatAmount)} ${esc(d.currency)}</td>
          </tr>
          <tr class="grand">
            <td>Total After VAT / الإجمالي شامل الضريبة</td>
            <td class="val">${moneyNoCurrency(d.total)} ${esc(d.currency)}</td>
          </tr>
          ${(d.paidAmount ?? 0) > 0 ? `<tr class="paid">
            <td class="lbl">Paid / المدفوع</td>
            <td class="val">${moneyNoCurrency(d.paidAmount)} ${esc(d.currency)}</td>
          </tr>` : ""}
          <tr class="due">
            <td class="lbl">Due Amount /المبلغ المستحق</td>
            <td class="val">${moneyNoCurrency(dueAmount)} ${esc(d.currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── QR + Signatures ── -->
  <div class="bottom-row">
    <div class="qr-block">
      <img src="${esc(d.qrDataUrl)}" alt="QR" />
      <div class="qr-verify">
        رمز التحقق — مسح للتحقق<br/>
        Verification QR
        <b>${esc(d.verifyUrl)}</b>
      </div>
    </div>
    <div class="signatures">
      <div class="sig"><div class="line">توقيع المستلم / Receiver</div></div>
      <div class="sig"><div class="line">المدير — التوقيع والختم / Manager</div></div>
    </div>
  </div>

  <!-- ── Meta footer ── -->
  <div class="meta-footer">
    <span dir="ltr">Generated: ${esc(d.generatedAt)}</span>
    <span>${esc(d.statusLabelAr)} / ${esc(d.statusLabelEn)}</span>
    <span>وثيقة صادرة من ${esc(d.companyNameAr)}</span>
  </div>
</div>
</body>
</html>`
}
