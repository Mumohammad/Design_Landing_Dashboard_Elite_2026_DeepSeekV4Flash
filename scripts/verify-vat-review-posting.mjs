import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
const expect=baseExpect.configure({timeout:30_000})
const cents=value=>Math.round(Number(value)*100)
const selectError=result=>Boolean(result.error)
/** Fresh synthetic tenant only. Every source approval, dispatch, period close
 * and VAT decision uses the ordinary signed-in UI. One intentionally imported
 * pending-input fixture has no posting and exercises the finance-review hold. */
export async function verifyVatReviewPosting(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!tenantId)throw Error('Synthetic VAT tenant required')
 for(const table of ['expenses','financial_events','journal_entries','vat_input_ledger']){
  const r=await admin.from(table).select('id',{count:'exact',head:true}).eq('tenant_id',tenantId)
  if(r.error||r.count!==0)throw Error('Fresh dedicated VAT tenant required')
 }
 const tag=randomUUID().slice(0,8),unknownId=randomUUID(),unknownRef='Imported-source-'+tag
 const cases=[{key:'recoverable',date:'2004-04-15',rate:15},{key:'nonrecoverable',date:'2004-04-16',rate:15},{key:'zero',date:'2004-04-17',rate:0},{key:'closed',date:'2004-05-15',rate:15}]
 const viewport=page.viewportSize(),locale=(await page.locator('html').getAttribute('lang'))??'en'
 let stage='UI expense creation and approval',stale=null,lastWrite=0
 const write=async button=>{const delay=6200-(Date.now()-lastWrite);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));lastWrite=Date.now();await button.click()}
 const reviewCard=(target,ar=false)=>target.locator('[data-slot="card"]').filter({has:target.getByText(ar?'عناصر قيد المراجعة':'Items awaiting review',{exact:true})})
 const goVat=async(target,language='en')=>{await target.goto(appUrl+'/accounting?lang='+language);await target.getByRole('tab',{name:language==='ar'?'الضريبة (VAT)':'VAT',exact:true}).click();await expect(reviewCard(target,language==='ar')).toBeVisible()}
 const openReview=async(target,ref,ar=false)=>{
  const card=reviewCard(target,ar)
  await card.getByRole('searchbox',{name:ar?'البحث في السجلات':'Search records',exact:true}).fill(ref)
  const row=card.locator('tbody tr').filter({hasText:ref})
  await expect(row).toHaveCount(1);await row.getByRole('button',{name:ar?'تصنيف':'Classify',exact:true}).click()
  return target.getByRole('dialog')
 }
 const readInput=async id=>{const r=await admin.from('vat_input_ledger').select('id,vat_recoverability,vat_amount,vat_base_amount,source_entity_id').eq('tenant_id',tenantId).eq('id',id).single();if(r.error)throw Error('Synthetic input read failed');return r.data}
 const adjustment=async id=>{const r=await admin.from('journal_entries').select('id,status,entry_date,source_entity_type,source_entity_id').eq('tenant_id',tenantId).eq('source_entity_type','vat_input_review').eq('source_entity_id',id);if(r.error)throw Error('Synthetic adjustment read failed');return r.data}
 try{
  for(const item of cases){
   item.vendor='VAT-'+item.key+'-'+tag
   await page.goto(appUrl+'/expenses?lang=en');await page.getByRole('button',{name:'New expense',exact:true}).click()
   const dialog=page.getByRole('dialog')
   await dialog.locator('#exp-type').selectOption('fuel');await dialog.locator('#exp-amount').fill('100')
   await dialog.locator('#exp-date').fill(item.date);await dialog.locator('#exp-vat').fill(String(item.rate));await dialog.locator('#exp-vendor').fill(item.vendor)
   await write(dialog.getByRole('button',{name:'Save expense',exact:true}));await expect(dialog).toBeHidden()
   await page.getByRole('textbox').first().fill(item.vendor)
   const row=page.locator('tbody tr').filter({hasText:item.vendor});await expect(row).toHaveCount(1)
   await row.getByRole('button',{name:'Approve expense',exact:true}).click()
   await dialog.locator('#exp-recover').selectOption('pending_review')
   await write(dialog.getByRole('button',{name:'Approve',exact:true}));await expect(dialog).toBeHidden()
   const source=await admin.from('expenses').select('id,expense_code,coa_account_code,vat_recoverability,is_approved,amount,vat_amount').eq('tenant_id',tenantId).eq('vendor',item.vendor).single()
   if(source.error||!source.data.is_approved||source.data.vat_recoverability!=='pending_review'||cents(source.data.amount)!==10000||cents(source.data.vat_amount)!==item.rate*100)throw Error('Ordinary expense approval evidence differs')
   item.expense=source.data
  }
  stage='ordinary idempotent event dispatcher'
  await page.goto(appUrl+'/accounting?lang=en');await page.getByRole('tab',{name:'Events',exact:true}).click()
  await write(page.getByRole('button',{name:'Run dispatcher',exact:true}))
  await expect(page.getByText(/^Dispatched:/)).toBeVisible()
  for(const item of cases){
   const events=await admin.from('financial_events').select('id,event_type,processing_status,processed_at').eq('tenant_id',tenantId).eq('source_type','expense').eq('source_id',item.expense.id)
   const journal=await admin.from('journal_entries').select('id,status,entry_date').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',item.expense.id)
   const input=await admin.from('vat_input_ledger').select('id,vat_recoverability,vat_amount').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',item.expense.id)
   if([events,journal,input].some(selectError)||events.data.length!==1||events.data[0].processing_status!=='processed'||!events.data[0].processed_at||journal.data.length!==1||journal.data[0].status!=='posted'||journal.data[0].entry_date!==item.date||input.data.length!==1||input.data[0].vat_recoverability!=='pending_review')throw Error('Ordinary dispatcher did not retain one complete source posting')
   item.original=journal.data[0];item.inputId=input.data[0].id
   const lines=await admin.from('journal_entry_lines').select('id,account_id,debit_amount,credit_amount').eq('tenant_id',tenantId).eq('journal_entry_id',item.original.id).order('id')
   if(lines.error||lines.data.length!==2)throw Error('Gross source expense journal missing')
   item.originalLines=lines.data
  }
  const chart=await admin.from('chart_of_accounts').select('id,account_code').eq('tenant_id',tenantId).is('deleted_at',null)
  if(chart.error)throw Error('Synthetic chart read failed')
  const code=id=>chart.data.find(r=>r.id===id)?.account_code
  for(const item of cases){const gross=10000+item.rate*100;if(item.originalLines.filter(l=>code(l.account_id)===item.expense.coa_account_code&&cents(l.debit_amount)===gross&&cents(l.credit_amount)===0).length!==1||item.originalLines.filter(l=>code(l.account_id)==='2000'&&cents(l.credit_amount)===gross&&cents(l.debit_amount)===0).length!==1)throw Error('Original journal must show actual gross expense/AP before review')}
  stage='recoverable classification transport recovery and stale tab'
  await goVat(page);let dialog=await openReview(page,cases[0].expense.expense_code)
  stale=await page.context().newPage();await goVat(stale);const staleDialog=await openReview(stale,cases[0].expense.expense_code)
  let blocked=false
  const fault=async route=>{const req=route.request();if(!blocked&&req.method()==='POST'&&req.headers()['next-action']&&new URL(req.url()).pathname==='/accounting'&&req.postData()?.includes(cases[0].inputId)){blocked=true;await route.abort('failed')}else await route.continue()}
  await page.route('**/accounting*',fault);await write(dialog.getByRole('button',{name:'Confirm',exact:true}))
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled()
  await page.unroute('**/accounting*',fault);if(!blocked)throw Error('VAT transport failure was not exercised')
  if((await readInput(cases[0].inputId)).vat_recoverability!=='pending_review'||(await adjustment(cases[0].inputId)).length!==0)throw Error('Aborted caller request changed classification')
  await write(dialog.getByRole('button',{name:'Confirm',exact:true}));await expect(dialog).toBeHidden()
  await write(staleDialog.getByRole('button',{name:'Confirm',exact:true}));await expect(staleDialog.getByRole('alert')).toBeVisible();await expect(staleDialog.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled()
  await stale.close();stale=null
  const posted=await adjustment(cases[0].inputId)
  if((await readInput(cases[0].inputId)).vat_recoverability!=='recoverable'||posted.length!==1||posted[0].status!=='posted'||posted[0].entry_date!==cases[0].date)throw Error('Recoverable decision did not retain exactly one dated posted adjustment')
  const adjustmentLines=await admin.from('journal_entry_lines').select('account_id,debit_amount,credit_amount').eq('tenant_id',tenantId).eq('journal_entry_id',posted[0].id)
  if(adjustmentLines.error||adjustmentLines.data.length!==2||adjustmentLines.data.filter(l=>code(l.account_id)==='2600'&&cents(l.debit_amount)===1500&&cents(l.credit_amount)===0).length!==1||adjustmentLines.data.filter(l=>code(l.account_id)===cases[0].expense.coa_account_code&&cents(l.credit_amount)===1500&&cents(l.debit_amount)===0).length!==1)throw Error('Recoverable VAT must debit2600 and credit the actual source expense GL')
  stage='nonrecoverable and zero VAT without unnecessary journals'
  for(const [item,classification] of [[cases[1],'non_recoverable'],[cases[2],'recoverable']]){
   dialog=await openReview(page,item.expense.expense_code)
   if(classification==='non_recoverable')await dialog.getByRole('button',{name:'Non-recoverable',exact:true}).click()
   await write(dialog.getByRole('button',{name:'Confirm',exact:true}));await expect(dialog).toBeHidden()
   if((await readInput(item.inputId)).vat_recoverability!==classification||(await adjustment(item.inputId)).length!==0)throw Error('Nonrecoverable/zero VAT unexpectedly changed the GL')
  }
  stage='closed source period held through ordinary UI'
  await page.getByRole('tab',{name:'Periods',exact:true}).click()
  const periodRow=page.getByRole('tabpanel',{name:'Periods',exact:true}).locator('tbody tr').filter({hasText:'May 2004'})
  await expect(periodRow).toHaveCount(1);await write(periodRow.getByRole('button',{name:'Close',exact:true}));await expect(periodRow.getByText('Closed',{exact:true})).toBeVisible()
  await page.getByRole('tab',{name:'VAT',exact:true}).click();dialog=await openReview(page,cases[3].expense.expense_code)
  await write(dialog.getByRole('button',{name:'Confirm',exact:true}))
  await expect(dialog.getByRole('alert')).toContainText('source accounting or VAT period is closed');await expect(dialog.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled()
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  if((await readInput(cases[3].inputId)).vat_recoverability!=='pending_review'||(await adjustment(cases[3].inputId)).length!==0)throw Error('Closed period classification changed VAT/GL')
  stage='explicit unproven imported source hold'
  const imported=await admin.from('vat_input_ledger').insert({id:unknownId,tenant_id:tenantId,period_year:2004,period_month:4,invoice_ref:unknownRef,invoice_date:'2004-04-18',vat_base_amount:100,vat_rate:15,vat_amount:15,vat_recoverability:'pending_review'})
  if(imported.error)throw Error('Synthetic imported pending metadata fixture failed')
  await goVat(page);dialog=await openReview(page,unknownRef);await write(dialog.getByRole('button',{name:'Confirm',exact:true}))
  await expect(dialog.getByRole('alert')).toContainText('source posting needs finance review');await expect(dialog.getByRole('button',{name:'Confirm',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  if((await readInput(unknownId)).vat_recoverability!=='pending_review'||(await adjustment(unknownId)).length!==0)throw Error('Unproven import generated a tax claim or financial posting')
  stage='original source and audit integrity'
  for(const item of cases){
   const original=await admin.from('journal_entry_lines').select('id,account_id,debit_amount,credit_amount').eq('tenant_id',tenantId).eq('journal_entry_id',item.original.id).order('id')
   const source=await admin.from('expenses').select('vat_recoverability').eq('tenant_id',tenantId).eq('id',item.expense.id).single()
   const audit=await admin.from('audit_log').select('new_values').eq('tenant_id',tenantId).eq('entity_id',item.inputId).eq('action','vat_review_item_resolved')
   if([original,source,audit].some(selectError)||JSON.stringify(original.data)!==JSON.stringify(item.originalLines)||source.data.vat_recoverability!=='pending_review'||audit.data.length!==(item.key==='closed'?0:1))throw Error('Review overwrote historical source posting or duplicated/omitted audit')
  }
  stage='Arabic mobile finance-review error'
  await goVat(page,'ar');dialog=await openReview(page,unknownRef,true);await write(dialog.getByRole('button',{name:'تأكيد التصنيف',exact:true}))
  await expect(dialog.getByRole('alert')).toContainText('يلزم تدقيق الترحيل الأصلي مالياً')
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.screenshot({path:'supabase/.temp/vat-review-finance-hold-ar.png',fullPage:true})
  await dialog.getByRole('button',{name:'إلغاء',exact:true}).click()
  console.log(JSON.stringify({check:'ordinary UI expense approval/dispatch, VAT recoverable GL reclassification, nonrecoverable/zero VAT, stale/failed calls, closed/unproven holds and Arabic mobile',result:'PASS'}))
 }catch(error){console.error(JSON.stringify({check:'VAT review posting',stage,errorType:error.name}));await page.screenshot({path:'supabase/.temp/vat-review-posting-failure.png',fullPage:true}).catch(()=>{});throw Error('VAT review posting verification failed: '+stage)}
 finally{if(stale)await stale.close();await page.unrouteAll({behavior:'ignoreErrors'});if(viewport)await page.setViewportSize(viewport);await page.goto(appUrl+'/dashboard?lang='+locale)}
 // Retain synthetic sources, posted journals and immutable resolution history.
}
