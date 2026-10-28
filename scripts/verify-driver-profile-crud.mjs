import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {expect as baseExpect} from '@playwright/test'
import {assertModuleTestTarget} from './assert-module-test-target.mjs'
import {writeReleaseEvidence} from './lib/write-release-evidence.mjs'
const expect=baseExpect.configure({timeout:30_000})
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??'')

/** Ordinary UI mutations in the coordinator's owned staging tenant. No business history is deleted. */
export async function verifyDriverProfileCrud(page,admin,tenantId,appUrl){
  await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
  const runId=process.env.VERIFY_RELEASE_RUN_ID
  if(!uuid(tenantId)||!uuid(runId)||process.env.VERIFY_MODULE_GROUP!=='drivers')throw Error('Owned drivers acceptance group required')
  const tenant=await admin.from('tenants').select('created_by,domain').eq('id',tenantId).single()
  if(tenant.error||!uuid(tenant.data.created_by)||!uuid(tenant.data.domain?.replace(/\.test$/,''))||!tenant.data.domain.endsWith('.test'))throw Error('Synthetic driver tenant identity unavailable')
  const owner=await admin.auth.admin.getUserById(tenant.data.created_by)
  if(owner.error||owner.data.user?.app_metadata?._release_acceptance_run!==runId||owner.data.user.app_metadata?._release_acceptance_group!=='drivers')throw Error('Driver tenant ownership differs')
  const actorId=tenant.data.created_by,tag=randomUUID(),arabicName='سائق اختبار واجهة الملف '+tag,name='Profile UI '+tag
  const evidenceDir=path.resolve(process.env.VERIFY_EVIDENCE_DIR??'')
  if(evidenceDir!==path.resolve('supabase/.temp/release-acceptance-'+runId+'/'+'drivers'))throw Error('Canonical owned group evidence required before fixtures')
  const relative=path.relative(path.resolve('supabase/.temp'),evidenceDir)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(evidenceDir).isDirectory())throw Error('Owned ignored evidence directory required')
  const ledger={schemaVersion:1,runId,group:'drivers',tenantId,actorId,marker:tag,driverId:null,codHold:null,result:'RUNNING',cleanup:'NOT_REQUIRED',startedAt:new Date().toISOString()}
  const save=()=>writeReleaseEvidence(path.join(evidenceDir,'driver-profile-crud-fixture.json'),ledger)
  save()
  let stage='create driver',stale,lastWrite=0,holdVersion
  const viewport=page.viewportSize(),locale=await page.locator('html').getAttribute('lang')
  const pace=async()=>{const wait=4400-(Date.now()-lastWrite);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastWrite=Date.now()}
  const write=async locator=>{await pace();await locator.scrollIntoViewIfNeeded();await locator.click()}
  const read=async()=>{
    const result=await admin.from('drivers').select('id,tenant_id,full_name_ar,full_name_en,primary_mobile,category,status,profile_version,cod_outstanding_amount,deleted_at,archived_reason,created_by')
      .eq('tenant_id',tenantId).eq('id',ledger.driverId).single()
    if(result.error||result.data.created_by!==actorId||result.data.full_name_ar!==arabicName)throw Error('Owned UI driver evidence unavailable')
    return result.data
  }
  const audit=async()=>{
    const result=await admin.from('audit_log').select('id,action,actor_id,old_values,new_values')
      .eq('tenant_id',tenantId).eq('entity_type','driver').eq('entity_id',ledger.driverId).eq('module','drivers').order('id')
    if(result.error)throw Error('Owned UI driver audit unavailable')
    return result.data
  }
  const menu=async(target,label)=>{await target.getByRole('button',{name:'Actions',exact:true}).click();await target.getByRole('menuitem',{name:label,exact:true}).click()}
  const restoreHold=async()=>{
    if(!ledger.codHold)return
    const held=await read()
    if(held.deleted_at||Number(held.cod_outstanding_amount)!==1||held.profile_version!==holdVersion)throw Error('Synthetic COD hold changed; automatic restoration refused')
    const restored=await admin.from('drivers').update({cod_outstanding_amount:ledger.codHold.original})
      .eq('tenant_id',tenantId).eq('id',ledger.driverId).eq('created_by',actorId).eq('profile_version',holdVersion).eq('cod_outstanding_amount',1).is('deleted_at',null).select('id')
    if(restored.error||restored.data?.length!==1||Number((await read()).cod_outstanding_amount)!==0)throw Error('Synthetic COD hold restoration unverified')
    ledger.codHold=null;holdVersion=undefined;ledger.cleanup='PASS';save()
  }
  try{
    await page.goto(appUrl+'/drivers?lang=en')
    await page.getByRole('button',{name:'Add New',exact:true}).first().click()
    const create=page.getByRole('dialog',{name:'Create New Driver',exact:true})
    await create.getByLabel('Full name (Arabic)',{exact:false}).fill(arabicName)
    await create.getByLabel('Full name (English)',{exact:true}).fill(name)
    await create.getByLabel('Primary mobile',{exact:false}).fill('0501490001')
    await write(create.getByRole('button',{name:'Create driver',exact:true}))
    await expect(create).toBeHidden()
    await page.waitForURL(url=>/^\/drivers\/[0-9a-f-]{36}$/.test(url.pathname))
    ledger.driverId=new URL(page.url()).pathname.split('/').at(-1)
    if(!uuid(ledger.driverId))throw Error('Created driver identity unavailable')
    save()
    const created=await read()
    expect(created).toMatchObject({full_name_en:name,primary_mobile:'0501490001',category:'sponsored_type1',status:'draft',deleted_at:null})
    expect(created.profile_version).toBeGreaterThan(0)
    await page.reload()
    await expect(page.getByRole('heading',{name:arabicName,exact:true})).toBeVisible()
    stage='versioned edit and stale second tab'
    stale=await page.context().newPage()
    await stale.goto(appUrl+'/drivers/'+ledger.driverId+'?lang=en')
    await menu(stale,'Edit driver')
    const oldEditor=stale.getByRole('dialog',{name:/^Edit driver/})
    await expect(oldEditor.getByLabel('Full name (English)',{exact:true})).toHaveValue(name)
    await menu(page,'Edit driver')
    const editor=page.getByRole('dialog',{name:/^Edit driver/})
    const editedName=name+' edited'
    await editor.getByLabel('Full name (English)',{exact:true}).fill(editedName)
    await write(editor.getByRole('button',{name:'Save changes',exact:true}))
    await expect(editor).toBeHidden()
    const edited=await read()
    expect(edited.full_name_en).toBe(editedName)
    expect(edited.profile_version).toBeGreaterThan(created.profile_version)
    const beforeStale=await audit()
    await oldEditor.getByLabel('Full name (English)',{exact:true}).fill(name+' stale overwrite')
    await write(oldEditor.getByRole('button',{name:'Save changes',exact:true}))
    await expect(stale.getByText('DRIVER_STALE_VERSION: reload the driver before saving',{exact:true})).toBeVisible()
    await expect(oldEditor).toBeVisible()
    expect(await read()).toEqual(edited)
    expect(await audit()).toEqual(beforeStale)
    await oldEditor.getByRole('button',{name:'Cancel',exact:true}).click()
    await stale.close();stale=undefined
    stage='activate suspend and reactivate with reviewed reason'
    for(const[label,status,reason]of [['Activate','active','Synthetic activation '+tag],['Suspend driver','suspended','Synthetic suspension '+tag],['Reactivate','active','Synthetic resumption '+tag]]){
      await menu(page,label)
      const dialog=page.getByRole('dialog',{name:label,exact:true})
      if(status==='suspended'){
        await dialog.locator('#action-reason-'+ledger.driverId).fill('x')
        await expect(dialog.getByRole('button',{name:'Confirm',exact:true})).toBeDisabled()
      }
      await dialog.locator('#action-reason-'+ledger.driverId).fill(reason)
      const prior=await read()
      await write(dialog.getByRole('button',{name:'Confirm',exact:true}))
      await expect(dialog).toBeHidden()
      await expect.poll(async()=>(await read()).status).toBe(status)
      expect((await read()).profile_version).toBeGreaterThan(prior.profile_version)
    }
    stage='owned synthetic COD hold blocks archive without mutation'
    const original=await read()
    if(Number(original.cod_outstanding_amount)!==0)throw Error('Fresh owned driver unexpectedly has COD balance')
    ledger.codHold={original:'0.00',injected:'1.00',intentVersion:original.profile_version};ledger.cleanup='REQUIRED';save()
    const held=await admin.from('drivers').update({cod_outstanding_amount:'1.00'})
      .eq('tenant_id',tenantId).eq('id',ledger.driverId).eq('created_by',actorId).eq('profile_version',original.profile_version).eq('cod_outstanding_amount',0).is('deleted_at',null).select('id,profile_version')
    if(held.error||held.data?.length!==1)throw Error('Synthetic COD hold injection unverified')
    holdVersion=held.data[0].profile_version;ledger.codHold.heldVersion=holdVersion;save()
    const confirmedHold=await read()
    if(Number(confirmedHold.cod_outstanding_amount)!==1||confirmedHold.profile_version<holdVersion)throw Error('Synthetic COD hold final version unverified')
    holdVersion=confirmedHold.profile_version;ledger.codHold.heldVersion=holdVersion;save()
    await menu(page,'Archive')
    const archive=page.getByRole('dialog',{name:'Archive driver',exact:true})
    await expect(archive.getByRole('button',{name:'Confirm',exact:true})).toBeDisabled()
    await archive.locator('#action-reason-'+ledger.driverId).fill('Retire synthetic browser driver '+tag)
    const heldRow=await read(),beforeDenied=await audit()
    await write(archive.getByRole('button',{name:'Confirm',exact:true}))
    await expect(page.getByText('DRIVER_RESOLVE_OPEN_BALANCES_FIRST',{exact:true})).toBeVisible()
    await expect(archive).toBeVisible()
    expect(await read()).toEqual(heldRow)
    expect(await audit()).toEqual(beforeDenied)
    await archive.getByRole('button',{name:'Cancel',exact:true}).click()
    await restoreHold()
    stage='safe archival preserves owned source and lifecycle audit'
    await menu(page,'Archive')
    const reason='Retire synthetic browser driver '+tag
    await archive.locator('#action-reason-'+ledger.driverId).fill(reason)
    const prior=await read()
    await write(archive.getByRole('button',{name:'Confirm',exact:true}))
    await page.waitForURL(url=>url.pathname==='/drivers')
    const archived=await read()
    expect(archived.archived_reason).toBe(reason)
    expect(archived.deleted_at).toBeTruthy()
    expect(archived.profile_version).toBeGreaterThan(prior.profile_version)
    expect(archived.full_name_en).toBe(editedName)
    expect(Number(archived.cod_outstanding_amount)).toBe(0)
    await page.reload()
    await expect(page.getByRole('row').filter({hasText:arabicName})).toHaveCount(0)
    const actions=await audit()
    for(const[action,count]of [['created',1],['updated',1],['status_changed',3],['archived',1]])expect(actions.filter(row=>row.action===action)).toHaveLength(count)
    expect(actions.every(row=>row.actor_id===actorId)).toBe(true)
    const history=actions.filter(row=>row.action==='status_changed')
    expect(history.map(row=>row.new_values.status).sort()).toEqual(['active','active','suspended'])
    expect(actions.find(row=>row.action==='archived').new_values).toMatchObject({archived:true,reason_recorded:true})
    ledger.result='PASS';save()
    console.log(JSON.stringify({check:'driver top-level accessible create, persisted edit, stale-tab denial, status reasons, COD archive denial and retained lifecycle',result:'PASS'}))
  }catch(error){ledger.result='FAIL';ledger.failedStage=stage;save();error.verificationStage=stage;throw error}
  finally{
    try{await restoreHold()}catch{ledger.cleanup='UNVERIFIED';save();throw Error('Owned synthetic driver hold cleanup requires recovery')}
    finally{if(stale)await stale.close().catch(()=>{});if(viewport)await page.setViewportSize(viewport);ledger.finishedAt=new Date().toISOString();save();await page.goto(appUrl+'/drivers?lang='+(locale==='ar'?'ar':'en')).catch(()=>{})}
  }
}
