import { describe, expect, it } from "vitest"
import { DELIVERY_PLATFORMS, RIDER_ID_PATTERN, platformByCode, platformTheme } from "./platforms"
import { buildCardPrintHtml, buildRiderCardsPrintHtml } from "./card-print"
import { NATIONALITIES, findNationality, nationalityOptions } from "@/lib/reference/nationalities"
import { SAUDI_CITIES, SAUDI_REGIONS, findSaudiCity } from "@/lib/reference/saudi-cities"

const person = { name: "Jamal <Mia>", phone: "0572544027", idNumber: "2836851145", photoUrl: null }

describe("delivery platform catalog", () => {
  it("covers the main KSA platforms with unique, DB-valid codes", () => {
    const codes = DELIVERY_PLATFORMS.map((p) => p.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of ["hungerstation", "keeta", "jahez", "mrsool", "toyou", "thechefz", "ninja", "nana", "careem", "shgardi"]) expect(codes).toContain(c)
    for (const c of codes) expect(c).toMatch(/^[a-z][a-z0-9_]{1,39}$/)
  })
  it("falls back to a neutral theme for unknown platforms", () => {
    expect(platformByCode("HungerStation")?.en).toBe("HungerStation")
    expect(platformTheme("custom_fleet").wordmark).toEqual(["CUSTOM_FLEET"])
  })
  it("validates rider IDs like the database", () => {
    expect(RIDER_ID_PATTERN.test("4747290")).toBe(true)
    expect(RIDER_ID_PATTERN.test("HS-12/a.b_c")).toBe(true)
    expect(RIDER_ID_PATTERN.test("bad id")).toBe(false)
    expect(RIDER_ID_PATTERN.test("x".repeat(65))).toBe(false)
  })
})

describe("rider card print", () => {
  it("prints the platform rider ID in the platform branding and escapes values", () => {
    const html = buildRiderCardsPrintHtml([{ theme: platformTheme("keeta"), riderId: "K-1001" }, { theme: platformTheme("jahez"), riderId: "J-77" }], person, "a4")
    expect(html).toContain("K-1001")
    expect(html).toContain("J-77")
    expect(html).toContain("KEETA")
    expect(html).toContain("JAHEZ")
    expect(html).toContain("Jamal &lt;Mia&gt;")
    expect(html.match(/data-card-face="front"/g)).toHaveLength(2)
  })
  it("issued card shows the primary rider ID and keeps the serial as reference", () => {
    const card = { workflow_version: 1, id: "c", driver_id: "d", card_serial: "EDC-0001", status: "active" as const, issued_at: "2026-01-01T00:00:00Z", expires_at: null, reprint_count: 0 }
    const withPlatform = buildCardPrintHtml(card, person, "pvc", { code: "hungerstation", riderId: "4747290" })
    expect(withPlatform).toMatch(/Rider ID: <\/tspan><tspan[^>]*>4747290</)
    expect(withPlatform).toContain("EDC-0001")
    expect(buildCardPrintHtml(card, person)).toMatch(/Rider ID: <\/tspan><tspan[^>]*>EDC-0001</)
    expect(() => buildRiderCardsPrintHtml([], person)).toThrow()
  })
})

describe("reference data", () => {
  it("lists all 193 UN members plus 2 observer states", () => {
    expect(NATIONALITIES).toHaveLength(195)
    expect(new Set(NATIONALITIES.map((n) => n.code)).size).toBe(195)
    expect(nationalityOptions(true)[0].code).toBe("SA")
  })
  it("resolves stored nationality text in either language", () => {
    expect(findNationality("سعودية")?.code).toBe("SA")
    expect(findNationality("Pakistani")?.code).toBe("PK")
    expect(findNationality("eg")?.code).toBe("EG")
  })
  it("maps every Saudi city to one of the 13 regions", () => {
    expect(SAUDI_REGIONS).toHaveLength(13)
    const regions = new Set(SAUDI_REGIONS.map((r) => r.code))
    expect(SAUDI_CITIES.length).toBeGreaterThan(140)
    for (const c of SAUDI_CITIES) expect(regions.has(c.region)).toBe(true)
    expect(findSaudiCity("جدة")?.region).toBe("MK")
    expect(findSaudiCity("dammam")?.region).toBe("EP")
  })
})
