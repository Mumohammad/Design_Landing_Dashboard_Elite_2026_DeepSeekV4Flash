import test from "node:test"
import assert from "node:assert/strict"
import { verifyPlatformAdminUsers, assertOwnedPlatformMutation, forwardOwnedPlatformMutation, createOwnedPlatformIntentRecorder } from "./verify-platform-admin-users.mjs"

const backend = "https://viowrovartosrkqukjxy.supabase.co"
const app = "https://elite-dashboard-fixture-elitesaasc-5643.vercel.app"
const tenant = "14600000-0000-4000-8000-000000000001"
const actor = "14600000-0000-4000-8000-000000000002"
for (const [name, database, deployment] of [
  ["production database", "https://wwfnsbilmyxeawgzicmv.supabase.co", app],
  ["production alias", backend, "https://elite-dashboard-blush.vercel.app"],
  ["unapproved database", "https://unknown.supabase.co", app],
  ["unapproved deployment", backend, "https://example.test"],
]) test("platform user helper rejects " + name + " before fixture access", async () => {
  let accesses = 0, requests = 0
  const admin = { supabaseUrl: database, from() { accesses++; throw Error("Unexpected fixture access") }, rpc() { accesses++; throw Error("Unexpected fixture access") } }
  Object.defineProperty(admin, "auth", { get() { accesses++; throw Error("Unexpected Auth access") } })
  const page = { request: { async get() { requests++; throw Error("Unexpected app request") } } }
  await assert.rejects(() => verifyPlatformAdminUsers(page, admin, tenant, deployment, actor), /production is forbidden/)
  assert.equal(accesses, 0)
  assert.equal(requests, 0)
})
for (const policy of ["connect-src 'self' " + backend + " https://wwfnsbilmyxeawgzicmv.supabase.co", "connect-src 'self' https://*.supabase.co", "connect-src 'self'"]) {
  test("platform user helper rejects unsafe staging CSP before fixture access: " + policy, async () => {
    let accesses = 0
    const page = { request: { async get() { return { status: () => 200, headers: () => ({ "content-security-policy": policy }) } } } }
    const admin = { supabaseUrl: backend, from() { accesses++; throw Error("Unexpected fixture access") } }
    await assert.rejects(() => verifyPlatformAdminUsers(page, admin, tenant, app, actor), /Staging CSP/)
    assert.equal(accesses, 0)
  })
}
test("platform user helper requires exact owner IDs before fixtures on loopback", async () => {
  let accesses = 0
  const admin = { supabaseUrl: "http://127.0.0.1:54321", from() { accesses++; throw Error("Unexpected fixture access") } }
  await assert.rejects(() => verifyPlatformAdminUsers({}, admin, tenant, "http://localhost:3000", undefined), /Synthetic release owner and tenant IDs required/)
  assert.equal(accesses, 0)
})
test("platform user helper refuses an existing real identity before any grant or Auth access", async () => {
  let reads = 0, writes = 0, authAccesses = 0
  const query = { select() { return this }, eq() { return this }, is() { return this }, async single() { reads++; return { error: null, data: { id: actor, role: "general_manager", status: "active", email: "existing-owner@example.com" } } }, insert() { writes++; throw Error("Unexpected grant") } }
  const admin = { supabaseUrl: "http://127.0.0.1:54321", from() { return query } }
  Object.defineProperty(admin, "auth", { get() { authAccesses++; throw Error("Unexpected Auth access") } })
  await assert.rejects(() => verifyPlatformAdminUsers({}, admin, tenant, "http://localhost:3000", actor), /Synthetic release owner required/)
  assert.equal(reads, 1)
  assert.equal(writes, 0)
  assert.equal(authAccesses, 0)
})
for (const boundary of ["unowned tenant", "missing membership", "pre-existing admin marker"]) {
  test("platform user helper refuses " + boundary + " without granting or deleting authority", async () => {
    let writes = 0, authAccesses = 0
    const row = { id: actor, auth_user_id: actor, tenant_id: tenant, role: "general_manager", status: "active", email: "release-14600000-0000-4000-8000-000000000003@example.test" }
    const admin = {
      supabaseUrl: "http://127.0.0.1:54321",
      from(table) {
        return {
          select() { return this }, eq() { return this }, is() { return this },
          async single() {
            if (table === "users") return { error: null, data: row }
            if (table === "tenants") return { error: null, data: { id: tenant, created_by: boundary === "unowned tenant" ? "other-owner" : actor, domain: "14600000-0000-4000-8000-000000000003.test", status: "active", deleted_at: null } }
            return { error: boundary === "missing membership" ? { code: "PGRST116" } : null, data: boundary === "missing membership" ? null : { id: tenant } }
          },
          async maybeSingle() { return { error: null, data: { user_id: actor } } },
          insert() { writes++; throw Error("Unexpected admin grant") },
          delete() { writes++; throw Error("Unexpected admin removal") },
        }
      },
    }
    Object.defineProperty(admin, "auth", { get() { authAccesses++; throw Error("Unexpected Auth access") } })
    await assert.rejects(() => verifyPlatformAdminUsers({}, admin, tenant, "http://localhost:3000", actor), /Synthetic release tenant proof required|Synthetic release owner membership required|pre-existing platform admin marker/)
    assert.equal(writes, 0)
    assert.equal(authAccesses, 0)
  })
}

const mutationId=n=>'15100000-0000-4000-8000-'+String(n).padStart(12,'0')
const scopeBase={actorId:actor,actorUserId:mutationId(1),actorTenantId:tenant,actorVersion:3,tenantId:mutationId(2),ownerUserId:mutationId(3),ownerVersion:1,memberUserId:mutationId(4),email:'platform-member-'+mutationId(5)+'@example.test',fullName:'Platform member '+mutationId(5),role:'readonly_auditor',password:'Fixture-only-mock-password',requestId:mutationId(6)}
const creation={request_id:scopeBase.requestId,tenant_id:scopeBase.tenantId,email:scopeBase.email,full_name:scopeBase.fullName,role:scopeBase.role,password:scopeBase.password}
test('platform create preflight permits only the exact synthetic destination and secret-free durable intent',()=>{const intent=assertOwnedPlatformMutation('POST',creation,{...scopeBase,intent:{method:'POST'}});assert.deepEqual(intent,{kind:'platform-member-intent',actorId:actor,email:scopeBase.email,requestId:scopeBase.requestId,tenantId:scopeBase.tenantId});assert.ok(!JSON.stringify(intent).includes(scopeBase.password))})
for(const [name,change]of[['foreign tenant',{tenant_id:mutationId(99)}],['original tenant',{tenant_id:tenant}],['foreign email',{email:'existing-human@example.com'}],['elevated role',{role:'general_manager'}],['wrong full name',{full_name:'Different member'}],['wrong password',{password:'Other-mock-password'}],['new replay identity',{request_id:mutationId(98)}],['extra tenant override',{actor_id:actor}]])test('platform POST blocks '+name+' before intent or provider forwarding',async()=>{let records=0,forwards=0;await assert.rejects(()=>forwardOwnedPlatformMutation('POST',{...creation,...change},{...scopeBase,intent:{method:'POST'}},{recordIntent:async()=>{records++},forward:async()=>{forwards++}}),/platform|Platform/);assert.equal(records,0);assert.equal(forwards,0)})
test('platform POST durable intent completes before the provider request',async()=>{const order=[];await forwardOwnedPlatformMutation('POST',creation,{...scopeBase,intent:{method:'POST'}},{recordIntent:async()=>{order.push('record')},forward:async()=>{order.push('forward')}});assert.deepEqual(order,['record','forward'])})
test('failed durable intent persistence prevents provider creation',async()=>{let forwarded=false;await assert.rejects(()=>forwardOwnedPlatformMutation('POST',creation,{...scopeBase,intent:{method:'POST'}},{recordIntent:async()=>{throw Error('Synthetic evidence write unavailable')},forward:async()=>{forwarded=true}}),/evidence write/);assert.equal(forwarded,false)})
const memberEdit={user_id:scopeBase.memberUserId,expected_version:2,reason:'Synthetic role review',role:'supervisor'}
for(const [name,data]of[['foreign user',{...memberEdit,user_id:mutationId(99)}],['Auth ID instead of public profile',{...memberEdit,user_id:actor}],['role elevation',{...memberEdit,role:'admin'}],['unreviewed expected version',{...memberEdit,expected_version:3}],['unreviewed reason',{...memberEdit,reason:'Changed reason'}],['unknown operation',{...memberEdit,deleted_at:'2026-10-26'}]])test('reviewed platform mutation blocks '+name+' before forwarding',async()=>{let forwarded=false;await assert.rejects(()=>forwardOwnedPlatformMutation('PATCH',data,{...scopeBase,intent:{method:'PATCH',payload:memberEdit}},{forward:async()=>{forwarded=true}}),/platform|Platform/);assert.equal(forwarded,false)})
test('owned member role/status/archive plans remain allowed',()=>{for(const [method,payload]of[['PATCH',memberEdit],['PATCH',{user_id:scopeBase.memberUserId,expected_version:2,reason:'Status review',status:'inactive'}],['DELETE',{user_id:scopeBase.memberUserId,expected_version:3,reason:'Archive owned fixture'}]])assert.equal(assertOwnedPlatformMutation(method,payload,{...scopeBase,intent:{method,payload}}),null)})
test('intentional server-side rejection probes remain bounded to owned IDs',()=>{const cases=[{user_id:scopeBase.memberUserId,expected_version:2,role:'supervisor'},{user_id:scopeBase.memberUserId,expected_version:2,reason:'x',role:'supervisor'},{user_id:scopeBase.memberUserId,expected_version:2,reason:'Combined reset probe',role:'supervisor',reset_password:true},{user_id:scopeBase.actorUserId,expected_version:3,reason:'Synthetic protected actor denial',status:'inactive'},{user_id:scopeBase.ownerUserId,expected_version:1,reason:'Synthetic last owner protection',role:'supervisor'}];for(const payload of cases)assert.equal(assertOwnedPlatformMutation('PATCH',payload,{...scopeBase,intent:{method:'PATCH',payload}}),null)})

test('concurrent platform creation binds one request before durable intent awaits',async()=>{
 let release,records=0,bound,forwarded=0;const ready=new Promise(resolve=>{release=resolve});
 const recordIntent=createOwnedPlatformIntentRecorder({record:async()=>{records++;await ready},bind:intent=>{bound=intent.requestId}});
 const scope={...scopeBase,requestId:undefined,intent:{method:'POST'}};
 const first=forwardOwnedPlatformMutation('POST',creation,scope,{recordIntent,forward:async()=>{forwarded++}});
 assert.equal(bound,creation.request_id);
 await assert.rejects(()=>forwardOwnedPlatformMutation('POST',{...creation,request_id:'14600000-0000-4000-8000-000000000099'},scope,{recordIntent,forward:async()=>{forwarded++}}),/intent differs/);
 const replay=forwardOwnedPlatformMutation('POST',creation,scope,{recordIntent,forward:async()=>{forwarded++}});
 await Promise.resolve();assert.equal(records,1);assert.equal(forwarded,0);release();await Promise.all([first,replay]);assert.equal(forwarded,2);
})
test('failed durable platform intent blocks original and replay forwarding',async()=>{
 let records=0,forwarded=0;const recordIntent=createOwnedPlatformIntentRecorder({record:async()=>{records++;throw Error('durable write unavailable')},bind:()=>{}});
 const send=()=>forwardOwnedPlatformMutation('POST',creation,{...scopeBase,intent:{method:'POST'}},{recordIntent,forward:async()=>{forwarded++}});
 await assert.rejects(send,/durable write unavailable/);await assert.rejects(send,/durable write unavailable/);assert.equal(records,1);assert.equal(forwarded,0);
})
