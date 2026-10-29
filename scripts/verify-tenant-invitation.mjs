import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {expect as baseExpect} from '@playwright/test'
import {assertModuleTestTarget} from './assert-module-test-target.mjs'
import {writeReleaseEvidence} from './lib/write-release-evidence.mjs'
const expect=baseExpect.configure({timeout:30_000})
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??'')

/** Invitation issuance only. Never accepts a token, creates Auth users, or claims external email delivery. */
export async function verifyTenantInvitation(page,admin,tenantId,appUrl){
  await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
  const runId=process.env.VERIFY_RELEASE_RUN_ID
  if(!uuid(tenantId)||!uuid(runId)||process.env.VERIFY_MODULE_GROUP!=='access')throw Error('Owned access acceptance group required')
  const tenant=await admin.from('tenants').select('created_by,domain').eq('id',tenantId).single()
  if(tenant.error||!uuid(tenant.data.created_by)||!uuid(tenant.data.domain?.replace(/\.test$/,''))||!tenant.data.domain.endsWith('.test'))throw Error('Synthetic invitation tenant identity unavailable')
  const owner=await admin.auth.admin.getUserById(tenant.data.created_by)
  if(owner.error||owner.data.user?.app_metadata?._release_acceptance_run!==runId||owner.data.user.app_metadata?._release_acceptance_group!=='access')throw Error('Invitation tenant ownership differs')
  const actorId=tenant.data.created_by,marker=randomUUID(),email='tenant-invite-'+marker+'@example.test'
  const evidenceDir=path.resolve(process.env.VERIFY_EVIDENCE_DIR??'')
  if(evidenceDir!==path.resolve('supabase/.temp/release-acceptance-'+runId+'/'+'access'))throw Error('Canonical owned group evidence required before fixtures')
  const relative=path.relative(path.resolve('supabase/.temp'),evidenceDir)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(evidenceDir).isDirectory())throw Error('Owned ignored evidence directory required')
  const ledger={schemaVersion:1,runId,group:'access',tenantId,actorId,marker,role:'readonly_auditor',email,inviteId:null,submitAttempted:false,unexpectedAuthIds:[],result:'RUNNING',cleanup:'REQUIRED',startedAt:new Date().toISOString()}
  const save=()=>writeReleaseEvidence(path.join(evidenceDir,'tenant-invitation-fixture.json'),ledger)
  save()
  let stage='create tenant invitation',originalError,revoked=false
  const locale=await page.locator('html').getAttribute('lang')
  const read=async()=>{
    const result=await admin.from('invites').select('id,tenant_id,email,role,invited_by,invited_at,expires_at,status,accepted_at,accepted_by,created_by,deleted_at,provisioning_auth_user_id')
      .eq('tenant_id',tenantId).eq('email',email).not('token_hash','is',null)
    if(result.error||result.data.length>1)throw Error('Owned invitation set unavailable')
    const row=result.data[0]
    if(row&&(row.created_by!==actorId||row.invited_by!==actorId||row.role!=='readonly_auditor'||row.email!==email))throw Error('Owned invitation binding differs')
    if(row){ledger.inviteId=row.id;if(row.provisioning_auth_user_id&&!ledger.unexpectedAuthIds.includes(row.provisioning_auth_user_id))ledger.unexpectedAuthIds.push(row.provisioning_auth_user_id);if(row.accepted_by&&!ledger.unexpectedAuthIds.includes(row.accepted_by))ledger.unexpectedAuthIds.push(row.accepted_by);save()}
    return row
  }
  const audit=async()=>{
    const result=await admin.from('audit_log').select('action,actor_id,new_values').eq('tenant_id',tenantId).eq('entity_type','invites').eq('entity_id',ledger.inviteId)
    if(result.error)throw Error('Owned invitation audit unavailable')
    return result.data
  }
  const revokeOwned=async()=>{
    const invite=await read()
    if(!invite){if(ledger.submitAttempted)throw Error('In-flight invitation issuance absence is unverified');ledger.cleanup='NOT_CREATED';save();return}
    if(invite.accepted_at||invite.accepted_by||invite.provisioning_auth_user_id||ledger.unexpectedAuthIds.length)throw Error('Unexpected invitation provisioning requires owned Auth recovery')
    if(invite.status==='revoked'){revoked=true;ledger.cleanup='PASS';save();return}
    if(invite.status!=='pending'||invite.deleted_at)throw Error('Owned invitation no longer safely revocable')
    await page.goto(appUrl+'/settings/users?lang=en')
    await page.getByRole('tab',{name:/^Invites(?:\s*\d+)?$/}).click()
    const row=page.getByRole('row').filter({has:page.getByText(email,{exact:true})})
    await expect(row).toHaveCount(1)
    await row.getByRole('button',{name:'Revoke',exact:true}).click()
    await expect(row).toHaveCount(0)
    const after=await read()
    if(!after||after.id!==invite.id||after.status!=='revoked'||after.deleted_at||after.accepted_at||after.accepted_by||after.provisioning_auth_user_id)throw Error('Owned invitation revocation not verified')
    revoked=true;ledger.cleanup='PASS';save()
  }
  try{
    await page.goto(appUrl+'/users?lang=en')
    await page.getByRole('button',{name:'Invite user',exact:true}).first().click()
    const dialog=page.getByRole('dialog',{name:'Invite a new user',exact:true})
    await dialog.getByLabel('Email',{exact:true}).fill(email)
    await dialog.locator('#invite-role').click()
    await expect(page.getByRole('option',{name:'General Manager',exact:true})).toHaveCount(0)
    await page.getByRole('option',{name:'Read-only Auditor',exact:true}).click()
    ledger.submitAttempted=true;save()
    await dialog.getByRole('button',{name:'Send invite',exact:true}).click()
    await expect(dialog).toBeHidden()
    // Isolated release previews intentionally have no mail provider credential.
    await expect(page.getByText('Invitation created, but sending could not be confirmed. Check email configuration and receipt before revoking and resending.',{exact:true})).toBeVisible()
    const invite=await read()
    if(!invite)throw Error('Issued tenant invitation missing')
    expect(invite).toMatchObject({tenant_id:tenantId,email,role:'readonly_auditor',status:'pending',accepted_at:null,accepted_by:null,provisioning_auth_user_id:null,deleted_at:null})
    const lifetime=Date.parse(invite.expires_at)-Date.parse(invite.invited_at)
    expect(lifetime).toBeGreaterThan(7*86400_000-60_000)
    expect(lifetime).toBeLessThan(7*86400_000+60_000)
    const users=await admin.from('users').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId).eq('email',email)
    if(users.error||users.count!==0)throw Error('Invitation issuance unexpectedly provisioned a member')
    const created=await audit()
    expect(created.filter(row=>row.action==='invite_created')).toHaveLength(1)
    expect(created.find(row=>row.action==='invite_created')).toMatchObject({actor_id:actorId,new_values:{email,role:'readonly_auditor'}})
    stage='retained pending invitation and localized management'
    await page.goto(appUrl+'/settings/users?lang=en')
    await page.getByRole('tab',{name:/^Invites(?:\s*\d+)?$/}).click()
    await expect(page.getByRole('row').filter({has:page.getByText(email,{exact:true})})).toContainText('Read-only Auditor')
    await page.reload()
    await page.getByRole('tab',{name:/^Invites(?:\s*\d+)?$/}).click()
    await expect(page.getByRole('row').filter({has:page.getByText(email,{exact:true})})).toHaveCount(1)
    stage='ordinary UI revocation preserves historical invite and audit'
    await revokeOwned()
    const actions=await audit()
    expect(actions.filter(row=>row.action==='invite_revoked')).toHaveLength(1)
    expect(actions.filter(row=>['invite_created','invite_revoked'].includes(row.action)).every(row=>row.actor_id===actorId)).toBe(true)
    ledger.result='PASS';save()
    console.log(JSON.stringify({check:'tenant invitation UI issuance, non-owner role, expiry, truthful disabled-mail result, persisted management and retained revocation audit',result:'PASS',externalEmailValidated:false,authUsersCreated:0}))
  }catch(error){originalError=error;ledger.result='FAIL';ledger.failedStage=stage;save();error.verificationStage=stage;throw error}
  finally{
    try{if(!revoked)await revokeOwned()}catch{ledger.cleanup='UNVERIFIED';save();if(!originalError)throw Error('Owned tenant invitation cleanup requires recovery');originalError.invitationCleanupUnverified=true}
    finally{ledger.finishedAt=new Date().toISOString();save();await page.goto(appUrl+'/users?lang='+(locale==='ar'?'ar':'en')).catch(()=>{})}
  }
}
