import test from 'node:test'
import assert from 'node:assert/strict'
import {createVerificationAccess, verificationOrigin, VerificationAccessError, redactVerificationText, GITHUB_OIDC_AUDIENCE} from './lib/verification-access.mjs'

const app='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app'
const foreign='https://viowrovartosrkqukjxy.supabase.co'
const time=2_000_000_000_000
// Fabricated JWT-shaped transport fixtures. No signature/key or real identity.
const jwt=payload=>[Buffer.from('{"alg":"TEST-ONLY"}').toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'testsignature'].join('.')
const localToken=(extra={})=>jwt({iss:'https://oidc.vercel.com/elitesaasc-5643',exp:time/1000+300,...extra})
const githubToken=(extra={})=>jwt({iss:'https://token.actions.githubusercontent.com',aud:GITHUB_OIDC_AUDIENCE,exp:time/1000+300,...extra})
const access=(options={})=>createVerificationAccess(app,{env:{VERCEL_OIDC_TOKEN:localToken()},now:()=>time,...options})
const githubEnv={GITHUB_ACTIONS:'true',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/token?api-version=2.0',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fabricated-request-credential'}

test('accepts only immutable approved Preview and explicit loopback origins',()=>{
 assert.equal(verificationOrigin(app),app)
 for(const url of ['http://localhost:3118','http://127.0.0.1:3108','http://[::1]:3118'])assert.equal(verificationOrigin(url),url)
})
for(const url of ['https://elite-dashboard-blush.vercel.app','https://elite-dashboard-git-master-elitesaasc-5643.vercel.app','https://elite-dashboard-modules-stage-elitesaasc-5643.vercel.app','http://elite-dashboard-fixture-elitesaasc-5643.vercel.app',app+':8443',app+'/drivers',app+'?x=1',app+'#x','https://user:pass@elite-dashboard-fixture-elitesaasc-5643.vercel.app','https://evil.test'])test('rejects unapproved target '+url,()=>assert.throws(()=>verificationOrigin(url),VerificationAccessError))

test('loopback requires no token and removes an inherited protection header',async()=>{
 const a=createVerificationAccess('http://localhost:3118',{env:{}})
 assert.deepEqual(await a.headersFor('/landing',{'X-Vercel-Trusted-Oidc-Idp-Token':'remove-me'}),{})
})
test('attaches only to exact approved origin and strips inherited header from foreign requests',async()=>{
 const a=access()
 assert.equal((await a.headersFor(app+'/landing'))['x-vercel-trusted-oidc-idp-token'],localToken())
 for(const url of [foreign+'/rest/v1/users','https://evil.test',app.replace('fixture','other')+'/'])assert.deepEqual(await a.headersFor(url,{'X-Vercel-Trusted-Oidc-Idp-Token':localToken(),'Accept':'application/json'}),{accept:'application/json'})
})
for(const token of [undefined,'bad-token',localToken({exp:time/1000}),localToken({exp:time/1000+29}),localToken({nbf:time/1000+120}),localToken({iss:'https://evil.test'})])test('missing, expired, future or foreign issuer fails before app network',async()=>{
 let calls=0;const a=access({env:{VERCEL_OIDC_TOKEN:token},fetchImpl:async()=>{calls++;throw Error('unexpected network')}})
 await assert.rejects(()=>a.fetch(app),VerificationAccessError);assert.equal(calls,0)
})
test('fetch and Request forwarding preserve body/method but force manual redirects',async()=>{
 const calls=[];const a=access({fetchImpl:async(...args)=>{calls.push(args);return new Response('',{status:302,headers:{location:'https://evil.test'}})}})
 const request=new Request(app+'/action',{method:'POST',body:'fixture',headers:{'content-type':'text/plain'}})
 const response=await a.fetch(request,{redirect:'follow'})
 assert.equal(response.status,302);assert.equal(calls.length,1)
 assert.equal(calls[0][0],request);assert.equal(calls[0][1].redirect,'manual')
 assert.equal(calls[0][1].headers['content-type'],'text/plain')
 assert.equal(calls[0][1].headers['x-vercel-trusted-oidc-idp-token'],localToken())
})
test('API requests never follow redirects and retain app authorization',async()=>{
 let call;const a=access();const context={fetch:async(...args)=>{call=args;return {status:()=>302}}}
 await a.request(context,'/api/platform/admin/users',{method:'POST',data:{fixture:true},maxRedirects:20,headers:{Authorization:'Bearer fabricated-app-credential'}})
 assert.equal(call[0],app+'/api/platform/admin/users');assert.equal(call[1].maxRedirects,0)
 assert.deepEqual(call[1].data,{fixture:true});assert.equal(call[1].headers.authorization,'Bearer fabricated-app-credential')
})
test('browser forwarding uses one fetch/fulfill hop instead of redirect-leaking continue',async()=>{
 const a=access();let fetchOptions,fulfilled,continued=0
 const response={status:()=>302};const route={request:()=>({url:()=>app+'/action',headers:()=>({})}),fetch:async options=>{fetchOptions=options;return response},fulfill:async options=>{fulfilled=options},continue:async()=>{continued++}}
 await a.routeContinue(route,{maxRedirects:8})
 assert.equal(fetchOptions.maxRedirects,0);assert.equal(fetchOptions.headers['x-vercel-trusted-oidc-idp-token'],localToken())
 assert.equal(fulfilled.response,response);assert.equal(continued,0)
})
test('foreign browser routes strip protection credentials and preserve native behavior',async()=>{
 const a=access();let forwarded
 const route={request:()=>({url:()=>foreign+'/rest/v1/items',headers:()=>({'x-vercel-trusted-oidc-idp-token':localToken(),apikey:'fixture'})}),continue:async options=>{forwarded=options}}
 await a.routeContinue(route)
 assert.equal(forwarded.headers['x-vercel-trusted-oidc-idp-token'],undefined);assert.equal(forwarded.headers.apikey,'fixture')
})
test('context installs once and refuses a second application identity',async()=>{
 let installs=0,predicate;const ctx={route:async(fn)=>{installs++;predicate=fn}}
 const a=access();await a.install(ctx);await a.install(ctx)
 assert.equal(installs,1);assert.equal(predicate(new URL(app+'/landing')),true);assert.equal(predicate(new URL(foreign)),false)
 await assert.rejects(()=>createVerificationAccess(app.replace('fixture','another')).install(ctx),/cannot share/)
})
test('GitHub requests exact audience, caches concurrently and refreshes before expiry',async()=>{
 let now=time,issued=0;const masked=[],requests=[]
 const a=access({env:githubEnv,now:()=>now,mask:token=>masked.push(token),fetchImpl:async(url,options)=>{issued++;requests.push([url,options]);return Response.json({value:githubToken({exp:now/1000+120,jti:issued})})}})
 const headers=await Promise.all([a.headersFor('/landing'),a.headersFor('/dashboard')])
 assert.equal(issued,1);assert.deepEqual(headers[0],headers[1]);assert.equal(masked.length,1)
 const target=new URL(requests[0][0]);assert.equal(target.searchParams.get('audience'),GITHUB_OIDC_AUDIENCE)
 assert.equal(requests[0][1].redirect,'manual');assert.equal(requests[0][1].headers.Authorization,'Bearer fabricated-request-credential')
 now+=70_000;await a.headersFor('/landing');assert.equal(issued,2);assert.equal(masked.length,2)
})
for(const endpoint of ['http://pipelines.actions.githubusercontent.com/token','https://evil.test/token','https://actions.githubusercontent.com.evil.test/token','https://u:p@pipelines.actions.githubusercontent.com/token','https://pipelines.actions.githubusercontent.com:8443/token'])test('refuses credential request to untrusted OIDC endpoint '+endpoint,async()=>{
 let calls=0;const a=access({env:{...githubEnv,ACTIONS_ID_TOKEN_REQUEST_URL:endpoint},fetchImpl:async()=>{calls++}})
 await assert.rejects(()=>a.headersFor('/'),VerificationAccessError);assert.equal(calls,0)
})
for(const value of [githubToken({iss:'https://evil.test'}),githubToken({aud:'other-audience'}),githubToken({exp:time/1000-1}),null])test('GitHub response identity must match issuer, audience and validity',async()=>{
 let masks=0;const a=access({env:githubEnv,mask:()=>masks++,fetchImpl:async()=>Response.json({value})})
 await assert.rejects(()=>a.headersFor('/'),VerificationAccessError);assert.equal(masks,0)
})
test('failed OIDC acquisition can retry without poisoning the cache',async()=>{
 let calls=0;const a=access({env:githubEnv,mask:()=>{},fetchImpl:async()=>++calls===1?new Response('',{status:503}):Response.json({value:githubToken()})})
 await assert.rejects(()=>a.headersFor('/'),VerificationAccessError)
 assert.equal((await a.headersFor('/'))['x-vercel-trusted-oidc-idp-token'],githubToken());assert.equal(calls,2)
})
test('network errors do not serialize transport credentials or raw request URLs',async()=>{
 const a=access({fetchImpl:async()=>{throw Error('url?token='+localToken())}})
 await assert.rejects(()=>a.fetch('/'),error=>error instanceof VerificationAccessError&&!error.message.includes(localToken()))
 const scrubbed=redactVerificationText('header='+localToken()+' nested='+githubToken(),['fabricated-sensitive-value'])
 assert.equal(scrubbed.includes(localToken()),false);assert.equal(scrubbed.includes(githubToken()),false)
 assert.equal(redactVerificationText('x-vercel-trusted-oidc-idp-token: opaque-header-value').includes('opaque-header-value'),false)
})
