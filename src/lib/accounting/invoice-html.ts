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
  /** Disclosure for a ZATCA-environment QR (sandbox/simulation evidence). */
  qrNote?: { ar: string; en: string } | null
  /** B2C sales (buyer without a VAT number) print as a Simplified Tax Invoice. */
  simplified?: boolean
  /** Embedded licensed font keeps Arabic shaping consistent in saved PDFs. */
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
/** Item column = explicit item name, else the first line of the description. */
function splitItem(line: InvoiceDocLine): { item: string; description: string } {
  if (line.itemName) return { item: line.itemName, description: line.description }
  const [first, ...rest] = line.description.split(/\r?\n/)
  return rest.length ? { item: first.trim(), description: rest.join("\n").trim() } : { item: line.description, description: "" }
}

// Layout mirrors the owner's reference tax invoice (Daftra template): logo,
// seller block and title + QR across the top, a double rule, customer and
// invoice meta, a fully bordered 8-column line table, a totals box on the
// left and the bank details at the foot.
export function buildInvoiceHtml(d: InvoiceDocData): string {
  const rates = [...new Set(d.lines.map((line) => line.vat_rate))]
  const vatLabel = rates.length === 1 ? `${rates[0]}%` : ""
  const money = (value: number) => `<span class="money" aria-label="${esc(d.currency)} ${number(value)}">${d.currency === "SAR" ? RIYAL_SYMBOL : esc(d.currency)} ${number(value)}</span>`
  const head = (ar: string, en: string) => `<span>${ar}</span><span lang="en">${en}</span>`
  const rows = d.lines.map((line) => {
    const { item, description } = splitItem(line)
    return `<tr>
    <td class="text" dir="auto">${esc(item)}</td>
    <td class="text" dir="auto">${esc(description)}${line.discount > 0 ? `<small>خصم / Discount: <bdi>${number(line.discount)}</bdi></small>` : ""}</td>
    <td class="number">${line.unit_price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
    <td class="number">${line.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
    <td class="number">${number(line.amount)}</td>
    <td class="number">${line.vat_rate}%</td>
    <td class="number">${number(line.vat_amount)}</td>
    <td class="number">${number(line.amount + line.vat_amount)}</td>
  </tr>`
  }).join("")
  // Imported invoices may carry a post-tax adjustment (e.g. Daftra's
  // "discount from invoice total"). Canonical invoices apply line discounts
  // before VAT, so they are already inside the subtotal — never twice.
  const adjustment = Math.round((d.subtotal + d.vatAmount - d.total) * 100) / 100
  const exceptionalStatus = /draft|cancelled/i.test(d.statusLabelEn)
  const font = d.fontDataUrl && /^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(d.fontDataUrl) ? d.fontDataUrl : ""
  const referenceFace = (value: string | undefined, weight: number) => value && /^data:font\/(ttf|woff2);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? `@font-face { font-family: "Invoice Reference"; src: url("${value}") format("${value.startsWith("data:font/ttf;") ? "truetype" : "woff2"}"); font-weight: ${weight}; font-style: normal; font-display: block; }` : ""
  const qr = imageSource(d.qrDataUrl)
  const logo = imageSource(d.logoDataUrl)
  const title = d.kind === "invoice"
    ? (d.simplified ? head("فاتورة ضريبية مبسطة", "Simplified Tax Invoice") : head("فاتورة ضريبية", "TAX Invoice"))
    : head(esc(d.docTypeAr), esc(d.docTypeEn))
  const paid = d.paidAmount
  const sellerLines = [
    d.companyVatNumber ? `الرقم الضريبي : <bdi dir="ltr">${esc(d.companyVatNumber)}</bdi>` : "",
    d.companyCrNumber ? `السجل التجاري : <bdi dir="ltr">${esc(d.companyCrNumber)}</bdi>` : "",
    d.companyPhone ? `هاتف : <bdi dir="ltr">${esc(d.companyPhone)}</bdi>` : "",
    esc(d.companyAddress),
    esc(d.companyCity),
  ].filter(Boolean).map((line) => `<div>${line}</div>`).join("")
  const meta = [
    [head("رقم الفاتورة", "Invoice NO"), esc(d.invoiceNumber)],
    [head("تاريخ الفاتورة", "Invoice Date"), esc(date(d.issueDate))],
    ...(d.dueDate ? [[head("تاريخ الاستحقاق", "Due Date"), esc(date(d.dueDate))]] : []),
    ...(d.referenceNumber ? [[head("مرجع المستند", "Reference"), esc(d.referenceNumber)]] : []),
  ].map(([k, v]) => `<tr><th>${k}</th><td><bdi dir="ltr">${v}</bdi></td></tr>`).join("")
  const totalRow = (ar: string, en: string | null, value: number, cls = "") =>
    `<tr${cls ? ` class="${cls}"` : ""}><th>${en ? head(ar, en) : `<span>${ar}</span>`}</th><td>${money(value)}</td></tr>`
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>فاتورة رقم ${esc(d.invoiceNumber)} - ${esc(d.companyNameAr)}</title>
<style>
@page { size: A4; margin: 14mm 16mm; }
${font ? `@font-face { font-family: "Invoice Cairo"; src: url("${font}") format("woff2"); font-weight: 200 1000; font-style: normal; font-display: block; }` : ""}
${referenceFace(d.referenceFontDataUrl, 400)}
${referenceFace(d.referenceBoldFontDataUrl, 700)}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; color: #000; }
body { font-family: "Invoice Reference", "Invoice Cairo", Tahoma, Arial, sans-serif; font-size: 9.5pt; line-height: 1.35; }
.doc { width: 100%; margin: 0 auto; }
small { display: block; font-size: 7pt; color: #444; }
span[lang="en"] { display: block; }
.header { display: grid; grid-template-columns: 112pt 1fr auto; gap: 16pt; align-items: start; break-inside: avoid; }
.logo-box { width: 112pt; height: 112pt; display: flex; align-items: center; justify-content: center; }
.logo { max-width: 112pt; max-height: 112pt; object-fit: contain; }
.seller { color: #222; }
.seller h1 { margin: 0 0 2pt; font-size: 12.5pt; font-weight: 700; color: #000; overflow-wrap: anywhere; }
.identity { text-align: left; min-width: 120pt; }
.title { margin: 0 0 6pt; font-size: 18pt; font-weight: 700; line-height: 1.2; }
.qr { display: block; width: 76pt; height: 76pt; margin-right: auto; }
.qr-note { max-width: 120pt; margin-top: 3pt; font-size: 6.5pt; }
.status { display: inline-block; margin-top: 4pt; border: .75pt solid #72501b; color: #72501b; padding: 1pt 6pt; font-size: 8pt; font-weight: 700; }
.rule { border: 0; border-top: 3pt double #000; margin: 26pt 0 18pt; }
.parties { display: grid; grid-template-columns: 1fr auto; gap: 24pt; align-items: start; break-inside: avoid; }
.client { display: flex; gap: 16pt; }
.client .label { font-weight: 700; }
.client .name { font-weight: 700; overflow-wrap: anywhere; }
.client .detail { color: #222; white-space: pre-line; overflow-wrap: anywhere; }
.meta { border-collapse: collapse; }
.meta th { text-align: right; font-weight: 700; padding: 0 0 4pt 16pt; vertical-align: top; }
.meta td { text-align: left; padding: 0 0 4pt; vertical-align: middle; }
.items { width: 100%; margin-top: 22pt; border-collapse: collapse; table-layout: fixed; border: .75pt solid #000; }
.items th { background: #e6e6e6; border: .5pt solid #000; padding: 5pt 3pt; text-align: center; vertical-align: middle; font-weight: 700; font-size: 9pt; }
.items td { border-inline: .5pt solid #000; padding: 6pt 4pt 16pt; vertical-align: top; font-size: 9.5pt; }
.items thead { display: table-header-group; }
.items tbody tr { break-inside: avoid; }
.items tbody tr + tr td { border-top: .5pt solid #000; }
.items .text { text-align: right; white-space: pre-line; overflow-wrap: break-word; }
.number { text-align: center; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
.totals { width: 230pt; margin-inline-start: auto; border-collapse: collapse; break-inside: avoid; }
.totals th { text-align: right; font-weight: 700; padding: 5pt 6pt; border-bottom: 1pt solid #000; }
.totals td { text-align: left; padding: 5pt 6pt; border-bottom: 1pt solid #000; vertical-align: top; }
.totals .grand th, .totals .grand td { background: #e6e6e6; font-size: 10pt; }
.totals td .money { font-weight: 400; }
.totals .grand td .money { font-weight: 700; }
.money { white-space: nowrap; direction: ltr; display: inline-block; font-variant-numeric: tabular-nums; }
.riyal { display: inline-block; width: .8em; height: .95em; vertical-align: -.05em; }
.bank { margin-top: 34pt; font-style: italic; break-inside: avoid; }
.bank div { margin-bottom: 1pt; }
.notes { margin-top: 18pt; white-space: pre-line; overflow-wrap: anywhere; break-inside: avoid; }
.notes h2 { margin: 0 0 4pt; font-size: 9pt; }
@media screen { body { padding: 32px; } .doc { max-width: 186mm; } }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body><main class="doc">
<header class="header">
  <div class="logo-box">${logo ? `<img class="logo" src="${logo}" alt="${esc(d.companyNameAr)}" />` : ""}</div>
  <div class="seller"><h1>${esc(d.companyNameAr || d.companyNameEn)}</h1>${sellerLines}</div>
  <div class="identity"><h2 class="title">${title}</h2>${qr ? `<img src="${qr}" class="qr" alt="${d.internalQr ? "Internal invoice QR" : "Invoice QR"}" />${d.internalQr ? '<small class="qr-note" role="note">رمز داخلي · غير معتمد<br>Internal QR · unvalidated</small>' : d.qrNote ? `<small class="qr-note" role="note">${esc(d.qrNote.ar)}<br>${esc(d.qrNote.en)}</small>` : ""}` : ""}${exceptionalStatus ? `<div class="status">${esc(d.statusLabelAr)} / ${esc(d.statusLabelEn)}</div>` : ""}</div>
</header>
<hr class="rule" />
<section class="parties">
  <div class="client"><div class="label">${head("العميل", "Client")}</div><div><div class="name" dir="auto">${esc(d.partyNameAr || d.partyNameEn)}</div>${d.partyTaxNumber ? `<div>الرقم الضريبي <bdi dir="ltr">${esc(d.partyTaxNumber)}</bdi></div>` : ""}${d.partyAddress ? `<div class="detail" dir="auto">${esc(d.partyAddress)}</div>` : ""}${d.partyPhone ? `<div><bdi dir="ltr">${esc(d.partyPhone)}</bdi></div>` : ""}</div></div>
  <table class="meta"><tbody>${meta}</tbody></table>
</section>
<table class="items"><colgroup><col style="width:12%"><col style="width:16%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>
<thead><tr><th>${head("البند", "Item")}</th><th>${head("الوصف", "Description")}</th><th>${head("السعر", "Price")}</th><th>${head("الكمية", "Qty")}</th><th>${head("المجموع قبل الضريبة", "Total Before Tax")}</th><th>${head("نسبة الضريبة", `VAT${vatLabel ? ` ${esc(vatLabel)}` : ""}`)}</th><th>${head("قيمة الضريبة", "VAT Amount")}</th><th>${head("المجموع مع الضريبة", "Total With VAT")}</th></tr></thead>
<tbody>${rows}</tbody></table>
<table class="totals"><tbody>
${d.discount > 0 && adjustment === 0 ? `${totalRow("الإجمالي قبل الخصم", "Total Before Discount", d.subtotal + d.discount)}${totalRow("الخصم", "Discount", -d.discount)}` : ""}
${totalRow("الإجمالي قبل الضريبة", "Total Before VAT", d.subtotal)}
${totalRow(`القيمة المضافة${vatLabel ? ` (${esc(vatLabel)})` : ""}`, null, d.vatAmount)}
${adjustment !== 0 ? totalRow(adjustment > 0 ? "خصم من إجمالي الفاتورة" : "تعديل على إجمالي الفاتورة", null, -adjustment) : ""}
${totalRow("الإجمالي بعد الضريبة", "Total After VAT", d.total, "grand")}
${paid !== undefined ? `${totalRow("مدفوع", "Paid", paid)}${totalRow("الرصيد المستحق", "Due Amount", Math.max(0, Math.round((d.total - paid) * 100) / 100))}` : ""}
</tbody></table>
${d.bankIban ? `<section class="bank"><div>معلومات الحساب البنكي:</div>${d.bankName ? `<div>اسم البنك : ${esc(d.bankName)}</div>` : ""}${d.bankBeneficiary ? `<div>اسم المستفيد : ${esc(d.bankBeneficiary)}</div>` : ""}<div>رقم الايبان : <bdi dir="ltr">${esc(d.bankIban)}</bdi></div></section>` : ""}
${d.notes ? `<section class="notes"><h2>ملاحظات / Notes</h2><div dir="auto">${esc(d.notes)}</div></section>` : ""}
</main></body></html>`
}
