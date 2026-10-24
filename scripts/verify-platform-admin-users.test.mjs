import test from "node:test"
import assert from "node:assert/strict"
import { verifyPlatformAdminUsers } from "./verify-platform-admin-users.mjs"

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
