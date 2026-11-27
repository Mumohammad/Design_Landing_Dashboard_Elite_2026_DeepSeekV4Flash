import {continueVerificationRoute,forwardVerificationRoute} from './lib/verification-access.mjs'
import {expect as baseExpect} from '@playwright/test'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {readFile} from 'node:fs/promises'
import {assertAcceptanceTarget,preflightAcceptanceTarget} from './lib/coordinated-acceptance.mjs'
const expect=baseExpect.configure({timeout:30000}),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// PDF text extraction inserts whitespace at soft wraps, including inside words.
// Only names/descriptions use this comparison; money/date/layout checks stay exact.
export function invoicePdfContainsText(actual,expected){
 return actual.replace(/\s+/gu,'').includes(expected.replace(/\s+/gu,''))
}
export function assertInvoiceReferenceTestTarget(backend,app,sha){
 const db=new URL(backend),site=new URL(app),loopback=host=>['localhost','127.0.0.1'].includes(host)
 if(loopback(db.hostname)&&loopback(site.hostname)){
  if(db.protocol!=='http:'||site.protocol!=='http:'||db.port!=='58321'||!['3107','3108'].includes(site.port)||[db,site].some(url=>url.username||url.password||url.pathname!=='/'||url.search||url.hash))throw Error('Exact isolated staging or disposable local invoice target required')
  return {kind:'loopback',backend:db.origin,app:site.origin}
 }
 return assertAcceptanceTarget(backend,app,sha)
}

export async function seedInvoiceDraftFixtures({request,target,ownerId,customerId,today,count=1105,fetcher=fetch}) {
 const {backend}=assertInvoiceReferenceTestTarget(target.backend,target.app,target.sha)
 const readUrl=backend+'/rest/v1/rpc/read_my_invoice_page'
 if(request.url()!==readUrl||request.method()!=='POST'||!uuid.test(ownerId)||!uuid.test(customerId)||
    !Number.isSafeInteger(count)||count<1||count>1105||!/^\d{4}-\d{2}-\d{2}$/.test(today)){
  throw Error('Owned invoice fixture session required')
 }
 const [authorization,apikey]=await Promise.all([request.headerValue('authorization'),request.headerValue('apikey')])
 const payload=/^Bearer [\w-]+\.([\w-]+)\.[\w-]+$/.exec(authorization??'')?.[1]
 let claims
 try { claims=JSON.parse(Buffer.from(payload??'','base64url').toString('utf8')) } catch {}
 // This check scopes the fixture to the browser owner. PostgREST verifies the
 // signature, membership, MFA and draft permissions on every write.
 if(!apikey||claims?.sub!==ownerId||claims?.role!=='authenticated'||claims?.aal!=='aal2'){
  throw Error('Owned invoice fixture session required')
 }
 const url=backend+'/rest/v1/rpc/save_invoice_draft'
 const batchSize=5
 for(let start=0;start<count;start+=batchSize){
  const size=Math.min(batchSize,count-start)
  const results=await Promise.allSettled(Array.from({length:size},async(_,offset)=>{
   const date=new Date(today+'T00:00:00Z')
   date.setUTCDate(date.getUTCDate()-((start+offset)%29))
   const p_input={
    request_id:randomUUID(),invoice_type:'sales',customer_id:customerId,
    issue_date:date.toISOString().slice(0,10),due_date:today,currency:'SAR',
    lines:[{description:'Synthetic invoice page fixture',quantity:1,unit_price:1,vat_rate:15}],
   }
   const result=await fetcher(url,{
    method:'POST',redirect:'error',headers:{authorization,apikey,'content-type':'application/json'},
    body:JSON.stringify({p_input}),signal:AbortSignal.timeout(15000),
   })
   if(!result.ok){await result.body?.cancel();throw Error('Invoice draft RPC failed')}
   if(!uuid.test((await result.json())?.id??''))throw Error('Invoice draft response missing its ID')
  }))
  if(results.some(result=>result.status==='rejected'))throw Error('Owned invoice page fixtures failed')
 }
}

export function createInvoiceResponseLoss(description,assertPendingFields){
 const ids=[],completion=Promise.withResolvers();let lost=false,ready=false
 const handler=async route=>{
  const request=route.request(),body=request.postData()??''
  if(request.method()!=='POST'||!request.headers()['next-action']||!body.includes(description))return continueVerificationRoute(route)
  ids.push(/request_id[\\\"\s:]{1,12}([0-9a-f-]{36})/i.exec(body)?.[1])
  if(lost)return continueVerificationRoute(route)
  lost=true;let failure
  try{await assertPendingFields()}catch{failure=Error('Pending invoice fields remained editable')}
  ready=true
  if(!failure)try{const response=await forwardVerificationRoute(route,{timeout:60000});if(!response.ok())failure=Error('Owned save response was not successful')}catch{failure=Error('Owned invoice save forwarding failed')}
  try{await route.abort('failed')}catch{failure??=Error('Owned invoice response loss failed')}
  completion.resolve(failure)
 }
 return {handler,ids,get lost(){return lost},get ready(){return ready},async wait(timeout=65000){
  let timer
  try{const failure=await Promise.race([completion.promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(Error('Owned invoice response loss did not complete')),timeout)})]);if(failure)throw failure}finally{clearTimeout(timer)}
 }}
}
export async function verifyInvoiceReferenceAndPages(page,admin,tenantId,appUrl){
 const sha=process.env.VERIFY_COMMIT_SHA,target=assertInvoiceReferenceTestTarget(admin.supabaseUrl,appUrl,sha)
 if(target.kind==='loopback'){
  const [health,landing]=await Promise.all([page.request.get(appUrl+'/api/health',{maxRedirects:0,timeout:30000}),page.request.get(appUrl+'/landing',{maxRedirects:0,timeout:30000})])
  const policy=landing.headers()['content-security-policy']??'',connect=(policy.split(';').map(x=>x.trim()).find(x=>x.startsWith('connect-src '))??'').split(/\s+/).slice(1)
  const allowedConnect=new Set(["'self'",target.backend,target.backend.replace(/^http/,'ws'),'https://api.resend.com','https://api.emailjs.com','https://zatca.gov.sa','https://*.ingest.sentry.io','https://*.ingest.de.sentry.io'])
  if(health.status()!==200||landing.status()!==200||(await health.json()).status!=='healthy'||!connect.includes(target.backend)||connect.some(source=>!allowedConnect.has(source)))throw Error('Healthy exclusively local invoice runtime required')
 }else await preflightAcceptanceTarget({backendUrl:admin.supabaseUrl,appUrl,expectedCommit:sha})
 if(!uuid.test(process.env.VERIFY_RELEASE_RUN_ID??''))throw Error('Owned invoice acceptance run required')
 if(!uuid.test(tenantId??''))throw Error('Owned synthetic invoice tenant required')
 const tenant=await admin.from('tenants').select('created_by,domain').eq('id',tenantId).single()
 if(tenant.error||!uuid.test(tenant.data.created_by)||!/\.test$/.test(tenant.data.domain??'')||!uuid.test(tenant.data.domain?.replace(/\.test$/,'')))throw Error('Owned release company required')
 const owner=await admin.auth.admin.getUserById(tenant.data.created_by)
 if(owner.error||!/^release-[0-9a-f-]{36}@example\.test$/i.test(owner.data.user?.email??'')||owner.data.user.app_metadata?._release_acceptance_group!==(target.kind==='loopback'?'local_ci':'finance')||owner.data.user.app_metadata?._release_acceptance_run!==process.env.VERIFY_RELEASE_RUN_ID)throw Error('Owned finance acceptance actor required')
 const evidence=path.resolve(process.env.VERIFY_EVIDENCE_DIR??''),relative=path.relative(path.resolve('supabase/.temp'),evidence)
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Ignored owned invoice evidence folder required')
 const tag=randomUUID().slice(0,4).toUpperCase(),description='Separate reference description '+tag,root=page.getByTestId('invoices-manager').filter({visible:true}),viewport=page.viewportSize(),routes=[];let step='reference customer'
 const scalar=async(table,where,columns='*')=>{let q=admin.from(table).select(columns).eq('tenant_id',tenantId);for(const[k,v]of Object.entries(where))q=q.eq(k,v);const r=await q.single();if(r.error)throw Error('Owned invoice fixture read failed');return r.data}
 const readReference=()=>scalar('invoices',{customer_id:customerId})
 let customerId
 const search=()=>page.getByPlaceholder('Search invoice number, party or status…',{exact:true}).filter({visible:true})
 const invoiceRow=number=>page.getByRole('row').filter({hasText:number})
 const openEdit=async number=>{await invoiceRow(number).getByRole('button',{name:'Invoice actions '+number,exact:true}).click();await page.getByRole('menuitem',{name:'Edit',exact:true}).click();return page.getByRole('dialog')}
 const renderPdf=async(dialog,ar=false)=>{
  const preview=dialog.getByRole('img',{name:ar?'صفحة الفاتورة 1 من 1':'Invoice page 1 of 1',exact:true})
  await expect(preview).toBeVisible({timeout:60000})
  expect(await preview.evaluate(canvas=>{
   const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
   return pixels.some((value,index)=>index%4===0 && value<128 && pixels[index+3]>0)
  })).toBe(true)
 }
 const pdfText=async(id,number,name,open)=>{
  let requests=0
  const matches=request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/invoices/'+id+'/pdf'
  const watch=request=>{if(matches(request))requests++}
  const tabs=page.context().pages().length
  page.on('request',watch)
  try{
   const response=page.waitForResponse(result=>matches(result.request()))
   if(open)await open()
   else {
    await invoiceRow(number).getByRole('button',{name:'Invoice actions '+number,exact:true}).click()
    await page.getByRole('menuitem',{name:'Print / Save PDF',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Preview PDF',exact:true}).click()
   }
   const dialog=page.getByRole('dialog')
   await renderPdf(dialog)
   expect(page.context().pages()).toHaveLength(tabs)
   const pdfResponse=await response
   expect(pdfResponse.ok()).toBe(true)
   expect(pdfResponse.headers()['content-type']).toContain('application/pdf')
   const generated=await admin.from('generated_documents').select('generated_data').eq('tenant_id',tenantId).eq('invoice_id',id).is('deleted_at',null).single()
   const previewHash=generated.data?.generated_data?.pdf_sha256
   if(generated.error||!/^[a-f0-9]{64}$/.test(previewHash??''))throw Error('Stored preview hash unavailable')
   if(name.includes('hidden-due'))await dialog.screenshot({path:path.join(evidence,'invoice-preview-desktop.png')})
   const pending=page.waitForEvent('download')
   await dialog.getByRole('button',{name:'Download PDF',exact:true}).click()
   const download=await pending,file=path.join(evidence,name)
   await download.saveAs(file)
   const bytes=await readFile(file)
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(previewHash)
   expect(requests).toBe(1)
   const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false})
   try{
    const pdf=await task.promise
    expect(pdf.numPages).toBe(1)
    const sheet=await pdf.getPage(1),size=sheet.getViewport({scale:1})
    expect(size.width).toBeCloseTo(612,1)
    expect(size.height).toBeCloseTo(792,1)
    await expect(dialog).toBeHidden()
    return (await sheet.getTextContent()).items.map(item=>item.str??'').join(' ')
   }finally{await task.destroy()}
  }finally{page.off('request',watch)}
 }
 try{
  const customer=await admin.from('customers').insert({tenant_id:tenantId,name_ar:'عميل الفاتورة المرجعية '+tag,name_en:'Reference invoice party '+tag}).select('id').single();if(customer.error)throw Error('Owned reference customer creation failed');customerId=customer.data.id
  await page.goto(appUrl+'/invoices?lang=en');await page.getByRole('button',{name:'New invoice',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.locator('#inv-party').selectOption(customerId);await dialog.getByLabel('Item name (optional)',{exact:true}).fill('Reference item '+tag);await dialog.getByLabel('Line description',{exact:true}).fill(description);await dialog.getByLabel('Unit price',{exact:true}).fill('72225.2082');await dialog.locator('#inv-due').fill('2091-06-17');await expect(dialog.getByText('83,058.99',{exact:true})).toBeVisible();await expect(dialog.getByLabel('Show due date on the printed invoice',{exact:true})).not.toBeChecked()
  step='committed response loss preserves one draft intent'
  const loss=createInvoiceResponseLoss(description,async()=>{await expect(dialog.getByTestId('invoice-draft-fields')).toHaveAttribute('disabled','');await expect(dialog.getByLabel('Unit price',{exact:true})).toBeDisabled();await expect(dialog.getByLabel('Item name (optional)',{exact:true})).toBeDisabled();await expect(dialog.getByLabel('Show due date on the printed invoice',{exact:true})).toBeDisabled();await expect(dialog.locator('#inv-due')).toBeDisabled()}),pattern='**/invoices*';routes.push([pattern,loss.handler]);await page.route(pattern,loss.handler)
  await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await expect.poll(()=>loss.ready).toBe(true);await loss.wait();await expect(dialog.getByRole('alert')).toBeVisible();await expect.poll(async()=>Number((await readReference()).total)).toBe(83058.99);await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await expect(dialog).toBeHidden();await page.unroute(pattern,loss.handler);expect(loss.lost).toBe(true);expect(loss.ids).toHaveLength(2);expect(loss.ids[0]).toMatch(uuid);expect(loss.ids[1]).toBe(loss.ids[0]);const reference=await readReference();expect(reference.show_due_date).toBe(false);expect(reference.due_date).toBe('2091-06-17');const line=await scalar('invoice_lines',{invoice_id:reference.id});expect(line.item_name).toBe('Reference item '+tag);expect(line.description).toBe(description);expect(Number(line.unit_price)).toBe(72225.2082)
  const audits=await admin.from('audit_log').select('id',{count:'exact'}).eq('tenant_id',tenantId).eq('entity_id',reference.id).eq('action','invoice_draft_created');if(audits.error||audits.count!==1)throw Error('Reference retry created duplicate audit evidence')
  step='persisted reference fields and due-date PDF option'
  await page.reload();await search().fill(reference.invoice_number);await expect(invoiceRow(reference.invoice_number)).toHaveCount(1);const hidden=await pdfText(reference.id,reference.invoice_number,'invoice-reference-hidden-due.pdf');expect(invoicePdfContainsText(hidden,'Reference item '+tag)).toBe(true);expect(invoicePdfContainsText(hidden,description)).toBe(true);expect(hidden).toContain('72,225.2082');expect(hidden).not.toContain('Due Date');expect(hidden).not.toContain('17/06/2091');for(const amount of['72,225.21','10,833.78','83,058.99'])expect(hidden).toContain(amount);expect(hidden).not.toMatch(/https?:\/\/|about:blank/)
  dialog=await openEdit(reference.invoice_number);await expect(dialog.getByLabel('Item name (optional)',{exact:true})).toHaveValue('Reference item '+tag);await expect(dialog.getByLabel('Unit price',{exact:true})).toHaveValue('72225.2082');await dialog.getByLabel('Show due date on the printed invoice',{exact:true}).check();const shown=await pdfText(reference.id,reference.invoice_number,'invoice-reference-visible-due.pdf',()=>dialog.getByRole('button',{name:'Save & preview',exact:true}).click());await expect.poll(async()=>(await readReference()).show_due_date).toBe(true);expect((await readReference()).due_date).toBe('2091-06-17');expect(shown).toContain('Due Date');expect(shown).toContain('72,225.2082');expect(shown).toContain('17/06/2091');for(const amount of['72,225.21','10,833.78','83,058.99'])expect(shown).toContain(amount)
  step='complete invoice search/global metrics and exports beyond old caps'
  const before=await admin.from('invoices').select('total,currency,status',{count:'exact'}).eq('tenant_id',tenantId).is('deleted_at',null).limit(500);if(before.error||before.count!==before.data?.length)throw Error('Fresh finance baseline must fit one exact snapshot');const beforeValue=before.data.filter(row=>row.currency==='SAR'&&!['cancelled','credited'].includes(row.status)).reduce((sum,row)=>sum+BigInt(Math.round(Number(row.total)*100)),0n)
  const customers=Array.from({length:1201},(_,index)=>({id:randomUUID(),tenant_id:tenantId,customer_code:'IP'+tag+String(index).padStart(4,'0'),name_ar:'عميل خيارات '+index,name_en:index===1200?'Last picker 50%_ '+tag:index===0?'Export invoices 50%_ '+tag:'Invoice option '+tag+' '+index}));for(let i=0;i<customers.length;i+=200)if((await admin.from('customers').insert(customers.slice(i,i+200))).error)throw Error('Owned party page fixtures failed')
  const today=new Date().toISOString().slice(0,10)
  const [invoiceRequest]=await Promise.all([
   page.waitForRequest(req=>req.method()==='POST'&&req.url()===target.backend+'/rest/v1/rpc/read_my_invoice_page'),
   page.reload(),
  ])
  await seedInvoiceDraftFixtures({request:invoiceRequest,target,ownerId:tenant.data.created_by,customerId:customers[0].id,today})
  await page.reload();await search().fill('Export invoices 50%_ '+tag);await expect(root.locator('tbody tr')).toHaveCount(50);const metrics=root.getByTestId('module-kpi-value');await expect(metrics.nth(0)).toHaveText(String(before.count+1105));const cents=beforeValue+127075n,expectedValue=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(cents%100n).toString().padStart(2,'0');await expect(metrics.nth(3)).toHaveText(expectedValue);await expect(root).toContainText('1105 invoices');const first=await root.getByRole('button',{name:/^Invoice actions /}).first().getAttribute('aria-label');await root.getByRole('button',{name:'Next',exact:true}).click();await expect.poll(()=>root.getByRole('button',{name:/^Invoice actions /}).first().getAttribute('aria-label')).not.toBe(first)
  const pending=page.waitForEvent('download');await root.getByRole('button',{name:'Export CSV',exact:true}).click();const csvDownload=await pending,stream=await csvDownload.createReadStream();if(!stream)throw Error('Owned export stream unavailable');const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''),csvRows=csv.trim().split(/\r?\n/);expect(csvRows).toHaveLength(1106);expect(new Set(csvRows.slice(1).map(row=>row.split(',')[0])).size).toBe(1105)
  step='truthful invoice read failure and real retry'
  const rpc='**/rest/v1/rpc/read_my_invoice_page',fault=route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic invoice read failure"}'});routes.push([rpc,fault]);await page.route(rpc,fault);await page.reload();await expect(root.getByRole('alert')).toContainText('Could not load invoices and their totals');for(let i=0;i<4;i++)await expect(metrics.nth(i)).toHaveText('—');await expect(root.getByText(/No invoices yet/)).toHaveCount(0);await page.unroute(rpc,fault);await root.getByRole('button',{name:'Retry',exact:true}).click();await expect(root.locator('tbody tr')).toHaveCount(50)
  step='invoice-only paged party choices beyond 1000 records'
  await root.getByRole('button',{name:'New invoice',exact:true}).click();dialog=page.getByRole('dialog');const picker=dialog.getByTestId('invoice-party-picker');await picker.getByRole('searchbox').fill('IP'+tag);await expect(picker).toContainText('1201 records');await picker.getByRole('button',{name:'Next records',exact:true}).click();await expect(picker).toContainText('Page 2');await picker.getByRole('searchbox').fill('Last picker 50%_ '+tag);await expect(picker.locator('option[value="'+customers[1200].id+'"]').first()).toHaveCount(1);await dialog.locator('#inv-party').selectOption(customers[1200].id);await dialog.getByLabel('Line description',{exact:true}).fill('Last option invoice '+tag);await dialog.getByLabel('Unit price',{exact:true}).fill('0.01');
  step='selected invoice party read failure blocks saving and preserves selection'
  const partyRpc='**/rest/v1/rpc/read_my_invoice_party_page',partyFault=route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic invoice party read failure"}'});let writesWhileUnknown=0;const watch=request=>{if(request.method()==='POST'&&request.headers()['next-action']&&(request.postData()??'').includes('Last option invoice '+tag))writesWhileUnknown++};page.on('request',watch);routes.push([partyRpc,partyFault]);
  try{await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled();await page.route(partyRpc,partyFault);await picker.getByRole('button',{name:'Refresh records',exact:true}).click();await expect(picker.getByRole('alert')).toContainText('Could not load records');await expect(dialog.locator('#inv-party')).toBeDisabled();await expect(dialog.locator('#inv-party')).toHaveValue(customers[1200].id);await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();expect(writesWhileUnknown).toBe(0);await page.unroute(partyRpc,partyFault);await picker.getByRole('button',{name:'Retry',exact:true}).click();await expect(dialog.locator('#inv-party')).toBeEnabled();await expect(dialog.locator('#inv-party')).toHaveValue(customers[1200].id);await expect(dialog.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled()}finally{page.off('request',watch)}
  await dialog.getByRole('button',{name:'Save draft',exact:true}).click();await expect(dialog).toBeHidden();expect((await scalar('invoices',{customer_id:customers[1200].id})).status).toBe('draft')
  step='Arabic reference editor and responsive layout'
  await page.setViewportSize({width:390,height:844});await page.goto(appUrl+'/invoices?lang=ar');await page.getByPlaceholder('ابحث برقم الفاتورة أو الطرف أو الحالة…',{exact:true}).filter({visible:true}).fill(reference.invoice_number);await expect(page.locator('html')).toHaveAttribute('lang','ar');await invoiceRow(reference.invoice_number).getByRole('button',{name:'إجراءات الفاتورة '+reference.invoice_number,exact:true}).click();await page.getByRole('menuitem',{name:'تعديل',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByLabel('اسم الصنف (اختياري)',{exact:true})).toHaveValue('Reference item '+tag);await expect(dialog.getByLabel('سعر الوحدة',{exact:true})).toHaveValue('72225.2082');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:path.join(evidence,'invoice-reference-mobile-ar.png'),fullPage:true});await dialog.locator('[data-slot="dialog-close"]').click();await invoiceRow(reference.invoice_number).getByRole('button',{name:'إجراءات الفاتورة '+reference.invoice_number,exact:true}).click();await page.getByRole('menuitem',{name:'طباعة / حفظ PDF',exact:true}).click();await dialog.getByRole('button',{name:'معاينة PDF',exact:true}).click();await renderPdf(dialog,true);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:path.join(evidence,'invoice-preview-mobile-ar.png')});await dialog.locator('[data-slot="dialog-close"]').click();console.log(JSON.stringify({check:'invoice reference persistence/PDF, receipt replay, complete pages/KPIs/export/party options, read failure/retry and Arabic mobile',result:'PASS'}))
 }catch(error){console.error(JSON.stringify({check:'invoice reference and complete reads',stage:step,errorType:error.name,callsite:/verify-invoice-reference-and-pages\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1),operation:/expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0]}));await page.screenshot({path:path.join(evidence,'invoice-reference-failure.png'),fullPage:true}).catch(()=>{});error.verificationStage=step;throw error}
 finally{for(const[pattern,handler]of routes)await page.unroute(pattern,handler).catch(()=>{});if(viewport)await page.setViewportSize(viewport);await page.goto(appUrl+'/invoices?lang=en').catch(()=>{})}
}
