import test from "node:test"
import assert from "node:assert/strict"
import {verifyDriverLeaveLifecycle} from "./verify-driver-leave-lifecycle.mjs"
const stage="https://elite-dashboard-fixture-elitesaasc-5643.vercel.app"
for(const[name,backend,app]of[
 ["production database","https://wwfnsbilmyxeawgzicmv.supabase.co",stage],
 ["production alias","https://viowrovartosrkqukjxy.supabase.co","https://elite-dashboard-blush.vercel.app"],
 ["unapproved hosted database","https://other.supabase.co",stage],
])test("leave helper rejects "+name+" before fixture access",async()=>{
 let writes=0,requests=0
 const admin={supabaseUrl:backend,from(){writes++;throw Error("Unexpected fixture access")}}
 const page={request:{async get(){requests++;throw Error("Unexpected app request")}}}
 await assert.rejects(()=>verifyDriverLeaveLifecycle(page,admin,"14100000-0000-4000-8000-000000000001",app),/production is forbidden/)
 assert.equal(writes,0);assert.equal(requests,0)
})
test("leave helper rejects staging CSP connected to production before fixtures",async()=>{
 let writes=0
 const page={request:{async get(){return{status:()=>200,headers:()=>({"content-security-policy":"connect-src 'self' https://viowrovartosrkqukjxy.supabase.co https://wwfnsbilmyxeawgzicmv.supabase.co"})}}}}
 const admin={supabaseUrl:"https://viowrovartosrkqukjxy.supabase.co",from(){writes++;throw Error("Unexpected fixture access")}}
 await assert.rejects(()=>verifyDriverLeaveLifecycle(page,admin,"14100000-0000-4000-8000-000000000001",stage),/Staging CSP/)
 assert.equal(writes,0)
})
