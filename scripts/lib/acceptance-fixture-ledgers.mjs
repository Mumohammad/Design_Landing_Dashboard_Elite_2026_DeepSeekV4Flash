import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {writeReleaseEvidence} from './write-release-evidence.mjs'

const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??'')
const denied=()=>Object.assign(Error('Owned release fixture ledger required before retirement'),{fixtureBoundary:true})
const sameNode=(a,b)=>a.dev===b.dev&&a.ino===b.ino
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const plans=new WeakMap()
const identityKeys=['runId','group','tenantId','authUserId','project','commit','target','ownerEmail','companyDomain']
const identity=proof=>JSON.stringify(identityKeys.map(key=>proof[key]??null))
const names={drivers:'driver-profile-crud-fixture.json',access:'tenant-invitation-fixture.json'}
const receiptName='driver-profile-crud-recovery.json'

function inspect(workspace,file,io){
 const relative=path.relative(workspace,file)
 if(relative.startsWith('..')||path.isAbsolute(relative))throw denied()
 const root=path.parse(file).root,parts=path.relative(root,file).split(path.sep).filter(Boolean),parents=[]
 let current=root
 for(let index=-1;index<parts.length;index++){
  if(index>=0)current=path.join(current,parts[index])
  let stat;try{stat=io.lstatSync(current,{bigint:true})}catch(error){if(error.code==='ENOENT')return null;throw denied()}
  const leaf=index===parts.length-1
  if(stat.isSymbolicLink()||(leaf?!stat.isFile()||stat.nlink!==1n:!stat.isDirectory()))throw denied()
  parents.push({file:current,stat})
 }
 return parents
}

/** Read one complete regular JSON snapshot, without following a junction or hard link. */
export function readOwnedAcceptanceJson(workspaceRoot,file,{fsImpl=fs}={}){
 const workspace=path.resolve(workspaceRoot),resolved=path.resolve(file),before=inspect(workspace,resolved,fsImpl)
 if(!before)return null
 let descriptor
 try{
  descriptor=fsImpl.openSync(resolved,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0))
  const stat=fsImpl.fstatSync(descriptor,{bigint:true})
  if(!stat.isFile()||stat.nlink!==1n||stat.size>2n*1024n*1024n||!sameNode(stat,before.at(-1).stat))throw denied()
  const bytes=fsImpl.readFileSync(descriptor),afterStat=fsImpl.fstatSync(descriptor,{bigint:true}),after=inspect(workspace,resolved,fsImpl)
  if(!after||before.length!==after.length||before.some((part,index)=>!sameNode(part.stat,after[index].stat))||!sameNode(stat,afterStat)||stat.size!==afterStat.size||stat.mtimeNs!==afterStat.mtimeNs||stat.ctimeNs!==afterStat.ctimeNs||BigInt(bytes.length)!==stat.size)throw denied()
  const value=JSON.parse(bytes.toString('utf8'))
  if(!value||typeof value!=='object'||Array.isArray(value))throw denied()
  const hash=digest(bytes)
  return {value,assertUnchanged(){
   const now=readOwnedAcceptanceJson(workspace,resolved,{fsImpl})
   if(!now||now.hash!==hash||!sameNode(stat,now.stat))throw denied()
  },hash,stat}
 }catch{throw denied()}finally{if(descriptor!==undefined)fsImpl.closeSync(descriptor)}
}

function validate(value,proof,group){
 if(value.schemaVersion!==1||value.runId!==proof.runId||value.group!==group||value.tenantId!==proof.tenantId||value.actorId!==proof.authUserId||!uuid(value.tenantId)||!uuid(value.actorId)||!uuid(value.marker)||!['RUNNING','PASS','FAIL'].includes(value.result))throw denied()
 if(group==='drivers'){
  if(!['NOT_REQUIRED','REQUIRED','PASS','UNVERIFIED'].includes(value.cleanup)||value.driverId!==null&&!uuid(value.driverId)||value.codHold!==null&&(typeof value.codHold!=='object'||Array.isArray(value.codHold)))throw denied()
  if(value.codHold){
   const hold=value.codHold
   if(!uuid(value.driverId)||hold.original!=='0.00'||hold.injected!=='1.00'||!Number.isSafeInteger(hold.intentVersion)||hold.intentVersion<1||hold.intentVersion>Number.MAX_SAFE_INTEGER-2||hold.heldVersion!==undefined&&hold.heldVersion!==hold.intentVersion+1)throw denied()
  }
 }else{
  if(!['REQUIRED','PASS','NOT_CREATED','UNVERIFIED'].includes(value.cleanup)||value.role!=='readonly_auditor'||value.email!=='tenant-invite-'+value.marker+'@example.test'||value.inviteId!==null&&!uuid(value.inviteId)||typeof value.submitAttempted!=='boolean'||!Array.isArray(value.unexpectedAuthIds)||new Set(value.unexpectedAuthIds).size!==value.unexpectedAuthIds.length||value.unexpectedAuthIds.some(id=>!uuid(id))||value.inviteId&&!value.submitAttempted)throw denied()
 }
}

function driverReceipt(file,proof){
 const ledger=file.value,hold=ledger.codHold
 if(!hold)throw denied()
 const heldVersion=hold.heldVersion??hold.intentVersion+1
 return {schemaVersion:1,kind:'driver-cod-hold-restoration',runId:ledger.runId,group:'drivers',project:proof.project,commit:proof.commit,target:proof.target,tenantId:ledger.tenantId,actorId:ledger.actorId,driverId:ledger.driverId,marker:ledger.marker,ledgerSha256:file.snapshot.hash,original:'0.00',injected:'1.00',intentVersion:hold.intentVersion,heldVersion,restoredVersion:heldVersion+1,result:'PASS'}
}

function validateReceipt(value,file,proof){
 if(!file||file.kind!=='driver')throw denied()
 const expected=driverReceipt(file,proof),keys=Object.keys(expected)
 if(Object.keys(value).length!==keys.length||keys.some(key=>value[key]!==expected[key]))throw denied()
}

/** Only canonical coordinator-owned group paths may authorize synthetic recovery. */
export function readAcceptanceFixturePlans({workspaceRoot=process.cwd(),groupDirectory,proof,fsImpl=fs}){
 if(!uuid(proof?.runId)||!(/^[a-z_]+$/).test(proof?.group??''))throw denied()
 const workspace=path.resolve(workspaceRoot),folder=path.join(workspace,'supabase','.temp','release-acceptance-'+proof.runId,proof.group)
 if(path.resolve(groupDirectory)!==folder)throw denied()
 const files=[],absent=[]
 const proofSnapshot=readOwnedAcceptanceJson(workspace,path.join(folder,'fixture-proof.json'),{fsImpl})
 if(proofSnapshot&&identity(proofSnapshot.value)!==identity(proof))throw denied()
 // Check both names in every group: a misplaced ledger cannot evade cleanup.
 for(const [group,name]of Object.entries(names)){
  const snapshot=readOwnedAcceptanceJson(workspace,path.join(folder,name),{fsImpl})
  if(!snapshot){absent.push(path.join(folder,name));continue}
  if(proof.group!==group)throw denied()
  validate(snapshot.value,proof,group)
  files.push({kind:group==='drivers'?'driver':'invitation',snapshot,value:structuredClone(snapshot.value)})
 }
 const result=Object.freeze({count:files.length})
 if(files.length&&!proofSnapshot)throw denied()
 const receiptFile=path.join(folder,receiptName),driver=files.find(file=>file.kind==='driver')
 let receiptSnapshot=readOwnedAcceptanceJson(workspace,receiptFile,{fsImpl})
 if(receiptSnapshot)validateReceipt(receiptSnapshot.value,driver,proof)
 plans.set(result,{binding:identity(proof),files,ownerId:proof.authUserId,invitationUnverified:false,protectedEmails:new Set(files.filter(file=>file.kind==='invitation').map(file=>file.value.email)),protectedAuthIds:new Set(files.flatMap(file=>file.value.unexpectedAuthIds??[])),receipt(){return receiptSnapshot?.value},recordRestoration(){
  assertAcceptanceFixturePlans(result,proof)
  if(receiptSnapshot)throw denied()
  const value=driverReceipt(driver,proof)
  // This receipt is new evidence, so an unexpectedly inserted destination
  // must remain untouched rather than becoming an atomic replacement.
  const creationIo=Object.create(fsImpl)
  creationIo.lstatSync=(file,options)=>{const stat=fsImpl.lstatSync(file,options);if(path.resolve(file)===receiptFile)throw denied();return stat}
  writeReleaseEvidence(receiptFile,value,{fsImpl:creationIo})
  const written=readOwnedAcceptanceJson(workspace,receiptFile,{fsImpl})
  if(!written)throw denied()
  validateReceipt(written.value,driver,proof)
  receiptSnapshot=written
 },guard(){
  proofSnapshot?.assertUnchanged()
  for(const file of absent)if(readOwnedAcceptanceJson(workspace,file,{fsImpl}))throw denied()
  if(receiptSnapshot)receiptSnapshot.assertUnchanged()
  else if(readOwnedAcceptanceJson(workspace,receiptFile,{fsImpl}))throw denied()
 }})
 return result
}

export function assertAcceptanceFixturePlans(plan,proof){
 const state=plans.get(plan)
 if(!state||state.binding!==identity(proof))throw denied()
 state.guard()
 for(const file of state.files)file.snapshot.assertUnchanged()
 return state.files
}

/** Invitation issuance must never authorize deleting an unexpected Auth member. */
export function mayRetireAcceptanceFixtureMember(plan,member){
 const state=plans.get(plan)
 if(!state)throw denied()
 return !(state.invitationUnverified&&member.auth_user_id!==state.ownerId)&&!state.protectedEmails.has(member.email)&&!state.protectedAuthIds.has(member.auth_user_id)
}

function issue(code){const error=Error(code);error.fixtureIssue=code;throw error}
const amount=(value,expected)=>typeof value==='number'?value===expected:typeof value==='string'&&/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)&&Number(value)===expected
async function driverCleanup(admin,ledger,guard,recovery){
 if(!ledger.driverId){if(ledger.codHold)issue('DRIVER_HOLD_INTENT_UNVERIFIED');return {kind:'driver',result:'NOT_CREATED'}}
 const read=async()=>{
  guard()
  const row=await admin.from('drivers').select('id,tenant_id,created_by,full_name_ar,profile_version,cod_outstanding_amount,deleted_at').eq('tenant_id',ledger.tenantId).eq('id',ledger.driverId).maybeSingle()
  const value=row.data
  if(row.error||!value||value.id!==ledger.driverId||value.tenant_id!==ledger.tenantId||value.created_by!==ledger.actorId||value.full_name_ar!=='سائق اختبار واجهة الملف '+ledger.marker||!Number.isSafeInteger(value.profile_version)||value.profile_version<1)issue('DRIVER_IDENTITY_UNVERIFIED')
  return value
 }
 const row=await read()
 guard()
 const created=await admin.from('audit_log').select('actor_id,new_values').eq('tenant_id',ledger.tenantId).eq('module','drivers').eq('entity_type','driver').eq('entity_id',ledger.driverId).eq('action','created')
 if(created.error||created.data?.length!==1||created.data[0].actor_id!==ledger.actorId||created.data[0].new_values?.profile_version!==1)issue('DRIVER_CREATION_UNVERIFIED')
 if(!ledger.codHold){if(!amount(row.cod_outstanding_amount,0))issue('DRIVER_BALANCE_UNVERIFIED');return {kind:'driver',result:'PASS',holdRestored:false}}
 const receipt=recovery.receipt()
 if(receipt){
  if(row.deleted_at||!amount(row.cod_outstanding_amount,0)||row.profile_version!==receipt.restoredVersion)issue('DRIVER_HOLD_RECEIPT_STATE_UNVERIFIED')
  return {kind:'driver',result:'PASS',holdRestored:true}
 }
 const heldVersion=ledger.codHold.heldVersion??ledger.codHold.intentVersion+1
 // The source trigger increments exactly once for every drivers UPDATE. A
 // saved intent plus this exact row is sufficient for a lost hold receipt.
 if(row.deleted_at||!amount(row.cod_outstanding_amount,1)||row.profile_version!==heldVersion)issue('DRIVER_HOLD_VERSION_UNVERIFIED')
 guard()
 const restored=await admin.from('drivers').update({cod_outstanding_amount:'0.00'}).eq('tenant_id',ledger.tenantId).eq('id',ledger.driverId).eq('created_by',ledger.actorId).eq('full_name_ar','سائق اختبار واجهة الملف '+ledger.marker).eq('profile_version',heldVersion).eq('cod_outstanding_amount',1).is('deleted_at',null).select('id,profile_version')
 if(restored.error||restored.data?.length!==1||restored.data[0].id!==ledger.driverId||restored.data[0].profile_version!==heldVersion+1)issue('DRIVER_HOLD_CAS_UNVERIFIED')
 const after=await read()
 if(!amount(after.cod_outstanding_amount,0)||after.profile_version!==heldVersion+1||after.deleted_at)issue('DRIVER_HOLD_RESTORATION_UNVERIFIED')
 try{recovery.recordRestoration()}catch(error){if(error.fixtureBoundary)throw error;issue('DRIVER_HOLD_RECEIPT_UNVERIFIED')}
 return {kind:'driver',result:'PASS',holdRestored:true}
}

async function invitationCleanup(admin,ledger,guard,protect){
 const read=async()=>{
  guard()
  const result=await admin.from('invites').select('id,tenant_id,email,role,created_by,invited_by,status,invited_at,expires_at,updated_at,accepted_at,accepted_by,provisioning_auth_user_id,deleted_at').eq('tenant_id',ledger.tenantId).eq('email',ledger.email)
  if(result.error||!Array.isArray(result.data)||result.data.length>1)issue('INVITATION_IDENTITY_UNVERIFIED')
  const row=result.data[0]
  if(row)protect(row)
  if(row&&(!uuid(row.id)||ledger.inviteId&&row.id!==ledger.inviteId||row.tenant_id!==ledger.tenantId||row.email!==ledger.email||row.role!==ledger.role||row.created_by!==ledger.actorId||row.invited_by!==ledger.actorId||!Number.isFinite(Date.parse(row.updated_at))||!Number.isFinite(Date.parse(row.invited_at))||!Number.isFinite(Date.parse(row.expires_at))))issue('INVITATION_IDENTITY_UNVERIFIED')
  return row
 }
 const row=await read()
 if(ledger.unexpectedAuthIds.length)issue('INVITATION_PROVISIONING_UNVERIFIED')
 if(!row){if(ledger.submitAttempted||ledger.inviteId)issue('INVITATION_SUBMISSION_INFLIGHT');return {kind:'invitation',result:'NOT_CREATED'}}
 if(!ledger.submitAttempted)issue('INVITATION_SUBMISSION_UNVERIFIED')
 if(row.accepted_at||row.accepted_by||row.provisioning_auth_user_id)issue('INVITATION_PROVISIONING_UNVERIFIED')
 guard()
 const profiles=await admin.from('users').select('id',{count:'exact',head:true}).eq('tenant_id',ledger.tenantId).eq('email',ledger.email)
 if(profiles.error||profiles.count!==0)issue('INVITATION_PROVISIONING_UNVERIFIED')
 if(row.deleted_at||!['pending','revoked'].includes(row.status))issue('INVITATION_STATE_UNVERIFIED')
 if(row.status==='revoked')return {kind:'invitation',result:'PASS',revoked:false}
 guard()
 const revoked=await admin.from('invites').update({status:'revoked',updated_by:ledger.actorId}).eq('id',row.id).eq('tenant_id',ledger.tenantId).eq('email',ledger.email).eq('role',ledger.role).eq('created_by',ledger.actorId).eq('invited_by',ledger.actorId).eq('status','pending').eq('updated_at',row.updated_at).eq('invited_at',row.invited_at).eq('expires_at',row.expires_at).is('accepted_at',null).is('accepted_by',null).is('provisioning_auth_user_id',null).is('deleted_at',null).select('id')
 if(revoked.error||revoked.data?.length!==1||revoked.data[0].id!==row.id)issue('INVITATION_REVOCATION_CAS_UNVERIFIED')
 const after=await read()
 if(!after||after.id!==row.id||after.status!=='revoked'||after.deleted_at||after.accepted_at||after.accepted_by||after.provisioning_auth_user_id)issue('INVITATION_REVOCATION_UNVERIFIED')
 return {kind:'invitation',result:'PASS',revoked:true}
}

/** Never trusts ledger cleanup/result flags; returns only deliberately safe facts. */
export async function retireAcceptanceFixturePlans(admin,proof,plan){
 const backend=new URL(admin.supabaseUrl)
 if(backend.origin!=='https://viowrovartosrkqukjxy.supabase.co'||backend.pathname!=='/'||backend.username||backend.password||backend.search||backend.hash||proof.project!=='viowrovartosrkqukjxy')throw denied()
 const files=assertAcceptanceFixturePlans(plan,proof),fixtures=[],issues=[]
 const recovery=plans.get(plan)
 const guard=()=>assertAcceptanceFixturePlans(plan,proof)
 const protect=row=>{for(const id of [row.accepted_by,row.provisioning_auth_user_id])if(uuid(id))plans.get(plan).protectedAuthIds.add(id)}
 for(const file of files){
  try{fixtures.push(await (file.kind==='driver'?driverCleanup(admin,file.value,guard,recovery):invitationCleanup(admin,file.value,guard,protect)))}
  catch(error){if(error.fixtureBoundary)throw error;if(file.kind==='invitation')plans.get(plan).invitationUnverified=true;fixtures.push({kind:file.kind,result:'UNVERIFIED'});issues.push(error.fixtureIssue??'FIXTURE_RECOVERY_UNVERIFIED')}
 }
 return {result:issues.length?'UNVERIFIED':'PASS',fixtures,issues}
}
