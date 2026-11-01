"use client"
// Browser-only OCR using the self-hosted Tesseract build in /public/ocr.
// Nothing leaves the device: the image is recognised locally in a worker.
import { extractDocumentFields, type OcrDocKind, type OcrSuggestion } from "./extract"

type TesseractWorker = { recognize: (img: Blob | HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> }
type TesseractGlobal = { createWorker: (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TesseractWorker> }

let loader: Promise<TesseractGlobal> | null = null
function loadTesseract(): Promise<TesseractGlobal> {
  const w = window as unknown as { Tesseract?: TesseractGlobal }
  if (w.Tesseract) return Promise.resolve(w.Tesseract)
  loader ??= new Promise<TesseractGlobal>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "/ocr/tesseract.min.js"
    s.async = true
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error("OCR engine failed to load")))
    s.onerror = () => { loader = null; reject(new Error("OCR engine failed to load")) }
    document.head.appendChild(s)
  })
  return loader
}

export function ocrSupported(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly === "object" && typeof Worker === "function"
}

/** Downscale very large photos so recognition stays fast on phones. */
async function prepare(file: Blob): Promise<Blob | HTMLCanvasElement> {
  try {
    const bmp = await createImageBitmap(file)
    const max = 2200, scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1) { bmp.close(); return file }
    const c = document.createElement("canvas")
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    return c
  } catch { return file }
}

export async function scanDocument(file: Blob, kind: OcrDocKind): Promise<OcrSuggestion & { text: string }> {
  if (!ocrSupported()) throw new Error("OCR is not supported on this browser")
  if (!file.type.startsWith("image/")) throw new Error("OCR works with photos or scans (JPG/PNG), not PDF")
  const T = await loadTesseract()
  const worker = await T.createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/tesseract-core-simd-lstm.wasm.js",
    langPath: "/ocr",
    workerBlobURL: false,
  })
  try {
    const { data } = await worker.recognize(await prepare(file))
    return { ...extractDocumentFields(data.text, kind), text: data.text }
  } finally { void worker.terminate() }
}
