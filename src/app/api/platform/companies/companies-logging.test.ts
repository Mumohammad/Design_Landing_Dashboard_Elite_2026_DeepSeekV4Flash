import { beforeEach, describe, expect, it, vi } from "vitest"
import { inspect } from "node:util"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  phase: "company" as "company" | "owner" | "membership" | "unexpected",
  privateDetail: "SYNTHETIC_PRIVATE_COMPANY_DIAGNOSTIC",
}))

vi.mock("@/lib/platform/admin-guard", () => ({
  verifyPlatformAdmin: async () => {
    const failure = Object.assign(new Error(state.privateDetail), { provider: { token: state.privateDetail } })
    if (state.phase === "unexpected") throw failure
    const service = {
      from: (table: string) => ({
        select: () => ({ or: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: () => table === "platform_companies"
          ? { select: () => ({ single: async () => state.phase === "company"
            ? { data: null, error: failure }
            : { data: { id: "11111111-2222-3333-4444-555555555555", slug: "logging" }, error: null } }) }
          : Promise.resolve({ error: table === "platform_users" && state.phase === "membership" ? failure : null }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
      rpc: async () => state.phase === "owner"
        ? { data: null, error: failure }
        : { data: { user_id: "22222222-3333-4444-5555-666666666666" }, error: null },
      auth: { admin: { deleteUser: async () => ({ error: null }) } },
    }
    return { ok: true, service }
  },
}))

import { POST } from "./route"

beforeEach(() => { state.phase = "company" })

describe("legacy company diagnostic privacy", () => {
  it.each(["company", "owner", "membership", "unexpected"] as const)("does not log private %s failure details", async phase => {
    state.phase = phase
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const request = new NextRequest("https://workspace.example.test/api/platform/companies", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Logging fixture", legal_name: "Logging fixture", domain: "logging.test", slug: "logging", email: "owner@logging.test", password: "Password123" }),
      })
      const response = await POST(request)
      expect(response.status).toBe(500)
      expect(JSON.stringify(await response.json())).not.toContain(state.privateDetail)
      expect(logged).toHaveBeenCalled()
      expect(inspect(logged.mock.calls, { depth: 8 })).not.toContain(state.privateDetail)
    } finally { logged.mockRestore() }
  })
})
