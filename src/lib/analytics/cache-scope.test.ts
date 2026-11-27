import { beforeEach, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readDashboardAuthorizationScope } from "./cache-scope"
import { __resetCacheForTests, cacheGet, cacheKey } from "@/lib/cache"
const tenantId = "11111111-1111-4111-8111-111111111111"
const userId = "22222222-2222-4222-8222-222222222222"
const profile = { tenantId, role: "accountant" }
const grant = { permission_id: "accounting-read", permissions: { module: "accounting", action: "read" } }
function client(data: unknown, error: unknown = null) {
  const calls: unknown[][] = []
  const chain = {
    select: (...args: unknown[]) => { calls.push(["select", ...args]); return chain },
    eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return chain },
    is: (...args: unknown[]) => { calls.push(["is", ...args]); return chain },
    limit: (...args: unknown[]) => { calls.push(["limit", ...args]); return chain },
    maybeSingle: async () => ({ data, error }),
  }
  return { client: { from: (table: string) => { calls.push(["from", table]); return chain } } as unknown as SupabaseClient, calls }
}
beforeEach(__resetCacheForTests)
describe("dashboard cache authorization", () => {
  it("never reuses a privileged snapshot after a grant downgrade with the same user and role", async () => {
    const allowed = client({ id: "role-id", name: "accountant", role_permissions: [grant] })
    const before = await readDashboardAuthorizationScope(allowed.client, profile)
    const key = (authorization: string | null) => cacheKey("dashboard", tenantId, userId, { filters: {}, authorization })
    await cacheGet(key(before), async () => ({ financial: 150 }))
    const after = await readDashboardAuthorizationScope(client({ id: "role-id", name: "accountant", role_permissions: [] }).client, profile)
    expect(after).not.toBe(before)
    expect(await cacheGet(key(after), async () => ({ financial: null }))).toEqual({ financial: null })
    expect(allowed.calls).toContainEqual(["eq", "tenant_id", tenantId])
    expect(allowed.calls).toContainEqual(["eq", "name", "accountant"])
    expect(allowed.calls).toContainEqual(["is", "deleted_at", null])
  })
  it("is independent of grant order, and includes the permission definition", async () => {
    const next = { permission_id: "invoice-read", permissions: { module: "invoices", action: "read" } }
    const read = (grants: unknown[]) => readDashboardAuthorizationScope(client({ id: "r", name: profile.role, role_permissions: grants }).client, profile)
    expect(await read([grant, next])).toBe(await read([next, grant]))
    expect(await read([grant])).not.toBe(await read([{ ...grant, permissions: { module: "accounting", action: "export" } }]))
  })
  it.each([null, {}, { id: "r", name: "admin", role_permissions: [] }, { id: "r", name: "accountant", role_permissions: [null] }, { id: "r", name: "accountant", role_permissions: [{ ...grant, permissions: null }] }, { id: "r", name: "accountant", role_permissions: Array(1000).fill(grant) }])("bypasses cache for unavailable or incomplete authorization %j", async data => {
    expect(await readDashboardAuthorizationScope(client(data).client, profile)).toBeNull()
  })
  it("bypasses cache on provider error", async () => {
    expect(await readDashboardAuthorizationScope(client({ id: "r", name: "accountant", role_permissions: [] }, { message: "denied" }).client, profile)).toBeNull()
  })
})
