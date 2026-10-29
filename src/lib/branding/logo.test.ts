import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"

vi.mock("server-only", () => ({}))
import { LogoValidationError, normalizeLogo } from "./logo"

describe("normalizeLogo", () => {
  it("re-encodes a large JPEG to a ≤512px PNG", async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#1E5A99" } }).jpeg().toBuffer()
    const png = await normalizeLogo(jpeg)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe("png")
    expect(meta.width).toBe(512)
    expect(meta.height).toBe(256)
  })

  it("rejects SVG and corrupt images", async () => {
    await expect(normalizeLogo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toBeInstanceOf(LogoValidationError)
    await expect(normalizeLogo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).rejects.toBeInstanceOf(LogoValidationError)
  })
})
