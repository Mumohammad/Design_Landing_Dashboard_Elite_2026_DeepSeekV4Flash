import "server-only"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { InvoiceDocData } from "./invoice-html"
import chromium from "@sparticuz/chromium"
import { chromium as playwright, type Browser } from "playwright-core"

/** Only operator-provisioned, licensed font files may enable exact reference
 * typography on hosts without Tahoma. This directory is never a request input
 * and must stay outside public/. Font files never become public web assets. */
export async function loadInvoiceReferenceFonts(): Promise<Pick<InvoiceDocData, "referenceFontDataUrl" | "referenceBoldFontDataUrl">> {
  const configured = process.env.INVOICE_REFERENCE_FONT_DIR
  if (!configured) return {}
  try {
    if (configured !== "bundled" && !path.isAbsolute(configured)) throw Error()
    const root = await realpath(configured === "bundled" ? path.join(process.cwd(), "private", "invoice-fonts") : configured)
    const publicRoot = await realpath(path.join(process.cwd(), "public"))
    const inside = (parent: string, child: string) => {
      const relative = path.relative(parent, child)
      return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    }
    if (inside(publicRoot, root)) throw Error()
    const readFont = async (name: string) => {
      const file = await realpath(path.join(root, name))
      if (!inside(root, file)) throw Error()
      const info = await stat(file)
      if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error()
      const bytes = await readFile(file)
      if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024 || bytes.readUInt32BE(0) !== 0x00010000) throw Error()
      return `data:font/ttf;base64,${bytes.toString("base64")}`
    }
    const [referenceFontDataUrl, referenceBoldFontDataUrl] = await Promise.all([readFont("regular.ttf"), readFont("bold.ttf")])
    return { referenceFontDataUrl, referenceBoldFontDataUrl }
  } catch {
    // Do not expose operator paths or raw filesystem errors to invoice users.
    throw new Error("Invoice reference fonts are unavailable or invalid")
  }
}

const MAX_BYTES = 4 * 1024 * 1024
let active = 0

export class InvoicePdfBusyError extends Error {}

/** Render only server-built, escaped invoice HTML. No credentials, scripts,
 * external network access, shared browser pages or browser print metadata. */
export async function renderInvoicePdf(html: string): Promise<Uint8Array> {
  if (!html.startsWith("<!DOCTYPE html>") || Buffer.byteLength(html) > MAX_BYTES) throw Error("Invalid invoice document")
  if (active >= 2) throw new InvoicePdfBusyError("PDF renderer is busy")
  active++
  let browser: Browser | undefined
  let phase = "launch"
  const deadline = setTimeout(() => { void browser?.close().catch(() => {}) }, 45_000)
  try {
    const localExecutable = !process.env.VERCEL ? process.env.INVOICE_CHROMIUM_EXECUTABLE_PATH : undefined
    browser = await playwright.launch({
      executablePath: localExecutable || await chromium.executablePath(),
      args: localExecutable ? [] : chromium.args,
      headless: true,
      timeout: 20_000,
    })
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 794, height: 1123 } })
    await context.route("**/*", route => {
      const url = route.request().url()
      return url.startsWith("data:") || url === "about:blank" ? route.continue() : route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    phase = "content"
    page.setDefaultTimeout(15_000)
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 })
    phase = "assets"
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images, image => image.decode()))
      // Unused fallback faces remain unloaded when the reference font is present.
      if (Array.from(document.fonts).some(font => font.status === "error")) throw Error("Invoice font unavailable")
    })
    await page.emulateMedia({ media: "print" })
    phase = "pdf"
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true })
    if (pdf.byteLength > MAX_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid invoice PDF")
    return Uint8Array.from(pdf)
  } catch (error) {
    // Do not log HTML, invoice data, credentials, URLs or raw browser errors.
    console.warn("Invoice PDF render failed", {
      phase, errorType: error instanceof Error ? error.name : "Unknown",
      code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined,
    })
    throw error
  } finally {
    clearTimeout(deadline)
    try { await browser?.close() } finally { active-- }
  }
}
