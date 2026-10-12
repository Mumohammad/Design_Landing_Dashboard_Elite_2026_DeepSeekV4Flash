import { beforeEach, describe, expect, it, vi } from "vitest"

const { state, rpc } = vi.hoisted(() => ({
  state: { status: "active", lockedUntil: null as string | null, assurance: false, error: null as object | null },
  rpc: vi.fn(),
}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "auth-owner" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({
    data: { id: "owner", auth_user_id: "auth-owner", tenant_id: "tenant", role: "general_manager", status: state.status, locked_until: state.lockedUntil }, error: null,
  }) }) }) }) }),
  rpc,
}) }))

import { can, getCurrentUser, getCurrentUserForMfa } from "./authorization"

beforeEach(() => {
  state.status = "active"
  state.lockedUntil = null
  state.assurance = false
  state.error = null
  rpc.mockReset().mockImplementation(async () => ({ data: state.assurance, error: state.error }))
})

describe("application authorization", () => {
  it("allows MFA enrollment identity while blocking service-role business actions at AAL1", async () => {
    expect(await getCurrentUserForMfa()).toMatchObject({ id: "owner" })
    expect(await getCurrentUser()).toBeNull()
    expect(await can("drivers", "read")).toMatchObject({ allowed: false })
  })
  it("accepts a verified assurance result and uses the database permission decision", async () => {
    state.assurance = true
    expect(await getCurrentUser()).toMatchObject({ id: "owner" })
    expect(await can("payroll", "approve")).toMatchObject({ allowed: true })
    expect(rpc).toHaveBeenCalledWith("user_has_permission", { p_module: "payroll", p_action: "approve" })
  })
  it("fails closed on assurance lookup errors", async () => {
    state.assurance = true
    state.error = { message: "unavailable" }
    expect(await getCurrentUser()).toBeNull()
    expect(await can("drivers", "read")).toMatchObject({ allowed: false })
  })
  it("rejects inactive and temporarily locked profiles even with valid assurance", async () => {
    state.assurance = true
    state.status = "inactive"
    expect(await getCurrentUserForMfa()).toBeNull()
    state.status = "active"
    state.lockedUntil = new Date(Date.now() + 60_000).toISOString()
    expect(await getCurrentUser()).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})
