import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }))
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(async () => ({ id: "profile-row-id", authUserId: "auth-user-id", tenantId: "tenant-1" })),
}))

import { engineContext } from "./data"

describe("engineContext", () => {
  it("uses the auth.users id as the actor (created_by FKs reference auth.users)", async () => {
    const ctx = await engineContext("create")
    expect(ctx.userId).toBe("auth-user-id")
    expect(ctx.tenantId).toBe("tenant-1")
  })
})
