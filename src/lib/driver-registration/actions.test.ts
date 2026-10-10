import { beforeEach, describe, expect, it, vi } from "vitest"

const { mocks, application } = vi.hoisted(() => ({
  mocks: {
    rpc: vi.fn(),
    remove: vi.fn(),
    notify: vi.fn(async () => undefined),
  },
  application: {
    locale: "en",
    personal: {
      firstName: "Test",
      middleName: "",
      lastName: "Applicant",
      dateOfBirth: "1990-01-01",
      nationality: "SA",
      gender: "male",
    },
    contact: {
      mobile: "0500000000",
      alternativeMobile: "",
      email: "applicant@example.test",
      city: "Riyadh",
      district: "Test",
      address: "Test address",
    },
    identity: {
      identityType: "national_id",
      identityNumber: "1000000000",
      identityExpiry: "2030-01-01",
    },
    license: {
      licenseNumber: "LIC-1",
      licenseType: "private",
      licenseCountry: "SA",
      licenseExpiry: "2030-01-01",
    },
    work: { workType: "full_time", driverCategory: "sponsored_type_1" },
    platforms: { platforms: ["hungerstation"] },
    vehicle: {
      hasVehicle: false,
      ownership: "",
      vehicleType: "",
      make: "",
      model: "",
      year: "",
      plate: "",
      regExpiry: "",
      insuranceExpiry: "",
    },
    documents: {
      identityAttachment: "drafts/11111111-1111-4111-8111-111111111111/21111111-1111-4111-8111-111111111111.pdf",
      licenseAttachment: "drafts/31111111-1111-4111-8111-111111111111/41111111-1111-4111-8111-111111111111.pdf",
      regAttachment: "",
      insuranceAttachment: "",
    },
    consent: { consentTerms: true, consentPrivacy: true },
    profilePhotoPath: "drafts/51111111-1111-4111-8111-111111111111/61111111-1111-4111-8111-111111111111.jpg",
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: () => ({ remove: mocks.remove }),
    },
  }),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  rateLimit: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/driver-registration/schema", () => ({
  fullApplicationSchema: {
    safeParse: () => ({ success: true, data: application }),
  },
}))

vi.mock("@/lib/notifications/applicant-email", () => ({
  notifyApplicantByEmail: mocks.notify,
}))

import { submitDriverApplication } from "./actions"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.remove.mockResolvedValue({ error: null })
})

describe("submitDriverApplication atomic compensation", () => {
  it("deletes every uploaded Storage object and reports failure when the atomic RPC fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "fault-injected document insert failure" },
    })

    const result = await submitDriverApplication("tenant-a", application as never)

    expect(result).toMatchObject({ ok: false, error: "insert" })
    expect(mocks.rpc).toHaveBeenCalledWith(
      "provision_driver_application_atomic",
      expect.objectContaining({ p_tenant_slug: "tenant-a" })
    )
    expect(mocks.remove).toHaveBeenCalledWith([
      application.profilePhotoPath,
      application.documents.identityAttachment,
      application.documents.licenseAttachment,
    ])
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it("rejects an unknown tenant and still removes uploaded objects", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "APP_TENANT_NOT_FOUND: unknown or inactive tenant" },
    })

    const result = await submitDriverApplication("missing-tenant", application as never)

    expect(result).toMatchObject({ ok: false, error: "noTenant" })
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })
})
