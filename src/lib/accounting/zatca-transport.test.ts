import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { transmitToZatca, isSandboxTransport, _sandboxUuid } from "./zatca-transport"

beforeEach(() => {
  for (const name of ["ZATCA_API_BASE_URL", "ZATCA_CSID_CERT", "ZATCA_CSID_SECRET", "ZATCA_CSID_PRIVATE_KEY", "ZATCA_MODE", "ZATCA_PRODUCTION_ENABLED"]) vi.stubEnv(name, "")
  vi.stubEnv("ZATCA_MODE", "mock")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const input = { xml: "<Invoice/>", pipeline: "reporting" as const, docRef: "SYNTHETIC-INV-1" }

describe("offline mock", () => {
  it.each(["reporting", "clearance"] as const)("explicitly marks %s responses as unvalidated mocks", async (pipeline) => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const response = await transmitToZatca({ ...input, pipeline })
    expect(response.status).toBe(pipeline === "reporting" ? "reported" : "cleared")
    expect(response.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.raw.sandbox).toBe(true)
    expect(response.raw.validationResults).toEqual({ status: "NOT_VALIDATED", warnings: [] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isSandboxTransport()).toBe(true)
  })

  it("has stable development identifiers without implying real idempotency", async () => {
    expect((await transmitToZatca(input)).uuid).toBe((await transmitToZatca(input)).uuid)
    expect(_sandboxUuid("INV-A")).not.toBe(_sandboxUuid("INV-B"))
  })

  it("credentials alone cannot turn a mock into networking", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect((await transmitToZatca({ ...input, credentials: { csidBase64: "SYNTHETIC-CERT", secret: "SYNTHETIC-SECRET" } })).raw.sandbox).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("non-production gateway submission", () => {
  const signedXml = "<Invoice><ext:UBLExtensions><ds:SignatureValue>x</ds:SignatureValue></ext:UBLExtensions></Invoice>"
  const signed = { ...input, xml: signedXml, invoiceHash: "z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=", uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d", credentials: { csidBase64: "VE9LRU4=", secret: "SYNTHETIC-SECRET" } }
  function sandbox() {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
  }

  it("refuses unsigned XML before touching credentials or the network", async () => {
    sandbox()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const credentials = { get csidBase64(): string { throw new Error("Credential should not be accessed") }, secret: "SYNTHETIC-SECRET" }
    await expect(transmitToZatca({ ...input, credentials })).rejects.toThrow("NOT_SIGNED")
    await expect(transmitToZatca({ ...signed, uuid: "nope" })).rejects.toThrow("NOT_SIGNED")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isSandboxTransport()).toBe(false)
  })

  it("requires CSID credentials", async () => {
    sandbox()
    await expect(transmitToZatca({ ...signed, credentials: undefined })).rejects.toThrow("CREDENTIALS")
  })

  it("posts the official JSON envelope and maps REPORTED from the body", async () => {
    sandbox()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ validationResults: { status: "WARNING", warningMessages: [{ code: "BR-KSA-08", message: "warn" }], errorMessages: [] }, reportingStatus: "REPORTED" }), { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    const response = await transmitToZatca(signed)
    expect(response.status).toBe("reported")
    expect(response.raw.validationResults).toMatchObject({ status: "WARNING", warningMessages: [{ code: "BR-KSA-08" }] })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/invoices/reporting/single")
    const headers = init.headers as Record<string, string>
    expect(headers["Accept-Version"]).toBe("V2")
    expect(headers["Clearance-Status"]).toBe("0")
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("VE9LRU4=:SYNTHETIC-SECRET").toString("base64")}`)
    expect(JSON.parse(String(init.body))).toEqual({ invoiceHash: signed.invoiceHash, uuid: signed.uuid, invoice: Buffer.from(signedXml).toString("base64") })
  })

  it("uses clearance and compliance endpoints and never trusts HTTP 2xx alone", async () => {
    sandbox()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ validationResults: { status: "PASS" }, clearanceStatus: "NOT_CLEARED" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    expect((await transmitToZatca({ ...signed, pipeline: "clearance" })).status).toBe("rejected")
    expect((fetchMock.mock.calls as unknown as [string][])[0][0]).toMatch(/\/invoices\/clearance\/single$/)
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ validationResults: { status: "PASS" }, reportingStatus: "REPORTED" }), { status: 200 }))
    expect((await transmitToZatca({ ...signed, pipeline: "compliance" })).status).toBe("reported")
    expect((fetchMock.mock.calls as unknown as [string][])[1][0]).toMatch(/\/compliance\/invoices$/)
  })

  it("rejects validation errors and maps gateway faults without echoing bodies", async () => {
    sandbox()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ validationResults: { status: "ERROR", errorMessages: [{ code: "invalid-signature" }] }, reportingStatus: "NOT_REPORTED" }), { status: 400 })))
    expect((await transmitToZatca(signed)).status).toBe("rejected")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET BODY", { status: 401 })))
    await expect(transmitToZatca(signed)).rejects.toThrow("UNAUTHORIZED")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET BODY", { status: 503 })))
    await expect(transmitToZatca(signed)).rejects.not.toThrow("SECRET")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    await expect(transmitToZatca(signed)).rejects.toThrow("NETWORK")
  })
})

describe("configuration fails closed", () => {
  it("rejects a gateway in mock mode rather than returning simulated success", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    await expect(transmitToZatca(input)).rejects.toThrow("requires explicit ZATCA_MODE")
    expect(isSandboxTransport()).toBe(false)
  })

  it("production mode needs the operator flag and still refuses unsigned documents", async () => {
    vi.stubEnv("ZATCA_MODE", "production")
    await expect(transmitToZatca({ ...input, environment: "production" })).rejects.toThrow("ZATCA_PRODUCTION_ENABLED")
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    await expect(transmitToZatca({ ...input, environment: "production" })).rejects.toThrow("NOT_SIGNED")
    expect(isSandboxTransport()).toBe(false)
  })

  it("missing sandbox configuration is an error, not an offline mock", async () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    await expect(transmitToZatca(input)).rejects.toThrow("requires an official gateway URL")
    expect(isSandboxTransport()).toBe(false)
  })
})
