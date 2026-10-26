import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
const expect=baseExpect.configure({timeout:25_000})
/** Requires a fresh, dedicated synthetic tenant. Final evidence is retained. */
export async function verifyApplicationReviews(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!tenantId)throw Error('Synthetic application tenant required')
 const initial=await admin.from('driver_applications').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId)
 if(initial.error||initial.count!==0)throw Error('Fresh dedicated application tenant required')
 const tag=randomUUID().slice(0,8),ids=[randomUUID(),randomUUID(),randomUUID()],docId=randomUUID()
 const needle=`Needle "${tag},50%_`,name='Review Candidate '+tag,withdrawName='Withdraw Candidate '+tag,rejectName='Reject Candidate '+tag
 const names=[name,withdrawName,rejectName],viewport=page.viewportSize(),originalLocale=await page.locator('html').getAttribute('lang')
 const fixture=(id,full_name,created_at)=>({id,tenant_id:tenantId,first_name:'Synthetic',last_name:'Applicant',full_name,mobile:'+966500000140',identity_type:'iqama',work_type:'freelancer',consent_terms:true,consent_privacy:true,created_at})
 let stage='synthetic fixtures',stale=null,lastWrite=0
 const write=async button=>{const wait=2100-(Date.now()-lastWrite);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastWrite=Date.now();await button.click()}
 const current=async id=>{const r=await admin.from('driver_applications').select('status,workflow_version,reviewed_by,reviewed_at,review_note,archived_at,withdrawn_at,withdrawn_by,withdrawal_reason').eq('tenant_id',tenantId).eq('id',id).single();if(r.error)throw Error('Synthetic application verification read failed');return r.data}
 try{
  await page.setViewportSize({width:1440,height:1000})
  const inserted=await admin.from('driver_applications').insert([...ids.map((id,i)=>fixture(id,names[i],'2026-10-23T00:00:00Z')),...Array.from({length:205},(_,i)=>fixture(randomUUID(),i===0?needle:`Paged Candidate ${tag} ${i}`,new Date(Date.UTC(2000,0,1,0,0,i)).toISOString()))])
  if(inserted.error)throw Error('Synthetic application fixtures failed')
  const document=await admin.from('driver_application_documents').insert({id:docId,tenant_id:tenantId,application_id:ids[0],document_type:'identity',file_name:'synthetic-identity.pdf',storage_path:tenantId+'/synthetic/'+tag+'/identity.pdf'})
  if(document.error)throw Error('Synthetic document metadata fixture failed')
  stage='complete pages and literal search'
  await page.goto(appUrl+'/applications?lang=en')
  const rows=page.locator('tbody tr'),search=page.getByRole('textbox').first(),metrics=page.locator('main div.text-2xl.font-bold')
  await expect(rows).toHaveCount(25);await expect(page.getByText('208 records · Page 1 of 9',{exact:true})).toBeVisible()
  await expect(metrics.nth(0)).toHaveText('208');await expect(metrics.nth(1)).toHaveText('208')
  await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByText('208 records · Page 2 of 9',{exact:true})).toBeVisible()
  await search.fill(needle);await expect(rows).toHaveCount(1);await expect(rows).toContainText(needle)
  await expect(metrics.nth(0)).toHaveText('208')
  stage='list failure and retry'
  const pattern='**/applications*'
  const failList=route=>route.request().method()==='POST'&&route.request().headers()['next-action']&&new URL(route.request().url()).pathname==='/applications'
   ?route.fulfill({status:503,contentType:'text/plain',body:'Synthetic application page unavailable'}):route.continue()
  await page.route(pattern,failList);await search.fill('Read fault '+tag)
  await expect(page.getByText('Could not load applications and their totals. Try again.',{exact:true})).toBeVisible()
  await expect(page.getByTestId('module-empty-state')).toHaveCount(0);await expect(metrics.nth(0)).toHaveText('—')
  await page.unroute(pattern,failList);await page.getByRole('button',{name:/^(Retry|Try again)$/}).click()
  await expect(page.getByTestId('module-empty-state')).toBeVisible();await expect(metrics.nth(0)).toHaveText('208')
  stage='submitted to under review'
  await page.goto(appUrl+'/applications/'+ids[0]+'?lang=en')
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
  const reason=page.locator('#application-review-reason')
  await expect(page.getByRole('button',{name:'Approve',exact:true})).toBeDisabled()
  await reason.fill('Begin synthetic document review');await write(page.getByRole('button',{name:'Under Review',exact:true}))
  await expect(reason).toHaveValue('');await expect(page.getByRole('button',{name:'Under Review',exact:true})).toBeDisabled()
  const reviewed=await current(ids[0]);if(reviewed.status!=='under_review'||reviewed.workflow_version!==3||!reviewed.reviewed_by)throw Error('Under review decision evidence differs')
  stage='changed document invalidates stale approval'
  stale=await page.context().newPage();await stale.goto(appUrl+'/applications/'+ids[0]+'?lang=en');await expect(stale.getByRole('heading',{name,exact:true})).toBeVisible()
  const replaced=await admin.from('driver_application_documents').update({file_name:'synthetic-identity-corrected.pdf'}).eq('tenant_id',tenantId).eq('id',docId)
  if(replaced.error)throw Error('Pending synthetic document update failed')
  await stale.locator('#application-review-reason').fill('Approve previously seen documents');await write(stale.getByRole('button',{name:'Approve',exact:true}))
  await expect(stale.getByText('This application changed. Reload and review it before deciding.',{exact:true})).toBeVisible()
  const unchanged=await current(ids[0]);if(unchanged.status!=='under_review'||unchanged.workflow_version!==4)throw Error('Stale approval altered current document decision')
  stage='final approval and immutable decision controls'
  await page.setViewportSize({width:390,height:844})
  await page.reload();await expect(page.getByText('synthetic-identity-corrected.pdf',{exact:false})).toBeVisible()
  await reason.fill('Approved current synthetic identity evidence');await write(page.getByRole('button',{name:'Approve',exact:true}))
  await expect(page.getByRole('button',{name:'Archive application',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Reject',exact:true})).toHaveCount(0)
  const approvalToast=page.locator('[data-sonner-toast]').filter({hasText:'Application approved'})
  await expect(approvalToast).toBeVisible();await approvalToast.hover()
  const approved=await current(ids[0]);if(approved.status!=='approved'||approved.workflow_version!==5||approved.review_note!=='Approved current synthetic identity evidence')throw Error('Final approval evidence differs')
  stage='archive visibility and preserved final evidence'
  await reason.fill('Archive completed synthetic review')
  const archiveButton=page.getByRole('button',{name:'Archive application',exact:true})
  await expect(approvalToast).toBeVisible()
  await expect.poll(()=>archiveButton.evaluate(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&button.contains(hit)})).toBe(true)
  await write(archiveButton)
  await expect(page.getByRole('button',{name:'Restore to list',exact:true})).toBeVisible()
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(appUrl+'/applications?lang=en');await page.getByRole('checkbox',{name:'Archived history',exact:true}).check()
  await expect(rows).toHaveCount(1);await expect(rows).toContainText(name);await expect(metrics.nth(0)).toHaveText('1')
  await rows.first().click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
  await reason.fill('Restore visibility of approved synthetic history');await write(page.getByRole('button',{name:'Restore to list',exact:true}))
  await expect(page.getByRole('button',{name:'Archive application',exact:true})).toBeVisible()
  const restored=await current(ids[0]);if(restored.status!=='approved'||restored.workflow_version!==7||restored.archived_at||restored.review_note!==approved.review_note||restored.reviewed_by!==approved.reviewed_by)throw Error('Archive/restore rewrote the original decision')
  stage='withdraw pending application'
  await page.goto(appUrl+'/applications/'+ids[1]+'?lang=en');await expect(page.getByRole('heading',{name:withdrawName,exact:true})).toBeVisible()
  await reason.fill('Applicant withdrew this synthetic request');await write(page.getByRole('button',{name:'Withdraw application',exact:true}))
  await expect(page.getByRole('button',{name:'Archive application',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0)
  const withdrawn=await current(ids[1]);if(withdrawn.status!=='withdrawn'||!withdrawn.withdrawn_at||!withdrawn.withdrawn_by||withdrawn.withdrawal_reason!=='Applicant withdrew this synthetic request')throw Error('Withdrawal evidence differs')
  stage='reject pending application with required reason'
  await page.goto(appUrl+'/applications/'+ids[2]+'?lang=en');await expect(page.getByRole('heading',{name:rejectName,exact:true})).toBeVisible()
  await reason.fill('Incomplete synthetic eligibility evidence');await write(page.getByRole('button',{name:'Reject',exact:true}))
  await expect(page.getByRole('button',{name:'Archive application',exact:true})).toBeVisible()
  if((await current(ids[2])).status!=='rejected')throw Error('Rejection not persisted')
  stage='detail read failure and retry'
  const docsPattern='**/rest/v1/driver_application_documents?**',failDocs=route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic document metadata unavailable"}'})
  await page.route(docsPattern,failDocs);await page.reload()
  await expect(page.getByText('Could not load the application or its documents. Try again.',{exact:true})).toBeVisible()
  await page.unroute(docsPattern,failDocs);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('heading',{name:rejectName,exact:true})).toBeVisible()
  stage='retained decision and archive audits'
  const audits=await admin.from('audit_log').select('entity_id,action').eq('tenant_id',tenantId).in('entity_id',ids)
  if(audits.error||audits.data.filter(r=>r.entity_id===ids[0]&&r.action==='application_reviewed').length!==2||audits.data.filter(r=>r.action==='application_archived').length!==1||audits.data.filter(r=>r.action==='application_restored').length!==1||audits.data.filter(r=>r.action==='application_withdrawn').length!==1||audits.data.filter(r=>r.entity_id===ids[2]&&r.action==='application_reviewed').length!==1)throw Error('Decision/audit history differs')
  stage='Arabic and English mobile controls'
  await page.goto(appUrl+'/applications?lang=en');await expect(metrics.nth(0)).toHaveText('208');await expect(metrics.nth(1)).toHaveText('205');await expect(metrics.nth(2)).toHaveText('1');await expect(metrics.nth(3)).toHaveText('1')
  await page.goto(appUrl+'/applications?lang=ar');await expect(page.locator('html')).toHaveAttribute('lang','ar')
  await page.getByRole('button',{name:'مسحوب',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows).toContainText(withdrawName)
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.screenshot({path:'supabase/.temp/applications-review-mobile-ar.png',fullPage:true})
  await page.goto(appUrl+'/applications/'+ids[0]+'?lang=ar');await expect(page.getByRole('button',{name:'أرشفة الطلب',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'قبول',exact:true})).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  console.log(JSON.stringify({check:'application complete pages, literal search/retries, versioned reviews/documents, approve/reject/withdraw, archive/restore, audit evidence and Arabic mobile',result:'PASS'}))
 }catch(error){
  console.error(JSON.stringify({check:'application review',stage,errorType:error.name}))
  await page.screenshot({path:'supabase/.temp/application-review-failure.png',fullPage:true}).catch(()=>{})
  throw Error('Application review verification failed: '+stage)
 }finally{
  if(stale)await stale.close();await page.unrouteAll({behavior:'ignoreErrors'})
  if(viewport)await page.setViewportSize(viewport)
  await page.goto(appUrl+'/dashboard?lang='+(originalLocale??'en'))
 }
 // Application and document metadata/audits remain in this isolated synthetic
 // tenant. No Storage objects are uploaded; no final history is deleted.
}
