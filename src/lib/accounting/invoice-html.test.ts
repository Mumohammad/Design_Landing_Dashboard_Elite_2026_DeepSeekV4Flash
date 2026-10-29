import { describe, expect, it } from 'vitest'
import { buildInvoiceHtml, type InvoiceDocData } from './invoice-html'
const BASE: InvoiceDocData = {
 kind:'invoice',docTypeAr:'فاتورة بيع',docTypeEn:'Sales Invoice',invoiceNumber:'000006',
 companyNameAr:'شركة تجريبية',companyNameEn:'Example',companyVatNumber:'300000000000003',companyAddress:'الرياض',companyCity:'',
 partyNameAr:'عميل تجريبي',partyNameEn:'Customer',partyTaxNumber:'',partyAddress:'',partyPhone:'',
 issueDate:'2026-09-08',dueDate:null,currency:'SAR',
 lines:[{line_no:1,description:'Service',quantity:1,unit_price:100,discount:10,amount:90,vat_rate:15,vat_amount:13.5}],
 subtotal:90,discount:10,vatAmount:13.5,total:103.5,paidAmount:20,
 statusLabelAr:'معتمدة',statusLabelEn:'Finalized',qrDataUrl:'data:image/png;base64,AAAA',verifyUrl:'/verify-document/test',generatedAt:'2026-09-08',internalQr:true,
}
describe('modern invoice print template',()=>{
 it('keeps a concise internal QR label without printing application metadata or instructions',()=>{
  const html=buildInvoiceHtml({...BASE,internalQr:true})
  expect(html).toContain('Internal QR · unvalidated')
  expect(html).toContain('alt="Internal invoice QR"')
  expect(html).not.toContain(BASE.verifyUrl)
  expect(html).not.toContain('ZATCA electronic invoicing has not been validated.')
 })
 it('titles B2C sales as a Simplified Tax Invoice and prints the Phase 1 QR note',()=>{
  const html=buildInvoiceHtml({...BASE,internalQr:false,simplified:true,qrNote:{ar:'رمز الفاتورة الإلكترونية (المرحلة الأولى) · لم تُرسل إلى ZATCA',en:'E-invoice QR (Phase 1) · not submitted to ZATCA'}})
  expect(html).toContain('Simplified Tax Invoice')
  expect(html).toContain('فاتورة ضريبية مبسطة')
  expect(html).toContain('E-invoice QR (Phase 1) · not submitted to ZATCA')
  expect(html).not.toContain('Internal QR · unvalidated')
 })
 it('uses A4 and concise bilingual RTL headings',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('<html lang="ar" dir="rtl">')
  expect(html).toContain('@page { size: A4;')
  expect(html).toContain('TAX Invoice')
  expect(html).toContain('08/09/2026')
  for (const heading of ['Item','Description','Price','Qty','Total Before Tax','VAT 15%','VAT Amount','Total With VAT']) expect(html).toContain(`<span lang="en">${heading}</span>`)
  for (const label of ['Client','Invoice NO','Invoice Date','Total Before VAT','Total After VAT','Paid','Due Amount']) expect(html).toContain(label)
 })
 it('prints gross line totals and the actual paid/outstanding balances',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('<td class="number">103.50</td>')
  expect(html).toContain('aria-label="SAR 20.00"')
  expect(html).toContain('aria-label="SAR 83.50"')
 })
 it('does not subtract an already included line discount twice',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('Total Before Discount')
  expect(html).toContain('aria-label="SAR 100.00"')
  expect(html).toContain('aria-label="SAR -10.00"')
  expect(html).not.toContain('خصم من إجمالي الفاتورة')
  expect(html).toContain('aria-label="SAR 103.50"')
 })
 it('labels an imported post-tax adjustment separately',()=>{
  const html=buildInvoiceHtml({...BASE,total:100,discount:3.5})
  expect(html).toContain('خصم من إجمالي الفاتورة')
  expect(html).not.toContain('Total Before Discount')
  expect(html).toContain('aria-label="SAR -3.50"')
 })
 it('does not mislabel mixed VAT rates as a single rate',()=>{
  const html=buildInvoiceHtml({...BASE,lines:[BASE.lines[0],{...BASE.lines[0],vat_rate:0}]})
  expect(html).not.toContain('VAT 15%')
  expect(html).toContain('<td class="number">0%</td>')
 })
 it('splits the first description line into the Item column',()=>{
  const html=buildInvoiceHtml({...BASE,lines:[{...BASE.lines[0],description:'توصيل طلبات\nعمولة توصيل طلبات شهر سبتمبر 2026'}]})
  expect(html).toContain('<td class="text" dir="auto">توصيل طلبات</td>')
  expect(html).toContain('عمولة توصيل طلبات شهر سبتمبر 2026')
 })
 it('preserves non-SAR currency and imported price precision',()=>{
  const html=buildInvoiceHtml({...BASE,currency:'USD',lines:[{...BASE.lines[0],unit_price:72.2082}]})
  expect(html).toContain('72.2082')
  expect(html).toContain('USD 103.50')
  expect(html).not.toContain('<svg class="riyal"')
 })
 it('escapes all customer-controlled markup and rejects executable image URLs',()=>{
  const html=buildInvoiceHtml({...BASE,companyNameAr:'A&B',notes:'<img src=x onerror=alert(1)>',
   currency:'<USD>',bankName:'<script>x</script>',bankIban:'SA123',qrDataUrl:'javascript:alert(1)',
   lines:[{...BASE.lines[0],description:'<script>alert(1)</script>',itemName:'"<b>'}]})
  expect(html).toContain('A&amp;B')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<img src=x')
  expect(html).toContain('&lt;USD&gt;')
 })
 it('prints only supplied bank details and marks drafts',()=>{
  expect(buildInvoiceHtml(BASE)).not.toContain('<section class="bank">')
  const html=buildInvoiceHtml({...BASE,bankName:'Test bank',bankBeneficiary:'Example',bankIban:'SA123',statusLabelAr:'مسودة',statusLabelEn:'Draft'})
  expect(html).toContain('SA123')
  expect(html).toContain('Test bank')
  expect(html).toContain('مسودة / Draft')
 })
 it('keeps credit-note identity instead of calling every document a tax invoice',()=>{
  const html=buildInvoiceHtml({...BASE,kind:'credit_note',docTypeAr:'إشعار دائن',docTypeEn:'Credit note'})
  expect(html).toContain('إشعار دائن')
  expect(html).toContain('Credit note')
  expect(html).not.toContain('Tax Invoice')
 })
 it('embeds only the supplied font data and rejects external CSS font URLs',()=>{
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'data:font/woff2;base64,AAAA'})).toContain('@font-face')
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'https://untrusted.test/font.woff2'})).not.toContain('untrusted.test')
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'data:font/woff2;base64,AAAA");color:red'})).not.toContain('@font-face')
 })
 it('prints Paid 0.00 and the full Due Amount like the reference invoice, and omits absent bank/notes',()=>{
  const html=buildInvoiceHtml({...BASE,paidAmount:0})
  expect(html).toContain('aria-label="SAR 0.00"')
  expect(html.match(/aria-label="SAR 103.50"/g)?.length).toBe(2)
  expect(html).not.toContain('<section class="bank">')
  expect(html).not.toContain('<section class="notes">')
 })
})
