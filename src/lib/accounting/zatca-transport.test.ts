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

describe("incomplete authority submission fails closed", () => {
  it.each([
    ["sandbox", "developer-portal"],
    ["simulation", "simulation"],
  ])("blocks %s before accessing credentials or the network", async (mode, path) => {
    vi.stubEnv("ZATCA_MODE", mode)
    vi.stubEnv("ZATCA_API_BASE_URL", `https://gw-fatoora.zatca.gov.sa/e-invoicing/${path}`)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const credentials = { get csidBase64(): string { throw new Error("Credential should not be accessed") }, secret: "SYNTHETIC-SECRET" }
    await expect(transmitToZatca({ ...input, credentials })).rejects.toThrow("certificate-bound XAdES signing and official API validation are incomplete")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isSandboxTransport()).toBe(false)
  })

  it("rejects a gateway in mock mode rather than returning simulated success", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    await expect(transmitToZatca(input)).rejects.toThrow("requires explicit ZATCA_MODE")
    expect(isSandboxTransport()).toBe(false)
  })

  it("a flag cannot override the independent production gate", async () => {
    vi.stubEnv("ZATCA_MODE", "production")
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    await expect(transmitToZatca(input)).rejects.toThrow("production remains blocked")
    expect(isSandboxTransport()).toBe(false)
  })

  it("missing sandbox configuration is an error, not an offline mock", async () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    await expect(transmitToZatca(input)).rejects.toThrow("requires an official gateway URL")
    expect(isSandboxTransport()).toBe(false)
  })
})
