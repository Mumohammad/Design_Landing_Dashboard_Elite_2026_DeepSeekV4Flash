import {expect as baseExpect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {assertModuleTestTarget} from './assert-module-test-target.mjs'
const expect=baseExpect.configure({timeout:30_000})
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 46>>stream\nBT /F1 12 Tf 20 100 Td (Synthetic evidence) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=','base64')

/** Actual UI uploads/actions in an isolated staging tenant. Retains source objects and final audit history. */
export async function verifyDriverEvidence(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!/^[0-9a-f-]{36}$/i.test(tenantId??''))throw Error('Synthetic evidence tenant required')
 const id=randomUUID(),tag=randomUUID().slice(0,8),viewport=page.viewportSize(),locale=await page.locator('html').getAttribute('lang'),needle='History 50%_ '+tag
 let stage='synthetic driver',second=null,readFailure=null,lastWrite=0
 const pattern='**/rest/v1/driver_documents?**',staleText='This driver or evidence changed. Reload and review it before saving.'
 const pace=async()=>{const wait=4400-(Date.now()-lastWrite);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastWrite=Date.now()}
 const write=async locator=>{await pace();await locator.click()}
 const docs=(target,docId)=>target.locator('[data-testid="driver-document-record"][data-document-id="'+docId+'"]')
 const evidence=(target,docId)=>target.locator('[data-testid="driver-evidence-document"][data-document-id="'+docId+'"]')
 const open=async(target,tab='Documents',lang='en')=>{await target.goto(appUrl+'/drivers/'+id+'?lang='+lang);await target.getByRole('tab',{name:tab,exact:true}).click();return target.getByRole('tabpanel',{name:tab,exact:true})}
 const list=async(table,select='*',filter={})=>{let q=admin.from(table).select(select).eq('tenant_id',tenantId);for(const[k,v]of Object.entries(filter))q=v===null?q.is(k,null):q.eq(k,v);const r=await q;if(r.error)throw Error('Synthetic persisted evidence unavailable: '+table);return r.data}
 const readDriver=async()=>{const r=await admin.from('drivers').select('photo_url,card_status,profile_version').eq('tenant_id',tenantId).eq('id',id).single();if(r.error)throw Error('Synthetic driver unavailable');return r.data}
 const getDoc=async number=>{const rows=await list('driver_documents','*',{driver_id:id,doc_number:number});if(rows.length!==1)throw Error('Expected one synthetic document');return rows[0]}
 const retained=async(bucket,path)=>{const r=await admin.storage.from(bucket).download(path);if(r.error||!r.data?.size)throw Error('Synthetic uploaded object was not retained')}
 const prepareUpload=async(target,number,replaceId=null)=>{
  const panel=await open(target)
  await(replaceId?docs(target,replaceId).getByRole('button',{name:'Replace',exact:true}):panel.getByRole('button',{name:'Upload document',exact:true})).click()
  const dialog=target.getByRole('dialog')
  if(!replaceId){await dialog.locator('#doc-type').click();await target.getByRole('option',{name:'Health certificate',exact:true}).click()}
  await dialog.locator('#doc-number').fill(number);await dialog.locator('#doc-expiry').fill('2098-12-31');await dialog.locator('#doc-file').setInputFiles({name:'synthetic-evidence.pdf',mimeType:'application/pdf',buffer:pdf})
  await expect(dialog.getByRole('button',{name:'Upload',exact:true})).toBeEnabled();return dialog
 }
 const upload=async number=>{const dialog=await prepareUpload(page,number);await write(dialog.getByRole('button',{name:'Upload',exact:true}));await expect(dialog).toBeHidden();return getDoc(number)}
 try{
  const driver=await admin.from('drivers').insert({id,tenant_id:tenantId,full_name_ar:'سائق اختبار المستندات '+tag,full_name_en:'Evidence browser fixture '+tag,primary_mobile:'0501440001',category:'freelancer',status:'active',hire_date:'2020-01-01'})
  if(driver.error)throw Error('Synthetic driver fixture failed')
  let panel=await open(page);await expect(panel.getByText('No documents for this driver',{exact:true})).toBeVisible()
  stage='actual private Storage upload and atomic metadata finalization'
  const first=await upload(needle);expect(first).toMatchObject({is_active:true,is_verified:false,workflow_version:1,mime_type:'application/pdf',file_size_bytes:pdf.length});expect(first.file_url).toMatch(new RegExp('^'+tenantId+'/'+id+'/health_certificate-[a-f0-9-]+\\.pdf$'));await retained('driver-documents',first.file_url)
  stage='reviewed verification and retained replacement history'
  await open(page,'Compliance');await write(evidence(page,first.id).getByRole('button',{name:'Verify',exact:true}));await expect.poll(async()=>(await getDoc(needle)).is_verified).toBe(true)
  const verified=await getDoc(needle);expect(verified.verified_by).toBeTruthy();expect(verified.verified_at).toBeTruthy();expect(verified.workflow_version).toBe(2)
  const replace=await prepareUpload(page,'Replacement '+tag,first.id);await write(replace.getByRole('button',{name:'Upload',exact:true}));await expect(replace).toBeHidden()
  expect(await getDoc(needle)).toMatchObject({is_active:false,is_verified:true,workflow_version:3,file_url:first.file_url,verified_at:verified.verified_at})
  panel=await open(page);await expect(docs(page,first.id)).toHaveCount(0);await panel.getByRole('checkbox',{name:'Replacement history',exact:true}).check();await expect(docs(page,first.id)).toBeVisible();await expect(docs(page,first.id).getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);await retained('driver-documents',first.file_url)
  stage='stale second-tab metadata finalization retains uploaded object'
  const staleDialog=await prepareUpload(page,'Stale upload '+tag)
  second=await page.context().newPage();const winner=await prepareUpload(second,'Current upload '+tag);await write(winner.getByRole('button',{name:'Upload',exact:true}));await expect(winner).toBeHidden()
  await write(staleDialog.getByRole('button',{name:'Upload',exact:true}));await expect(page.getByText(staleText,{exact:true})).toBeVisible();await expect(staleDialog).toBeVisible();await expect(staleDialog.locator('#doc-number')).toHaveValue('Stale upload '+tag)
  expect(await list('driver_documents','id',{driver_id:id,doc_number:'Stale upload '+tag})).toHaveLength(0)
  const stored=await admin.storage.from('driver-documents').list(tenantId+'/'+id,{limit:100});if(stored.error)throw Error('Synthetic object list failed');expect(stored.data.length).toBe(4)
  await staleDialog.getByRole('button',{name:'Cancel',exact:true}).click();await second.close();second=null
  stage='reviewed document retirement through mounted delete dialog'
  const current=await getDoc('Current upload '+tag);panel=await open(page);await docs(page,current.id).getByRole('button',{name:'Delete',exact:true}).click();const dialog=page.getByRole('dialog');await write(dialog.getByRole('button',{name:'Delete',exact:true}));await expect(dialog).toBeHidden();await expect.poll(async()=>(await getDoc('Current upload '+tag)).is_active).toBe(false)
  const retired=await getDoc('Current upload '+tag);expect(retired.deleted_at).toBeTruthy();expect(retired.workflow_version).toBe(2);await retained('driver-documents',current.file_url)
  stage='photo update and removal retain the object'
  await open(page,'Compliance');await pace();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Change photo',exact:true}).click();await(await chooser).setFiles({name:'synthetic-photo.png',mimeType:'image/png',buffer:png})
  await expect.poll(async()=>(await readDriver()).photo_url).not.toBeNull();const photoPath=(await readDriver()).photo_url;await retained('driver-photos',photoPath)
  await page.getByRole('button',{name:'Preview photo',exact:true}).click();await write(page.getByRole('dialog').getByRole('button',{name:'Remove photo',exact:true}));await expect.poll(async()=>(await readDriver()).photo_url).toBeNull();await retained('driver-photos',photoPath)
  stage='concurrent two-tab card issuance has one committed source'
  await open(page,'Compliance');second=await page.context().newPage();await open(second,'Compliance');const oneCard=page.getByTestId('driver-card-panel'),twoCard=second.getByTestId('driver-card-panel');await expect(oneCard.getByRole('button',{name:'Issue card',exact:true})).toBeEnabled();await expect(twoCard.getByRole('button',{name:'Issue card',exact:true})).toBeEnabled();await pace()
  await Promise.all([oneCard.getByRole('button',{name:'Issue card',exact:true}).click(),twoCard.getByRole('button',{name:'Issue card',exact:true}).click()])
  await expect.poll(async()=>(await list('driver_cards','id',{driver_id:id,status:'active'})).length).toBe(1)
  await expect.poll(async()=>[...(await page.getByRole('alert').allTextContents()),...(await second.getByRole('alert').allTextContents())].join(' ')).toContain(staleText)
  const card=(await list('driver_cards','*',{driver_id:id,status:'active'}))[0];expect((await readDriver()).card_status).toBe('active');expect(await list('audit_log','id',{entity_id:card.id,action:'card_issue'})).toHaveLength(1);await second.close();second=null
  stage='actual selected card print format records a request and opens the matching output'
  await open(page,'Compliance');await page.getByTestId('driver-card-panel').getByRole('button',{name:'Preview card',exact:true}).click();const preview=page.getByRole('dialog');await preview.getByRole('combobox').click();await page.getByRole('option',{name:'A4',exact:true}).click()
  const popupEvent=page.waitForEvent('popup');await write(preview.getByRole('button',{name:'Print',exact:true}));const popup=await popupEvent;await popup.evaluate(()=>{window.print=()=>{}});await expect(popup.locator('body')).toHaveAttribute('data-card-format','a4');await expect(popup.locator('.card-sheet')).toHaveCount(2);await popup.close()
  await expect.poll(async()=>(await list('driver_card_prints','format',{card_id:card.id})).length).toBe(1);expect((await list('driver_card_prints','format',{card_id:card.id}))[0].format).toBe('a4');expect((await list('driver_cards','reprint_count',{id:card.id}))[0].reprint_count).toBe(1)
  stage='reviewed card revoke and immutable final source'
  await open(page,'Compliance');await page.getByTestId('driver-card-panel').getByRole('button',{name:'Revoke card',exact:true}).click();const revoke=page.getByRole('dialog');await expect(revoke.getByRole('button',{name:'Revoke card',exact:true})).toBeDisabled();await revoke.locator('#revoke-reason').fill('Synthetic card review '+tag);await write(revoke.getByRole('button',{name:'Revoke card',exact:true}));await expect(revoke).toBeHidden();await expect.poll(async()=>(await readDriver()).card_status).toBe('revoked');const finalCard=(await list('driver_cards','*',{id:card.id}))[0];expect(finalCard).toMatchObject({status:'revoked',workflow_version:3,reprint_count:1});expect(finalCard.revoked_at).toBeTruthy()
  stage='missing identity override and reviewed revocation'
  await open(page,'Compliance');let engine=page.getByTestId('driver-compliance-engine');await engine.getByRole('listitem').filter({has:page.getByText('Identity',{exact:true})}).getByRole('button',{name:'Override',exact:true}).click();const overrideDialog=page.getByRole('dialog');await expect(overrideDialog.getByRole('button',{name:'Approve override',exact:true})).toBeDisabled();await overrideDialog.locator('#ovr-reason').fill('Synthetic identity renewal '+tag);await write(overrideDialog.getByRole('button',{name:'Approve override',exact:true}));await expect(overrideDialog).toBeHidden()
  const override=(await list('driver_compliance_overrides','*',{driver_id:id,revoked_at:null}))[0];expect(override).toMatchObject({requirement:'identity',workflow_version:1});expect(override.approved_by).toBeTruthy()
  await open(page,'Compliance');await write(page.locator('[data-testid="driver-evidence-override"][data-override-id="'+override.id+'"]').getByRole('button',{name:'Revoke',exact:true}));await expect.poll(async()=>(await list('driver_compliance_overrides','revoked_at',{id:override.id}))[0].revoked_at).not.toBeNull();expect((await list('driver_compliance_overrides','workflow_version,reason',{id:override.id}))[0]).toMatchObject({workflow_version:2,reason:'Synthetic identity renewal '+tag})
  stage='complete retained replacement history beyond one page'
  // Use actual authorized UI uploads because evidence table DML is deliberately revoked from service_role.
  for(let i=0;i<27;i++)await upload('History replacement '+String(i).padStart(2,'0')+' '+tag)
  const past=await list('driver_documents','id',{driver_id:id,is_active:false,deleted_at:null});expect(past.length).toBeGreaterThan(25)
  panel=await open(page);await panel.getByRole('checkbox',{name:'Replacement history',exact:true}).check();await expect(panel.getByTestId('driver-document-record')).toHaveCount(25);await panel.getByRole('button',{name:'Next page',exact:true}).click();await expect(docs(page,first.id)).toBeVisible()
  const search=panel.getByRole('searchbox',{name:'Search history',exact:true});await search.pressSequentially(needle,{delay:30});await expect(search).toBeFocused();await expect(panel.getByTestId('driver-document-record')).toHaveCount(1);await expect(docs(page,first.id)).toBeVisible()
  stage='history read failure retains toolbar and distinguishes empty state'
  readFailure=route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic evidence history unavailable"}'}):route.continue();await page.route(pattern,readFailure);await panel.getByRole('button',{name:'Refresh',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Could not load documents. Try again.');await expect(panel.getByText('No documents for this driver',{exact:true})).toHaveCount(0);await expect(panel.getByRole('searchbox',{name:'Search history',exact:true})).toBeVisible();await page.unroute(pattern,readFailure);readFailure=null;await panel.getByRole('button',{name:'Try again',exact:true}).click();await expect(docs(page,first.id)).toBeVisible()
  stage='audit privacy and expected one-per-success evidence'
  const rows=await list('audit_log','action,entity_type,old_values,new_values',{entity_type:'driver_evidence'}),own=rows.filter(row=>JSON.stringify([row.old_values,row.new_values]).includes(id)),serialized=JSON.stringify(own)
  expect(serialized).not.toContain(needle);expect(serialized).not.toContain(first.file_url);expect(serialized).not.toContain('Synthetic identity renewal');expect(own.filter(row=>row.action==='card_issue')).toHaveLength(1);expect(own.filter(row=>row.action==='card_print_requested')).toHaveLength(1);expect(own.filter(row=>row.action==='photo_remove')).toHaveLength(1)
  stage='Arabic mobile document history and compliance'
  panel=await open(page,'المستندات','ar');await page.setViewportSize({width:390,height:844});await expect(page.locator('html')).toHaveAttribute('lang','ar');await panel.getByRole('checkbox',{name:'سجل الاستبدال',exact:true}).check();await expect(panel.getByRole('searchbox',{name:'بحث في السجل',exact:true})).toBeVisible();await expect.poll(()=>panel.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(2)
  await page.getByRole('tab',{name:'الامتثال',exact:true}).click();engine=page.getByTestId('driver-compliance-engine');await expect(engine.getByText('الهوية',{exact:true})).toBeVisible();await expect(engine.getByText('missing',{exact:true})).toHaveCount(0);await page.screenshot({path:'supabase/.temp/driver-evidence-mobile-ar.png',fullPage:true})
  console.log(JSON.stringify({check:'driver evidence actual uploads, reviewed source decisions, stale/concurrent writes, retained history paging, print request format, audit privacy and Arabic mobile',result:'PASS'}))
 }catch(error){console.error(JSON.stringify({check:'driver evidence lifecycle',stage,errorType:error.name}));await page.screenshot({path:'supabase/.temp/driver-evidence-failure.png',fullPage:true}).catch(()=>{});throw Error('Driver evidence verification failed: '+stage)}
 finally{if(second)await second.close();if(readFailure)await page.unroute(pattern,readFailure);if(viewport)await page.setViewportSize(viewport);await page.goto(appUrl+'/dashboard?lang='+(locale??'en'))}
}
