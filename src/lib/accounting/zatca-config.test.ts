import { afterEach, describe, expect, it, vi } from "vitest"
import { getZatcaNetworkBase } from "./zatca-config"
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
  it("cannot submit or onboard into production, even with credentials or an enable flag", async () => {
    vi.stubEnv("ZATCA_MODE", "production")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/core")
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock)
    await expect(transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "TEST",
      credentials: { csidBase64: "fixture", secret: "fixture" } })).rejects.toThrow("disabled")
    vi.stubEnv("ZATCA_PRODUCTION_ENABLED", "true")
    await expect(transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "TEST" })).rejects.toThrow("validation are incomplete")
    await expect(requestComplianceCsid({ csr: "fixture", otp: "fixture" })).rejects.toThrow("validation are incomplete")
    await expect(requestProductionCsid({ complianceRequestId: "fixture", csidBase64: "fixture", csidSecret: "fixture" })).rejects.toThrow("validation are incomplete")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("does not return simulated success for missing network credentials", async () => {
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    await expect(transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "TEST" })).rejects.toThrow("NOT_SIGNED")
  })
})
