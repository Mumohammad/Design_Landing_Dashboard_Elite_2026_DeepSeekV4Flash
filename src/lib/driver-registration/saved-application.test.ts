import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import {
  SAVED_APPLICATION_MAX_COOKIE_CHARS,
  SAVED_APPLICATION_TTL_SECONDS,
  openSavedApplication,
  resumeStep,
  sanitizeSavedData,
  sealSavedApplication,
} from "./saved-application"

const draft = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"
const file = (d: string, n: number) => `drafts/${d}/${String(n).padStart(8, "0")}-1111-4111-8111-111111111111.pdf`

const personal = { firstName: "Ahmed", middleName: "", lastName: "Saleh", dateOfBirth: "1995-02-01", nationality: "Saudi", gender: "male" }
const contact = { mobile: "0551234567", alternativeMobile: "", email: "", city: "Riyadh", district: "Olaya", address: "King Fahd Road 12" }

function baseData() {
  return {
    personal,
    contact,
    identity: { identityType: "national_id", identityNumber: "1012345678", identityExpiry: "2030-01-01", identityAttachment: file(draft, 1) },
    license: null,
    work: null,
    platforms: null,
    vehicle: null,
    documents: null,
    profilePhotoPath: file(draft, 9).replace(".pdf", ".jpg"),
  }
}

beforeEach(() => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-key"))

describe("saved application sealing", () => {
  it("round-trips progress for the same tenant and upload draft", () => {
    const data = sanitizeSavedData(baseData(), draft)
    expect(data.personal?.firstName).toBe("Ahmed")
    const now = Date.now()
    const sealed = sealSavedApplication({ tenantSlug: "elite", step: "license", savedAt: now, data })
    expect(sealed.length).toBeLessThan(SAVED_APPLICATION_MAX_COOKIE_CHARS)
    expect(sealed).not.toContain("Ahmed")
    const opened = openSavedApplication(sealed, "elite", draft, now + 1000)
    expect(opened?.step).toBe("license")
    expect(opened?.data.identity?.identityNumber).toBe("1012345678")
  })

  it("rejects another tenant, a tampered cookie and an expired draft", () => {
    const now = Date.now()
    const sealed = sealSavedApplication({ tenantSlug: "elite", step: "contact", savedAt: now, data: sanitizeSavedData(baseData(), draft) })
    expect(openSavedApplication(sealed, "rival", draft, now)).toBeNull()
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1)
    expect(openSavedApplication(flipped, "elite", draft, now)).toBeNull()
    expect(openSavedApplication(sealed, "elite", draft, now + SAVED_APPLICATION_TTL_SECONDS * 1000 + 1)).toBeNull()
    expect(openSavedApplication("2." + sealed.slice(2), "elite", draft, now)).toBeNull()
  })

  it("drops steps whose uploads belong to another browser", () => {
    const input = baseData()
    input.identity.identityAttachment = file(other, 1)
    const data = sanitizeSavedData(input, draft)
    expect(data.identity).toBeNull()
    expect(data.contact).not.toBeNull()
    expect(sanitizeSavedData(baseData(), null).personal).toBeNull()
  })

  it("drops invalid sections and never resumes past the first gap", () => {
    const input = { ...baseData(), contact: { mobile: "123" } }
    const data = sanitizeSavedData(input, draft)
    expect(data.contact).toBeNull()
    expect(resumeStep(data, "review")).toBe("contact")
    expect(resumeStep(sanitizeSavedData(baseData(), draft), "personal")).toBe("personal")
  })
})
