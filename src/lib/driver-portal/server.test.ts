import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, errorTable: "", throwTable: "" }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const filters: Array<(row: Record<string, unknown>) => boolean> = []
  const result = () => {
    if (table === mocks.throwTable) throw new Error("private connection detail")
    return { data: (mocks.rows[table] ?? []).filter(row => filters.every(filter => filter(row))), error: table === mocks.errorTable ? { message: "private SQL detail" } : null }
  }
  const chain = {
    select: () => chain, order: () => chain, limit: () => chain, update: () => chain,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain },
    is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return chain },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain },
    maybeSingle: async () => { const r = result(); return { ...r, data: r.data[0] ?? null } },
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
  }
  return chain
} }) }))
import { loadPortalView, PortalReadUnavailableError, resolvePortalLink } from "./server"
import { hashPortalToken } from "./token"
const token = "a".repeat(64), tenant = "tenant", driver = "driver"
beforeEach(() => {
  mocks.errorTable = ""; mocks.throwTable = ""
  mocks.rows = {
    driver_portal_links: [{ id: "link", tenant_id: tenant, driver_id: driver, token_hash: hashPortalToken(token), expires_at: "2099-01-01T00:00:00Z", revoked_at: null }],
    tenants: [{ id: tenant, status: "active", deleted_at: null, name_en: "Synthetic", name_ar: "Synthetic" }],
    drivers: [{ id: driver, tenant_id: tenant, status: "active", deleted_at: null, full_name_ar: "Synthetic", photo_url: null }],
  }
})
describe("portal current scope", () => {
  it("resolves only an active current tenant and driver", async () => { expect(await resolvePortalLink(token)).toMatchObject({ tenant_id: tenant, driver_id: driver }) })
  it.each(["suspended", "deleted"])("denies a %s tenant", async fault => {
    if (fault === "suspended") mocks.rows.tenants[0].status = "suspended"
    else mocks.rows.tenants[0].deleted_at = "2026-01-01"
    expect(await resolvePortalLink(token)).toBeNull()
  })
  it.each(["suspended", "terminated", "blacklisted", "draft", "deleted", "moved"])("denies a %s driver", async fault => {
    if (fault === "deleted") mocks.rows.drivers[0].deleted_at = "2026-01-01"
    else if (fault === "moved") mocks.rows.drivers[0].tenant_id = "other"
    else mocks.rows.drivers[0].status = fault
    expect(await resolvePortalLink(token)).toBeNull()
  })
  it("allows a driver on leave", async () => { mocks.rows.drivers[0].status = "on_leave"; expect(await resolvePortalLink(token)).not.toBeNull() })
  it.each(["revoked", "expired", "invalid date"])("denies a link with %s", async fault => {
    if (fault === "revoked") mocks.rows.driver_portal_links[0].revoked_at = "2026-01-01"
    else mocks.rows.driver_portal_links[0].expires_at = fault === "expired" ? "2000-01-01" : "invalid"
    expect(await resolvePortalLink(token)).toBeNull()
  })
  it.each(["driver_portal_links", "tenants", "drivers"])("sanitizes %s read failure", async table => {
    mocks.errorTable = table
    await expect(resolvePortalLink(token)).rejects.toBeInstanceOf(PortalReadUnavailableError)
    await expect(resolvePortalLink(token)).rejects.not.toThrow("private")
  })
  it("sanitizes thrown connection errors", async () => {
    mocks.throwTable = "driver_portal_links"
    await expect(resolvePortalLink(token)).rejects.toThrow("temporarily unavailable")
  })
  it("does not present a failed document query as an empty document list", async () => {
    mocks.errorTable = "driver_documents"
    await expect(loadPortalView(token)).rejects.toBeInstanceOf(PortalReadUnavailableError)
  })
})
