import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {readAcceptanceFixturePlans,assertAcceptanceFixturePlans,retireAcceptanceFixturePlans,readOwnedAcceptanceJson} from './lib/acceptance-fixture-ledgers.mjs'
import {retireAcceptanceFixtures} from './lib/coordinated-acceptance.mjs'
import {retireReleaseAcceptance} from './retire-release-acceptance.mjs'

const id=n=>'16000000-0000-4000-8000-'+String(n).padStart(12,'0')
const backend='https://viowrovartosrkqukjxy.supabase.co',target='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app',commit='a'.repeat(40)
function fixture(t,group='drivers'){
 const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fixture-ledgers-'))
 t.after(()=>{assert.ok(path.relative(os.tmpdir(),workspaceRoot).startsWith('fixture-ledgers-'));fs.rmSync(workspaceRoot,{recursive:true,force:true})})
 const proof={runId:id(1),group,tenantId:id(2),authUserId:id(3),project:'viowrovartosrkqukjxy',target,commit,ownerEmail:'release-'+id(4)+'@example.test',companyDomain:id(4)+'.test',result:'FAIL',results:[]}
 const folder=path.join(workspaceRoot,'supabase','.temp','release-acceptance-'+proof.runId,group)
 fs.mkdirSync(folder,{recursive:true})
 const proofPath=path.join(folder,'fixture-proof.json');fs.writeFileSync(proofPath,JSON.stringify(proof))
 const file=path.join(folder,group==='drivers'?'driver-profile-crud-fixture.json':'tenant-invitation-fixture.json')
 const ledger={schemaVersion:1,runId:proof.runId,group,tenantId:proof.tenantId,actorId:proof.authUserId,marker:id(5),result:'PASS',cleanup:'PASS',...(group==='drivers'?{driverId:id(6),codHold:{original:'0.00',injected:'1.00',intentVersion:7,heldVersion:8}}:{role:'readonly_auditor',email:'tenant-invite-'+id(5)+'@example.test',inviteId:id(6),submitAttempted:true,unexpectedAuthIds:[]})}
 const row={id:id(6),tenant_id:proof.tenantId,created_by:proof.authUserId,...(group==='drivers'?{full_name_ar:'سائق اختبار واجهة الملف '+ledger.marker,profile_version:8,cod_outstanding_amount:'1.00',deleted_at:null}:{email:ledger.email,role:ledger.role,invited_by:proof.authUserId,status:'pending',invited_at:'2026-10-27T00:00:00Z',expires_at:'2026-11-03T00:00:00Z',updated_at:'2026-10-27T00:00:00Z',accepted_at:null,accepted_by:null,provisioning_auth_user_id:null,deleted_at:null})}
 const state={clients:0,reads:0,writes:[],conflict:false,deleted:false,drivers:group==='drivers'?[row]:[],invites:group==='access'?[row]:[],users:[{id:id(7),tenant_id:proof.tenantId,auth_user_id:proof.authUserId,email:proof.ownerEmail,status:'active'}],tenants:[{id:proof.tenantId,created_by:proof.authUserId,domain:proof.companyDomain}],platform_admins:[],audit_log:[{actor_id:proof.authUserId,tenant_id:proof.tenantId,module:'drivers',entity_type:'driver',entity_id:id(6),action:'created',new_values:{profile_version:1}}]}
 const admin={supabaseUrl:backend,auth:{admin:{async getUserById(value){state.reads++;assert.equal(value,proof.authUserId);return{error:null,data:{user:{email:proof.ownerEmail,app_metadata:{_release_acceptance_run:proof.runId,_release_acceptance_group:group},...(state.deleted?{deleted_at:'2026-10-27T00:00:00Z'}:{})}}}},async deleteUser(value){state.writes.push({table:'auth',id:value});state.deleted=true;return{error:null}}}},from(table){
  const filters=[];let action='select',values,exact=false,head=false
  const matches=value=>filters.every(([key,wanted])=>key==='cod_outstanding_amount'?Number(value[key])===Number(wanted):value[key]===wanted)
  const output=single=>{
   state.reads++;let rows=state[table].filter(matches)
   if(action==='update'){
    state.writes.push({table,values,filters})
    if(state.conflict&&['drivers','invites'].includes(table))rows=[]
    for(const value of rows){Object.assign(value,values);if(table==='drivers')value.profile_version++}
   }
   if(action==='update'&&table==='drivers'&&state.lostResponse)return {error:{message:'private uncertain response'},data:null}
   return {error:null,data:head?null:single?(rows[0]?structuredClone(rows[0]):null):structuredClone(rows),...(exact?{count:rows.length}:{})}
  }
  return{select(_columns,options){exact=options?.count==='exact';head=options?.head===true;return this},eq(key,value){filters.push([key,value]);return this},is(key,value){filters.push([key,value]);return this},update(value){action='update';values=value;return this},async single(){return output(true)},async maybeSingle(){return output(true)},then(resolve,reject){return Promise.resolve(output(false)).then(resolve,reject)}}
 }}
 const save=()=>fs.writeFileSync(file,JSON.stringify(ledger));save()
 const read=(extra={})=>readAcceptanceFixturePlans({workspaceRoot,groupDirectory:folder,proof,...extra})
 const options={workspaceRoot,runId:proof.runId,backendUrl:backend,appUrl:target,commit}
 const summary={...proof,groups:[{group,result:'FAIL'}]};delete summary.group
 fs.writeFileSync(path.join(path.dirname(folder),'result.json'),JSON.stringify(summary))
 return {workspaceRoot,proof,proofPath,folder,file,ledger,row,state,admin,save,read,options,createAdmin(){state.clients++;return admin}}
}

const receiptPath=f=>path.join(f.folder,'driver-profile-crud-recovery.json')
async function restore(f){assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'PASS');assert.ok(fs.existsSync(receiptPath(f)))}

for(const [name,change]of [
 ['missing schema',{schemaVersion:undefined}],['foreign run',{runId:id(99)}],['foreign actor',{actorId:id(99)}],['foreign tenant',{tenantId:id(99)}],['foreign group',{group:'access'}],['invalid marker',{marker:'foreign'}],['invalid driver id',{driverId:'foreign'}],['unexpected original balance',{codHold:{original:'2.00',injected:'1.00',intentVersion:7,heldVersion:8}}],['invalid hold version',{codHold:{original:'0.00',injected:'1.00',intentVersion:7,heldVersion:9}}],
])test('ledger '+name+' is rejected before constructing a client',async t=>{
 const f=fixture(t);Object.assign(f.ledger,change);f.save()
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})

for(const group of ['drivers','access'])test(group+' malformed JSON is rejected before any API access',async t=>{
 const f=fixture(t,group);fs.writeFileSync(f.file,'{"schemaVersion":')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.equal(f.state.clients,0)
})
test('a hard-linked ledger fails closed',t=>{const f=fixture(t);fs.linkSync(f.file,path.join(f.workspaceRoot,'copy.json'));assert.throws(f.read,/Owned release/)})
test('a ledger directory junction fails closed',t=>{
 const f=fixture(t),other=path.join(f.workspaceRoot,'other');fs.renameSync(f.folder,other);fs.symlinkSync(other,f.folder,'junction');assert.throws(f.read,/Owned release/)
})
test('same-content proof replacement after validation is detected before API access',async t=>{
 const f=fixture(t)
 const outcome=await retireReleaseAcceptance(f.options,{createAdmin(){f.state.clients++;const bytes=fs.readFileSync(f.proofPath);fs.renameSync(f.proofPath,f.proofPath+'.old');fs.writeFileSync(f.proofPath,bytes);return f.admin}})
 assert.equal(outcome.result,'FAIL');assert.equal(f.state.reads,0);assert.equal(f.state.writes.length,0)
})
test('an in-place ledger replacement after validation is detected',t=>{
 const f=fixture(t),plan=f.read();f.ledger.cleanup='UNVERIFIED';f.save();assert.throws(()=>assertAcceptanceFixturePlans(plan,f.proof),/Owned release/)
})
test('a newly inserted ledger cannot bypass an absent snapshot',t=>{
 const f=fixture(t);fs.unlinkSync(f.file);const plan=f.read();f.save();assert.throws(()=>assertAcceptanceFixturePlans(plan,f.proof),/Owned release/)
})
test('filesystem replacement during descriptor read fails closed',t=>{
 const f=fixture(t),io=Object.create(fs);let replaced=false
 io.readFileSync=fd=>{const bytes=fs.readFileSync(fd);if(!replaced){replaced=true;fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,bytes)}return bytes}
 assert.throws(()=>readOwnedAcceptanceJson(f.workspaceRoot,f.file,{fsImpl:io}),/Owned release/)
})
test('every new ledger is validated before an earlier valid group can mutate',async t=>{
 const f=fixture(t),folder=path.join(path.dirname(f.folder),'access');fs.mkdirSync(folder)
 const proof={...f.proof,group:'access'};fs.writeFileSync(path.join(folder,'fixture-proof.json'),JSON.stringify(proof));fs.writeFileSync(path.join(folder,'tenant-invitation-fixture.json'),'{}')
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})
test('fixture recovery refuses production before all API operations',async t=>{
 const f=fixture(t);f.admin.supabaseUrl='https://wwfnsbilmyxeawgzicmv.supabase.co'
 await assert.rejects(()=>retireAcceptanceFixturePlans(f.admin,f.proof,f.read()),/Owned release/)
 assert.equal(f.state.reads,0);assert.equal(f.state.writes.length,0)
})

for(const receipt of [true,false])test('exact owned driver hold restores with '+(receipt?'confirmed':'lost')+' injection receipt',async t=>{
 const f=fixture(t);if(!receipt){delete f.ledger.codHold.heldVersion;f.save()}
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())
 assert.equal(result.result,'PASS');assert.equal(result.fixtures[0].holdRestored,true)
 assert.equal(f.row.cod_outstanding_amount,'0.00');assert.equal(f.row.profile_version,9);assert.equal(f.state.writes.length,1)
 assert.deepEqual(f.state.writes[0].values,{cod_outstanding_amount:'0.00'})
})
for(const [name,change]of [['foreign creator',{created_by:id(99)}],['foreign marker',{full_name_ar:'foreign'}],['unexpected version',{profile_version:9}],['unexpected balance',{cod_outstanding_amount:'2.00'}],['uncertain zero balance',{cod_outstanding_amount:'0.00',profile_version:9}],['archived held row',{deleted_at:'2026-10-27T00:00:00Z'}]])test('driver '+name+' remains unverified without balance writes',async t=>{
 const f=fixture(t);Object.assign(f.row,change)
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
})
test('driver hold CAS conflict cannot be reported as restored',async t=>{
 const f=fixture(t);f.state.conflict=true
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'UNVERIFIED');assert.deepEqual(result.issues,['DRIVER_HOLD_CAS_UNVERIFIED']);assert.equal(f.row.cod_outstanding_amount,'1.00')
})
test('ledger PASS without a hold receipt still checks API balance',async t=>{
 const f=fixture(t);f.ledger.codHold=null;f.save()
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
 f.row.cod_outstanding_amount='0.00'
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'PASS')
})
test('member retirement PASS cannot hide an unresolved driver ledger',async t=>{
 const f=fixture(t);f.row.profile_version=99;let error
 try{await retireAcceptanceFixtures(f.admin,f.proof,f.read())}catch(value){error=value}
 assert.equal(error.cleanupEvidence.result,'UNVERIFIED');assert.equal(error.cleanupEvidence.membersRetired,1);assert.equal(f.state.deleted,true);assert.equal(f.row.cod_outstanding_amount,'1.00')
})

test('pending owned synthetic invitation is revoked with all CAS bindings',async t=>{
 const f=fixture(t,'access'),result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())
 assert.equal(result.result,'PASS');assert.equal(f.row.status,'revoked');assert.equal(f.state.writes.length,1)
 const write=f.state.writes[0];assert.deepEqual(write.values,{status:'revoked',updated_by:f.proof.authUserId})
 for(const key of ['id','tenant_id','email','role','created_by','invited_by','status','updated_at','invited_at','expires_at','accepted_at','accepted_by','provisioning_auth_user_id','deleted_at'])assert.ok(write.filters.some(([field])=>field===key),key)
})
test('already revoked invitation is verified without mutation',async t=>{const f=fixture(t,'access');f.row.status='revoked';assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'PASS');assert.equal(f.state.writes.length,0)})
for(const [name,change]of [['accepted',{accepted_at:'2026-10-27T00:00:00Z'}],['accepted identity',{accepted_by:id(99)}],['provisioning identity',{provisioning_auth_user_id:id(99)}],['foreign inviter',{invited_by:id(99)}],['owner role',{role:'general_manager'}],['foreign id',{id:id(99)}],['deleted',{deleted_at:'2026-10-27T00:00:00Z'}]])test('invitation '+name+' stays unverified without mutation',async t=>{
 const f=fixture(t,'access');Object.assign(f.row,change);assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
})
test('invitation submission absence remains in flight despite claimed PASS',async t=>{
 const f=fixture(t,'access');f.state.invites=[];f.ledger.inviteId=null;f.save()
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'UNVERIFIED');assert.deepEqual(result.issues,['INVITATION_SUBMISSION_INFLIGHT']);assert.equal(f.state.writes.length,0)
})
test('invitation never submitted and absent is NOT_CREATED',async t=>{
 const f=fixture(t,'access');f.state.invites=[];f.ledger.inviteId=null;f.ledger.submitAttempted=false;f.save()
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'PASS');assert.equal(result.fixtures[0].result,'NOT_CREATED');assert.equal(f.state.writes.length,0)
})
test('unexpected recorded Auth identities require reviewed recovery and never Auth deletion',async t=>{
 const f=fixture(t,'access');f.ledger.unexpectedAuthIds=[id(99)];f.save()
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'UNVERIFIED');assert.equal(f.state.reads,1);assert.equal(f.state.writes.length,0)
})
test('unexpected provisioned member blocks invitation revocation',async t=>{
 const f=fixture(t,'access');f.state.users.push({tenant_id:f.proof.tenantId,email:f.ledger.email,id:id(99)})
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
})
for(const recorded of [false,true])test('invitation '+(recorded?'recorded Auth identity':'synthetic email')+' cannot authorize broad member Auth deletion',async t=>{
 const f=fixture(t,'access'),extra=id(99)
 f.state.users.push({id:id(98),tenant_id:f.proof.tenantId,auth_user_id:extra,email:recorded?'other@example.test':f.ledger.email,status:'active'})
 if(recorded)f.row.provisioning_auth_user_id=extra
 let error;try{await retireAcceptanceFixtures(f.admin,f.proof,f.read())}catch(value){error=value}
 assert.equal(error.cleanupEvidence.result,'UNVERIFIED');assert.equal(error.cleanupEvidence.membersRetired,1)
 assert.equal(f.state.users[1].status,'active');assert.ok(!f.state.writes.some(write=>write.table==='auth'&&write.id===extra))
})
test('unresolved invitation discovery retires only the independently bound owner',async t=>{
 const f=fixture(t,'access'),extra=id(99);f.state.invites=[]
 f.state.users.push({id:id(98),tenant_id:f.proof.tenantId,auth_user_id:extra,email:'unknown@example.test',status:'active'})
 let error;try{await retireAcceptanceFixtures(f.admin,f.proof,f.read())}catch(value){error=value}
 assert.equal(error.cleanupEvidence.result,'UNVERIFIED');assert.equal(error.cleanupEvidence.membersRetired,1)
 assert.equal(f.state.users[1].status,'active');assert.ok(!f.state.writes.some(write=>write.table==='auth'&&write.id===extra))
})
test('invitation CAS conflict stays unverified',async t=>{
 const f=fixture(t,'access');f.state.conflict=true
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read());assert.equal(result.result,'UNVERIFIED');assert.deepEqual(result.issues,['INVITATION_REVOCATION_CAS_UNVERIFIED']);assert.equal(f.row.status,'pending')
})
test('safe export includes recovery facts and preserves original FAIL without raw ledgers',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.file,'utf8'),outcome=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
 assert.equal(outcome.result,'PASS');assert.equal(outcome.acceptanceResult,'FAIL');assert.equal(fs.readFileSync(f.file,'utf8'),before)
 const result=outcome.groups.find(group=>group.group==='drivers');assert.deepEqual(result.fixtures,[{kind:'driver',result:'PASS',holdRestored:true}])
 assert.ok(!fs.existsSync(path.join(outcome.artifactDirectory,'drivers',path.basename(f.file))))
 assert.equal(JSON.parse(fs.readFileSync(path.join(outcome.artifactDirectory,'result.json'),'utf8')).result,'FAIL')
})

test('parent restoration, independent CLI and repeated CLI verify the same receipt without repeat CAS',async t=>{
 const f=fixture(t),proof=fs.readFileSync(f.proofPath,'utf8'),ledger=fs.readFileSync(f.file,'utf8')
 assert.equal((await retireAcceptanceFixtures(f.admin,f.proof,f.read())).result,'PASS')
 const receipt=fs.readFileSync(receiptPath(f),'utf8')
 for(let retry=0;retry<2;retry++){
  const result=await retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin})
  assert.equal(result.result,'PASS');assert.equal(result.acceptanceResult,'FAIL')
  assert.deepEqual(result.groups.find(item=>item.group==='drivers').fixtures,[{kind:'driver',result:'PASS',holdRestored:true}])
 }
 assert.equal(f.state.writes.filter(write=>write.table==='drivers').length,1)
 assert.equal(fs.readFileSync(f.proofPath,'utf8'),proof);assert.equal(fs.readFileSync(f.file,'utf8'),ledger);assert.equal(fs.readFileSync(receiptPath(f),'utf8'),receipt)
 const value=JSON.parse(receipt)
 assert.deepEqual([value.intentVersion,value.heldVersion,value.restoredVersion,value.original,value.injected],[7,8,9,'0.00','1.00'])
 assert.match(value.ledgerSha256,/^[0-9a-f]{64}$/)
})

for(const [name,change]of [['foreign run',{runId:id(99)}],['foreign actor',{actorId:id(99)}],['foreign driver',{driverId:id(99)}],['foreign tenant',{tenantId:id(99)}],['foreign marker',{marker:id(99)}],['foreign group',{group:'access'}],['foreign source',{commit:'b'.repeat(40)}],['foreign project',{project:'wwfnsbilmyxeawgzicmv'}],['foreign snapshot',{ledgerSha256:'0'.repeat(64)}],['changed CAS input',{heldVersion:9}],['changed restored version',{restoredVersion:10}],['changed amount',{original:'1.00'}],['unprojected secret',{sessionToken:'private'}]])test('recovery receipt '+name+' fails before client creation',async t=>{
 const f=fixture(t);await restore(f)
 const value={...JSON.parse(fs.readFileSync(receiptPath(f),'utf8')),...change};fs.writeFileSync(receiptPath(f),JSON.stringify(value));f.state.reads=0;f.state.writes=[]
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})
test('receipt bound to older ledger bytes fails before client creation',async t=>{
 const f=fixture(t);await restore(f);fs.appendFileSync(f.file,'\n');f.state.reads=0;f.state.writes=[]
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})
test('a hard-linked recovery receipt fails before client creation',async t=>{
 const f=fixture(t);await restore(f);fs.linkSync(receiptPath(f),path.join(f.workspaceRoot,'receipt-copy.json'));f.state.reads=0;f.state.writes=[]
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})
test('a truncated recovery receipt fails before client creation',async t=>{
 const f=fixture(t);await restore(f);fs.writeFileSync(receiptPath(f),'{"schemaVersion":');f.state.reads=0;f.state.writes=[]
 await assert.rejects(()=>retireReleaseAcceptance(f.options,{createAdmin:f.createAdmin}),/Owned release/)
 assert.deepEqual([f.state.clients,f.state.reads,f.state.writes.length],[0,0,0])
})
test('same-content receipt replacement after validation fails before API access',async t=>{
 const f=fixture(t);await restore(f);f.state.reads=0;f.state.writes=[]
 const result=await retireReleaseAcceptance(f.options,{createAdmin(){const bytes=fs.readFileSync(receiptPath(f));fs.renameSync(receiptPath(f),receiptPath(f)+'.old');fs.writeFileSync(receiptPath(f),bytes);return f.admin}})
 assert.equal(result.result,'FAIL');assert.equal(f.state.reads,0);assert.equal(f.state.writes.length,0)
})
for(const [name,change]of [['advanced version',{profile_version:10}],['held balance',{cod_outstanding_amount:'1.00'}],['foreign identity',{created_by:id(99)}],['archived row',{deleted_at:'2026-10-27T00:00:00Z'}]])test('valid receipt with API '+name+' remains unverified without a new CAS',async t=>{
 const f=fixture(t);await restore(f);Object.assign(f.row,change);f.state.writes=[]
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())
 assert.equal(result.result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
})
test('lost CAS response writes no receipt and zero balance alone never verifies a retry',async t=>{
 const f=fixture(t);f.state.lostResponse=true
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED')
 assert.equal(f.row.cod_outstanding_amount,'0.00');assert.equal(f.row.profile_version,9);assert.ok(!fs.existsSync(receiptPath(f)))
 f.state.lostResponse=false;f.state.writes=[]
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED');assert.equal(f.state.writes.length,0)
})
test('failed atomic receipt persistence cannot turn restoration into PASS',async t=>{
 const f=fixture(t),io=Object.create(fs)
 io.renameSync=()=>{throw Object.assign(Error('private filesystem detail'),{code:'EACCES'})}
 const result=await retireAcceptanceFixturePlans(f.admin,f.proof,f.read({fsImpl:io}))
 assert.equal(result.result,'UNVERIFIED');assert.deepEqual(result.issues,['DRIVER_HOLD_RECEIPT_UNVERIFIED'])
 assert.equal(f.row.cod_outstanding_amount,'0.00');assert.ok(!fs.existsSync(receiptPath(f)));assert.ok(!fs.readdirSync(f.folder).some(name=>name.endsWith('.tmp')))
 assert.equal((await retireAcceptanceFixturePlans(f.admin,f.proof,f.read())).result,'UNVERIFIED')
})
test('a receipt inserted during atomic persistence is preserved and cannot claim PASS',async t=>{
 const f=fixture(t),io=Object.create(fs),foreign='{"foreign":"preserve"}'
 io.fsyncSync=descriptor=>{fs.fsyncSync(descriptor);fs.writeFileSync(receiptPath(f),foreign)}
 await assert.rejects(()=>retireAcceptanceFixturePlans(f.admin,f.proof,f.read({fsImpl:io})),/Owned release/)
 assert.equal(fs.readFileSync(receiptPath(f),'utf8'),foreign);assert.equal(f.row.cod_outstanding_amount,'0.00')
 assert.ok(!fs.readdirSync(f.folder).some(name=>name.endsWith('.tmp')))
})
