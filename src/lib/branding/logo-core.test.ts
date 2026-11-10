import { describe, expect, it } from "vitest"
import { decodeLogoPayload, detectLogoFormat, tenantLogoObjectPath, tenantLogoPath } from "./logo-core"

const T = "11111111-2222-3333-4444-555555555555"
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe("tenant logo helpers", () => {
  it("detects png/jpeg/webp by magic bytes and rejects svg", () => {
    expect(detectLogoFormat(PNG)).toBe("png")
    expect(detectLogoFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg")
    expect(detectLogoFormat(Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")))).toBe("webp")
    expect(detectLogoFormat(Uint8Array.from(Buffer.from("<svg xmlns=")))).toBeNull()
  })

  it("decodes data URLs and bare base64, rejecting junk and oversize payloads", () => {
    const b64 = Buffer.from(PNG).toString("base64")
    expect(decodeLogoPayload(`data:image/png;base64,${b64}`)).toEqual(PNG)
    expect(decodeLogoPayload(b64)).toEqual(PNG)
    expect(decodeLogoPayload("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull()
    expect(decodeLogoPayload("not base64!")).toBeNull()
    expect(decodeLogoPayload("A".repeat(3_000_000))).toBeNull()
  })

  it("only resolves this tenant's stored logo objects (no SSRF / cross-tenant)", () => {
    const p = tenantLogoPath(T, "0123456789abcdef0123")
    expect(p).toBe(`${T}/logo-0123456789abcdef.png`)
    const url = `https://x.supabase.co/storage/v1/object/public/company-assets/${p}`
    expect(tenantLogoObjectPath(url, T)).toBe(p)
    expect(tenantLogoObjectPath(url, "99999999-2222-3333-4444-555555555555")).toBeNull()
    expect(tenantLogoObjectPath("https://cdn.example.com/logo.png", T)).toBeNull()
    expect(tenantLogoObjectPath(`https://x.supabase.co/storage/v1/object/public/company-assets/${T}/../x/logo-0123456789abcdef.png`, T)).toBeNull()
    expect(tenantLogoObjectPath(null, T)).toBeNull()
  })
})
