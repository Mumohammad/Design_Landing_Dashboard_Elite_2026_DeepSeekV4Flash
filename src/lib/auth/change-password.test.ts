import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  user: { id: "profile", authUserId: "auth-user", tenantId: "tenant", role: "general_manager" } as object | null,
  aal: { currentLevel: "aal2", nextLevel: "aal2" } as object | null,
  assuranceError: null as object | null,
  snapshot: { data: { credential_revision: 7, password_requirement_version: 3 } as Record<string, unknown> | null, error: null as object | null },
  updateUser: vi.fn(), reauthenticate: vi.fn(), rpc: vi.fn(), rateLimit: vi.fn(), revalidate: vi.fn(), eq: vi.fn(),
}))
vi.mock("./authorization", () => ({ getCurrentUserForMfa: async () => mocks.user }))
vi.mock("./rate-limit", () => ({ rateLimit: mocks.rateLimit }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: mocks.aal, error: mocks.assuranceError }) },
  updateUser: mocks.updateUser, reauthenticate: mocks.reauthenticate,
} }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const query = { select: () => query, eq: (key: string, value: string) => { mocks.eq(key, value); return query }, is: () => query, single: async () => mocks.snapshot }
    return query
  }, rpc: mocks.rpc,
}) }))

import { changeOwnPassword, requestPasswordReauthentication } from "./change-password"

const password = "ExampleUpdated123"
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: "profile", authUserId: "auth-user", tenantId: "tenant", role: "general_manager" }
  mocks.aal = { currentLevel: "aal2", nextLevel: "aal2" }; mocks.assuranceError = null
  mocks.snapshot = { data: { credential_revision: 7, password_requirement_version: 3 }, error: null }
  mocks.updateUser.mockResolvedValue({ error: null })
  mocks.reauthenticate.mockResolvedValue({ error: null })
  mocks.rpc.mockResolvedValue({ data: { completed: true, credential_revision: 8 }, error: null })
  mocks.rateLimit.mockResolvedValue({ success: true }); mocks.revalidate.mockImplementation(() => {})
})

describe("trusted password completion", () => {
  it("confirms the user's Auth update before private completion and never sends the password to SQL", async () => {
    const order: string[] = []
    mocks.updateUser.mockImplementation(async () => { order.push("auth"); return { error: null } })
    mocks.rpc.mockImplementation(async () => { order.push("completion"); return { data: { completed: true, credential_revision: 8 }, error: null } })
    expect(await changeOwnPassword({ password })).toEqual({ success: true })
    expect(order).toEqual(["auth", "completion"])
    expect(mocks.updateUser).toHaveBeenCalledWith({ password })
    expect(mocks.rpc).toHaveBeenCalledWith("complete_user_password_change", { p_actor: "auth-user", p_expected_revision: 8, p_requirement_version: 3 })
    expect(mocks.eq.mock.calls).toEqual([["id", "profile"], ["auth_user_id", "auth-user"], ["tenant_id", "tenant"]])
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(password)
  })
  it.each([null, {}, { password: "short1" }, { password: "x".repeat(129) + "1" }, { password, nonce: false }])("rejects malformed input before Auth or SQL", async input => {
    expect((await changeOwnPassword(input)).success).toBe(false)
    expect(mocks.updateUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("requires an active unlocked application identity", async () => {
    mocks.user = null
    expect((await changeOwnPassword({ password })).error).toContain("Sign in again")
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it("preserves verified-factor step-up before credentials change", async () => {
    mocks.aal = { currentLevel: "aal1", nextLevel: "aal2" }
    expect(await changeOwnPassword({ password })).toMatchObject({ success: false, requiresMfa: true })
    expect(mocks.updateUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("allows credential bootstrap without waiving later privileged enrollment", async () => {
    mocks.aal = { currentLevel: "aal1", nextLevel: "aal1" }
    expect(await changeOwnPassword({ password })).toEqual({ success: true })
  })
  it("fails closed when assurance or shared rate limiting is unavailable", async () => {
    mocks.aal = null
    expect((await changeOwnPassword({ password })).success).toBe(false)
    mocks.aal = { currentLevel: "aal2", nextLevel: "aal2" }
    mocks.rateLimit.mockRejectedValue(Error("synthetic backend unavailable"))
    expect((await changeOwnPassword({ password })).success).toBe(false)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it("honors the rate limit and refuses invalid credential snapshots", async () => {
    mocks.rateLimit.mockResolvedValue({ success: false })
    expect((await changeOwnPassword({ password })).error).toContain("Too many attempts")
    mocks.rateLimit.mockResolvedValue({ success: true })
    for (const value of [null, -1, Number.MAX_SAFE_INTEGER, "7"]) {
      mocks.snapshot.data = { credential_revision: value, password_requirement_version: 3 }
      expect((await changeOwnPassword({ password })).success).toBe(false)
    }
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it.each(["same_password", "weak_password", "insufficient_aal", "reauthentication_needed", "reauthentication_not_valid", "unexpected_error"])("handles provider %s without clearing requirements or exposing provider text", async code => {
    mocks.updateUser.mockResolvedValue({ error: { code, message: "private provider diagnostic" } })
    const result = await changeOwnPassword({ password })
    expect(result.success).toBe(false); expect(result.errorAr).toBeTruthy()
    expect(JSON.stringify(result)).not.toContain("private provider diagnostic")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("retains uncertainty after a lost Auth response or unconfirmed completion", async () => {
    mocks.updateUser.mockRejectedValue(Error("synthetic response loss"))
    expect((await changeOwnPassword({ password })).error).toContain("could not be confirmed")
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.updateUser.mockResolvedValue({ error: null })
    for (const receipt of [{ data: null, error: null }, { data: { completed: true, credential_revision: 9 }, error: null }, { data: null, error: { message: "concurrent reset" } }]) {
      mocks.rpc.mockResolvedValue(receipt)
      expect((await changeOwnPassword({ password })).error).toContain("could not be confirmed")
    }
  })
  it("passes an email nonce only to Auth and does not report a cache error as failed credentials", async () => {
    mocks.revalidate.mockImplementation(() => { throw Error("synthetic cache failure") })
    expect(await changeOwnPassword({ password, nonce: " 123456 " })).toEqual({ success: true })
    expect(mocks.updateUser).toHaveBeenCalledWith({ password, nonce: "123456" })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain("123456")
  })
  it("gates and rate limits email reauthentication without changing credentials", async () => {
    expect(await requestPasswordReauthentication()).toEqual({ success: true })
    expect(mocks.rateLimit).toHaveBeenCalledWith("password-reauth:auth-user", 3, "hour")
    expect(mocks.updateUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.rateLimit.mockResolvedValue({ success: false })
    expect((await requestPasswordReauthentication()).success).toBe(false)
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1)
  })
})
