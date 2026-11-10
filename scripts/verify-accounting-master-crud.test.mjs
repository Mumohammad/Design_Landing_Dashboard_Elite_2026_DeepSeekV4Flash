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
