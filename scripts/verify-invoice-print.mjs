import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from '@playwright/test'
import QRCode from 'qrcode'
const folder = 'supabase/.temp/invoice-print'
mkdirSync(folder, { recursive: true })
const source = readFileSync('src/lib/accounting/riyal-symbol.ts','utf8') + '\n' + readFileSync('src/lib/accounting/invoice-html.ts','utf8').replace(/^import .*\r?\n/, '')
const exports = {}
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports)
const data = {
 kind:'invoice',docTypeAr:'فاتورة بيع',docTypeEn:'Sales Invoice',invoiceNumber:'000006',
 companyNameAr:'شركة الاختبار للتجارة',companyNameEn:'Example Company',companyVatNumber:'000000000000000',
 companyPhone:'+966500000000',companyAddress:'عنوان تجريبي',companyCity:'مدينة تجريبية',
 partyNameAr:'عميل الاختبار',partyNameEn:'',partyTaxNumber:'000000000000000',partyAddress:'عنوان العميل\nالرياض',partyPhone:'',
 issueDate:'2026-09-08',dueDate:null,currency:'SAR',
 lines:[{line_no:1,itemName:'توصيل طلبات',description:'عمولة توصيل\nطلبات شهر\nاغسطس\n2026',quantity:1,unit_price:72225.2082,discount:0,amount:72225.21,vat_rate:15,vat_amount:10833.78}],
 subtotal:72225.21,discount:2670.75,vatAmount:10833.78,total:80388.24,paidAmount:0,statusLabelAr:'صادرة',statusLabelEn:'Issued',
 bankName:'بنك الاختبار',bankBeneficiary:'شركة الاختبار للتجارة',bankIban:'SA00000000000000000000000',
 qrDataUrl:await QRCode.toDataURL('Synthetic invoice layout verification',{margin:0,width:180}),verifyUrl:'/verify-document/test',generatedAt:'2026-09-08T00:00:00Z',
 internalQr:true,
 logoDataUrl:`data:image/png;base64,${readFileSync('public/logo.png').toString('base64')}`,
}
// Optional local reference fields stay outside version control.
if (process.env.INVOICE_REFERENCE_DATA) Object.assign(data,JSON.parse(readFileSync(process.env.INVOICE_REFERENCE_DATA,'utf8').replace(/^\uFEFF/,'')))
const html = exports.buildInvoiceHtml(data)
writeFileSync(`${folder}/invoice.html`,html)
const browser = await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:816,height:1056}})
 await page.setContent(html)
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
 await page.emulateMedia({media:'print'})
 const pdf=await page.pdf({path:`${folder}/invoice.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false})
 if ((pdf.toString('latin1').match(/\/Type \/Page\b/g)??[]).length!==1) throw Error('Reference invoice must fit one page')
 const bounds=await page.locator('.items').boundingBox()
 if(Math.abs(bounds.width-650)>1) throw Error('Invoice table width differs from reference')
 const geometry=await page.evaluate(()=>{
   const doc=document.querySelector('.doc').getBoundingClientRect()
   const table=document.querySelector('.items').getBoundingClientRect()
   const left=document.querySelector('.items th:last-child').getBoundingClientRect()
   const right=document.querySelector('.items th:first-child').getBoundingClientRect()
   return { top:table.top-doc.top, left:left.left-doc.left, right:right.right-doc.right }
 })
 // Measurements from the supplied Letter sample. A full-width RTL colgroup
 // plus collapsed borders previously painted outside the printable margin.
 if(Math.abs(geometry.top-322)>1 || geometry.left<-.5 || geometry.right>.5) throw Error('Invoice grid is clipped or displaced from the reference geometry')
 if(await page.locator('.items tbody td:last-child').innerText()!=='83,058.99') throw Error('Gross line total must include VAT')
 // Stress pagination without hiding or truncating lines.
 await page.setContent(exports.buildInvoiceHtml({...data,lines:Array.from({length:60},(_,i)=>({...data.lines[0],line_no:i+1,itemName:String(i+1),description:`خدمة رقم ${i+1}\nLong description for pagination verification`}))}))
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
 const multi=await page.pdf({path:`${folder}/multipage.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false})
 if ((multi.toString('latin1').match(/\/Type \/Page\b/g)??[]).length<3) throw Error('Long invoice must paginate')
 console.log('PASS: print render, 650px reference table, gross VAT amount, and 60-line pagination rendered')
 console.log(resolve(`${folder}/invoice.pdf`))
} finally {await browser.close()}
