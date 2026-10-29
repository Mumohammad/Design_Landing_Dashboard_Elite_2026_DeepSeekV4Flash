import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from '@playwright/test'
import QRCode from 'qrcode'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
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
 fontDataUrl:`data:font/woff2;base64,${readFileSync('src/assets/fonts/cairo.woff2').toString('base64')}`,
}
// Optional local reference fields stay outside version control.
if (process.env.INVOICE_REFERENCE_DATA) Object.assign(data,JSON.parse(readFileSync(process.env.INVOICE_REFERENCE_DATA,'utf8').replace(/^\uFEFF/,'')))
const html = exports.buildInvoiceHtml(data)
writeFileSync(`${folder}/invoice.html`,html)
const browser = await chromium.launch({headless:true,...(process.env.INVOICE_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.INVOICE_CHROMIUM_EXECUTABLE_PATH}:{})})
try {
 const page=await browser.newPage({viewport:{width:816,height:1056}})
 await page.setContent(html)
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
 await page.emulateMedia({media:'print'})
 const pdf=await page.pdf({path:`${folder}/invoice.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,tagged:true})
 const singleTask=getDocument({data:Uint8Array.from(pdf),isEvalSupported:false})
 const doc=await singleTask.promise
 if(doc.numPages!==1) throw Error('Standard invoice must fit one page')
 const pdfPage=await doc.getPage(1)
 const size=pdfPage.getViewport({scale:1})
 if(Math.abs(size.width-595.28)>1 || Math.abs(size.height-841.89)>1) throw Error('Invoice must use A4')
 const text=(await pdfPage.getTextContent()).items.map(item=>item.str??'').join(' ')
 if(/about:blank|https?:\/\/|Save as PDF|\/verify-document\//.test(text)) throw Error('Browser metadata or application instructions leaked into PDF')
 if(!text.includes('83,058.99') || !text.includes('80,388.24')) throw Error('Authoritative gross/adjusted totals missing')
 const geometry=await page.evaluate(()=>{
   const doc=document.querySelector('.doc').getBoundingClientRect()
   const table=document.querySelector('.items').getBoundingClientRect()
   const cells=[...document.querySelectorAll('.items th,.items td')]
   return { left:table.left-doc.left, right:table.right-doc.right,
     overflowing:cells.filter(cell=>cell.scrollWidth>cell.clientWidth+1).length }
 })
 if(geometry.left<-.5 || geometry.right>.5 || geometry.overflowing) throw Error('Invoice content is clipped')
 if(await page.locator('.items tbody td:last-child').innerText()!=='83,058.99') throw Error('Gross line total must include VAT')
 // Stress pagination without hiding or truncating lines.
 await page.setContent(exports.buildInvoiceHtml({...data,lines:Array.from({length:60},(_,i)=>({...data.lines[0],line_no:i+1,itemName:undefined,description:`ITEM-${String(i+1).padStart(4,'0')}\nخدمة طويلة للتحقق من تتابع الصفحات`}))}))
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
 const multi=await page.pdf({path:`${folder}/multipage.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false})
 const multiTask=getDocument({data:Uint8Array.from(multi),isEvalSupported:false})
 const multipage=await multiTask.promise
 if(multipage.numPages<3) throw Error('Long invoice must paginate')
 const allText=[]
 for(let i=1;i<=multipage.numPages;i++) allText.push((await (await multipage.getPage(i)).getTextContent()).items.map(item=>item.str??'').join(' '))
 const combined=allText.join(' ')
 for(let i=1;i<=60;i++) if(!combined.includes(`ITEM-${String(i).padStart(4,'0')}`)) throw Error('Invoice line lost during pagination')
 if(allText.filter(value=>value.includes('80,388.24')).length!==1) throw Error('Invoice totals duplicated across pages')
 await singleTask.destroy();await multiTask.destroy()
 console.log('PASS: clean A4 PDF, embedded Arabic font, no browser metadata/instructions, unclipped table, authoritative VAT/totals and all 60 paginated lines')
 console.log(resolve(`${folder}/invoice.pdf`))
} finally {await browser.close()}
