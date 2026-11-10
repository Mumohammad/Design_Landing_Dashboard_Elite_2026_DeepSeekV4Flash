import { describe, expect, it } from "vitest"
import { extractDocumentFields, findDates, hijriToGregorian, isSaudiIdNumber, mrzCheckDigit, parseMrz, westernize } from "./extract"

// ICAO 9303 specimen passport
const MRZ = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10"

describe("OCR extraction", () => {
  it("parses a TD3 passport MRZ with valid check digits", () => {
    const r = parseMrz(MRZ)!
    expect(r.passportNumber).toBe("L898902C3")
    expect(r.nationality).toBe("UTO")
    expect(r.birthDate).toBe("1974-08-12")
    expect(r.expiryDate).toBe("2012-04-15")
    expect(r.surname).toBe("ERIKSSON")
    expect(r.givenNames).toBe("ANNA MARIA")
    expect(r.valid).toBe(true)
    expect(mrzCheckDigit("L898902C3")).toBe(6)
  })
  it("validates Saudi ID / iqama numbers", () => {
    expect(isSaudiIdNumber("1000000008")).toBe(true)
    expect(isSaudiIdNumber("1000000009")).toBe(false)
    expect(isSaudiIdNumber("3000000008")).toBe(false)
  })
  it("converts Arabic-Indic digits and Hijri dates", () => {
    expect(westernize("١٤٤٨/٠٩/٠١")).toBe("1448/09/01")
    expect(hijriToGregorian(1446, 9, 1)).toBe("2025-03-01")
    expect(findDates("Expiry 1446/09/01")[0]).toMatchObject({ iso: "2025-03-01", source: "hijri" })
  })
  it("prefers the labelled expiry date on an iqama scan", () => {
    const text = "Kingdom of Saudi Arabia\nIqama No 2000000006\nDate of birth 12/03/1990\nExpiry date 2027/05/20"
    const r = extractDocumentFields(text, "iqama", "2026-11-01")
    expect(r.docNumber).toBe("2000000006")
    expect(r.expiryDate).toBe("2027-05-20")
    expect(r.confidence).toBe("high")
  })
  it("reads passports through the MRZ", () => {
    const r = extractDocumentFields(`Passport\n${MRZ}`, "passport")
    expect(r).toMatchObject({ docNumber: "L898902C3", expirySource: "mrz", confidence: "high", nationality: "UTO" })
  })
})
