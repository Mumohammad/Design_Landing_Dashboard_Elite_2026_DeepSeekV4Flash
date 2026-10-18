import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => ({
  getUser: vi.fn(), signOut: vi.fn(), assurance: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(),
  cookies: null as null | { getAll: () => unknown[]; setAll: (cookies: Array<{name: string; value: string; options?: Record<string, unknown>}>) => void },
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    auth.cookies = options.cookies
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), single: auth.single, maybeSingle: auth.maybeSingle }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query)
    return { auth: { getUser: auth.getUser, signOut: auth.signOut, mfa: { getAuthenticatorAssuranceLevel: auth.assurance } }, from: () => query }
  }),
}))

import { proxy } from "./proxy"

beforeEach(() => {
  vi.clearAllMocks()
  auth.getUser.mockResolvedValue({ data: { user: { id: "test-user" } } })
  auth.single.mockResolvedValue({ data: { id: "profile", tenant_id: "tenant", role: "accountant", status: "active", must_change_password: false, locked_until: null } })
  auth.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null })
  auth.signOut.mockResolvedValue({ error: null })
})

describe("session continuity across landing and dashboard", () => {
  it("forwards refreshed cookies to server rendering and the browser", async () => {
    auth.getUser.mockImplementation(async () => {
      auth.cookies!.setAll([{ name: "sb-test", value: "refreshed-session", options: { path: "/", sameSite: "lax" } }])
      return { data: { user: { id: "test-user" } } }
    })
    const request = new NextRequest("https://app.example/accounting")
    const response = await proxy(request)
    expect(request.cookies.get("sb-test")?.value).toBe("refreshed-session")
    expect(response.cookies.get("sb-test")?.value).toBe("refreshed-session")
    expect(response.headers.get("x-middleware-request-cookie")).toContain("refreshed-session")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })

  it("preserves refreshed cookies and the requested module through MFA", async () => {
    auth.getUser.mockImplementation(async () => {
      auth.cookies!.setAll([{ name: "sb-test", value: "refreshed-session" }])
      return { data: { user: { id: "test-user" } } }
    })
    auth.assurance.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })
    const response = await proxy(new NextRequest("https://app.example/invoices?status=draft"))
    const destination = new URL(response.headers.get("location")!)
    expect(destination.pathname).toBe("/auth/mfa-challenge")
    expect(destination.searchParams.get("returnTo")).toBe("/invoices?status=draft")
    expect(response.cookies.get("sb-test")?.value).toBe("refreshed-session")
  })

  it("returns a signed-in visitor to the intended module without another sign-in", async () => {
    const response = await proxy(new NextRequest("https://app.example/auth/sign-in?returnTo=%2Finvoices"))
    expect(response.headers.get("location")).toBe("https://app.example/invoices")
  })

  it("renders sign-in for visitors without a session without redirecting to itself", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
    const response = await proxy(new NextRequest("https://app.example/auth/sign-in"))
    expect(response.headers.get("location")).toBeNull()
    expect(response.status).toBe(200)
  })

  it("carries the landing language when reusing an authenticated dashboard session", async () => {
    const response = await proxy(new NextRequest("https://app.example/auth/sign-in?returnTo=%2Finvoices&lang=en"))
    expect(response.headers.get("location")).toBe("https://app.example/invoices?lang=en")
  })

  it("keeps account errors visible and rejects return-to sign-in loops", async () => {
    const failed = await proxy(new NextRequest("https://app.example/auth/sign-in?error=AUTH_ACCOUNT_LOCKED"))
    expect(failed.headers.get("location")).toBeNull()
    const loop = await proxy(new NextRequest("https://app.example/auth/sign-in?returnTo=%2Fauth%2Fsign-in"))
    expect(loop.headers.get("location")).toBe("https://app.example/dashboard")
  })

  it("preserves the full module destination when authentication is required", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
    const response = await proxy(new NextRequest("https://app.example/invoices?status=draft"))
    expect(new URL(response.headers.get("location")!).searchParams.get("returnTo")).toBe("/invoices?status=draft")
  })

  it("returns cleared cookies when an inactive profile is signed out", async () => {
    auth.single.mockResolvedValue({ data: { id: "profile", status: "inactive" } })
    auth.signOut.mockImplementation(async () => {
      auth.cookies!.setAll([{ name: "sb-test", value: "", options: { maxAge: 0 } }])
      return { error: null }
    })
    const response = await proxy(new NextRequest("https://app.example/dashboard"))
    expect(response.cookies.get("sb-test")?.maxAge).toBe(0)
    expect(response.headers.get("location")).toContain("AUTH_ACCOUNT_INACTIVE")
  })
})
