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
describe('reference invoice print template',()=>{
 it('keeps the internal QR disclosure in saved PDFs without changing table geometry',()=>{
  const html=buildInvoiceHtml({...BASE,internalQr:true})
  expect(html).toContain('Internal QR only. ZATCA electronic invoicing has not been validated.')
  expect(html).toContain('alt="Internal invoice QR"')
  expect(html.indexOf('Internal QR only.')).toBeGreaterThan(html.indexOf('class="totals"'))
 })
 it('uses the reference Letter geometry and bilingual RTL headings',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('<html lang="ar" dir="rtl">')
  expect(html).toContain('@page { size: Letter;')
  expect(html).toContain('font-family: Tahoma')
  expect(html).toContain('TAX Invoice')
  expect(html).toContain('08/09/2026')
  expect(html).toContain('Total Before Tax')
  expect(html).toContain('Total With VAT')
 })
 it('prints gross line totals and the actual paid/outstanding balances',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('<td class="number">103.50</td>')
  expect(html).toContain('aria-label="SAR 20.00"')
  expect(html).toContain('aria-label="SAR 83.50"')
 })
 it('does not subtract an already included line discount twice',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('Line discount (included)')
  expect(html).not.toContain('خصم من إجمالي الفاتورة')
  expect(html).toContain('aria-label="SAR 103.50"')
 })
 it('labels an imported post-tax adjustment separately',()=>{
  const html=buildInvoiceHtml({...BASE,total:100,discount:3.5})
  expect(html).toContain('خصم من إجمالي الفاتورة')
  expect(html).toContain('aria-label="SAR -3.50"')
 })
 it('does not mislabel mixed VAT rates as a single rate',()=>{
  const html=buildInvoiceHtml({...BASE,lines:[BASE.lines[0],{...BASE.lines[0],vat_rate:0}]})
  expect(html).not.toContain('<br>VAT 15%')
  expect(html).toContain('<td class="number">0%</td>')
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
  expect(buildInvoiceHtml({...BASE,kind:'credit_note',docTypeAr:'إشعار دائن',docTypeEn:'Credit note'})).toContain('إشعار دائن<br>Credit note')
 })
})
