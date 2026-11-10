import { beforeEach, describe, expect, it, vi } from "vitest"

const { maybeSingle, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle,
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  return { maybeSingle, from: vi.fn(() => query) }
})

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from }),
}))

vi.mock("@/app/driver-registration/registration-app", () => ({
  RegistrationApp: () => null,
}))

import TenantDriverApplicationPage from "./[tenantSlug]/page"
import LegacyDriverRegistrationPage from "../driver-registration/page"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("tenant-bound public intake route", () => {
  it("rejects the legacy route with no tenant slug", () => {
    expect(() => LegacyDriverRegistrationPage()).toThrow("NEXT_NOT_FOUND")
  })

  it("rejects a malformed slug before querying Supabase", async () => {
    await expect(
      TenantDriverApplicationPage({ params: Promise.resolve({ tenantSlug: "../tenant" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(from).not.toHaveBeenCalled()
  })

  it("rejects an unknown or inactive tenant slug", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(
      TenantDriverApplicationPage({ params: Promise.resolve({ tenantSlug: "missing-tenant" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders intake only for an active tenant slug", async () => {
    maybeSingle.mockResolvedValue({ data: { slug: "tenant-a" }, error: null })

    const result = await TenantDriverApplicationPage({
      params: Promise.resolve({ tenantSlug: "tenant-a" }),
    })

    expect(from).toHaveBeenCalledWith("tenants")
    expect(result.props.tenantSlug).toBe("tenant-a")
  })
})
