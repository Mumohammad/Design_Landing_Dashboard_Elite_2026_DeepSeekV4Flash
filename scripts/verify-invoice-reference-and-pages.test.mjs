import test from'node:test'
import assert from'node:assert/strict'
import{expect as browserExpect}from'@playwright/test'
import{assertInvoiceReferenceTestTarget,createInvoiceResponseLoss,verifyInvoiceReferenceAndPages}from'./verify-invoice-reference-and-pages.mjs'
const stage='https://viowrovartosrkqukjxy.supabase.co',app='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app',sha='a'.repeat(40)
for(const[name,backend,url,commit]of[
 ['production backend','https://wwfnsbilmyxeawgzicmv.supabase.co',app,sha],['production alias',stage,'https://elite-dashboard-blush.vercel.app',sha],['unknown backend','https://unknown.supabase.co',app,sha],['unknown app',stage,'https://example.test',sha],['backend path',stage+'/rest/v1',app,sha],['query pin',stage,app+'?dpl=old',sha],['nonexact commit',stage,app,'master'],
])test('invoice reference guard denies '+name,()=>assert.throws(()=>assertInvoiceReferenceTestTarget(backend,url,commit),/isolated staging/))
test('invoice reference guard accepts only exact isolated immutable target',()=>assert.deepEqual(assertInvoiceReferenceTestTarget(stage,app,sha),{backend:stage,app,sha}))
for(const[name,backend,url]of[['production backend','https://wwfnsbilmyxeawgzicmv.supabase.co',app],['production alias',stage,'https://elite-dashboard-blush.vercel.app']])test('invoice reference acceptance denies '+name+' before fixtures or Auth',async()=>{let reads=0;const admin={supabaseUrl:backend,from(){reads++;throw Error('Unexpected fixture access')}};Object.defineProperty(admin,'auth',{get(){reads++;throw Error('Unexpected Auth access')}});const old=process.env.VERIFY_COMMIT_SHA;process.env.VERIFY_COMMIT_SHA=sha;try{await assert.rejects(()=>verifyInvoiceReferenceAndPages({},admin,'95200000-0000-4000-8000-000000000001',url),/isolated staging/);assert.equal(reads,0)}finally{if(old===undefined)delete process.env.VERIFY_COMMIT_SHA;else process.env.VERIFY_COMMIT_SHA=old}})

for(const host of['localhost','127.0.0.1'])test('invoice reference guard accepts the owned disposable local ports '+host,()=>assert.deepEqual(assertInvoiceReferenceTestTarget('http://'+host+':58321','http://'+host+':3107'),{kind:'loopback',backend:'http://'+host+':58321',app:'http://'+host+':3107'}))
for(const[name,backend,url]of[
 ['wrong database port','http://localhost:5432','http://localhost:3107'],['wrong application port','http://localhost:58321','http://localhost:3000'],['database query','http://localhost:58321?ref=live','http://localhost:3107'],['application pin','http://localhost:58321','http://localhost:3107?dpl=old'],['database credentials','http://user@localhost:58321','http://localhost:3107'],['database path','http://localhost:58321/rest/v1','http://localhost:3107'],['hosted database with local app',stage,'http://localhost:3107'],['local database with hosted app','http://localhost:58321',app]
])test('invoice local guard denies '+name,()=>assert.throws(()=>assertInvoiceReferenceTestTarget(backend,url,sha),/isolated staging/))
test('invoice local runtime rejects a production-connected app before fixtures or Auth',async()=>{let reads=0;const admin={supabaseUrl:'http://localhost:58321',from(){reads++;throw Error('Unexpected fixture access')}};Object.defineProperty(admin,'auth',{get(){reads++;throw Error('Unexpected Auth access')}});const page={request:{async get(url){return {status:()=>200,json:async()=>({status:'healthy'}),headers:()=>({'content-security-policy':"connect-src 'self' http://localhost:58321 https://wwfnsbilmyxeawgzicmv.supabase.co"})}}}};await assert.rejects(()=>verifyInvoiceReferenceAndPages(page,admin,'95200000-0000-4000-8000-000000000001','http://localhost:3107'),/exclusively local/);assert.equal(reads,0)})

for(const source of['https:','*','https://foreign.example.test'])test('invoice local runtime denies broad or foreign network source '+source,async()=>{let reads=0;const admin={supabaseUrl:'http://localhost:58321',from(){reads++;throw Error('Unexpected fixture access')}};const page={request:{async get(){return {status:()=>200,json:async()=>({status:'healthy'}),headers:()=>({'content-security-policy':"connect-src 'self' http://localhost:58321 "+source})}}}};await assert.rejects(()=>verifyInvoiceReferenceAndPages(page,admin,'95200000-0000-4000-8000-000000000001','http://localhost:3107'),/exclusively local/);assert.equal(reads,0)})
test('healthy exclusively local runtime still requires an owned company',async()=>{const old=process.env.VERIFY_RELEASE_RUN_ID;process.env.VERIFY_RELEASE_RUN_ID='95200000-0000-4000-8000-000000000002';let reads=0;const admin={supabaseUrl:'http://localhost:58321',from(table){reads++;assert.equal(table,'tenants');return {select(){return this},eq(){return this},async single(){return {error:{message:'Not an owned company'}}}}}};const page={request:{async get(){return {status:()=>200,json:async()=>({status:'healthy'}),headers:()=>({'content-security-policy':"connect-src 'self' http://localhost:58321 ws://localhost:58321 https://api.resend.com https://api.emailjs.com https://zatca.gov.sa https://*.ingest.sentry.io"})}}}};try{await assert.rejects(()=>verifyInvoiceReferenceAndPages(page,admin,'95200000-0000-4000-8000-000000000001','http://localhost:3107'),/Owned release company/);assert.equal(reads,1)}finally{if(old===undefined)delete process.env.VERIFY_RELEASE_RUN_ID;else process.env.VERIFY_RELEASE_RUN_ID=old}})


const requestId='95200000-0000-4000-8000-000000000003',description='Owned offline invoice description'
function invoiceLossRoute(overrides={}){
 const calls={continued:0,forwarded:0,aborted:0},request={method:()=> 'POST',headers:()=>({'next-action':'offline-action'}),postData:()=>JSON.stringify([{request_id:requestId,description}])}
 const route={request:()=>request,async continue(){calls.continued++},async fetch(options){calls.forwarded++;assert.equal(options.timeout,60000);return{ok:()=>true}},async abort(reason){calls.aborted++;assert.equal(reason,'failed')},...overrides}
 return{route,request,calls}
}
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve))

test('invoice response loss waits for delayed commit and abort before the unchanged alert check',async()=>{
 const fields=Promise.withResolvers(),forward=Promise.withResolvers(),abort=Promise.withResolvers(),state={alert:false,invoices:0,audits:0};let pendingChecks=0,finished=false
 const fixture=invoiceLossRoute({async fetch(options){fixture.calls.forwarded++;assert.equal(options.timeout,60000);await forward.promise;state.invoices++;state.audits++;return{ok:()=>true}},async abort(reason){fixture.calls.aborted++;assert.equal(reason,'failed');await abort.promise;state.alert=true}})
 const loss=createInvoiceResponseLoss(description,async()=>{pendingChecks++;await fields.promise}),handling=loss.handler(fixture.route)
 assert.equal(loss.lost,true);assert.equal(loss.ready,false);assert.equal(fixture.calls.forwarded,0)
 fields.resolve();await nextTurn();assert.equal(loss.ready,true)
 const waiting=loss.wait().then(()=>{finished=true})
 // The previous ordering starts this check while the commit is still pending.
 await assert.rejects(()=>browserExpect.poll(()=>state.alert,{timeout:20,intervals:[1]}).toBe(true))
 assert.equal(finished,false);assert.equal(state.invoices,0);assert.equal(state.audits,0)
 forward.resolve();await nextTurn();assert.equal(state.invoices,1);assert.equal(state.audits,1);assert.equal(finished,false);assert.equal(state.alert,false)
 abort.resolve();await handling;await waiting;await browserExpect.poll(()=>state.alert,{timeout:20,intervals:[1]}).toBe(true)
 await loss.handler(fixture.route)
 assert.equal(pendingChecks,1);assert.equal(fixture.calls.forwarded,1);assert.equal(fixture.calls.aborted,1);assert.equal(fixture.calls.continued,1)
 assert.deepEqual(loss.ids,[requestId,requestId]);assert.equal(state.invoices,1);assert.equal(state.audits,1)
})

for(const[name,patch]of[
 ['GET',{method:()=> 'GET'}],['POST without action header',{headers:()=>({})}],['unrelated action',{postData:()=>JSON.stringify({request_id:requestId,description:'Other owned action'})}],
])test('invoice response loss ignores '+name,async()=>{
 const fixture=invoiceLossRoute();Object.assign(fixture.request,patch);let checks=0
 const loss=createInvoiceResponseLoss(description,async()=>{checks++});await loss.handler(fixture.route)
 assert.equal(checks,0);assert.equal(loss.lost,false);assert.equal(loss.ready,false);assert.deepEqual(loss.ids,[]);assert.deepEqual(fixture.calls,{continued:1,forwarded:0,aborted:0})
})

for(const[name,guard,patch,message,forwarded]of[
 ['editable pending fields',async()=>{throw Error('Private pending field detail')},{},'Pending invoice fields remained editable',0],
 ['unsuccessful save',async()=>{},{fetch:async()=>({ok:()=>false})},'Owned save response was not successful',1],
 ['forwarding failure',async()=>{},{fetch:async()=>{throw Error('Private transport detail')}},'Owned invoice save forwarding failed',1],
 ['abort failure',async()=>{},{abort:async()=>{throw Error('Private abort detail')}},'Owned invoice response loss failed',1],
])test('invoice response loss surfaces '+name+' without private diagnostics',async()=>{
 const fixture=invoiceLossRoute(),baseFetch=fixture.route.fetch,baseAbort=fixture.route.abort
 if(patch.fetch)fixture.route.fetch=async options=>{fixture.calls.forwarded++;assert.equal(options.timeout,60000);return patch.fetch(options)}
 else fixture.route.fetch=baseFetch
 if(patch.abort)fixture.route.abort=async reason=>{fixture.calls.aborted++;assert.equal(reason,'failed');return patch.abort(reason)}
 else fixture.route.abort=baseAbort
 const loss=createInvoiceResponseLoss(description,guard);await loss.handler(fixture.route)
 await assert.rejects(()=>loss.wait(),error=>{assert.equal(error.message,message);assert.ok(!error.message.includes('Private'));return true})
 assert.equal(loss.ready,true);assert.equal(fixture.calls.forwarded,forwarded);assert.equal(fixture.calls.aborted,1)
})

test('invoice response loss completion wait remains bounded',async()=>{
 const loss=createInvoiceResponseLoss(description,async()=>{})
 await assert.rejects(()=>loss.wait(5),/Owned invoice response loss did not complete/)
 assert.equal(loss.lost,false);assert.equal(loss.ready,false)
})
