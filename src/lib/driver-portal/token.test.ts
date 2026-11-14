import { describe, expect, it } from "vitest"
import { generatePortalToken, hashPortalToken, isPortalToken, matchesPortalFileSignature } from "./token"
const bytes = (value: string) => new TextEncoder().encode(value)
describe("portal tokens and file signatures", () => {
  it("creates opaque 256-bit tokens and stable hashes", () => {
    const token = generatePortalToken()
    expect(isPortalToken(token)).toBe(true)
    expect(hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashPortalToken(token)).not.toBe(token)
    expect(generatePortalToken()).not.toBe(token)
  })
  it("recognizes the permitted headers", () => {
    expect(matchesPortalFileSignature(Uint8Array.from([255,216,255]), "image/jpeg")).toBe(true)
    expect(matchesPortalFileSignature(Uint8Array.from([137,80,78,71,13,10,26,10]), "image/png")).toBe(true)
    expect(matchesPortalFileSignature(bytes("RIFF0000WEBP"), "image/webp")).toBe(true)
    expect(matchesPortalFileSignature(bytes("%PDF-1.7"), "application/pdf")).toBe(true)
    expect(matchesPortalFileSignature(bytes("0000ftypheic0000"), "image/heic")).toBe(true)
    expect(matchesPortalFileSignature(bytes("0000ftypmif10000"), "image/heif")).toBe(true)
  })
  it.each(["image/jpeg","image/png","image/webp","image/heic","image/heif","application/pdf"])("rejects HTML masquerading as %s", mime => {
    expect(matchesPortalFileSignature(bytes("<script>alert(1)</script>"), mime)).toBe(false)
    expect(matchesPortalFileSignature(new Uint8Array(), mime)).toBe(false)
  })
})
