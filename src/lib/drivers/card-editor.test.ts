import { describe, expect, it } from "vitest"
import { CUSTOM_PLATFORM, draftFromProfile, draftIssues, draftToCard, emptyDraft } from "./card-editor"

const driver = { id: "d1", driver_code: "DRV-7", full_name_en: " Ali Khan ", full_name_ar: "علي", primary_mobile: "0500000000", secondary_mobile: null, iqama_number: "2412345678", rider_id: "HS-1" }
const accounts = [
  { platform_code: "keeta", platform_driver_id: "K-9", status: "active", is_primary: false },
  { platform_code: "hungerstation", platform_driver_id: "HS-1", status: "active", is_primary: true },
  { platform_code: "jahez", platform_driver_id: "J-2", status: "suspended", is_primary: false },
]

describe("card editor drafts", () => {
  it("auto-fills from the profile and the primary platform account", () => {
    const d = draftFromProfile(driver, "https://x/p.jpg", accounts)
    expect(d).toMatchObject({ platform: "hungerstation", name: "Ali Khan", phone: "0500000000", idNumber: "2412345678", riderId: "HS-1", photoUrl: "https://x/p.jpg", driverId: "d1", footerRef: "DRV-7" })
  })

  it("uses the chosen platform's rider ID", () => {
    expect(draftFromProfile(driver, null, accounts, "keeta").riderId).toBe("K-9")
    expect(draftFromProfile(driver, null, accounts, "jahez").riderId).toBe("J-2")
    expect(draftFromProfile(driver, null, [], "noon").riderId).toBe("HS-1")
  })

  it("falls back to Arabic name and driver code", () => {
    const d = draftFromProfile({ ...driver, full_name_en: null, rider_id: null }, null, [])
    expect(d.name).toBe("علي")
    expect(d.riderId).toBe("DRV-7")
    expect(d.platform).toBe("hungerstation")
  })

  it("validates required fields", () => {
    expect(draftIssues(emptyDraft())).toEqual(["name", "riderId"])
    expect(draftIssues({ ...emptyDraft(), name: "A", riderId: "bad id!" })).toEqual(["riderIdFormat"])
    expect(draftIssues({ ...emptyDraft(), name: "A", riderId: "1", platform: CUSTOM_PLATFORM })).toEqual(["customName"])
  })

  it("maps drafts to card data, including custom platforms", () => {
    const { face, person } = draftToCard({ ...emptyDraft(), platform: CUSTOM_PLATFORM, customName: "FastGo", name: "Sara", riderId: "FG-1", phone: "" })
    expect(face.theme.wordmark).toEqual(["FASTGO"])
    expect(face.title).toBe("FastGo rider card FG-1")
    expect(person).toEqual({ name: "Sara", phone: null, idNumber: null, photoUrl: null })
    expect(draftToCard({ ...emptyDraft(), platform: "keeta", name: "x", riderId: "1" }).face.theme.wordmark).toEqual(["KEETA"])
  })
})
