import test from "node:test"
import assert from "node:assert/strict"
import{assertModuleTestTarget}from"./assert-module-test-target.mjs"
const stage="https://viowrovartosrkqukjxy.supabase.co",app="https://elite-dashboard-abc123-elitesaasc-5643.vercel.app"
const page=policy=>({request:{get:async()=>({status:()=>200,headers:()=>({"content-security-policy":policy})})}})
test("loopback tests remain allowed",async()=>assert.deepEqual(await assertModuleTestTarget({},"http://127.0.0.1:54321","http://localhost:3000"),{kind:"loopback"}))
test("approved stage requires CSP binding",async()=>assert.deepEqual(await assertModuleTestTarget(page("default-src 'self'; connect-src 'self' "+stage),stage,app),{kind:"staging"}))
test("production backend is denied before request",async()=>assert.rejects(()=>assertModuleTestTarget({},"https://wwfnsbilmyxeawgzicmv.supabase.co",app),/production is forbidden/))
test("production alias is always denied",async()=>assert.rejects(()=>assertModuleTestTarget({},stage,"https://elite-dashboard-blush.vercel.app"),/production is forbidden/))
test("mixed production CSP is denied",async()=>assert.rejects(()=>assertModuleTestTarget(page("connect-src "+stage+" https://wwfnsbilmyxeawgzicmv.supabase.co"),stage,app),/Staging CSP/))
test("wildcard backend CSP is denied",async()=>assert.rejects(()=>assertModuleTestTarget(page("connect-src "+stage+" https://*.supabase.co"),stage,app),/Staging CSP/))
test("missing staging CSP is denied",async()=>assert.rejects(()=>assertModuleTestTarget(page("connect-src 'self'"),stage,app),/Staging CSP/))
test("redirects to another deployment are denied",async()=>assert.rejects(()=>assertModuleTestTarget({request:{get:async()=>({status:()=>307})}},stage,app),/unredirected/))
test("unrecognized app domains are denied",async()=>assert.rejects(()=>assertModuleTestTarget({},stage,"https://example.test"),/production is forbidden/))

test("probes the canonical public landing route even for authenticated test sessions",async()=>{
 let target
 const result=await assertModuleTestTarget({request:{get:async(url,options)=>{target=url;assert.equal(options.maxRedirects,0);return{status:()=>200,headers:()=>({"content-security-policy":"connect-src "+stage})}}}},stage,app)
 assert.equal(target,app+"/landing");assert.equal(result.kind,"staging")
})
for(const suffix of [":5555","/unapproved-path","?backend=other","#other"])test("rejects non-canonical staging backend "+suffix,async()=>assert.rejects(()=>assertModuleTestTarget({},stage+suffix,app),/production is forbidden/))
