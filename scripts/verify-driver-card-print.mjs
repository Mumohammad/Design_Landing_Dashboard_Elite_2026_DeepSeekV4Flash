import fs from 'node:fs'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {buildCardPrintHtml} from '../src/lib/drivers/card-print.ts'
const dir='supabase/.temp/release-backups/driver-evidence/card-print'
fs.mkdirSync(dir,{recursive:true})
const fixture={workflow_version:1,id:'14400000-0000-4000-8000-000000000001',driver_id:'14400000-0000-4000-8000-000000000002',card_serial:'TEST-144-0001',status:'active',issued_at:'2026-10-24T00:00:00.000Z',expires_at:'2027-10-24T00:00:00.000Z',reprint_count:0},person={name:'Driver Layout Fixture',phone:'0500000000',idNumber:'TEST-144',photoUrl:null}
assert.throws(()=>buildCardPrintHtml(fixture,person,'screen'),/Unsupported/)
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-extensions','--disable-background-networking']})
try{
 const results=[]
 for(const format of ['pvc','a4']){
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',request=>request.url().startsWith('about:')||request.url().startsWith('data:')?request.continue():request.abort())
  const html=buildCardPrintHtml(fixture,person,format)
  await page.setContent(html.replace('<script>window.onload = function () { window.print(); };</script>',''),{waitUntil:'load'});await page.emulateMediaType('print');await page.evaluate(()=>document.fonts.ready)
  const faces=await page.$$eval('.card-sheet',nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),face=node.firstElementChild.getBoundingClientRect();return{width:box.width,height:box.height,faceWidth:face.width,faceHeight:face.height}}))
  assert.equal(faces.length,2)
  for(const face of faces)for(const key of ['width','faceWidth'])assert.ok(Math.abs(face[key]-54*96/25.4)<0.5,format+' card width')
  for(const face of faces)for(const key of ['height','faceHeight'])assert.ok(Math.abs(face[key]-85.6*96/25.4)<0.5,format+' card height')
  const file=dir+'/driver-card-'+format+'.pdf',pdf=await page.pdf({path:file,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false})
  const loading=getDocument({data:new Uint8Array(pdf)}),doc=await loading.promise;assert.equal(doc.numPages,format==='pvc'?2:1)
  const pages=[]
  for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i),v=p.getViewport({scale:1}),expected=format==='pvc'?[54,85.6]:[210,297];assert.ok(Math.abs(v.width-expected[0]*72/25.4)<1,'PDF page width');assert.ok(Math.abs(v.height-expected[1]*72/25.4)<1,'PDF page height');pages.push({widthMm:Number((v.width*25.4/72).toFixed(2)),heightMm:Number((v.height*25.4/72).toFixed(2))})}
  results.push({format,pages,cardFaces:faces.length,widthMm:54,heightMm:85.6,result:'PASS'});await loading.destroy();await page.close()
 }
 fs.writeFileSync(dir+'/verification.json',JSON.stringify({check:'actual card print formats',result:'PASS',results},null,2));console.log(JSON.stringify({check:'actual card print formats',result:'PASS',results}))
}finally{await browser.close()}
