// Financial Phase 18 — unit tests for the ZATCA onboarding transport
// (compliance CSID + production CSID). Sandbox-mock by default; the real
// POST paths are exercised against a mocked HTTP layer.
import { afterEach, describe, expect, it, vi } from "vitest"
import { requestComplianceCsid, requestProductionCsid } from "./zatca-onboarding"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("requestComplianceCsid (sandbox mode)", () => {
  it("returns a deterministic mock CSID + secret + requestId", async () => {
    const a = await requestComplianceCsid({ csr: "YWJj", otp: "123456" })
    const b = await requestComplianceCsid({ csr: "YWJj", otp: "123456" })
    expect(a.sandbox).toBe(true)
    expect(a.csidBase64).toBe(b.csidBase64)
    expect(a.requestId).toBe(b.requestId)
    expect(a.secret).toContain("mock-secret-")
  })

  it("produces different mocks for different CSRs", async () => {
    const a = await requestComplianceCsid({ csr: "AAAA", otp: "1" })
    const b = await requestComplianceCsid({ csr: "BBBB", otp: "1" })
    expect(a.requestId).not.toBe(b.requestId)
  })
})

describe("requestProductionCsid (sandbox mode)", () => {
  it("returns a deterministic mock PCSID + secret", async () => {
    const res = await requestProductionCsid({
      complianceRequestId: "mock-request-1234abcd",
      csidBase64: "MOCK",
      csidSecret: "mock-secret",
    })
    expect(res.sandbox).toBe(true)
    expect(res.secret).toContain("mock-secret-")
    expect(Buffer.from(res.csidBase64, "base64").toString()).toContain("MOCK-PCSID")
  })
})

describe("requestComplianceCsid (production POST path)", () => {
  it("POSTs the CSR to /compliance with OTP + Accept-Version headers and maps the response", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured.url = url
        captured.init = init
        return {
          ok: true,
          status: 200,
          json: async () => ({
            binarySecurityToken: "MOCK-CERT-BASE64",
            secret: "s3cr3t",
            requestID: "req-123",
          }),
        }
      })
    )

    const res = await requestComplianceCsid({ csr: "YWJj", otp: "654321" })
    expect(captured.url).toBe("https://zatca.example.test/compliance")
    expect(captured.init.method).toBe("POST")
    expect(JSON.parse(String(captured.init.body))).toEqual({ csr: "YWJj" })
    const h = captured.init.headers as Record<string, string>
    expect(h.OTP).toBe("654321")
    expect(h["Accept-Version"]).toBe("V2")
    expect(res.sandbox).toBe(false)
    expect(res.csidBase64).toBe("MOCK-CERT-BASE64")
    expect(res.secret).toBe("s3cr3t")
    expect(res.requestId).toBe("req-123")
  })

  it("throws with status + body on a non-OK response", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid csr" }))
    )
    await expect(requestComplianceCsid({ csr: "YWJj", otp: "1" })).rejects.toThrow(
      "ZATCA onboarding error 400: invalid csr"
    )
  })
})

describe("requestProductionCsid (production POST path)", () => {
  it("POSTs compliance_request_id to /production/csids with Basic auth from the CCSID", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured.url = url
        captured.init = init
        return {
          ok: true,
          status: 200,
          json: async () => ({ binarySecurityToken: "PCSID-BASE64", secret: "p-secret" }),
        }
      })
    )

    const res = await requestProductionCsid({
      complianceRequestId: "req-123",
      csidBase64: "CCSID-B64",
      csidSecret: "c-secret",
    })
    expect(captured.url).toBe("https://zatca.example.test/production/csids")
    expect(JSON.parse(String(captured.init.body))).toEqual({ compliance_request_id: "req-123" })
    const h = captured.init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Basic ${Buffer.from("CCSID-B64:c-secret").toString("base64")}`)
    expect(res.sandbox).toBe(false)
    expect(res.csidBase64).toBe("PCSID-BASE64")
    expect(res.secret).toBe("p-secret")
  })
})
