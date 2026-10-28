import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {MODULE_GROUPS,assertAcceptanceRunId,assertAcceptanceTarget,retireAcceptanceFixtures,redactAcceptanceOutput} from './lib/coordinated-acceptance.mjs'
import {readAcceptanceFixturePlans,assertAcceptanceFixturePlans,readOwnedAcceptanceJson} from './lib/acceptance-fixture-ledgers.mjs'

const project='viowrovartosrkqukjxy',groups=Object.keys(MODULE_GROUPS)
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value??'')
const denied=()=>Error('Owned release acceptance evidence required before retirement')
const pdfs=['invoice-browser-print.pdf','invoice-reference-hidden-due.pdf','invoice-reference-visible-due.pdf']
function regular(workspace,file,directory=false){
 const relative=path.relative(workspace,file)
 if(relative.startsWith('..')||path.isAbsolute(relative))throw denied()
 const parts=[workspace,...relative.split(path.sep).filter(Boolean).map((_,i,items)=>path.join(workspace,...items.slice(0,i+1)))]
 for(let index=0;index<parts.length;index++){
  let info;try{info=fs.lstatSync(parts[index])}catch(error){if(error.code==='ENOENT')return false;throw denied()}
  if(info.isSymbolicLink()||(index<parts.length-1||directory?!info.isDirectory():!info.isFile()||info.nlink!==1))throw denied()
 }
 return true
}
function readJson(workspace,file){
 return readOwnedAcceptanceJson(workspace,file)?.value??null
}
function identity(value,expected,group){
 if(!value||value.runId!==expected.runId||value.commit!==expected.commit||value.target!==expected.target||value.project!==project||(group&&value.group!==group))throw denied()
}
function validateProof(proof,expected,group){
 identity(proof,expected,group)
 if(!['RUNNING','PASS','FAIL'].includes(proof.result)||!Array.isArray(proof.results)||new Set(proof.results).size!==proof.results.length||proof.results.some(item=>!MODULE_GROUPS[group].includes(item)))throw denied()
 if(proof.authUserId!==undefined&&!uuid(proof.authUserId)||proof.tenantId!==undefined&&!uuid(proof.tenantId))throw denied()
 if(proof.authUserId){
  if(!/^release-[0-9a-f-]{36}@example\.test$/i.test(proof.ownerEmail??'')||!/^[0-9a-f-]{36}\.test$/i.test(proof.companyDomain??''))throw denied()
 }else if(proof.tenantId||proof.ownerEmail||proof.companyDomain||proof.authorityMarker||proof.extraFixtures?.length||proof.pendingAuxiliary?.length)throw denied()
 for(const field of ['extraFixtures','pendingAuxiliary'])if(proof[field]!==undefined&&!Array.isArray(proof[field]))throw denied()
 if(proof.authorityMarker&&(proof.authorityMarker.actorId!==proof.authUserId||proof.authorityMarker.email!==proof.ownerEmail||!/^platform-user-acceptance:[0-9a-f-]{36}$/i.test(proof.authorityMarker.note??'')))throw denied()
 for(const extra of proof.extraFixtures??[]){
  if(!['platform-owner','platform-member'].includes(extra.kind)||extra.actorId!==proof.authUserId||!uuid(extra.authUserId)||!new RegExp('^'+extra.kind+'-[0-9a-f-]{36}@example\\.test$','i').test(extra.email??'')||extra.tenantId!==undefined&&!uuid(extra.tenantId))throw denied()
  if(extra.kind==='platform-owner'?!uuid(extra.tag):!uuid(extra.requestId)||!uuid(extra.tenantId))throw denied()
 }
 for(const intent of proof.pendingAuxiliary??[])if(intent.kind!=='platform-member-intent'||intent.actorId!==proof.authUserId||!uuid(intent.tenantId)||!uuid(intent.requestId)||!/^platform-member-[0-9a-f-]{36}@example\.test$/i.test(intent.email??''))throw denied()
}
function publicProof(proof){
 const result={}
 for(const key of ['runId','group','project','commit','target','result','authUserId','tenantId','ownerEmail','companyDomain','results'])if(proof[key]!==undefined)result[key]=proof[key]
 for(const key of ['appAccessRetired','authAccessRetired','returningAuthVerified','cleanupFailed'])if(typeof proof[key]==='boolean')result[key]=proof[key]
 for(const field of ['extraFixtures','pendingAuxiliary'])if(proof[field])result[field]=proof[field].map(item=>Object.fromEntries((item.kind==='platform-owner'?['kind','actorId','authUserId','email','tag','tenantId']:item.kind==='platform-member'?['kind','actorId','authUserId','email','tenantId','requestId']:['kind','actorId','email','tenantId','requestId']).filter(key=>item[key]!==undefined).map(key=>[key,item[key]])))
 if(proof.authorityMarker)result.authorityMarker={kind:'platform-marker',actorId:proof.authorityMarker.actorId,email:proof.authorityMarker.email,note:proof.authorityMarker.note}
 return result
}
function cleanupFacts(value){
 const result={result:['PASS','NOT_CREATED','UNVERIFIED'].includes(value?.result)?value.result:'UNVERIFIED'}
 for(const field of ['membersRetired','auxiliaryRetired','unresolvedAuxiliary','recoveredAuxiliary'])if(Number.isSafeInteger(value?.[field])&&value[field]>=0)result[field]=value[field]
 if(typeof value?.markerRemoved==='boolean')result.markerRemoved=value.markerRemoved
 if(Array.isArray(value?.fixtures))result.fixtures=value.fixtures.filter(item=>['driver','invitation'].includes(item?.kind)).map(item=>({kind:item.kind,result:['PASS','NOT_CREATED','UNVERIFIED'].includes(item.result)?item.result:'UNVERIFIED',...(typeof item.holdRestored==='boolean'?{holdRestored:item.holdRestored}:{}),...(typeof item.revoked==='boolean'?{revoked:item.revoked}:{})}))
 result.issues=Array.isArray(value?.issues)?value.issues.filter(item=>typeof item==='string'&&/^[A-Z_]{1,80}$/.test(item)):result.result==='UNVERIFIED'?['RETIREMENT_UNVERIFIED']:[]
 return result
}
export function readAcceptanceLedger({workspaceRoot=process.cwd(),runDirectory,runId,backendUrl,appUrl,commit}){
 assertAcceptanceRunId(runId)
 const target=assertAcceptanceTarget(backendUrl,appUrl,commit),workspace=path.resolve(workspaceRoot),root=path.join(workspace,'supabase','.temp','release-acceptance-'+runId)
 if(runDirectory!==undefined&&path.resolve(runDirectory)!==root)throw denied()
 if(!regular(workspace,root,true))return {expected:{runId,commit,target:target.app,project},workspace,root,missing:true,proofs:[]}
 const expected={runId,commit,target:target.app,project},summary=readJson(workspace,path.join(root,'result.json'))
 if(summary){identity(summary,expected);if(!['RUNNING','PASS','FAIL'].includes(summary.result)||!Array.isArray(summary.groups)||new Set(summary.groups.map(item=>item.group)).size!==summary.groups.length||summary.groups.some(item=>!groups.includes(item.group)||!['RUNNING','PASS','FAIL'].includes(item.result)))throw denied()}
 const allowed=new Set(['result.json','cleanup-recovery.json',...groups])
 for(const name of fs.readdirSync(root)){if(allowed.has(name))continue;if(/^safe-artifacts-[0-9a-f-]{36}$/i.test(name)){regular(workspace,path.join(root,name),true);continue}if(!/^\.result\.json\.[0-9a-f-]{36}\.tmp$/i.test(name))throw denied();regular(workspace,path.join(root,name))}
 const proofs=groups.map(group=>{
  regular(workspace,path.join(root,group),true)
  const proof=readJson(workspace,path.join(root,group,'fixture-proof.json'))
  if(proof)validateProof(proof,expected,group)
  for(const name of ['run.log',...(group==='finance'?pdfs:[])])regular(workspace,path.join(root,group,name))
  const fixturePlan=readAcceptanceFixturePlans({workspaceRoot:workspace,groupDirectory:path.join(root,group),proof:proof??{...expected,group}})
  return{group,proof,fixturePlan}
 })
 if(!summary&&proofs.some(item=>item.proof))throw denied()
 const artifactRoot=path.join(root,'safe-artifacts-'+randomUUID())
 regular(workspace,path.join(root,'cleanup-recovery.json'))
 if(regular(workspace,artifactRoot,true))throw denied()
 return{expected,workspace,root,summary,proofs,artifactRoot}
}
function writeFile(ledger,file,value){
 regular(ledger.workspace,path.dirname(file),true);regular(ledger.workspace,file)
 fs.mkdirSync(path.dirname(file),{recursive:true})
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW??0),0o600)
 try{fs.writeFileSync(fd,value)}finally{fs.closeSync(fd)}
}
export async function retireReleaseAcceptance(options,{createAdmin,retire=retireAcceptanceFixtures,secrets=[]}={}){
 const ledger=readAcceptanceLedger(options)
 if(ledger.missing)return{...ledger.expected,result:'NOT_STARTED',groups:groups.map(group=>({group,result:'NOT_STARTED'}))}
 fs.mkdirSync(ledger.artifactRoot)
 let admin
 const results=[]
 for(const {group,proof,fixturePlan}of ledger.proofs){
  if(!proof){results.push({group,result:'NOT_STARTED'});continue}
  const copy=structuredClone(proof)
  try{
   const client=proof.authUserId?(admin??=createAdmin()):{supabaseUrl:options.backendUrl}
   // Recheck the complete run after client construction, before any API access.
   for(const entry of ledger.proofs)assertAcceptanceFixturePlans(entry.fixturePlan,entry.proof??{...ledger.expected,group:entry.group})
   const cleanup=cleanupFacts(await retire(client,copy,fixturePlan))
   if(proof.authUserId&&!proof.tenantId&&['PASS','NOT_CREATED'].includes(cleanup.result)&&!(cleanup.membersRetired>0)){
    cleanup.result='UNVERIFIED';cleanup.issues=[...cleanup.issues,'INFLIGHT_AUTH_CREATION_UNVERIFIED']
   }
   results.push({group,...cleanup,...(copy.tenantId&&copy.tenantId!==proof.tenantId?{recoveredTenantId:copy.tenantId}:{})})
  }catch(error){results.push({group,...cleanupFacts(error.cleanupEvidence??{result:'UNVERIFIED'})})}
 }
 const recovery={...ledger.expected,result:results.every(item=>['PASS','NOT_CREATED','NOT_STARTED'].includes(item.result))?'PASS':'FAIL',acceptanceResult:ledger.summary?.result??'NOT_STARTED',groups:results,checkedAt:new Date().toISOString()}
 writeFile(ledger,path.join(ledger.root,'cleanup-recovery.json'),JSON.stringify(recovery,null,2)+'\n')
 const summary={...ledger.expected,result:ledger.summary?.result??'NOT_STARTED',groups:(ledger.summary?.groups??[]).map(item=>({group:item.group,result:item.result,...(typeof item.exitCode==='number'?{exitCode:item.exitCode}:{}),...(typeof item.timedOut==='boolean'?{timedOut:item.timedOut}:{}),...(typeof item.logSafe==='boolean'?{logSafe:item.logSafe}:{})}))}
 writeFile(ledger,path.join(ledger.artifactRoot,'result.json'),JSON.stringify(summary,null,2)+'\n')
 writeFile(ledger,path.join(ledger.artifactRoot,'cleanup-recovery.json'),JSON.stringify(recovery,null,2)+'\n')
 for(const {group,proof}of ledger.proofs){
  if(!proof)continue
  writeFile(ledger,path.join(ledger.artifactRoot,group,'fixture-proof.json'),JSON.stringify(publicProof(proof),null,2)+'\n')
  writeFile(ledger,path.join(ledger.artifactRoot,group,'cleanup-recovery.json'),JSON.stringify(results.find(item=>item.group===group),null,2)+'\n')
  const log=path.join(ledger.root,group,'run.log')
  if(fs.existsSync(log)){
   if(fs.statSync(log).size>8*1024*1024)throw Error('Acceptance log exceeds safe artifact limit')
   writeFile(ledger,path.join(ledger.artifactRoot,group,'run.log'),redactAcceptanceOutput(fs.readFileSync(log,'utf8'),secrets))
  }
  if(group==='finance')for(const name of pdfs){
   const file=path.join(ledger.root,group,name)
   if(!fs.existsSync(file))continue
   if(!proof.authUserId||!proof.tenantId||fs.statSync(file).size>30*1024*1024)throw Error('Owned synthetic finance PDF required')
   const bytes=fs.readFileSync(file);if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Owned synthetic finance PDF required')
   writeFile(ledger,path.join(ledger.artifactRoot,group,name),bytes)
  }
 }
 return {...recovery,artifactDirectory:ledger.artifactRoot}
}
async function main(){
 const commit=process.env.VERIFY_COMMIT_SHA,head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true})
 if(head.status!==0||head.stdout.trim()!==commit)throw denied()
 const options={runId:process.env.VERIFY_RELEASE_RUN_ID,backendUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,appUrl:process.env.VERIFY_APP_URL,commit}
 const outcome=await retireReleaseAcceptance(options,{secrets:[process.env.SUPABASE_SERVICE_ROLE_KEY,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],createAdmin(){
  if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Existing isolated staging credential required')
  return createClient(options.backendUrl,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(20000)])})}})
 }})
 if(outcome.artifactDirectory&&process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact_dir='+outcome.artifactDirectory+'\n')
 console.log(JSON.stringify({check:'owned release acceptance recovery',result:outcome.result,groups:outcome.groups.length}))
 if(outcome.result==='FAIL')process.exitCode=1
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error(JSON.stringify({check:'owned release acceptance recovery',result:'FAIL',reason:'BOUNDARY_OR_RETIREMENT_UNVERIFIED'}));process.exitCode=1})
