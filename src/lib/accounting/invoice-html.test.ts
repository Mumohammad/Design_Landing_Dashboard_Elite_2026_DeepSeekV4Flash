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
 it('uses the supplied Letter page, reference typography and eight separate bilingual columns',()=>{
  const html=buildInvoiceHtml(BASE)
  expect(html).toContain('<html lang="ar" dir="rtl">')
  expect(html).toContain('@page { size: Letter; margin: 30pt 62.25pt; }')
  expect(html).toContain('width: 487.5pt')
  expect(html).toContain('Tahoma')
  expect(html.match(/<col style=/g)).toHaveLength(8)
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
  expect(html).toContain('aria-label="SAR -10.00"')
  expect(html).toContain('<tr class="included-discount">')
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
  expect(html).not.toContain('>VAT 15%</span>')
  expect(html).toContain('<td class="number">0%</td>')
 })
 it('preserves non-SAR currency and imported price precision',()=>{
  const html=buildInvoiceHtml({...BASE,currency:'USD',lines:[{...BASE.lines[0],unit_price:72.2082}]})
  expect(html).toContain('72.2082')
  expect(html).toContain('USD 103.50')
  expect(html).not.toContain('<svg class="riyal"')
 })
 it('keeps the item name independent of multiline descriptions and leaves unnamed items blank',()=>{
  const description='First description line\nSecond description line'
  const named=buildInvoiceHtml({...BASE,lines:[{...BASE.lines[0],itemName:'Separate item',description}]})
  expect(named).toContain('<td class="item" dir="auto">Separate item</td>')
  expect(named).toContain(`<td class="description" dir="auto">${description}</td>`)
  const unnamed=buildInvoiceHtml({...BASE,lines:[{...BASE.lines[0],discount:0,description}]})
  expect(unnamed).toContain('<td class="item" dir="auto"></td>')
  expect(unnamed).toContain(`<td class="description" dir="auto">${description}</td>`)
 })
 it('keeps narrow item cells free of discount annotations and places an included discount in the summary',()=>{
  const html=buildInvoiceHtml({...BASE,lines:[{...BASE.lines[0],itemName:'1',unit_price:45000,discount:4000,amount:41000,vat_amount:6150}],subtotal:41000,discount:4000,vatAmount:6150,total:47150,paidAmount:0})
  expect(html).toContain('<td class="item" dir="auto">1</td>')
  expect(html).not.toContain('خصم / Discount:')
  const summary=html.slice(html.indexOf('<section class="summary">'),html.indexOf('</section>',html.indexOf('<section class="summary">')))
  expect(summary).toContain('Line discount (included)')
  expect(summary).toContain('aria-label="SAR -4,000.00"')
  expect(summary).toContain('aria-label="SAR 41,000.00"')
  expect(summary).toContain('aria-label="SAR 6,150.00"')
  expect(summary.match(/aria-label="SAR 47,150.00"/g)).toHaveLength(2)
 })
 it('embeds safe inline business logos and omits absent or remote logo sources',()=>{
  expect(buildInvoiceHtml({...BASE,logoDataUrl:'data:image/png;base64,BBBB'})).toContain('<img class="logo" src="data:image/png;base64,BBBB"')
  for(const logoDataUrl of [undefined,'https://untrusted.test/logo.png','javascript:alert(1)','data:image/png;base64,AAAA" onerror="alert(1)']) {
   const html=buildInvoiceHtml({...BASE,logoDataUrl})
   expect(html).not.toContain('<img class="logo"')
   expect(html).not.toContain('untrusted.test')
  }
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
  expect(html).not.toContain('TAX Invoice')
 })
 it('embeds only the supplied font data and rejects external CSS font URLs',()=>{
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'data:font/woff2;base64,AAAA'})).toContain('@font-face')
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'https://untrusted.test/font.woff2'})).not.toContain('untrusted.test')
  expect(buildInvoiceHtml({...BASE,fontDataUrl:'data:font/woff2;base64,AAAA");color:red'})).not.toContain('@font-face')
 })
 it('accepts only inline reference font assets and keeps regular/bold weights separate',()=>{
  const html=buildInvoiceHtml({...BASE,referenceFontDataUrl:'data:font/ttf;base64,AAAA',referenceBoldFontDataUrl:'data:font/woff2;base64,BBBB'})
  expect(html).toContain('format("truetype"); font-weight: 400')
  expect(html).toContain('format("woff2"); font-weight: 700')
  expect(buildInvoiceHtml({...BASE,referenceFontDataUrl:'file:///private/font.ttf',referenceBoldFontDataUrl:'https://untrusted.test/font.woff2'})).not.toContain('@font-face')
 })
 it('preserves the reference zero-payment and outstanding rows without inventing bank details',()=>{
  const html=buildInvoiceHtml({...BASE,paidAmount:0})
  expect(html).toContain('Due Amount')
  expect(html).toContain('aria-label="SAR 0.00"')
  expect(html).toContain('aria-label="SAR 103.50"')
  expect(html).not.toContain('<section class="bank">')
  expect(html).not.toContain('<section class="notes">')
 })
})

describe('rich invoice notes', () => {
 it('prints editor formatting and drops unsafe markup', () => {
  const html = buildInvoiceHtml({ ...BASE, notes: '<b>Terms</b><ul><li>Pay in 30 days</li></ul><a href="javascript:alert(1)">x</a><span style="color: #dc2626" onclick="x()">red</span>' })
  expect(html).toContain('<div class="rich" dir="auto"><b>Terms</b><ul><li>Pay in 30 days</li></ul><span>x</span><span style="color: #dc2626">red</span></div>')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('onclick')
 })
 it('keeps legacy plain-text notes escaped with line breaks', () => {
  expect(buildInvoiceHtml({ ...BASE, notes: 'Line 1\nA < B' })).toContain('Line 1<br>A &lt; B')
 })
})
