// Rider card → PDF without third-party libraries. Each card face (the same
// SVG used by the preview and the print window) is rasterised to a ~300 dpi
// JPEG in the browser, then embedded in a tiny hand-written PDF (DCTDecode
// image XObjects). The PDF builder itself is pure so it can be unit-tested.
import type { DriverCardPerson } from "./cards"
import { riderCardFaceSvg, type DriverCardOutputFormat, type RiderCardFace } from "./card-print"

const MM = 72 / 25.4
export const CARD_W_PT = 54 * MM
export const CARD_H_PT = 85.6 * MM
const A4_W_PT = 210 * MM
const A4_H_PT = 297 * MM

export interface PdfJpeg { bytes: Uint8Array; width: number; height: number }
export interface PdfPlacement { image: number; x: number; y: number; w: number; h: number }
export interface PdfPage { width: number; height: number; items: PdfPlacement[] }

const enc = new TextEncoder()
const n = (v: number) => (Math.round(v * 100) / 100).toString()

/** Minimal PDF 1.4 writer: pages of placed JPEG images. */
export function buildImagePdf(images: PdfJpeg[], pages: PdfPage[], title = "Rider cards"): Uint8Array {
  if (!pages.length) throw Error("PDF needs at least one page")
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (c: Uint8Array | string) => { const b = typeof c === "string" ? enc.encode(c) : c; chunks.push(b); size += b.length }
  // Object numbering: 1 catalog, 2 pages, 3 info, images 4.., then page+content pairs.
  const imgBase = 4
  const pageBase = imgBase + images.length
  const total = pageBase + pages.length * 2 - 1
  const obj = (num: number, body: () => void) => { offsets[num] = size; push(`${num} 0 obj\n`); body(); push("\nendobj\n") }
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
  const kids = pages.map((_, i) => `${pageBase + i * 2} 0 R`).join(" ")
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"))
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`))
  const safeTitle = title.replace(/[^\x20-\x7E]/g, "").replace(/([\\()])/g, "\\$1")
  obj(3, () => push(`<< /Title (${safeTitle}) /Producer (EliteDev) >>`))
  images.forEach((img, i) => obj(imgBase + i, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`)
    push(img.bytes)
    push("\nendstream")
  }))
  pages.forEach((page, i) => {
    const used = [...new Set(page.items.map((it) => it.image))]
    const xo = used.map((k) => `/Im${k} ${imgBase + k} 0 R`).join(" ")
    const content = page.items.map((it) => `q ${n(it.w)} 0 0 ${n(it.h)} ${n(it.x)} ${n(page.height - it.y - it.h)} cm /Im${it.image} Do Q`).join("\n")
    const contentBytes = enc.encode(content)
    obj(pageBase + i * 2, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /XObject << ${xo} >> >> /Contents ${pageBase + i * 2 + 1} 0 R >>`))
    obj(pageBase + i * 2 + 1, () => { push(`<< /Length ${contentBytes.length} >>\nstream\n`); push(contentBytes); push("\nendstream") })
  })
  const xref = size
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`)
  for (let k = 1; k <= total; k++) push(`${String(offsets[k]).padStart(10, "0")} 00000 n \n`)
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

/**
 * Page layout for N faces (front, back, front, back…). PVC = one face per
 * 54×85.6 mm page (card printers); A4 = real-size faces on a 3×3 grid.
 */
export function layoutCardPages(faceCount: number, format: DriverCardOutputFormat): PdfPage[] {
  if (format === "pvc") return Array.from({ length: faceCount }, (_, i) => ({ width: CARD_W_PT, height: CARD_H_PT, items: [{ image: i, x: 0, y: 0, w: CARD_W_PT, h: CARD_H_PT }] }))
  const cols = 3, rows = 3, gap = 8 * MM
  const gridW = cols * CARD_W_PT + (cols - 1) * gap, gridH = rows * CARD_H_PT + (rows - 1) * gap
  const x0 = (A4_W_PT - gridW) / 2, y0 = (A4_H_PT - gridH) / 2
  const pages: PdfPage[] = []
  for (let i = 0; i < faceCount; i++) {
    const slot = i % (cols * rows)
    if (slot === 0) pages.push({ width: A4_W_PT, height: A4_H_PT, items: [] })
    const c = slot % cols, r = Math.floor(slot / cols)
    pages[pages.length - 1].items.push({ image: i, x: x0 + c * (CARD_W_PT + gap), y: y0 + r * (CARD_H_PT + gap), w: CARD_W_PT, h: CARD_H_PT })
  }
  return pages
}

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(b) })

/** Inline a remote (signed) photo so the SVG can be rasterised offline. */
export async function photoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.startsWith("data:")) return url
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" })
    if (!res.ok) return null
    return await blobToDataUrl(await res.blob())
  } catch { return null }
}

const PX_W = 638, PX_H = 1011 // 54×85.6 mm @ 300 dpi

async function rasterise(svg: string): Promise<PdfJpeg> {
  const sized = svg.replace('width="100%" height="100%"', `width="${PX_W}" height="${PX_H}"`)
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml;charset=utf-8" }))
  try {
    const img = new Image()
    img.decoding = "sync"
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(Error("Card image failed to render")); img.src = url })
    const canvas = document.createElement("canvas")
    canvas.width = PX_W; canvas.height = PX_H
    const ctx = canvas.getContext("2d")
    if (!ctx) throw Error("Canvas unavailable")
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, PX_W, PX_H)
    ctx.drawImage(img, 0, 0, PX_W, PX_H)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.93))
    if (!blob) throw Error("Card image encode failed")
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: PX_W, height: PX_H }
  } finally { URL.revokeObjectURL(url) }
}

/** Browser-only: render cards (front + back each) to a PDF blob. */
export async function renderRiderCardsPdf(cards: RiderCardFace[], person: DriverCardPerson | null, format: DriverCardOutputFormat): Promise<Blob> {
  if (!cards.length) throw Error("No cards to export")
  const photo = await photoAsDataUrl(person?.photoUrl ?? null)
  const p = person ? { ...person, photoUrl: photo } : null
  const images: PdfJpeg[] = []
  for (const [i, c] of cards.entries()) {
    for (const side of ["front", "back"] as const) images.push(await rasterise(riderCardFaceSvg(c, p, side, `pdf${i}${side}`)))
  }
  const title = cards.length === 1 ? (cards[0].title ?? `Rider card ${cards[0].riderId}`) : `Rider cards (${cards.length})`
  const bytes = buildImagePdf(images, layoutCardPages(images.length, format), title)
  return new Blob([bytes as BlobPart], { type: "application/pdf" })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.rel = "noopener"
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const cardPdfFilename = (riderId: string, platform: string) =>
  `rider-card-${platform}-${riderId}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80) + ".pdf"
