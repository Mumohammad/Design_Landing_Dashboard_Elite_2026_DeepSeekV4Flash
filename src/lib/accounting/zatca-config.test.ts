import { afterEach, describe, expect, it, vi } from "vitest"
import { getZatcaNetworkBase, zatcaConfiguredEnvironment, zatcaOnboardableEnvironments, zatcaProductionAvailable } from "./zatca-config"
import { transmitToZatca } from "./zatca-transport"
import { requestComplianceCsid, requestProductionCsid } from "./zatca-onboarding"

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe("ZATCA environment boundary", () => {
  it("defaults to an offline mock without a configured gateway", () => {
    expect(getZatcaNetworkBase()).toBeNull()
  })
  it("refuses legacy implicit activation from a URL alone", () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/core")
    expect(getZatcaNetworkBase).toThrow("requires explicit")
  })
  it("accepts only the official gateway for the explicitly chosen sandbox", () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/")
    expect(getZatcaNetworkBase()).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
  })
  it.each([
    "http://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
    "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
    "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
    "https://gw-fatoora.zatca.gov.sa.attacker.test/e-invoicing/developer-portal",
    "https://gw-fatoora.zatca.gov.sa:444/e-invoicing/developer-portal",
    "https://user:password@gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
    "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal?redirect=core",
  ])("rejects unsafe/mismatched network destination %s", (url) => {
    vi.stubEnv("ZATCA_MODE", "sandbox"); vi.stubEnv("ZATCA_API_BASE_URL", url)
    expect(getZatcaNetworkBase).toThrow("does not match")
  })
  it("production mode requires the explicit operator flag before any network call", async () => {
    vi.stubEnv("ZATCA_MODE", "production")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/core")
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock)
    await expect(transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "TEST", environment: "production",
      credentials: { csidBase64: "fixture", secret: "fixture" } })).rejects.toThrow("disabled")
    await expect(requestComplianceCsid({ csr: "fixture", otp: "fixture", environment: "production" })).rejects.toThrow("disabled")
    await expect(requestProductionCsid({ complianceRequestId: "fixture", csidBase64: "fixture", csidSecret: "fixture", environment: "production" })).rejects.toThrow("disabled")
    expect(zatcaProductionAvailable()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("a production-capable deployment defaults to simulation and reaches core only when asked", () => {
    vi.stubEnv("ZATCA_MODE", "production")
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    expect(zatcaProductionAvailable()).toBe(true)
    expect(zatcaConfiguredEnvironment()).toBe("simulation")
    expect(getZatcaNetworkBase()).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
    expect(getZatcaNetworkBase("production")).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/core")
    expect(zatcaOnboardableEnvironments(false)).toEqual(["simulation"])
    expect(zatcaOnboardableEnvironments(true)).toEqual(["simulation", "production"])
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
    expect(() => getZatcaNetworkBase("production")).toThrow("core")
  })
  it("a test deployment can never reach production", () => {
    vi.stubEnv("ZATCA_MODE", "simulation")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation")
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    expect(zatcaProductionAvailable()).toBe(false)
    expect(() => getZatcaNetworkBase("production")).toThrow("not enabled")
  })
  it("does not return simulated success for missing network credentials", async () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    await expect(transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "TEST" })).rejects.toThrow("NOT_SIGNED")
  })
})
