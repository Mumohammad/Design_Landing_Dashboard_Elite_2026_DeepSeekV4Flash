import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  tenantId: "14500000-0000-4000-8000-000000000101" as string | null,
  tenantError: null as object | null,
  permitted: true,
  permissionError: null as object | null,
  role: "general_manager",
  rpc: vi.fn(),
}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "14500000-0000-4000-8000-000000000001" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({
    data: { id: "profile", auth_user_id: "14500000-0000-4000-8000-000000000001", tenant_id: "14500000-0000-4000-8000-000000000101", role: m.role, status: "active", locked_until: null },
    error: null,
  }) }) }) }) }),
  rpc: m.rpc,
}) }))

import { can, getCurrentUser, getCurrentUserForMfa, requirePermission } from "./authorization"

beforeEach(() => {
  m.tenantId = "14500000-0000-4000-8000-000000000101"
  m.tenantError = null
  m.permitted = true
  m.permissionError = null
  m.role = "general_manager"
  m.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "get_my_tenant_id") return { data: m.tenantId, error: m.tenantError }
    if (name === "user_has_permission") return { data: m.permitted, error: m.permissionError }
    // Assurance can be valid while the tenant is disabled. It is insufficient.
    if (name === "has_required_assurance") return { data: true, error: null }
    throw new Error("Unexpected authorization RPC")
  })
})

describe("active tenant business authorization", () => {
  it("requires the database tenant UUID to match the authenticated profile", async () => {
    expect(await getCurrentUser()).toMatchObject({ tenantId: m.tenantId })
    expect(m.rpc).toHaveBeenCalledWith("get_my_tenant_id")
    expect(m.rpc).not.toHaveBeenCalledWith("has_required_assurance")
    m.tenantId = "14500000-0000-4000-8000-000000000102"
    expect(await getCurrentUser()).toBeNull()
  })

  it.each(["suspended", "terminated", "deleted"])("rejects a %s tenant despite an active GM profile and valid assurance", async () => {
    m.tenantId = null
    m.permitted = false
    expect(await getCurrentUser()).toBeNull()
    expect(await can("drivers", "update")).toMatchObject({ allowed: false })
    await expect(requirePermission("drivers", "update")).rejects.toMatchObject({ code: "AUTH007", statusCode: 403 })
    expect(m.rpc).toHaveBeenCalledWith("user_has_permission", { p_module: "drivers", p_action: "update" })
  })

  it("keeps the MFA enrollment/challenge profile available before business access", async () => {
    m.tenantId = null
    m.permitted = false
    expect(await getCurrentUserForMfa()).toMatchObject({ id: "profile", role: "general_manager" })
    expect(m.rpc).not.toHaveBeenCalled()
    expect(await getCurrentUser()).toBeNull()
    expect(await can("drivers", "read")).toMatchObject({ allowed: false })
  })

  it("fails closed when the caller tenant lookup errors", async () => {
    m.tenantError = { message: "Synthetic unavailable boundary" }
    expect(await getCurrentUser()).toBeNull()
    expect(await getCurrentUserForMfa()).not.toBeNull()
  })

  it("never uses the general-manager display role to bypass a denied permission", async () => {
    m.permitted = false
    expect(await can("roles", "manage")).toMatchObject({ allowed: false })
    await expect(requirePermission("roles", "manage")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("allows a registered non-GM only through the database permission decision", async () => {
    m.role = "supervisor"
    expect(await getCurrentUser()).toMatchObject({ role: "supervisor" })
    expect(await can("drivers", "update")).toMatchObject({ allowed: true })
    m.permissionError = { message: "Synthetic lookup failure" }
    expect(await can("drivers", "update")).toMatchObject({ allowed: false })
  })
})
