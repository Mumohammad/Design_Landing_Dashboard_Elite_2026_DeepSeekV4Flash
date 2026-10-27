import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {MODULE_GROUPS,assertAcceptanceTarget} from './lib/coordinated-acceptance.mjs'
import {retireReleaseAcceptance} from './retire-release-acceptance.mjs'

const backendUrl='https://viowrovartosrkqukjxy.supabase.co',appUrl='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app',commit='a'.repeat(40),runId='15000000-0000-4000-8000-000000000001',auth='15000000-0000-4000-8000-000000000002',tenant='15000000-0000-4000-8000-000000000003'
const ownerEmail='release-15000000-0000-4000-8000-000000000004@example.test',companyDomain='15000000-0000-4000-8000-000000000004.test'
function fixture(t,{authCreated=true,tenantRecorded=true,profileExists=true,retired=false}={}){
 const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'owned-acceptance-'))
 t.after(()=>{const relative=path.relative(os.tmpdir(),workspaceRoot);assert.ok(relative.startsWith('owned-acceptance-')&&!relative.includes(path.sep));fs.rmSync(workspaceRoot,{recursive:true,force:true})})
 const root=path.join(workspaceRoot,'supabase','.temp','release-acceptance-'+runId),options={workspaceRoot,runId,backendUrl,appUrl,commit}
 fs.mkdirSync(root,{recursive:true})
 const summary={runId,commit,target:appUrl,project:'viowrovartosrkqukjxy',result:'FAIL',groups:[{group:'finance',result:'FAIL'}]}
 const proof={...summary,group:'finance',results:[],extraFixtures:[],pendingAuxiliary:[],authUserId:auth,ownerEmail,companyDomain,...(tenantRecorded?{tenantId:tenant}:{})};delete proof.groups
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(summary))
 const folder=path.join(root,'finance');fs.mkdirSync(folder)
 const proofPath=path.join(folder,'fixture-proof.json');fs.writeFileSync(proofPath,JSON.stringify(proof))
 const state={clients:0,reads:0,writes:0,deleted:retired,status:retired?'inactive':'active'}
 const profile={id:'15000000-0000-4000-8000-000000000005',tenant_id:tenant,auth_user_id:auth,email:ownerEmail}
 const admin={supabaseUrl:backendUrl,auth:{admin:{async getUserById(id){state.reads++;assert.equal(id,auth);return authCreated?{error:null,data:{user:{id,email:ownerEmail,app_metadata:{_release_acceptance_run:runId,_release_acceptance_group:'finance'},...(state.deleted?{deleted_at:'2026-10-27T00:00:00Z'}:{})}}}:{error:{status:404},data:{user:null}}},async deleteUser(id){assert.equal(id,auth);state.writes++;state.deleted=true;return{error:null}}}},from(table){
  const filters=[];let action='select',updateValue,exact=false
  const matches=row=>filters.every(([key,value])=>row[key]===value)
  const output=single=>{
   state.reads++
   let rows=table==='tenants'?[{id:tenant,created_by:auth,domain:companyDomain}]:table==='users'&&profileExists?[{...profile,status:state.status}]:[]
   rows=rows.filter(matches)
   if(action==='update'){state.writes++;state.status=updateValue.status;return{error:null,data:null}}
   return{error:null,data:single?(rows[0]??null):rows,...(exact?{count:rows.length}:{})}
  }
  return{select(_columns,options){exact=options?.count==='exact';return this},eq(key,value){filters.push([key,value]);return this},update(value){action='update';updateValue=value;return this},async maybeSingle(){return output(true)},async single(){return output(true)},then(resolve,reject){return Promise.resolve(output(false)).then(resolve,reject)}}
 }}
 return{options,root,folder,proofPath,proof,summary,state,admin,createAdmin(){state.clients++;return admin}}
}
function saveProof(f,change){fs.writeFileSync(f.proofPath,JSON.stringify({...f.proof,...change}))}

for(const[name,change]of[
 ['foreign run',{runId:'15000000-0000-4000-8000-000000000099'}],['foreign commit',{commit:'b'.repeat(40)}],['foreign project',{project:'wwfnsbilmyxeawgzicmv'}],['foreign target',{target:'https://elite-dashboard-other-elitesaasc-5643.vercel.app'}],['wrong group',{group:'audit_admin'}],['invalid recorded Auth id',{authUserId:'invalid'}],['foreign auxiliary actor',{extraFixtures:[{kind:'platform-owner',actorId:tenant,authUserId:auth,email:'platform-owner-15000000-0000-4000-8000-000000000004@example.test',tag:runId}]}],
])test('cleanup rejects '+name+' before client access or mutation',async t=>{
 const f=fixture(t);saveProof(f,change)
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes],[0,0,0])
 assert.ok(!fs.existsSync(path.join(f.root,'cleanup-recovery.json')))
})

test('all nine proofs are validated before an earlier valid group can mutate',async t=>{
 const f=fixture(t),dir=path.join(f.root,'audit_admin');fs.mkdirSync(dir)
 fs.writeFileSync(path.join(dir,'fixture-proof.json'),JSON.stringify({...f.proof,group:'audit_admin',commit:'b'.repeat(40)}))
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0);assert.equal(f.state.writes,0)
})
test('cleanup refuses a caller-selected foreign path',async t=>{
 const f=fixture(t)
 await assert.rejects(()=>retireReleaseAcceptance({...f.options,runDirectory:path.dirname(f.root)},{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('cleanup refuses production before client access',async t=>{
 const f=fixture(t)
 await assert.rejects(()=>retireReleaseAcceptance({...f.options,backendUrl:'https://wwfnsbilmyxeawgzicmv.supabase.co'},{createAdmin:f.createAdmin}),/isolated staging/)
 assert.equal(f.state.clients,0)
})
test('directory junction proofs are refused before API access on Windows and Unix',async t=>{
 const f=fixture(t),linked=path.join(f.options.workspaceRoot,'linked-group')
 fs.mkdirSync(linked);fs.renameSync(f.proofPath,path.join(linked,'fixture-proof.json'));fs.rmdirSync(f.folder);fs.symlinkSync(linked,f.folder,'junction')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('hard-linked proof is refused before API access',async t=>{
 const f=fixture(t);fs.linkSync(f.proofPath,path.join(f.options.workspaceRoot,'foreign-proof.json'))
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('JSON null is not mistaken for an absent pre-Auth proof',async t=>{
 const f=fixture(t);fs.writeFileSync(f.proofPath,'null')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/);assert.equal(f.state.clients,0)
})
test('malformed or truncated proof fails closed before API access',async t=>{
 const f=fixture(t);fs.writeFileSync(f.proofPath,'{"authUserId":')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('a foreign output file cannot be smuggled into the upload directory',async t=>{
 const f=fixture(t),output=path.join(f.root,'safe-artifacts');fs.mkdirSync(output);fs.writeFileSync(path.join(output,'.env'),'Private-not-for-upload')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('missing ledger and missing child proofs perform no API access',async t=>{
 const f=fixture(t);fs.unlinkSync(f.proofPath)
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(result.result,'PASS');assert.equal(result.groups.length,9);assert.ok(result.groups.every(group=>group.result==='NOT_STARTED'));assert.equal(f.state.clients,0)
 const missing=await retireReleaseAcceptance({...f.options,runId:'15000000-0000-4000-8000-000000000099'},{createAdmin:f.createAdmin})
 assert.equal(missing.result,'NOT_STARTED');assert.equal(f.state.clients,0)
})
test('initial proof before Auth creation is NOT_CREATED without an API client',async t=>{
 const f=fixture(t);saveProof(f,{authUserId:undefined,tenantId:undefined,ownerEmail:undefined,companyDomain:undefined})
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(result.groups.find(group=>group.group==='finance').result,'NOT_CREATED');assert.equal(f.state.clients,0)
})
test('incomplete provisioning ledger recovers tenant only in separate evidence',async t=>{
 const f=fixture(t,{tenantRecorded:false}),before=fs.readFileSync(f.proofPath,'utf8'),summary=fs.readFileSync(path.join(f.root,'result.json'),'utf8')
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(result.result,'PASS');assert.equal(result.acceptanceResult,'FAIL')
 assert.equal(result.groups.find(group=>group.group==='finance').recoveredTenantId,tenant)
 assert.equal(f.state.status,'inactive');assert.equal(f.state.deleted,true)
 assert.equal(fs.readFileSync(f.proofPath,'utf8'),before);assert.equal(fs.readFileSync(path.join(f.root,'result.json'),'utf8'),summary)
})
test('recorded Auth creation with no profile is safely retired after metadata checks',async t=>{
 const f=fixture(t,{tenantRecorded:false,profileExists:false})
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(result.result,'PASS');assert.equal(f.state.writes,1);assert.equal(f.state.deleted,true)
})
test('recorded Auth absent without tenant remains unverified and mutation-free',async t=>{
 const f=fixture(t,{tenantRecorded:false,profileExists:false,authCreated:false})
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),finance=result.groups.find(group=>group.group==='finance')
 assert.equal(result.result,'FAIL');assert.equal(finance.result,'UNVERIFIED');assert.deepEqual(finance.issues,['INFLIGHT_AUTH_CREATION_UNVERIFIED']);assert.equal(f.state.writes,0)
})

test('prior retirement is independently checked and idempotent',async t=>{
 const f=fixture(t,{retired:true})
 assert.equal((await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})).result,'PASS')
 assert.equal((await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})).result,'PASS')
 assert.ok(f.state.reads>0);assert.equal(f.state.writes,0)
})
test('retirement failure remains FAIL while later known groups are attempted',async t=>{
 const f=fixture(t),dir=path.join(f.root,'audit_admin');fs.mkdirSync(dir)
 fs.writeFileSync(path.join(dir,'fixture-proof.json'),JSON.stringify({...f.proof,group:'audit_admin'}))
 const seen=[];const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin,retire:async(_admin,proof)=>{seen.push(proof.group);if(proof.group==='finance')throw Error('PrivateSecretNotForEvidence');return{result:'PASS',membersRetired:1}}})
 assert.equal(result.result,'FAIL');assert.deepEqual(seen,['finance','audit_admin']);assert.ok(!JSON.stringify(result).includes('PrivateSecret'))
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'result.json'),'utf8')).result,'FAIL')
})
test('safe evidence projects secrets away, redacts logs and copies only named synthetic finance PDFs',async t=>{
 const f=fixture(t,{retired:true}),secret='ScopedPrivateCredentialValue12345'
 saveProof(f,{password:secret,session:{access_token:secret}})
 fs.writeFileSync(path.join(f.folder,'run.log'),secret+' Bearer private-token eyJmock.e30.signature\n')
 fs.writeFileSync(path.join(f.folder,'invoice-reference-hidden-due.pdf'),'%PDF-synthetic')
 fs.writeFileSync(path.join(f.folder,'private.pdf'),'%PDF-never-upload')
 fs.writeFileSync(path.join(f.folder,'mfa.png'),'never-upload')
 const outcome=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin,secrets:[secret]})
 const output=outcome.artifactDirectory,files=fs.readdirSync(path.join(output,'finance')).sort()
 assert.deepEqual(files,['cleanup-recovery.json','fixture-proof.json','invoice-reference-hidden-due.pdf','run.log'])
 for(const file of files.filter(name=>!name.endsWith('.pdf'))){const value=fs.readFileSync(path.join(output,'finance',file),'utf8');assert.ok(!value.includes(secret));assert.ok(!value.includes('private-token'));assert.ok(!value.includes('eyJmock'))}
 assert.equal(JSON.parse(fs.readFileSync(path.join(output,'result.json'),'utf8')).result,'FAIL')
 assert.equal(Object.keys(MODULE_GROUPS).length,9)
})

test('CI job is trusted exact-head staging-only and preserves cancellation cleanup',()=>{
 const require=createRequire(import.meta.url),yaml=createRequire(require.resolve('@eslint/eslintrc'))('js-yaml'),workflow=yaml.load(fs.readFileSync('.github/workflows/ci.yml','utf8')),job=workflow.jobs.staging_acceptance
 assert.deepEqual(job.needs,['ci','pgtap']);assert.match(job.if,/head\.repo\.full_name == github\.repository/);assert.match(job.if,/head\.ref == 'codex\/production-modules-completion'/);assert.match(job.if,/event_name == 'pull_request'/)
 assert.ok(job['timeout-minutes']<=90);assert.equal(job.concurrency['cancel-in-progress'],false);assert.match(workflow.concurrency['cancel-in-progress'],/production-modules-completion/)
 assert.equal(job.steps[0].with.ref,'$'+'{{ github.event.pull_request.head.sha }}');assert.equal(job.steps[0].with['persist-credentials'],false)
 const suite=job.steps.find(step=>step.id==='acceptance_process'),cleanup=job.steps.find(step=>step.id==='acceptance_cleanup'),upload=job.steps.find(step=>step.uses==='actions/upload-artifact@v4')
 assert.ok(suite);assert.match(suite.run,/\['scripts\/verify-production-modules\.mjs'\]/);assert.equal(suite['continue-on-error'],undefined);assert.match(cleanup.if,/always\(\)/);assert.ok(cleanup['timeout-minutes']<=10)
 assert.equal(upload.with.path,'$'+'{{ steps.acceptance_cleanup.outputs.artifact_dir }}');assert.match(upload.if,/acceptance_cleanup\.outputs\.artifact_dir != ''/)
 assert.ok(!JSON.stringify(job).includes('PRODUCTION_'));assert.equal(job.env.SUPABASE_SERVICE_ROLE_KEY,undefined);assert.equal(cleanup.env.SUPABASE_SERVICE_ROLE_KEY,'$'+'{{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}')
 assert.ok(!job.env.VERIFY_MODULE_GROUP);assert.equal(workflow.jobs.e2e.env.TEST_USER_EMAIL,'$'+'{{ secrets.TEST_USER_EMAIL }}')
})
test('orphaned atomic summary temp cannot obstruct retirement or enter artifacts',async t=>{
 const f=fixture(t,{retired:true});fs.writeFileSync(path.join(f.root,'.result.json.'+runId+'.tmp'),'partial JSON')
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin});assert.equal(result.result,'PASS');assert.ok(!fs.readdirSync(result.artifactDirectory).some(name=>name.endsWith('.tmp')))
})
test('CI missing staging secret or wrong target fails before writing configuration or fixtures',()=>{
 const require=createRequire(import.meta.url),yaml=createRequire(require.resolve('@eslint/eslintrc'))('js-yaml'),workflow=yaml.load(fs.readFileSync('.github/workflows/ci.yml','utf8')),step=workflow.jobs.staging_acceptance.steps.find(item=>item.id==='acceptance_config')
 const body=step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/,'').replace(/^import .*;\n/gm,''),run=new Function('process','fs','randomUUID','assertAcceptanceTarget',body),complete={VERIFY_APP_URL:appUrl,VERIFY_COMMIT_SHA:commit,NEXT_PUBLIC_SUPABASE_URL:backendUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:'PublicAnonFixture',SUPABASE_SERVICE_ROLE_KEY:'ScopedPrivateFixture',GITHUB_ENV:'env-output',GITHUB_OUTPUT:'step-output'}
 let writes=0;const mockFs={mkdirSync(){writes++},writeFileSync(){writes++},appendFileSync(){writes++}}
 assert.throws(()=>run({env:{...complete,SUPABASE_SERVICE_ROLE_KEY:''}},mockFs,()=>runId,assertAcceptanceTarget),/Complete isolated/)
 assert.throws(()=>run({env:{...complete,NEXT_PUBLIC_SUPABASE_URL:'https://wwfnsbilmyxeawgzicmv.supabase.co'}},mockFs,()=>runId,assertAcceptanceTarget),/isolated staging/)
 assert.equal(writes,0);assert.equal(step.env.SUPABASE_SERVICE_ROLE_KEY,'$'+'{{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}')
})
test('fresh export cannot retain foreign valid-named files from an earlier export',async t=>{
 const f=fixture(t,{retired:true}),stale=path.join(f.root,'safe-artifacts-15000000-0000-4000-8000-000000000099'),group=path.join(stale,'masters');fs.mkdirSync(group,{recursive:true})
 fs.writeFileSync(path.join(group,'fixture-proof.json'),JSON.stringify({runId:'foreign',password:'NeverUploadStaleSecret'}));fs.writeFileSync(path.join(group,'run.log'),'NeverUploadStaleSecret')
 const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(result.result,'PASS');assert.notEqual(result.artifactDirectory,stale);assert.ok(!fs.existsSync(path.join(result.artifactDirectory,'masters')))
 assert.ok(fs.readFileSync(path.join(group,'run.log'),'utf8').includes('NeverUploadStaleSecret'))
})

test('interrupted export publishes no directory and a retry starts from a new exclusive export',async t=>{
 const f=fixture(t,{retired:true}),pdf=path.join(f.folder,'invoice-browser-print.pdf');fs.writeFileSync(pdf,'not a synthetic PDF')
 const published=[]
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}).then(value=>published.push(value.artifactDirectory)),/synthetic finance PDF/)
 assert.deepEqual(published,[])
 const partial=fs.readdirSync(f.root).filter(name=>name.startsWith('safe-artifacts-'));assert.equal(partial.length,1)
 fs.unlinkSync(pdf)
 const retry=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(retry.result,'PASS');assert.notEqual(path.basename(retry.artifactDirectory),partial[0])
})

for(const status of ['RUNNING','FAIL','PASS'])for(const result of ['PASS','NOT_CREATED'])test('unsettled Auth intent '+status+'/'+result+' never turns absence into verified retirement',async t=>{
 const f=fixture(t,{tenantRecorded:false});saveProof(f,{result:status,appAccessRetired:true,authAccessRetired:true})
 const before=fs.readFileSync(f.proofPath,'utf8'),outcome=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin,retire:async()=>({result,membersRetired:0})})
 const finance=outcome.groups.find(group=>group.group==='finance')
 assert.equal(outcome.result,'FAIL');assert.equal(finance.result,'UNVERIFIED');assert.deepEqual(finance.issues,['INFLIGHT_AUTH_CREATION_UNVERIFIED'])
 assert.equal(fs.readFileSync(f.proofPath,'utf8'),before)
 const exported=JSON.parse(fs.readFileSync(path.join(outcome.artifactDirectory,'finance','cleanup-recovery.json'),'utf8'))
 assert.equal(exported.result,'UNVERIFIED');assert.deepEqual(exported.issues,['INFLIGHT_AUTH_CREATION_UNVERIFIED'])
})
