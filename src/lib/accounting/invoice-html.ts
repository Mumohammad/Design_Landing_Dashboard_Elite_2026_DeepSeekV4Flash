import { RIYAL_SYMBOL } from "./riyal-symbol"

// Bilingual A4 invoice. Rendering is pure; stored financial values are authoritative.
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
  /** Embedded licensed font keeps Arabic shaping consistent in saved PDFs. */
  fontDataUrl?: string
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
    <td class="description"><div class="line-heading"><span class="line-number">${line.line_no}</span><div>${line.itemName ? `<strong dir="auto">${esc(line.itemName)}</strong>` : ""}<div dir="auto">${esc(line.description)}</div>${line.discount > 0 ? `<small>خصم / Discount: <bdi>${number(line.discount)}</bdi></small>` : ""}</div></div></td>
    <td class="number">${line.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
    <td class="number">${line.unit_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
    <td class="number">${number(line.amount)}</td>
    <td class="number">${number(line.vat_amount)}<small>${line.vat_rate}%</small></td>
    <td class="number">${number(line.amount + line.vat_amount)}</td>
  </tr>`).join("")
  // Some imported invoices have an explicit post-tax adjustment. Never apply
  // line discounts twice: canonical invoices already include them in subtotal.
  const adjustment = Math.round((d.subtotal + d.vatAmount - d.total) * 100) / 100
  const exceptionalStatus = /draft|cancelled/i.test(d.statusLabelEn)
  const font = d.fontDataUrl && /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(d.fontDataUrl) ? d.fontDataUrl : ""
  const qr = imageSource(d.qrDataUrl)
  const label = (ar: string, en: string) => `<span>${ar}</span><small lang="en">${en}</small>`
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>فاتورة رقم ${esc(d.invoiceNumber)} - ${esc(d.companyNameAr)}</title>
<style>
@page { size: A4; margin: 14mm 16mm; }
${font ? `@font-face { font-family: "Invoice Cairo"; src: url("${font}") format("woff2"); font-weight: 200 1000; font-style: normal; font-display: block; }` : ""}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: #162f49; }
body { font-family: "Invoice Cairo", Tahoma, Arial, sans-serif; font-size: 9pt; line-height: 1.55; }
.doc { width: 100%; margin: 0 auto; }
small { display: block; font-size: 7.5pt; color: #53697b; font-weight: 400; }
.header { display: flex; justify-content: space-between; align-items: center; gap: 24pt; padding-bottom: 14pt; border-bottom: 1.5pt solid #163f63; break-inside: avoid; }
.brand { display: flex; align-items: center; gap: 12pt; min-width: 0; }
.brand h1 { margin: 0; font-size: 15pt; line-height: 1.55; overflow-wrap: anywhere; }
.brand p { margin: 2pt 0 0; font-size: 9pt; color: #53697b; }
.logo { width: 72pt; height: 72pt; object-fit: contain; flex-shrink: 0; }
.identity { text-align: left; flex-shrink: 0; max-width: 215pt; }
.title { margin: 0; font-size: 24pt; font-weight: 700; line-height: 1.25; }
.title small { font-size: 10pt; color: #163f63; }
.invoice-number { display: block; margin-top: 6pt; font-size: 11pt; font-weight: 600; overflow-wrap: anywhere; }
.status { display: inline-block; margin-top: 5pt; border: .75pt solid #163f63; padding: 2pt 8pt; font-size: 8pt; }
.exceptional { border-color: #72501b; color: #72501b; font-weight: 700; }
.dates { display: flex; gap: 28pt; padding: 10pt 0; border-bottom: .5pt solid #c5d0da; break-inside: avoid; }
.dates strong { display: block; font-size: 9pt; }
.dates small { margin-bottom: 3pt; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 30pt; padding: 14pt 0; break-inside: avoid; }
.party-title { margin: 0 0 8pt; font-size: 10pt; color: #163f63; }
.party-name { margin: 0 0 4pt; font-size: 11pt; font-weight: 700; overflow-wrap: anywhere; }
.party-detail { color: #324d63; white-space: pre-line; overflow-wrap: anywhere; }
.detail-line { margin-top: 3pt; }
.items { width: 100%; border-collapse: collapse; table-layout: fixed; direction: rtl; }
.items th { background: #163f63; color: white; padding: 9pt 5pt; text-align: center; vertical-align: middle; font-size: 8.2pt; line-height: 1.5; }
.items th small { color: #e1ebf2; font-size: 7pt; }
.items th:first-child { text-align: right; padding-right: 9pt; }
.items td { border-bottom: .5pt solid #c5d0da; padding: 11pt 5pt; vertical-align: top; font-size: 8pt; }
.items tbody tr { break-inside: avoid; }
.items thead { display: table-header-group; }
.items .description { text-align: right; white-space: pre-line; overflow-wrap: anywhere; font-size: 9pt; padding-right: 8pt; }
.line-heading { display: flex; gap: 6pt; }
.line-number { color: #53697b; font-size: 7.5pt; min-width: 9pt; padding-top: 1pt; }
.number { text-align: center; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
.number small { margin-top: 3pt; }
.items td:last-child { font-weight: 700; }
.summary { display: grid; grid-template-columns: 1fr 235pt; direction: rtl; gap: 24pt; margin-top: 14pt; align-items: start; break-inside: avoid; }
.qr-block { text-align: center; width: 78pt; }
.qr { display: block; width: 70pt; height: 70pt; margin: 0 auto 4pt; }
.qr-block small { font-size: 6.8pt; line-height: 1.6; }
.totals { width: 100%; border-collapse: collapse; }
.totals th { text-align: right; font-size: 9pt; font-weight: 400; }
.totals td { text-align: left; vertical-align: middle; }
.totals th, .totals td { padding: 4pt 0; }
.totals .grand th, .totals .grand td { border-top: 1pt solid #163f63; border-bottom: 1pt solid #163f63; padding: 10pt 0; font-weight: 700; }
.totals .grand td { font-size: 16pt; }
.discount-note { font-size: 8pt; color: #53697b; margin: 5pt 0 0; }
.money { white-space: nowrap; direction: ltr; display: inline-block; font-variant-numeric: tabular-nums; }
.riyal { display: inline-block; width: .8em; height: .95em; vertical-align: -.05em; }
.bank { margin-top: 18pt; padding-top: 12pt; border-top: .5pt solid #c5d0da; break-inside: avoid; }
.bank h2, .notes h2 { margin: 0 0 7pt; font-size: 10pt; }
.bank-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt 24pt; }
.iban { grid-column: 1 / -1; }
.iban bdi { font-size: 11pt; letter-spacing: .3pt; overflow-wrap: anywhere; }
.notes { margin-top: 17pt; white-space: pre-line; overflow-wrap: anywhere; }
@media screen { body { padding: 32px; } .doc { max-width: 178mm; } }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body><main class="doc">
<header class="header">
  <div class="brand">${imageSource(d.logoDataUrl) ? `<img class="logo" src="${imageSource(d.logoDataUrl)}" alt="${esc(d.companyNameAr)}" />` : ""}<div><h1>${esc(d.companyNameAr || d.companyNameEn)}</h1>${d.companyNameEn && d.companyNameAr ? `<p lang="en" dir="ltr">${esc(d.companyNameEn)}</p>` : ""}</div></div>
  <div class="identity"><h2 class="title">${d.kind === "invoice" ? label("فاتورة ضريبية", "Tax Invoice") : label(esc(d.docTypeAr), esc(d.docTypeEn))}</h2><bdi class="invoice-number" dir="ltr">${esc(d.invoiceNumber)}</bdi><div class="status${exceptionalStatus ? " exceptional" : ""}">${esc(d.statusLabelAr)} / ${esc(d.statusLabelEn)}</div></div>
</header>
<section class="dates"><div>${label("تاريخ الإصدار", "Issue date")}<strong><bdi>${esc(date(d.issueDate))}</bdi></strong></div>${d.dueDate ? `<div>${label("تاريخ الاستحقاق", "Due date")}<strong><bdi>${esc(date(d.dueDate))}</bdi></strong></div>` : ""}<div>${label("العملة", "Currency")}<strong><bdi>${esc(d.currency)}</bdi></strong></div>${d.referenceNumber ? `<div>${label("مرجع المستند", "Document reference")}<strong><bdi>${esc(d.referenceNumber)}</bdi></strong></div>` : ""}</section>
<section class="parties"><div><h2 class="party-title">${label("من", "From")}</h2><p class="party-name">${esc(d.companyNameAr || d.companyNameEn)}</p><div class="party-detail" dir="auto">${esc([d.companyAddress, d.companyCity].filter(Boolean).join("\n"))}</div>${d.companyVatNumber ? `<div class="detail-line">الرقم الضريبي / VAT: <bdi dir="ltr">${esc(d.companyVatNumber)}</bdi></div>` : ""}${d.companyCrNumber ? `<div class="detail-line">س.ت / CR: <bdi dir="ltr">${esc(d.companyCrNumber)}</bdi></div>` : ""}${d.companyPhone ? `<div class="detail-line"><bdi dir="ltr">${esc(d.companyPhone)}</bdi></div>` : ""}</div>
<div><h2 class="party-title">${label("إلى", "Bill to")}</h2><p class="party-name" dir="auto">${esc(d.partyNameAr || d.partyNameEn)}</p>${d.partyNameEn && d.partyNameAr && d.partyNameEn !== d.partyNameAr ? `<div lang="en" dir="ltr">${esc(d.partyNameEn)}</div>` : ""}<div class="party-detail" dir="auto">${esc(d.partyAddress)}</div>${d.partyTaxNumber ? `<div class="detail-line">الرقم الضريبي / VAT: <bdi dir="ltr">${esc(d.partyTaxNumber)}</bdi></div>` : ""}${d.partyPhone ? `<div class="detail-line"><bdi dir="ltr">${esc(d.partyPhone)}</bdi></div>` : ""}</div>
</section>
<table class="items"><colgroup><col style="width:30%"><col style="width:6%"><col style="width:15%"><col style="width:16%"><col style="width:15%"><col style="width:18%"></colgroup>
<thead><tr><th>${label("البند والوصف", "Item / Description")}</th><th>${label("الكمية", "Qty")}</th><th>${label("سعر الوحدة", "Unit price")}</th><th>${label("قبل الضريبة", "Net amount")}</th><th>${label("ضريبة القيمة المضافة", "VAT amount")}</th><th>${label("الإجمالي", "Total with VAT")}</th></tr></thead>
<tbody>${rows}</tbody></table>
<section class="summary"><div>${qr ? `<div class="qr-block"><img src="${qr}" class="qr" alt="${d.internalQr ? "Internal invoice QR" : "Invoice QR"}" />${d.internalQr ? '<small role="note">رمز داخلي · غير معتمد<br>Internal QR · unvalidated</small>' : ""}</div>` : ""}</div><div><table class="totals"><tbody>
<tr><th>${label("الإجمالي قبل الضريبة", "Net total")}</th><td>${money(d.subtotal)}</td></tr>
<tr><th>${label(`القيمة المضافة ${vatLabel ? `(${esc(vatLabel)})` : ""}`, "VAT total")}</th><td>${money(d.vatAmount)}</td></tr>
${adjustment !== 0 ? `<tr><th>${label(adjustment > 0 ? "خصم من الإجمالي" : "تعديل الإجمالي", "Total adjustment")}</th><td>${money(-adjustment)}</td></tr>` : ""}
<tr class="grand"><th>${label("الإجمالي", "Invoice total")}</th><td>${money(d.total)}</td></tr>
${(d.paidAmount ?? 0) > 0 ? `<tr><th>${label("المدفوع", "Paid")}</th><td>${money(d.paidAmount!)}</td></tr><tr><th>${label("المتبقي", "Balance due")}</th><td>${money(Math.max(0, d.total - (d.paidAmount ?? 0)))}</td></tr>` : ""}
</tbody></table>${adjustment === 0 && d.discount > 0 ? `<p class="discount-note">خصم البنود مشمول / Line discount included: ${money(d.discount)}</p>` : ""}</div></section>
${d.bankIban ? `<section class="bank"><h2>${label("تفاصيل التحويل البنكي", "Bank transfer details")}</h2><div class="bank-grid"><div><small>البنك / Bank</small><div dir="auto">${esc(d.bankName)}</div></div><div><small>المستفيد / Beneficiary</small><div dir="auto">${esc(d.bankBeneficiary)}</div></div><div class="iban"><small>رقم الآيبان / IBAN</small><bdi dir="ltr">${esc(d.bankIban)}</bdi></div></div></section>` : ""}
${d.notes ? `<section class="notes"><h2>${label("ملاحظات", "Notes")}</h2><div dir="auto">${esc(d.notes)}</div></section>` : ""}
</main></body></html>`
}
