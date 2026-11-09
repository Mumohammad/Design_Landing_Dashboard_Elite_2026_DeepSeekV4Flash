import { afterEach, describe, expect, it, vi } from "vitest"
import { buildImagePdf, cardPdfFilename, CARD_H_PT, CARD_W_PT, layoutCardPages, photoAsDataUrl, renderRiderCardsPdf } from "./card-pdf"
import { draftToCard, emptyDraft } from "./card-editor"

const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 3 }
const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b)

describe("card pdf", () => {
  it("lays out PVC as one face per card-sized page", () => {
    const pages = layoutCardPages(4, "pvc")
    expect(pages).toHaveLength(4)
    expect(pages[0].width).toBeCloseTo(153.07, 1)
    expect(pages[0].height).toBeCloseTo(242.65, 1)
    expect(pages[3].items[0]).toMatchObject({ image: 3, x: 0, y: 0, w: CARD_W_PT, h: CARD_H_PT })
  })

  it("lays out A4 as a 3×3 grid of real-size faces", () => {
    const pages = layoutCardPages(10, "a4")
    expect(pages).toHaveLength(2)
    expect(pages[0].items).toHaveLength(9)
    expect(pages[1].items).toHaveLength(1)
    for (const it of pages[0].items) {
      expect(it.x).toBeGreaterThan(0)
      expect(it.y + it.h).toBeLessThan(pages[0].height)
    }
  })

  it("writes a structurally valid PDF with a correct xref", () => {
    const pdf = buildImagePdf([jpeg, jpeg], layoutCardPages(2, "pvc"), "Rider (card) ٣")
    const s = text(pdf)
    expect(s.startsWith("%PDF-1.4")).toBe(true)
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(s).toContain("/Count 2")
    expect(s).toContain("/Filter /DCTDecode")
    expect(s).toContain("/Title (Rider \\(card\\) )")
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1])
    expect(s.slice(startxref, startxref + 4)).toBe("xref")
    const entries = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(9)
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  })

  it("rejects empty documents", () => {
    expect(() => buildImagePdf([], [])).toThrow()
  })

  it("builds safe filenames", () => {
    expect(cardPdfFilename("HS/12 34", "hungerstation")).toBe("rider-card-hungerstation-HS-12-34.pdf")
  })
})

describe("configured card photos", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("allows a deliberately photo-free card without making a request", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    expect(await photoAsDataUrl(null)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(["expired", "network", "non-image"])("rejects %s photos before PDF rendering can omit them", async fault => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (fault === "network") throw new Error("Offline")
      return new Response(fault === "expired" ? "Denied" : "Not an image", {
        status: fault === "expired" ? 403 : 200, headers: { "content-type": "text/plain" },
      })
    }))
    const card = draftToCard({ ...emptyDraft(), name: "Driver", riderId: "HS-1", photoUrl: "https://fixture.test/signed-photo" })
    await expect(renderRiderCardsPdf([card.face], card.person, "pvc")).rejects.toThrow("configured card photo")
  })

  it("rejects corrupt local image data instead of exporting a blank frame", async () => {
    vi.stubGlobal("Image", class { src = ""; decode() { return Promise.reject(new Error("Invalid image")) } })
    await expect(photoAsDataUrl("data:image/png;base64,broken")).rejects.toThrow("configured card photo")
  })

  it("retains a successfully decoded local photo", async () => {
    const decode = vi.fn(async () => undefined)
    vi.stubGlobal("Image", class { src = ""; decode = decode })
    const photo = "data:image/png;base64,fixture"
    expect(await photoAsDataUrl(photo)).toBe(photo)
    expect(decode).toHaveBeenCalledOnce()
  })
})
