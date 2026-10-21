import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { state } = vi.hoisted(() => ({
  state: {
    platformAdmin: true,
    role: "general_manager",
    forcePassword: false,
    status: "active",
    lockedUntil: null as string | null,
    signOuts: 0,
    aal: { currentLevel: "aal2", nextLevel: "aal2" } as {
      currentLevel: "aal1" | "aal2"
      nextLevel: "aal1" | "aal2"
    } | null,
    aalError: null as { message: string } | null,
  },
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "auth-user-1" } }, error: null }),
      signOut: async () => { state.signOuts++; return { error: null } },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: state.aal,
          error: state.aalError,
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "platform_admins" && state.platformAdmin
              ? { user_id: "auth-user-1" }
              : null,
            error: null,
          }),
          single: async () => ({
            data: {
              id: "public-user-1",
              tenant_id: "tenant-1",
              role: state.role,
              status: state.status,
              must_change_password: state.forcePassword,
              locked_until: state.lockedUntil,
            },
            error: null,
          }),
          is: () => ({
            single: async () => ({
              data: { id: "public-user-1", tenant_id: "tenant-1", role: state.role, status: state.status, must_change_password: state.forcePassword, locked_until: state.lockedUntil },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}))

let proxy: typeof import("./proxy").proxy
let config: typeof import("./proxy").config

beforeAll(async () => {
  const proxyModule = await import("./proxy")
  proxy = proxyModule.proxy
  config = proxyModule.config
})

beforeEach(() => {
  state.platformAdmin = true
  state.role = "general_manager"
  state.forcePassword = false; state.status = "active"; state.lockedUntil = null; state.signOuts = 0
  state.aal = { currentLevel: "aal2", nextLevel: "aal2" }
  state.aalError = null
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function request(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`)
}

describe("platform-admin MFA boundary", () => {
  it("matches platform-admin routes and redirects an AAL1 session to step-up", async () => {
    state.aal = { currentLevel: "aal1", nextLevel: "aal2" }

    expect(config.matcher).toContain("/platform/admin/:path*")
    const response = await proxy(request("/platform/admin"))

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location")!).pathname).toBe("/auth/mfa-challenge")
  })

  it("allows an allowlisted platform administrator at AAL2", async () => {
    const response = await proxy(request("/platform/admin/companies"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("fails closed without a redirect loop when assurance cannot be verified", async () => {
    state.aal = null
    state.aalError = { message: "MFA service unavailable" }

    const response = await proxy(request("/platform/admin"))
    const location = new URL(response.headers.get("location")!)

    expect(response.status).toBe(307)
    expect(location.pathname).toBe("/auth/errors/internal-server-error")
    expect(location.searchParams.get("error")).toBe("MFA_ASSURANCE_UNAVAILABLE")
    expect(location.searchParams.get("returnTo")).toBe("/platform/admin")
  })
})

describe("tenant-user MFA compatibility", () => {
  it("rejects access for a non-privileged user when assurance is unavailable", async () => {
    state.role = "supervisor"
    state.aal = null
    state.aalError = { message: "MFA service unavailable" }

    const response = await proxy(request("/dashboard"))

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("MFA_ASSURANCE_UNAVAILABLE")
  })
})

describe("required password replacement", () => {
  it("routes an unenrolled administrator to replacement before enrollment without a loop", async () => {
    state.forcePassword = true; state.aal = { currentLevel: "aal1", nextLevel: "aal1" }
    expect(config.matcher).toContain("/auth/change-password")
    for (const path of ["/dashboard", "/settings/security", "/settings/mfa"]) {
      const result = await proxy(request(path + "?lang=en"))
      const url = new URL(result.headers.get("location")!)
      expect(url.pathname).toBe("/auth/change-password"); expect(url.searchParams.get("lang")).toBe("en")
    }
    expect((await proxy(request("/auth/change-password"))).status).toBe(200)
    state.forcePassword = false
    expect(new URL((await proxy(request("/dashboard"))).headers.get("location")!).pathname).toBe("/settings/mfa")
  })
  it("requires an existing factor before password replacement and preserves the safe destination", async () => {
    state.forcePassword = true; state.aal = { currentLevel: "aal1", nextLevel: "aal2" }
    const url = new URL((await proxy(request("/auth/change-password?lang=ar"))).headers.get("location")!)
    expect(url.pathname).toBe("/auth/mfa-challenge"); expect(url.searchParams.get("returnTo")).toBe("/auth/change-password")
    expect(url.searchParams.get("lang")).toBe("ar")
    state.aal.currentLevel = "aal2"
    expect((await proxy(request("/auth/change-password"))).status).toBe(200)
  })
  it("fails closed when required-change assurance cannot be checked", async () => {
    state.forcePassword = true; state.aal = null
    const result = await proxy(request("/dashboard"))
    expect(new URL(result.headers.get("location")!).searchParams.get("error")).toBe("MFA_ASSURANCE_UNAVAILABLE")
  })
  it.each(["inactive", "pending_invite", "terminated", "locked"])("signs out %s accounts without a sign-in/dashboard loop", async status => {
    state.status = status; state.forcePassword = true
    expect(new URL((await proxy(request("/auth/change-password"))).headers.get("location")!).pathname).toBe("/auth/sign-in")
    expect(state.signOuts).toBe(1)
  })
  it("signs out an active account with a future lock even on the password route", async () => {
    state.forcePassword = true; state.lockedUntil = new Date(Date.now() + 60_000).toISOString()
    expect(new URL((await proxy(request("/auth/change-password"))).headers.get("location")!).searchParams.get("error")).toBe("AUTH_ACCOUNT_LOCKED")
    expect(state.signOuts).toBe(1)
  })
})
