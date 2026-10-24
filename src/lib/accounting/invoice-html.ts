import { RIYAL_SYMBOL } from "./riyal-symbol"

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
  /** Licensed Arabic fallback for hosts without the reference's Tahoma font. */
  fontDataUrl?: string
  /** Operator-licensed reference fonts, supplied only by the server renderer. */
  referenceFontDataUrl?: string; referenceBoldFontDataUrl?: string
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

/** Reference geometry is measured in PDF points: Letter, a 487.5pt content
 * width and eight separate item columns. All business data remains dynamic. */
export function buildInvoiceHtml(d: InvoiceDocData): string {
  const rates = [...new Set(d.lines.map((line) => line.vat_rate))]
  const vatLabel = rates.length === 1 ? `${rates[0]}%` : ""
  const money = (value: number) => `<span class="money" aria-label="${esc(d.currency)} ${number(value)}">${d.currency === "SAR" ? RIYAL_SYMBOL : esc(d.currency)} ${number(value)}</span>`
  const label = (ar: string, en: string) => `<span>${ar}</span><span lang="en" dir="ltr">${en}</span>`
  const rows = d.lines.map((line) => `<tr>
    <td class="item" dir="auto">${esc(line.itemName)}${line.discount > 0 ? `<small>خصم / Discount: <bdi>${number(line.discount)}</bdi></small>` : ""}</td>
    <td class="description" dir="auto">${esc(line.description)}</td>
    <td class="number">${line.unit_price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
    <td class="number">${line.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
    <td class="number">${number(line.amount)}</td>
    <td class="number">${line.vat_rate}%</td>
    <td class="number">${number(line.vat_amount)}</td>
    <td class="number">${number(line.amount + line.vat_amount)}</td>
  </tr>`).join("")
  // Stored line amounts already include line discounts. Imported post-tax
  // adjustments are a separate row; never subtract a line discount twice.
  const adjustment = Math.round((d.subtotal + d.vatAmount - d.total) * 100) / 100
  const exceptionalStatus = /draft|cancelled/i.test(d.statusLabelEn)
  const font = d.fontDataUrl && /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(d.fontDataUrl) ? d.fontDataUrl : ""
  const referenceFace = (value: string | undefined, weight: number) => value && /^data:font\/(ttf|woff2);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? `@font-face { font-family: "Invoice Reference"; src: url("${value}") format("${value.startsWith("data:font/ttf;") ? "truetype" : "woff2"}"); font-weight: ${weight}; font-style: normal; font-display: block; }` : ""
  const qr = imageSource(d.qrDataUrl)
  const paid = d.paidAmount ?? 0
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>فاتورة رقم ${esc(d.invoiceNumber)} - ${esc(d.companyNameAr)}</title>
<style>
@page { size: Letter; margin: 30pt 62.25pt; }
${font ? `@font-face { font-family: "Invoice Arabic"; src: url("${font}") format("woff2"); font-weight: 200 1000; font-style: normal; font-display: block; }` : ""}
${referenceFace(d.referenceFontDataUrl, 400)}
${referenceFace(d.referenceBoldFontDataUrl, 700)}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: "Invoice Reference", Tahoma, "Invoice Arabic", Arial, sans-serif; font-size: 9pt; line-height: 10.5pt; }
.doc { width: 487.5pt; max-width: 100%; margin: 0 auto; }
h1, h2, p { margin: 0; }
small { display: block; font-size: 7pt; line-height: 9pt; }
.header { display: grid; grid-template-columns: 128.25pt minmax(0, 214.95pt) 31.8pt 112.5pt; direction: ltr; min-height: 154.5pt; border-bottom: 2.25pt double #000; align-items: start; break-inside: avoid; }
.identity { direction: rtl; text-align: left; }
.title { font-size: 16.5pt; line-height: 20.25pt; font-weight: 700; }
.title span { display: block; }
.qr-block { width: 94pt; margin: 7.5pt auto 0 0; direction: ltr; }
.qr { display: block; width: 67.5pt; height: 67.5pt; }
.qr-block small { text-align: left; margin-top: 3pt; font-size: 6pt; line-height: 8pt; }
.brand { direction: rtl; text-align: right; overflow-wrap: anywhere; line-height: 12.75pt; }
.brand h1 { font-size: 12pt; line-height: 18pt; font-weight: 700; }
.brand .english { font-size: 8pt; }
.company-address { white-space: pre-line; }
.logo { grid-column: 4; width: 112.5pt; height: 112.5pt; object-fit: contain; }
.parties { display: flex; direction: ltr; justify-content: space-between; gap: 12pt; min-height: 87pt; padding: 18.75pt 0 21pt; break-inside: avoid; }
.metadata { border-collapse: collapse; direction: rtl; width: 150pt; flex-shrink: 0; align-self: start; table-layout: fixed; }
.metadata th { width: 88.805pt; padding: 0; text-align: left; font-weight: 700; }
.metadata td { width: 61.195pt; text-align: right; padding: 0 15pt 0 0; direction: ltr; overflow-wrap: anywhere; }
.metadata th, .metadata td { padding-top: 0; padding-bottom: 0; vertical-align: middle; line-height: 10.5pt; }
.metadata th span { display: block; }
.metadata .date { white-space: nowrap; }
.party { display: flex; direction: rtl; gap: 7.5pt; min-width: 0; text-align: right; }
.party-title { font-size: 9pt; line-height: 10.5pt; width: 35.25pt; flex-shrink: 0; }
.party-title span { display: block; }
.party-details { padding-top: 5.25pt; min-width: 0; overflow-wrap: anywhere; }
.party-name { font-weight: 700; }
.party-address { white-space: pre-line; }
.status { margin: 0 0 8pt; font-weight: 700; border: .75pt solid #000; padding: 4pt 6pt; break-inside: avoid; }
.items { width: 100%; border-collapse: collapse; table-layout: fixed; direction: rtl; }
.items thead { display: table-header-group; }
.items th { height: 51.75pt; border-top: .75pt solid #000; border-bottom: .75pt solid #000; padding: 4.5pt 2.25pt; text-align: center; vertical-align: middle; font-size: 9pt; line-height: 10.5pt; font-weight: 700; }
.items th span { display: block; }
.items th:first-child { border-right: .75pt solid #000; }
.items th:last-child { border-left: .75pt solid #000; }
.items .description { text-align: right; }
.items td { border: .75pt solid #000; padding: 3.75pt 4.5pt 3.75pt; vertical-align: top; font-size: 9pt; line-height: 10.5pt; }
.items tbody tr { break-inside: avoid; page-break-inside: avoid; }
.items .item, .items .description { white-space: pre-line; overflow-wrap: anywhere; }
.items .item { text-align: center; }
.number { text-align: center; direction: ltr; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.summary { margin-top: -.75pt; direction: ltr; break-inside: avoid; page-break-inside: avoid; }
.totals { width: 195pt; border-collapse: collapse; table-layout: fixed; direction: rtl; }
.totals th { width: 126pt; text-align: right; font-weight: 700; }
.totals td { width: 69pt; text-align: right; }
.totals th, .totals td { border-bottom: .75pt solid #000; padding: 4.5pt 4.5pt 3pt; vertical-align: top; line-height: 10.5pt; }
.totals th span { display: block; }
.totals .grand th, .totals .grand td { border-top: .75pt solid #000; font-weight: 700; }
.totals tr:last-child th, .totals tr:last-child td { border-bottom: .75pt solid #000; }
.money { white-space: nowrap; direction: ltr; display: inline-block; font-variant-numeric: tabular-nums; }
.riyal { display: inline-block; width: .8em; height: .95em; vertical-align: -.05em; }
.discount-note { margin-top: 5pt; font-size: 7pt; direction: rtl; text-align: left; }
.bank { margin-top: 40.912pt; text-align: right; font-style: italic; line-height: 10.5pt; overflow-wrap: anywhere; break-inside: avoid; page-break-inside: avoid; }
.bank h2 { font-size: 9pt; font-weight: 400; }
.notes { margin-top: 15pt; white-space: pre-line; overflow-wrap: anywhere; }
.notes h2 { font-size: 9pt; }
@media screen { body { padding: 30pt 20pt; } }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body><main class="doc">
<header class="header">
 <div class="identity"><h2 class="title">${d.kind === "invoice" ? label("فاتورة ضريبية", "TAX Invoice") : label(esc(d.docTypeAr), esc(d.docTypeEn))}</h2>${qr ? `<div class="qr-block"><img src="${qr}" class="qr" alt="${d.internalQr ? "Internal invoice QR" : "Invoice QR"}" />${d.internalQr ? '<small role="note">رمز داخلي · غير معتمد<br>Internal QR · unvalidated</small>' : ""}</div>` : ""}</div>
 <div class="brand"><h1>${esc(d.companyNameAr || d.companyNameEn)}</h1>${d.companyNameEn && d.companyNameAr ? `<div class="english" lang="en" dir="ltr">${esc(d.companyNameEn)}</div>` : ""}${d.companyVatNumber ? `<div>الرقم الضريبي : <bdi dir="ltr">${esc(d.companyVatNumber)}</bdi></div>` : ""}${d.companyPhone ? `<div>هاتف : <bdi dir="ltr">${esc(d.companyPhone)}</bdi></div>` : ""}<div class="company-address" dir="auto">${esc([d.companyAddress, d.companyCity].filter(Boolean).join("\n"))}</div>${d.companyCrNumber ? `<div>س.ت / CR: <bdi dir="ltr">${esc(d.companyCrNumber)}</bdi></div>` : ""}</div>
 ${imageSource(d.logoDataUrl) ? `<img class="logo" src="${imageSource(d.logoDataUrl)}" alt="${esc(d.companyNameAr)}" />` : ""}
</header>
<section class="parties"><table class="metadata"><tbody><tr><th>${label("رقم الفاتورة", "Invoice NO")}</th><td><bdi>${esc(d.invoiceNumber)}</bdi></td></tr><tr><th>${label("تاريخ الفاتورة", "Invoice Date")}</th><td><bdi class="date">${esc(date(d.issueDate))}</bdi></td></tr>${d.dueDate ? `<tr><th>${label("تاريخ الاستحقاق", "Due Date")}</th><td><bdi class="date">${esc(date(d.dueDate))}</bdi></td></tr>` : ""}${d.currency !== "SAR" ? `<tr><th>${label("العملة", "Currency")}</th><td><bdi>${esc(d.currency)}</bdi></td></tr>` : ""}${d.referenceNumber ? `<tr><th>${label("مرجع المستند", "Document reference")}</th><td><bdi>${esc(d.referenceNumber)}</bdi></td></tr>` : ""}</tbody></table>
<div class="party"><h2 class="party-title">${label("العميل", "Client")}</h2><div class="party-details"><p class="party-name" dir="auto">${esc(d.partyNameAr || d.partyNameEn)}</p>${d.partyNameEn && d.partyNameAr && d.partyNameEn !== d.partyNameAr ? `<div lang="en" dir="ltr">${esc(d.partyNameEn)}</div>` : ""}${d.partyTaxNumber ? `<div>الرقم الضريبي <bdi dir="ltr">${esc(d.partyTaxNumber)}</bdi></div>` : ""}<div class="party-address" dir="auto">${esc(d.partyAddress)}</div>${d.partyPhone ? `<div><bdi dir="ltr">${esc(d.partyPhone)}</bdi></div>` : ""}</div></div>
</section>
${exceptionalStatus ? `<div class="status">${esc(d.statusLabelAr)} / ${esc(d.statusLabelEn)}</div>` : ""}
<table class="items"><colgroup><col style="width:35.25pt"><col style="width:66.75pt"><col style="width:66pt"><col style="width:66pt"><col style="width:66pt"><col style="width:66pt"><col style="width:66pt"><col style="width:54.75pt"></colgroup>
<thead><tr><th>${label("البند", "Item")}</th><th class="description">${label("الوصف", "Description")}</th><th>${label("السعر", "Price")}</th><th>${label("الكمية", "Qty")}</th><th>${label("المجموع قبل الضريبة", "Total Before Tax")}</th><th>${label("نسبة الضريبة", `VAT${vatLabel ? ` ${esc(vatLabel)}` : ""}`)}</th><th>${label("قيمة الضريبة", "VAT Amount")}</th><th>${label("المجموع<br>مع الضريبة", "Total With VAT")}</th></tr></thead><tbody>${rows}</tbody></table>
<section class="summary"><table class="totals"><tbody>
<tr><th>${label("الإجمالي قبل الضريبة", "Total Before VAT")}</th><td>${money(d.subtotal)}</td></tr>
<tr><th>القيمة المضافة${vatLabel ? ` (${esc(vatLabel)})` : ""}</th><td>${money(d.vatAmount)}</td></tr>
${adjustment !== 0 ? `<tr><th>${adjustment > 0 ? "خصم من إجمالي الفاتورة" : "تعديل إجمالي الفاتورة"}</th><td>${money(-adjustment)}</td></tr>` : ""}
<tr class="grand"><th>${label("الإجمالي بعد الضريبة", "Total After VAT")}</th><td>${money(d.total)}</td></tr>
<tr><th>${label("مدفوع", "Paid")}</th><td>${money(paid)}</td></tr><tr><th>${label("الرصيد المستحق", "Due Amount")}</th><td>${money(Math.max(0, d.total - paid))}</td></tr>
</tbody></table>${adjustment === 0 && d.discount > 0 ? `<p class="discount-note">خصم البنود مشمول / Line discount included: ${money(d.discount)}</p>` : ""}</section>
${d.bankIban ? `<section class="bank"><h2>معلومات الحساب البنكي:</h2>${d.bankName ? `<div>اسم البنك : ${esc(d.bankName)}</div>` : ""}${d.bankBeneficiary ? `<div>اسم المستفيد : ${esc(d.bankBeneficiary)}</div>` : ""}<div>رقم الآيبان : <bdi dir="ltr">${esc(d.bankIban)}</bdi></div></section>` : ""}
${d.notes ? `<section class="notes"><h2>${label("ملاحظات", "Notes")}</h2><div dir="auto">${esc(d.notes)}</div></section>` : ""}
</main></body></html>`
}
