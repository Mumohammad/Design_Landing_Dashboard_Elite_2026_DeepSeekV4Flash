import fs from 'node:fs'
import path from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {StringDecoder} from 'node:string_decoder'
import {createClient} from '@supabase/supabase-js'
import {writeReleaseEvidence} from './write-release-evidence.mjs'

export const MODULE_GROUPS = {
 vat_review:['verifyVatReviewPosting'],
 payroll:['verifyPayrollPreparation'],
 drivers:['verifyDriverProfileOperations','verifyDriverLeaveLifecycle','verifyDriverEvidence'],
 operations:['verifyFleetOperations','verifyOrdersPlatforms'],
 access:['verifyUserRoleManagement','verifySettingsCrud','verifyExpenseCorrections','verifyApplicationReviews','verifyApprovalsInbox'],
 finance:['verifyInvoiceCrud','verifyJournalCrud','verifyFinancialStatements','verifyAccountingPages','verifyBankCrud','verifyReceivableCrud'],
 expenses:['verifyExpensesOverview'],
 masters:['verifyAccountingMasters'],
 audit_admin:['verifyVatPosition','verifyAuditPrivacy','verifyPlatformAdminUsers','verifyModuleLocales'],
}
const production='wwfnsbilmyxeawgzicmv',staging='viowrovartosrkqukjxy',uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??'')
export function assertAcceptanceTarget(backendUrl,appUrl,sha) {
 const backend=new URL(backendUrl),app=new URL(appUrl)
 if(backend.origin!=='https://'+staging+'.supabase.co'||backend.pathname!=='/'||backend.username||backend.password||backend.search||backend.hash||app.protocol!=='https:'||!/^elite-dashboard-[a-z0-9]+-elitesaasc-5643\.vercel\.app$/.test(app.hostname)||app.port||app.username||app.password||app.search||app.hash||app.pathname!=='/'||!/^([0-9a-f]{40})$/.test(sha??''))throw Error('Exact approved isolated staging target and commit required')
 return {backend:backend.origin,app:app.origin,sha}
}
export function validateDeploymentEvidence(status,body,policy,sha) {
 const sources=(policy.split(';').map(x=>x.trim()).find(x=>x.startsWith('connect-src '))??'').split(/\s+/).slice(1)
 const allowed=new Set(["'self'",'https://'+staging+'.supabase.co','wss://'+staging+'.supabase.co','https://api.resend.com','https://api.emailjs.com','https://zatca.gov.sa','https://*.ingest.sentry.io'])
 if(status!==200||body?.status!=='healthy'||body.version!==sha||!sources.includes('https://'+staging+'.supabase.co')||policy.includes(production)||sources.some(source=>!allowed.has(source)))throw Error('Healthy exact commit and exclusive staging CSP required')
}
export async function preflightAcceptanceTarget({backendUrl,appUrl,expectedCommit,fetchImpl=fetch}) {
 const target=assertAcceptanceTarget(backendUrl,appUrl,expectedCommit)
 const [health,landing]=await Promise.all([
  fetchImpl(target.app+'/api/health',{redirect:'manual',signal:AbortSignal.timeout(30000)}),
  fetchImpl(target.app+'/landing',{redirect:'manual',signal:AbortSignal.timeout(30000)}),
 ])
 if(landing.status!==200)throw Error('Unredirected staging landing required')
 validateDeploymentEvidence(health.status,await health.json(),landing.headers.get('content-security-policy')??'',expectedCommit)
 return target
}
export function resolveAcceptanceRunId(env=process.env) { return assertAcceptanceRunId(env.VERIFY_RELEASE_RUN_ID??randomUUID()) }
export function assertAcceptanceRunId(runId) {
 if(!uuid(runId))throw Error('Owned acceptance run UUID required before fixture creation')
 return runId
}
export function validateGroupProof(proof,{group,runId,sha,target}) {
 const wanted=MODULE_GROUPS[group]
 if(!wanted||proof?.group!==group||proof.project!==staging||proof.target!==target||proof.runId!==runId||proof.commit!==sha||proof.result!=='PASS'||JSON.stringify(proof.results)!==JSON.stringify(wanted)||!uuid(proof.authUserId)||!uuid(proof.tenantId)||proof.appAccessRetired!==true||proof.authAccessRetired!==true||(group==='audit_admin'&&proof.returningAuthVerified!==true))throw Error('Complete current group acceptance and retirement proof required')
}
export function redactAcceptanceOutput(text,secrets=[]) {
 for(const secret of secrets.filter(x=>typeof x==='string'&&x.length>=8))text=text.replaceAll(secret,'[REDACTED]')
 return text.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED_JWT]')
}
export function createAcceptanceLogScrubber(secrets,onLine,{maxLineBytes=131072}={}) {
 const decoder=new StringDecoder('utf8');let pending='',ended=false
 const emit=line=>{if(Buffer.byteLength(line,'utf8')>maxLineBytes)throw Error('Acceptance output line exceeds safe limit');onLine(redactAcceptanceOutput(line,secrets)+(line.endsWith('\n')?'':'\n'))}
 const consume=()=>{let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index+1);pending=pending.slice(index+1);emit(line)}if(Buffer.byteLength(pending,'utf8')>maxLineBytes)throw Error('Acceptance output line exceeds safe limit')}
 return {write(data){if(ended)throw Error('Acceptance output already finalized');pending+=decoder.write(Buffer.isBuffer(data)?data:Buffer.from(String(data)));consume()},end(){if(ended)return;ended=true;pending+=decoder.end();consume();if(pending){emit(pending);pending=''}}}
}
const authGone=result=>result.error?.status===404||(!result.error&&!!result.data.user?.deleted_at)
export async function retireAcceptanceFixtures(admin,proof) {
 assertAcceptanceTarget(admin.supabaseUrl,proof.target,proof.commit)
 if(proof.project!==staging||!uuid(proof.runId)||!Object.hasOwn(MODULE_GROUPS,proof.group))throw Error('Owned acceptance run identity required')
 if(!uuid(proof.authUserId))return {result:'NOT_CREATED'}
 if(!uuid(proof.tenantId)) {
  const identity=await admin.auth.admin.getUserById(proof.authUserId)
  const existing=await admin.from('users').select('tenant_id,email').eq('auth_user_id',proof.authUserId).maybeSingle()
  if(existing.error)throw Error('Owned incomplete provisioning read failed')
  if(existing.data){if(existing.data.email!==proof.ownerEmail)throw Error('Owned incomplete profile mismatch');proof.tenantId=existing.data.tenant_id}
  else {
   if(authGone(identity))return {result:'PASS',membersRetired:0}
   if(identity.error||identity.data.user?.email!==proof.ownerEmail||identity.data.user?.app_metadata?._release_acceptance_run!==proof.runId||identity.data.user?.app_metadata?._release_acceptance_group!==proof.group)throw Error('Owned incomplete Auth identity mismatch')
   if((await admin.auth.admin.deleteUser(proof.authUserId,true)).error||!authGone(await admin.auth.admin.getUserById(proof.authUserId)))throw Error('Owned incomplete Auth retirement failed')
   return {result:'PASS',membersRetired:1}
  }
 }
 const originalAuth=await admin.auth.admin.getUserById(proof.authUserId)
 if(!authGone(originalAuth)&&(originalAuth.error||originalAuth.data.user?.email!==proof.ownerEmail||originalAuth.data.user?.app_metadata?._release_acceptance_run!==proof.runId||originalAuth.data.user?.app_metadata?._release_acceptance_group!==proof.group))throw Error('Owned release Auth metadata mismatch')
 const tenant=await admin.from('tenants').select('created_by,domain').eq('id',proof.tenantId).single()
 const owner=await admin.from('users').select('id,tenant_id,auth_user_id,email,status').eq('tenant_id',proof.tenantId).eq('auth_user_id',proof.authUserId).single()
 if(tenant.error||owner.error||tenant.data.created_by!==proof.authUserId||tenant.data.domain!==proof.companyDomain||!/^[0-9a-f-]{36}\.test$/i.test(tenant.data.domain??'')||owner.data.email!==proof.ownerEmail||!/^release-[0-9a-f-]{36}@example\.test$/i.test(owner.data.email??''))throw Error('Owned release tenant retirement proof failed')
 const issues=[],facts={membersRetired:0,auxiliaryRetired:0,markerRemoved:false,unresolvedAuxiliary:0,recoveredAuxiliary:0}
 const members=await admin.from('users').select('id,auth_user_id,email,status',{count:'exact'}).eq('tenant_id',proof.tenantId)
 if(members.error||members.count===null||members.count!==members.data?.length)issues.push('MEMBER_SET_INCOMPLETE')
 const known=members.error?[owner.data]:members.data??[owner.data]
 if(!known.some(member=>member.auth_user_id===proof.authUserId))known.push(owner.data)
 for(const member of known)try{
  if(!uuid(member.auth_user_id)||!member.email?.endsWith('@example.test'))throw Error('Non-synthetic member')
  let auth=await admin.auth.admin.getUserById(member.auth_user_id)
  if(!authGone(auth)&&(auth.error||auth.data.user?.email!==member.email))throw Error('Owned Auth binding unknown')
  if(member.status!=='inactive'&&(await admin.from('users').update({status:'inactive'}).eq('id',member.id).eq('tenant_id',proof.tenantId).eq('auth_user_id',member.auth_user_id)).error)throw Error('Owned app retirement failed')
  if(!authGone(auth)){if((await admin.auth.admin.deleteUser(member.auth_user_id,true)).error)throw Error('Owned Auth retirement failed');auth=await admin.auth.admin.getUserById(member.auth_user_id)}
  const profile=await admin.from('users').select('status').eq('id',member.id).eq('tenant_id',proof.tenantId).single()
  if(profile.error||profile.data.status!=='inactive'||!authGone(auth))throw Error('Owned retirement unverified')
  facts.membersRetired++
 }catch{issues.push('MEMBER_RETIREMENT_UNVERIFIED')}
 // A lost response may have finalized a recorded member. Recover only its
 // exact known company/email/creator and the Auth request metadata.
 for(const intent of proof.pendingAuxiliary??[]) {
  if((proof.extraFixtures??[]).some(extra=>extra.kind==='platform-member'&&extra.requestId===intent.requestId))continue
  try {
   if(intent.actorId!==proof.authUserId||!uuid(intent.tenantId)||!uuid(intent.requestId)||!/^platform-member-[0-9a-f-]{36}@example\.test$/i.test(intent.email??''))throw Error('Auxiliary intent mismatch')
   const sourceOwner=(proof.extraFixtures??[]).find(extra=>extra.kind==='platform-owner'&&extra.actorId===proof.authUserId&&extra.tenantId===intent.tenantId)
   if(!sourceOwner)throw Error('Auxiliary company ownership missing')
   const company=await admin.from('tenants').select('created_by,domain').eq('id',intent.tenantId).single()
   if(company.error||company.data.created_by!==sourceOwner.authUserId||company.data.domain!==sourceOwner.tag+'.test')throw Error('Auxiliary company ownership mismatch')
   const row=await admin.from('users').select('auth_user_id,created_by,email').eq('tenant_id',intent.tenantId).eq('email',intent.email).maybeSingle()
   if(row.error||!row.data||row.data.created_by!==proof.authUserId||!uuid(row.data.auth_user_id))throw Error('Auxiliary finalization not discoverable')
   const auth=await admin.auth.admin.getUserById(row.data.auth_user_id),meta=auth.data?.user?.app_metadata??{}
   if(!authGone(auth)&&(auth.error||auth.data.user?.email!==intent.email||meta._platform_provision_actor!==proof.authUserId||meta._platform_provision_tenant!==intent.tenantId||meta._platform_provision_request!==intent.requestId))throw Error('Auxiliary request binding mismatch')
   proof.extraFixtures??=[];proof.extraFixtures.push({...intent,kind:'platform-member',authUserId:row.data.auth_user_id});facts.recoveredAuxiliary++
  }catch{facts.unresolvedAuxiliary++;issues.push('AUXILIARY_INTENT_UNRESOLVED')}
 }
 // An unresolved member never prevents cleanup of independently known owners
 // or the exact temporary authority marker.
 for(const extra of proof.extraFixtures??[])try{
  if(!uuid(extra.authUserId)||extra.actorId!==proof.authUserId||!/^platform-(owner|member)-[0-9a-f-]{36}@example\.test$/i.test(extra.email??''))throw Error('Owned auxiliary identity mismatch')
  let auth=await admin.auth.admin.getUserById(extra.authUserId)
  const profile=await admin.from('users').select('id,tenant_id,email,status,created_by').eq('auth_user_id',extra.authUserId).maybeSingle()
  if(profile.error||(profile.data&&profile.data.email!==extra.email))throw Error('Owned auxiliary profile mismatch')
  if(profile.data){const company=await admin.from('tenants').select('created_by,domain').eq('id',profile.data.tenant_id).single();const owns=extra.kind==='platform-owner'?company.data?.created_by===extra.authUserId&&company.data?.domain===extra.tag+'.test':extra.kind==='platform-member'&&profile.data.created_by===proof.authUserId&&profile.data.tenant_id===extra.tenantId;if(company.error||!owns)throw Error('Owned auxiliary company mismatch')}
  if(!authGone(auth)){
   if(auth.error||auth.data.user?.email!==extra.email)throw Error('Owned auxiliary Auth binding unknown')
   const meta=auth.data.user.app_metadata??{},valid=extra.kind==='platform-owner'?meta._platform_acceptance===extra.tag&&meta._platform_acceptance_actor===proof.authUserId:extra.kind==='platform-member'&&meta._platform_provision_actor===proof.authUserId&&meta._platform_provision_tenant===extra.tenantId&&meta._platform_provision_request===extra.requestId
   if(!valid)throw Error('Owned auxiliary metadata mismatch')
  }
  if(profile.data&&profile.data.status!=='inactive'&&(await admin.from('users').update({status:'inactive'}).eq('id',profile.data.id).eq('tenant_id',profile.data.tenant_id).eq('auth_user_id',extra.authUserId)).error)throw Error('Owned auxiliary app retirement failed')
  if(!authGone(auth)){if((await admin.auth.admin.deleteUser(extra.authUserId,true)).error)throw Error('Owned auxiliary Auth retirement failed');auth=await admin.auth.admin.getUserById(extra.authUserId)}
  const check=profile.data?await admin.from('users').select('status').eq('id',profile.data.id).eq('tenant_id',profile.data.tenant_id).single():null
  if(!authGone(auth)||(check&&(check.error||check.data.status!=='inactive')))throw Error('Owned auxiliary retirement unverified')
  facts.auxiliaryRetired++
 }catch{issues.push('AUXILIARY_RETIREMENT_UNVERIFIED')}
 try {
  const marker=await admin.from('platform_admins').select('email,note,created_by').eq('user_id',proof.authUserId).maybeSingle()
  if(marker.error)throw Error('Authority marker read failed')
  if(marker.data){
   const recorded=proof.authorityMarker
   if(marker.data.email!==owner.data.email||marker.data.created_by!==proof.authUserId||!/^platform-user-acceptance:[0-9a-f-]{36}$/i.test(marker.data.note??'')||(recorded&&(recorded.actorId!==proof.authUserId||recorded.email!==marker.data.email||recorded.note!==marker.data.note)))throw Error('Authority marker ownership mismatch')
   const removed=await admin.from('platform_admins').delete().eq('user_id',proof.authUserId).eq('email',marker.data.email).eq('note',marker.data.note).eq('created_by',proof.authUserId).select('user_id')
   if(removed.error||removed.data.length!==1)throw Error('Owned authority marker removal failed')
  }
  facts.markerRemoved=true
 }catch{issues.push('AUTHORITY_MARKER_RETIREMENT_UNVERIFIED')}
 const result={result:issues.length?'UNVERIFIED':'PASS',...facts,issues,checkedAt:new Date().toISOString()}
 if(issues.length){const error=Error('Owned acceptance retirement incomplete');error.cleanupEvidence=result;throw error}
 return result
}
function cleanHead(sha){const h=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}),s=spawnSync('git',['status','--porcelain=v1'],{encoding:'utf8',windowsHide:true});return h.status===0&&s.status===0&&h.stdout.trim()===sha&&!s.stdout.trim()}
export async function runCoordinatedAcceptance({appUrl,expectedCommit,backendUrl,env=process.env}) {
 const target=assertAcceptanceTarget(backendUrl,appUrl,expectedCommit)
 if(!env.SUPABASE_SERVICE_ROLE_KEY||!cleanHead(expectedCommit))throw Error('Clean exact source and existing isolated credentials required')
 await preflightAcceptanceTarget({backendUrl,appUrl,expectedCommit})
 const runId=resolveAcceptanceRunId(env),root=path.resolve('supabase/.temp/release-acceptance-'+runId),groups=Object.keys(MODULE_GROUPS),results=[]
 fs.mkdirSync(root);const summary={runId,commit:expectedCommit,target:target.app,project:staging,result:'RUNNING',groups:results,startedAt:new Date().toISOString()};const save=()=>writeReleaseEvidence(path.join(root,'result.json'),summary);save()
 const admin=createClient(target.backend,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 let cursor=0
 const worker=async()=>{while(cursor<groups.length){const group=groups[cursor++],folder=path.join(root,group);fs.mkdirSync(folder,{recursive:true});const out={group,result:'RUNNING',startedAt:new Date().toISOString()};results.push(out);save();console.log(JSON.stringify({check:'coordinated acceptance',group,state:'started'}));const log=path.join(folder,'run.log');let timedOut=false,logSafe=true
 const code=await new Promise(resolve=>{const child=spawn(process.execPath,['scripts/verify-production-modules.mjs'],{env:{...env,VERIFY_APP_URL:target.app,VERIFY_COMMIT_SHA:expectedCommit,NEXT_PUBLIC_SUPABASE_URL:target.backend,VERIFY_MODULE_GROUP:group,VERIFY_RELEASE_RUN_ID:runId,VERIFY_EVIDENCE_DIR:folder},windowsHide:true,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{timedOut=true;child.kill()},40*60_000);timer.unref();for(const stream of [child.stdout,child.stderr]){const scrubber=createAcceptanceLogScrubber([env.SUPABASE_SERVICE_ROLE_KEY,env.NEXT_PUBLIC_SUPABASE_ANON_KEY],line=>fs.appendFileSync(log,line));stream.on('data',bytes=>{try{scrubber.write(bytes)}catch{logSafe=false;child.kill()}});stream.on('end',()=>{try{scrubber.end()}catch{logSafe=false;child.kill()}})};child.once('error',()=>{clearTimeout(timer);resolve(-1)});child.once('close',value=>{clearTimeout(timer);resolve(value??-1)})})
 let proof;try{proof=JSON.parse(fs.readFileSync(path.join(folder,'fixture-proof.json'),'utf8'));out.cleanup=await retireAcceptanceFixtures(admin,proof);fs.writeFileSync(path.join(folder,'cleanup-verified.json'),JSON.stringify(out.cleanup,null,2));validateGroupProof(proof,{group,runId,sha:expectedCommit,target:target.app});if(code!==0||timedOut||!logSafe||out.cleanup.result!=='PASS')throw Error('Child acceptance unsuccessful');out.result='PASS'}catch(error){out.result='FAIL';out.cleanup??=error.cleanupEvidence??{result:'UNVERIFIED'};fs.writeFileSync(path.join(folder,'cleanup-unverified.json'),JSON.stringify(out.cleanup,null,2))}out.exitCode=code;out.timedOut=timedOut;out.logSafe=logSafe;out.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({check:'coordinated acceptance',group,result:out.result,cleanup:out.cleanup.result}))}}
 const heartbeat=setInterval(()=>console.log(JSON.stringify({check:'coordinated acceptance progress',passed:results.filter(x=>x.result==='PASS').length,running:results.filter(x=>x.result==='RUNNING').map(x=>x.group),total:groups.length})),45000);heartbeat.unref()
 try{await Promise.all([worker(),worker()])}finally{clearInterval(heartbeat)}
 summary.sourceStillClean=cleanHead(expectedCommit);summary.finishedAt=new Date().toISOString();summary.result=results.length===groups.length&&results.every(x=>x.result==='PASS')&&summary.sourceStillClean?'PASS':'FAIL';save();console.log(JSON.stringify({check:'complete coordinated release acceptance',result:summary.result,groups:results.length,passed:results.filter(x=>x.result==='PASS').length,evidence:root}));return summary.result==='PASS'?0:1
}
