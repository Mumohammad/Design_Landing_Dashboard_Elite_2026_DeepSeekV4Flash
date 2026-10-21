// Financial Phase 14 — unit tests for the verification-QR TLV payload
// (simplified tax invoice field set: seller name, VAT no., timestamp,
// total, VAT amount) and the PNG renderer.
import { describe, expect, it, vi } from "vitest"
import QRCode from "qrcode"
import { buildTaxQrPayload, qrPngDataUrl, taxQrBase64, tlvField } from "./invoice-qr"

describe("tlvField", () => {
  it("encodes tag + 1-byte length + UTF-8 value bytes", () => {
    const f = tlvField(1, "abc")
    expect(Array.from(f)).toEqual([1, 3, 97, 98, 99])
  })

  it("uses the UTF-8 byte length (Arabic is multi-byte)", () => {
    const f = tlvField(2, "شركة") // 4 Arabic chars × 2 bytes = 8
    expect(f[0]).toBe(2)
    expect(f[1]).toBe(8)
    expect(f.length).toBe(10)
  })

  it("throws when the value exceeds the 255-byte single-byte length limit", () => {
    expect(() => tlvField(3, "a".repeat(256))).toThrow("255-byte")
    // Exactly 255 bytes is representable.
    expect(() => tlvField(4, "a".repeat(255))).not.toThrow()
  })
})

describe("buildTaxQrPayload", () => {
  const payload = {
    sellerName: "نخبة التطوير",
    sellerVatNumber: "310122223500003",
    timestamp: "2026-08-12T10:30:00.000Z",
    total: 115_000,
    vatAmount: 15_000,
  }

  it("concatenates the five standard fields in tag order 1..5", () => {
    const bytes = buildTaxQrPayload(payload)
    // Walk the TLV stream and collect (tag, value).
    const fields: { tag: number; value: string }[] = []
    let offset = 0
    while (offset < bytes.length) {
      const tag = bytes[offset]
      const len = bytes[offset + 1]
      const value = new TextDecoder().decode(bytes.slice(offset + 2, offset + 2 + len))
      fields.push({ tag, value })
      offset += 2 + len
    }
    expect(fields.map((f) => f.tag)).toEqual([1, 2, 3, 4, 5])
    expect(fields[0].value).toBe("نخبة التطوير")
    expect(fields[1].value).toBe("310122223500003")
    expect(fields[2].value).toBe("2026-08-12T10:30:00.000Z")
    // Money is serialized at fixed 2dp — never "115000.00000001".
    expect(fields[3].value).toBe("115000.00")
    expect(fields[4].value).toBe("15000.00")
  })

  it("round-trips the TLV stream length exactly (no bytes lost)", () => {
    const bytes = buildTaxQrPayload(payload)
    let consumed = 0
    while (consumed < bytes.length) {
      consumed += 2 + bytes[consumed + 1]
    }
    expect(consumed).toBe(bytes.length)
  })
})

describe("qrPngDataUrl", () => {
  it("puts Base64 text in the QR, rather than raw TLV bytes", async () => {
    const bytes = buildTaxQrPayload({sellerName:"شركة",sellerVatNumber:"300000000000003",timestamp:"2026-10-18T10:00:00Z",total:115,vatAmount:15})
    const render = vi.spyOn(QRCode, "toDataURL")
    try {
      await qrPngDataUrl(bytes)
      const content = render.mock.calls[0][0]
      expect(typeof content).toBe("string")
      expect(Buffer.from(content as string,"base64")).toEqual(Buffer.from(bytes))
    } finally { render.mockRestore() }
  })

  it("rejects QR text beyond the specification's resource limit", () => {
    expect(() => taxQrBase64(new Uint8Array(526))).toThrow("700-character")
    expect(taxQrBase64(new Uint8Array(525))).toHaveLength(700)
  })

  it("renders a base64 PNG data URL from a byte payload", async () => {
    const url = await qrPngDataUrl(buildTaxQrPayload({
      sellerName: "X",
      sellerVatNumber: "310122223500003",
      timestamp: "2026-08-12T10:30:00.000Z",
      total: 115_000,
      vatAmount: 15_000,
    }))
    expect(url.startsWith("data:image/png;base64,")).toBe(true)
  })
})
