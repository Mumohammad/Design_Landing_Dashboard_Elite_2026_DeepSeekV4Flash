import { inspect } from "node:util"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "./route"

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  lookup: vi.fn(),
  domainFilter: vi.fn(),
  invite: vi.fn(),
  provision: vi.fn(),
  deleteUser: vi.fn(),
  audit: vi.fn(),
}))

vi.mock("@/lib/platform/admin-guard", () => ({ verifyPlatformAdmin: mocks.guard }))

const tenantID = "11111111-1111-4111-8111-111111111111"
const ownerID = "22222222-2222-4222-8222-222222222222"
const details = { company_name: "Acme", domain: "acme.example", owner_email: "owner@acme.example" }
const privateDetail = "SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC"

function request(body: unknown = details) {
  return rawRequest(JSON.stringify(body))
}

function rawRequest(body: string) {
  return new NextRequest("https://workspace.example.test/api/platform/admin/create-company", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.guard.mockResolvedValue({
    ok: true,
    userId: "33333333-3333-4333-8333-333333333333",
    service: {
      from: mocks.from,
      rpc: mocks.provision,
      auth: { admin: { inviteUserByEmail: mocks.invite, deleteUser: mocks.deleteUser } },
    },
  })
  mocks.from.mockImplementation((table: string) => {
    if (table === "tenants") return { select: () => ({ eq: mocks.domainFilter }) }
    if (table === "audit_log") return { insert: mocks.audit }
    throw new Error("Unexpected table")
  })
  mocks.domainFilter.mockReturnValue({ maybeSingle: mocks.lookup })
  mocks.lookup.mockResolvedValue({ data: null, error: null })
  mocks.invite.mockResolvedValue({ data: { user: { id: ownerID } }, error: null })
  mocks.provision.mockResolvedValue({ data: { id: tenantID, slug: "acme" }, error: null })
  mocks.deleteUser.mockResolvedValue({ error: null })
  mocks.audit.mockResolvedValue({ error: null })
})

afterEach(() => { vi.restoreAllMocks() })

describe("platform company creation", () => {
  it("preserves the guard status and denies work before a service call", async () => {
    mocks.guard.mockResolvedValue({ ok: false, status: 403 })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it.each([
    ["invalid JSON", () => rawRequest("{ broken")],
    ["a non-string company name", () => request({ ...details, company_name: 42 })],
    ["an invalid owner email", () => request({ ...details, owner_email: "not-an-email" })],
  ] as const)("rejects %s before reading tenants or inviting an owner", async (_label, makeRequest) => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it("checks the normalized domain before inviting an owner", async () => {
    mocks.lookup.mockResolvedValue({ data: { id: tenantID }, error: null })
    const response = await POST(request({ ...details, domain: " ACME.Example " }))
    expect(response.status).toBe(409)
    expect(mocks.domainFilter).toHaveBeenCalledWith("domain", "acme.example")
    expect(mocks.invite).not.toHaveBeenCalled()
  })

  it("stops before invitation when domain availability is unknown", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: new Error(privateDetail) })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(privateDetail)
    expect(mocks.invite).not.toHaveBeenCalled()
    expect(mocks.provision).not.toHaveBeenCalled()
  })

  it("keeps invitation-provider errors out of responses and logs", async () => {
    mocks.invite.mockRejectedValue(new Error(privateDetail))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(privateDetail)
    expect(inspect(vi.mocked(console.error).mock.calls)).not.toContain(privateDetail)
    expect(mocks.provision).not.toHaveBeenCalled()
  })

  it("returns a safe response when the authorization provider throws", async () => {
    mocks.guard.mockRejectedValue(new Error(privateDetail))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(privateDetail)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("retains the invited user when the database result cannot confirm creation", async () => {
    mocks.provision.mockResolvedValue({ data: { slug: "acme" }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/verify its outcome/)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it("retains the invited identity even on a confirmed database rejection", async () => {
    mocks.provision.mockResolvedValue({ data: null, error: { code: "23505", message: privateDetail } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(privateDetail)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it("retains the owner when a transport error leaves provisioning uncertain", async () => {
    mocks.provision.mockResolvedValue({ data: null, error: { code: "PGRST000", message: privateDetail } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })


  it("returns reconciliation guidance when the provisioning call throws", async () => {
    mocks.provision.mockRejectedValue(new Error(privateDetail))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/verify its outcome/)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it("retains the owner when provisioning says the owner is already linked", async () => {
    mocks.provision.mockResolvedValue({ data: null, error: { code: "P0001", message: "COMPANY_ALREADY_PROVISIONED" } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })

  it("accepts a committed tenant whose localized company name has no ASCII slug", async () => {
    mocks.provision.mockResolvedValue({ data: { id: tenantID, slug: null }, error: null })
    const response = await POST(request({ ...details, company_name: "شركة الاختبار" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, tenant_id: tenantID, slug: null })
    expect(mocks.provision).toHaveBeenCalledWith("provision_company_atomic", {
      p_auth_user_id: ownerID,
      p_company: { name: "شركة الاختبار", domain: "acme.example", slug: "" },
    })
  })

  it("returns confirmed creation when the supplemental audit transport fails", async () => {
    mocks.audit.mockRejectedValue(new Error(privateDetail))
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, tenant_id: tenantID, slug: "acme" })
    expect(console.error).toHaveBeenCalledWith("Company creation audit requires reconciliation", { tenantId: tenantID })
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
})
