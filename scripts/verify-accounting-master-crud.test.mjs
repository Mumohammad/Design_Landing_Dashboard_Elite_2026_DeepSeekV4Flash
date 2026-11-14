import test from 'node:test'
import assert from 'node:assert/strict'
import {assertAccountingMasterTestTarget} from './verify-accounting-master-crud.mjs'
const database='https://viowrovartosrkqukjxy.supabase.co',app='https://elite-dashboard-masters1-elitesaasc-5643.vercel.app',sha='a'.repeat(40)
const approved="default-src 'self'; connect-src 'self' https://viowrovartosrkqukjxy.supabase.co"
function server({version=sha,status='healthy',healthStatus=200,landingStatus=200,policy=approved}={}){
 const calls=[]
 return {calls,fetcher:async(url,options)=>{calls.push({url,redirect:options.redirect,hasSignal:!!options.signal});if(url.endsWith('/api/health'))return Response.json({version,status},{status:healthStatus});return new Response('',{status:landingStatus,headers:{'content-security-policy':policy}})}}
}
test('master acceptance guard allows exact healthy isolated immutable preview',async()=>{const f=server();await assertAccountingMasterTestTarget(database,app,sha,f.fetcher);assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.url.startsWith(app+'/')&&call.redirect==='manual'&&call.hasSignal))})
for(const[name,db,url,commit]of [
 ['production database','https://wwfnsbilmyxeawgzicmv.supabase.co',app,sha],
 ['production alias',database,'https://elite-dashboard-blush.vercel.app',sha],
 ['unapproved deployment',database,'https://example.test',sha],
 ['shared staging alias',database,'https://elite-dashboard-modules-stage-elitesaasc-5643.vercel.app',sha],
 ['missing exact commit',database,app,undefined],
 ['path target',database,app+'/invoices',sha],
 ['non-https',database,app.replace('https:','http:'),sha],
])test('master guard blocks '+name+' before fixture work',async()=>{let calls=0,fixturesReached=false;await assert.rejects(async()=>{await assertAccountingMasterTestTarget(db,url,commit,async()=>{calls++;throw Error('Unexpected network')});fixturesReached=true});assert.equal(calls,0);assert.equal(fixturesReached,false)})
for(const[name,options]of [
 ['wrong source version',{version:'b'.repeat(40)}],['unhealthy dependencies',{status:'unhealthy',healthStatus:503}],['redirected landing',{landingStatus:302}],
 ['missing backend policy',{policy:"connect-src 'self'"}],['wildcard backend',{policy:approved+' *'}],['all Supabase projects',{policy:approved+' https://*.supabase.co'}],
 ['production connection',{policy:approved+' https://wwfnsbilmyxeawgzicmv.supabase.co'}],
])test('master guard rejects '+name+' before fixture work',async()=>{const f=server(options);let fixturesReached=false;await assert.rejects(async()=>{await assertAccountingMasterTestTarget(database,app,sha,f.fetcher);fixturesReached=true});assert.equal(fixturesReached,false)})

test('default master preflight uses scoped Preview identity rather than unauthenticated fetch',async t=>{
 const target='https://elite-dashboard-mastersdefault1-elitesaasc-5643.vercel.app'
 const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
 const token=encoded({alg:'none'})+'.'+encoded({iss:'https://oidc.vercel.com/elitesaasc-5643',exp:Math.floor(Date.now()/1000)+3600})+'.fabricatedSignature'
 const keys=['GITHUB_ACTIONS','BASE_URL','VERIFY_APP_URL','VERCEL_OIDC_TOKEN'],previous=keys.map(key=>[key,process.env[key]])
 Object.assign(process.env,{GITHUB_ACTIONS:'false',BASE_URL:target,VERIFY_APP_URL:target,VERCEL_OIDC_TOKEN:token})
 const calls=[]
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const headers=new Headers(options.headers);calls.push({url,redirect:options.redirect,identity:headers.get('x-vercel-trusted-oidc-idp-token')})
  if(headers.get('x-vercel-trusted-oidc-idp-token')!==token)return new Response('<html>Protected Preview</html>',{status:401})
  return url.endsWith('/api/health')?Response.json({version:sha,status:'healthy'}):new Response('',{headers:{'content-security-policy':approved}})
 })
 try{
  await assertAccountingMasterTestTarget(database,target,sha)
  assert.equal(calls.length,2)
  assert.ok(calls.every(call=>call.url.startsWith(target+'/')&&call.redirect==='manual'&&call.identity===token))
 }finally{for(const[key,value]of previous)if(value===undefined)delete process.env[key];else process.env[key]=value}
})

for(const[name,options]of [['missing identity',{token:undefined}],['conflicting target',{token:'fabricated',base:'https://elite-dashboard-conflict1-elitesaasc-5643.vercel.app'}]])test('default master preflight rejects '+name+' before requests or fixtures',async t=>{
 const target='https://elite-dashboard-mastersdenied1-elitesaasc-5643.vercel.app',keys=['GITHUB_ACTIONS','BASE_URL','VERIFY_APP_URL','VERCEL_OIDC_TOKEN'],previous=keys.map(key=>[key,process.env[key]])
 Object.assign(process.env,{GITHUB_ACTIONS:'false',BASE_URL:options.base??target,VERIFY_APP_URL:target})
 if(options.token===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=options.token
 let requests=0,fixturesReached=false;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('Unexpected request')})
 try{await assert.rejects(async()=>{await assertAccountingMasterTestTarget(database,target,sha);fixturesReached=true});assert.equal(requests,0);assert.equal(fixturesReached,false)}
 finally{for(const[key,value]of previous)if(value===undefined)delete process.env[key];else process.env[key]=value}
})

for(const[status,body,message]of [[302,'<html>Protection redirect</html>','Healthy exact-commit staging isolation required'],[401,'<html>Protection</html>','Healthy exact-commit staging isolation required'],[200,'<html>Unexpected HTML</html>','Valid staging health JSON required']])test('master preflight safely rejects non-JSON/protection health '+status,async()=>{
 let requests=0,fixturesReached=false
 await assert.rejects(async()=>{await assertAccountingMasterTestTarget(database,app,sha,async()=>{requests++;return new Response(body,{status})});fixturesReached=true},error=>error.message===message)
 assert.equal(requests,1);assert.equal(fixturesReached,false)
})
