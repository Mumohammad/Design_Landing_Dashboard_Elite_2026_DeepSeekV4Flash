import { RIYAL_SYMBOL } from "./riyal-symbol"

// Reference invoice layout: Letter, 9pt Tahoma, monochrome RTL tables.
// Rendering is pure; amounts are authoritative stored invoice values.
export interface InvoiceDocLine {
  line_no: number; itemName?: string; description: string; quantity: number
  unit_price: number; discount: number; amount: number; vat_rate: number; vat_amount: number
}
export interface InvoiceDocData {
  kind: "invoice" | "credit_note" | "debit_note"
  docTypeAr: string; docTypeEn: string; invoiceNumber: string; referenceNumber?: string | null
  companyNameAr: string; companyNameEn: string; companyVatNumber: string; companyCrNumber?: string | null
  companyPhone?: string | null; companyAddress: string; companyCity: string; logoDataUrl?: string
  partyNameAr: string; partyNameEn: string; partyTaxNumber: string; partyAddress: string; partyPhone: string
  issueDate: string; dueDate: string | null; currency: string; lines: InvoiceDocLine[]
  subtotal: number; discount: number; vatAmount: number; total: number; paidAmount?: number
  notes?: string | null; statusLabelAr: string; statusLabelEn: string
  qrDataUrl: string; verifyUrl: string; generatedAt: string
  /** Explicit disclosure for the current internal QR, preserved on saved PDFs. */
  internalQr: boolean
  bankIban?: string | null; bankName?: string | null; bankBeneficiary?: string | null
}
function esc(value: string | null | undefined): string {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function number(value: number, precision = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision })
}
function date(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value
}
function imageSource(value: string | undefined): string {
  return value && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : ""
}
export function buildInvoiceHtml(d: InvoiceDocData): string {
  const rates = [...new Set(d.lines.map((line) => line.vat_rate))]
  const vatLabel = rates.length === 1 ? `${rates[0]}%` : ""
  const money = (value: number) => `<span class="money" aria-label="${esc(d.currency)} ${number(value)}">${d.currency === "SAR" ? RIYAL_SYMBOL : esc(d.currency)} ${number(value)}</span>`
  const rows = d.lines.map((line) => `<tr>
    <td class="item">${esc(line.itemName ?? String(line.line_no))}</td>
    <td class="description">${esc(line.description)}</td>
    <td class="number">${line.unit_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
    <td class="number">${line.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
    <td class="number">${number(line.amount)}</td>
    <td class="number">${line.vat_rate}%</td>
    <td class="number">${number(line.vat_amount)}</td>
    <td class="number">${number(line.amount + line.vat_amount)}</td>
  </tr>`).join("")
  // Some imported invoices have an explicit post-tax adjustment. Never apply
  // line discounts twice: canonical invoices already include them in subtotal.
  const adjustment = Math.round((d.subtotal + d.vatAmount - d.total) * 100) / 100
  const exceptionalStatus = /draft|cancelled/i.test(d.statusLabelEn)
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>فاتورة رقم ${esc(d.invoiceNumber)} - ${esc(d.companyNameAr)}</title>
<style>
@page { size: Letter; margin: 30pt 62.25pt; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: black; }
body { font-family: Tahoma, Arial, sans-serif; font-size: 9pt; line-height: 10.5pt; }
.doc { width: 487.5pt; margin: 0 auto; }
.header { display: grid; direction: ltr; grid-template-columns: 150pt 225pt 112.5pt; min-height: 154.5pt; border-bottom: 2.25pt double black; }
.title { text-align: left; font-size: 16.5pt; font-weight: 700; line-height: 20.25pt; }
.qr { display: block; width: 67.5pt; height: 67.5pt; margin-top: 7.5pt; }
.company { direction: rtl; text-align: right; padding-right: 30pt; line-height: 12.75pt; }
.company h1 { margin: 0 0 3pt; font-size: 12pt; line-height: 15pt; }
.logo { width: 112.5pt; height: 112.5pt; object-fit: contain; }
.meta { display: flex; direction: ltr; justify-content: space-between; gap: 20pt; min-height: 87pt; padding-top: 18.75pt; padding-bottom: 19.25pt; }
.invoice-meta { display: grid; grid-template-columns: 46.2pt 67.5pt; align-content: start; align-items: center; gap: 0 15pt; }
.invoice-meta strong { direction: rtl; text-align: left; line-height: 10.5pt; }
.invoice-meta span { text-align: right; direction: ltr; }
.client { display: flex; direction: rtl; gap: 15pt; text-align: right; max-width: 285pt; }
.client-label { min-width: 28pt; font-weight: bold; }
.client-detail { padding-top: 5.25pt; direction: rtl; white-space: pre-line; overflow-wrap: anywhere; }
.items { width: 100%; border: .75pt solid black; border-collapse: collapse; table-layout: fixed; direction: rtl; }
.items th { height: 51.75pt; padding: 4pt 3pt; text-align: center; vertical-align: middle; font-size: 9pt; line-height: 10.5pt; border-top: .75pt solid; border-bottom: .75pt solid; }
.items th:first-child { border-right: .75pt solid; } .items th:last-child { border-left: .75pt solid; }
.items td { border: .75pt solid #555; vertical-align: top; padding: 4pt 3pt; line-height: 10.5pt; overflow-wrap: anywhere; }
.items tbody tr { min-height: 50.25pt; break-inside: avoid; }
.items thead { display: table-header-group; } .items .description { white-space: pre-line; text-align: right; }
.items .item { text-align: right; } .number { text-align: center; direction: ltr; }
.totals { direction: rtl; width: 195pt; margin-right: auto; margin-top: -.75pt; border-collapse: collapse; break-inside: avoid; }
.totals th { width: 125pt; text-align: right; font-size: 9pt; }
.totals td { text-align: right; width: 70pt; vertical-align: top; }
.totals th, .totals td { border-bottom: .5pt solid; padding: 3.75pt 4.5pt; line-height: 10.5pt; }
.totals td { padding-right: 5.5pt; }
.totals .grand th, .totals .grand td { font-weight: bold; border-bottom-width: 1pt; }
.money { white-space: nowrap; direction: ltr; display: inline-block; }
.riyal { display: inline-block; width: 8pt; height: 9pt; vertical-align: -.5pt; }
.bank { margin-top: 39pt; text-align: right; font-style: italic; line-height: 10.5pt; break-inside: avoid; }
.bank bdi { overflow-wrap: anywhere; } .notes { margin-top: 14pt; white-space: pre-line; overflow-wrap: anywhere; }
.status { font-size: 9pt; line-height: 12pt; } .supplement { margin-top: 8pt; font-size: 8pt; }
@media screen { body { padding: 30pt 0; } }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body><main class="doc">
<header class="header">
  <div class="title">${d.kind === "invoice" ? "فاتورة ضريبية<br>TAX Invoice" : `${esc(d.docTypeAr)}<br>${esc(d.docTypeEn)}`}
    <img src="${imageSource(d.qrDataUrl)}" class="qr" alt="${d.internalQr ? "Internal invoice QR" : "Invoice QR"}" />
    ${exceptionalStatus ? `<div class="status">${esc(d.statusLabelAr)} / ${esc(d.statusLabelEn)}</div>` : ""}
  </div>
  <div class="company"><h1>${esc(d.companyNameAr || d.companyNameEn)}</h1>
    <div>الرقم الضريبي : <bdi>${esc(d.companyVatNumber || "—")}</bdi></div>
    ${d.companyPhone ? `<div>هاتف : <bdi>${esc(d.companyPhone)}</bdi></div>` : ""}
    <div>${esc(d.companyAddress).replace(/\n/g, "<br>")}</div><div>${esc(d.companyCity)}</div>
  </div>
  ${imageSource(d.logoDataUrl) ? `<img class="logo" src="${imageSource(d.logoDataUrl)}" alt="${esc(d.companyNameAr)}" />` : '<div></div>'}
</header>
<section class="meta">
  <div class="invoice-meta"><span>${esc(d.invoiceNumber)}</span><strong>رقم الفاتورة<br>Invoice NO</strong>
    <span>${esc(date(d.issueDate))}</span><strong>تاريخ الفاتورة<br>Invoice Date</strong></div>
  <div class="client"><div class="client-label">العميل<br>Client</div><div class="client-detail"><strong>${esc(d.partyNameAr || d.partyNameEn)}</strong>${d.partyTaxNumber ? `<br>الرقم الضريبي <bdi>${esc(d.partyTaxNumber)}</bdi>` : ""}${d.partyAddress ? `<br>${esc(d.partyAddress)}` : ""}</div></div>
</section>
<table class="items"><colgroup><col style="width:35.25pt"><col style="width:66.75pt">${'<col style="width:66pt">'.repeat(5)}<col style="width:54.75pt"></colgroup>
<thead><tr><th>البند<br>Item</th><th>الوصف<br>Description</th><th>السعر<br>Price</th><th>الكمية<br>Qty</th><th>المجموع قبل الضريبة<br>Total Before Tax</th><th>نسبة الضريبة<br>VAT ${esc(vatLabel)}</th><th>قيمة الضريبة<br>VAT Amount</th><th>المجموع مع الضريبة<br>Total With VAT</th></tr></thead>
<tbody>${rows}</tbody></table>
<table class="totals"><tbody>
<tr><th>الإجمالي قبل الضريبة<br>Total Before VAT</th><td>${money(d.subtotal)}</td></tr>
<tr><th>القيمة المضافة ${vatLabel ? `(${esc(vatLabel)})` : ""}</th><td>${money(d.vatAmount)}</td></tr>
${adjustment !== 0 ? `<tr><th>${adjustment > 0 ? "خصم من إجمالي الفاتورة" : "تعديل إجمالي الفاتورة"}</th><td>${money(-adjustment)}</td></tr>` : d.discount > 0 ? `<tr><th>خصم البنود (مضمن)<br>Line discount (included)</th><td>${money(-d.discount)}</td></tr>` : ""}
<tr class="grand"><th>الإجمالي بعد الضريبة<br>Total After VAT</th><td>${money(d.total)}</td></tr>
<tr><th>مدفوع<br>Paid</th><td>${money(d.paidAmount ?? 0)}</td></tr>
<tr><th>الرصيد المستحق<br>Due Amount</th><td>${money(Math.max(0, d.total - (d.paidAmount ?? 0)))}</td></tr>
</tbody></table>
${d.bankIban ? `<section class="bank">معلومات الحساب البنكي:<br>اسم البنك : ${esc(d.bankName)}<br>اسم المستفيد : ${esc(d.bankBeneficiary)}<br>رقم الايبان : <bdi dir="ltr">${esc(d.bankIban)}</bdi></section>` : ""}
${d.notes ? `<section class="notes">${esc(d.notes)}</section>` : ""}
${d.referenceNumber ? `<div class="supplement">مرجع / Ref: ${esc(d.referenceNumber)}</div>` : ""}
${d.internalQr ? '<div class="supplement" role="note">الرمز داخلي وغير معتمد للفوترة الإلكترونية لدى الهيئة.<br>Internal QR only. ZATCA electronic invoicing has not been validated.</div>' : ""}
</main></body></html>`
}
