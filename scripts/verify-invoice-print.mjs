import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { createRequire } from 'node:module'
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
 companyNameAr:'شركة الاختبار للتجارة',companyNameEn:'',companyVatNumber:'000000000000000',
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
// Exercise the same private font loader as the real server route.
if(process.env.INVOICE_REFERENCE_FONT_DIR){
 const runtime={}
 const pdfSource=readFileSync('src/lib/accounting/invoice-pdf.ts','utf8').replace('import "server-only"','')
 const compiled=ts.transpileModule(pdfSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 new Function('require','exports',compiled)(createRequire(import.meta.url),runtime)
 Object.assign(data,await runtime.loadInvoiceReferenceFonts())
}
// Optional local reference fields stay outside version control.
if (process.env.INVOICE_REFERENCE_DATA) Object.assign(data,JSON.parse(readFileSync(process.env.INVOICE_REFERENCE_DATA,'utf8').replace(/^\uFEFF/,'')))
const html = exports.buildInvoiceHtml(data)
// Comparison mode is local-only and makes the Linux fallback difference visible.
const renderedHtml = process.env.INVOICE_FORCE_FALLBACK === '1'
 ? html.replace('font-family: "Invoice Reference", Tahoma, "Invoice Arabic",', 'font-family: "Invoice Arabic",') : html
writeFileSync(`${folder}/invoice.html`,renderedHtml)
const browser = await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:816,height:1056}})
 await page.setContent(renderedHtml)
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))})
 await page.emulateMedia({media:'print'})
 const pdf=await page.pdf({path:`${folder}/invoice.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,tagged:true})
 const singleTask=getDocument({data:Uint8Array.from(pdf),isEvalSupported:false})
 const doc=await singleTask.promise
 if(doc.numPages!==1) throw Error('Standard invoice must fit one page')
 const pdfPage=await doc.getPage(1)
 const size=pdfPage.getViewport({scale:1})
 if(Math.abs(size.width-612)>.1 || Math.abs(size.height-792)>.1) throw Error('Invoice must match the reference Letter page')
 const text=(await pdfPage.getTextContent()).items.map(item=>item.str??'').join(' ')
 if(/about:blank|https?:\/\/|Save as PDF|\/verify-document\//.test(text)) throw Error('Browser metadata or application instructions leaked into PDF')
 if(!text.includes('83,058.99') || !text.includes('80,388.24')) throw Error('Authoritative gross/adjusted totals missing')
 const geometry=await page.evaluate(()=>{
   const doc=document.querySelector('.doc').getBoundingClientRect()
   const table=document.querySelector('.items').getBoundingClientRect()
   const cells=[...document.querySelectorAll('.items th,.items td')]
   return { left:table.left-doc.left, right:table.right-doc.right,
     overflowing:cells.filter(cell=>cell.scrollWidth>cell.clientWidth+1).length,
     contentWidthPt:doc.width*.75,tableTopPt:(table.top-doc.top)*.75,
     tableWidthPt:table.width*.75,columns:document.querySelectorAll('.items th').length,
     headerHeightPt:document.querySelector('.header').getBoundingClientRect().height*.75,
     summaryWidthPt:document.querySelector('.totals').getBoundingClientRect().width*.75,
     fallbackForced:!getComputedStyle(document.body).fontFamily.includes('Tahoma') }
 })
 if(geometry.left<-.5 || geometry.right>.5 || geometry.overflowing) throw Error('Invoice content is clipped')
 if(geometry.columns!==8 || Math.abs(geometry.contentWidthPt-487.5)>.1 || Math.abs(geometry.tableWidthPt-487.5)>.1 || Math.abs(geometry.headerHeightPt-154.5)>.1 || Math.abs(geometry.summaryWidthPt-195)>.1) throw Error('Reference geometry changed')
 writeFileSync(`${folder}/geometry.json`,JSON.stringify(geometry,null,2))
 if(await page.locator('.items tbody td:last-child').innerText()!=='83,058.99') throw Error('Gross line total must include VAT')
 // Real application document numbers are longer than the six-digit reference.
 await page.setContent(exports.buildInvoiceHtml({...data,invoiceNumber:'INV-2026-001035'}))
 await page.evaluate(async()=>{await document.fonts.ready})
 if(await page.locator('.metadata td').evaluateAll(cells=>cells.some(cell=>cell.scrollWidth>cell.clientWidth+1))) throw Error('Long invoice number is clipped')
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
 if(allText.some(value=>value.includes('ITEM-')&&!value.includes('Description'))) throw Error('Table heading missing on a continued item page')
 for(let i=1;i<=60;i++) if(!combined.includes(`ITEM-${String(i).padStart(4,'0')}`)) throw Error('Invoice line lost during pagination')
 if(allText.filter(value=>value.includes('80,388.24')).length!==1) throw Error('Invoice totals duplicated across pages')
 await singleTask.destroy();await multiTask.destroy()
 console.log('PASS: reference Letter PDF, no browser metadata/instructions, eight unclipped columns, authoritative VAT/totals and all 60 paginated lines')
 console.log(resolve(`${folder}/invoice.pdf`))
} finally {await browser.close()}
