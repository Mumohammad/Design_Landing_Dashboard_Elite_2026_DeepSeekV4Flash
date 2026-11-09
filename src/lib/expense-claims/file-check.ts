// Receipt file validation by content (magic bytes), not by the name or the
// browser-reported type. Client-safe and dependency-free; the server re-runs
// it on the stored bytes before an attachment is registered.
import { MAX_ATTACHMENT_BYTES, type Bi, type DocKind } from "./constants"

export type AllowedMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "application/pdf" | "application/xml"

export type SniffResult =
  | { ok: true; mime: AllowedMime; kind: DocKind; ext: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported" | "active_content" | "unsafe_xml" | "not_einvoice"; message: Bi }

/** `accept` attribute for receipt pickers (CamScanner exports are PDF or JPEG). */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.xml,application/xml,text/xml"

const MSG: Record<Exclude<SniffResult, { ok: true }>["reason"], Bi> = {
  empty: { en: "The file is empty.", ar: "الملف فارغ." },
  too_large: { en: "Files must be 10 MB or smaller.", ar: "يجب ألا يتجاوز حجم الملف 10 ميجابايت." },
  unsupported: { en: "Only JPG, PNG, WEBP, HEIC photos, PDF files or supplier XML e-invoice files are accepted.", ar: "يُقبل فقط صور JPG وPNG وWEBP وHEIC أو ملفات PDF أو ملفات فواتير XML من المورد." },
  active_content: { en: "This PDF contains scripts, embedded files or actions and was blocked for safety.", ar: "يحتوي ملف PDF على نصوص برمجية أو ملفات مضمّنة أو إجراءات، وتم حظره للسلامة." },
  unsafe_xml: { en: "XML files with DOCTYPE or ENTITY declarations are blocked for safety.", ar: "تم حظر ملفات XML التي تحتوي على تعريفات DOCTYPE أو ENTITY للسلامة." },
  not_einvoice: { en: "XML files are accepted only as structured e-invoice originals (UBL Invoice).", ar: "تُقبل ملفات XML فقط كأصل فاتورة إلكترونية منظمة (UBL Invoice)." },
}
const fail = (reason: keyof typeof MSG): SniffResult => ({ ok: false, reason, message: MSG[reason] })

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len))

function latin1(b: Uint8Array, max = b.length): string {
  let s = ""
  const n = Math.min(b.length, max)
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(n, i + 8192)))
  return s
}

// PDF name tokens that run code, launch programs, embed or submit files.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|SubmitForm|ImportData|GoToE)(?![A-Za-z0-9])/

export function sniffFile(bytes: Uint8Array, size = bytes.length): SniffResult {
  if (!size || !bytes.length) return fail("empty")
  if (size > MAX_ATTACHMENT_BYTES) return fail("too_large")
  const b = bytes
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, mime: "image/jpeg", kind: "photo", ext: "jpg" }
  if (b.length >= 8 && ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n") return { ok: true, mime: "image/png", kind: "photo", ext: "png" }
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { ok: true, mime: "image/webp", kind: "photo", ext: "webp" }
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4)
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return { ok: true, mime: "image/heic", kind: "photo", ext: "heic" }
    if (["mif1", "msf1"].includes(brand)) return { ok: true, mime: "image/heif", kind: "photo", ext: "heif" }
    return fail("unsupported")
  }
  const head = latin1(b, 1024)
  if (head.startsWith("%PDF-")) {
    const all = latin1(b)
    if (PDF_ACTIVE.test(all)) return fail("active_content")
    return { ok: true, mime: "application/pdf", kind: looksScanned(all) ? "scanned_pdf" : "digital_pdf", ext: "pdf" }
  }
  // XML: only supplier structured e-invoice originals (UBL Invoice / CreditNote).
  const text = decodeUtf8(b)
  if (text !== null) {
    const t = text.replace(/^\uFEFF/, "").trimStart()
    if (t.startsWith("<")) {
      if (/<!DOCTYPE|<!ENTITY/i.test(t)) return fail("unsafe_xml")
      if (!/^<\?xml[\s>]/.test(t) && !/^<([A-Za-z_][\w.-]*:)?(Invoice|CreditNote|DebitNote)[\s>]/.test(t)) return fail("unsupported")
      if (!/<([A-Za-z_][\w.-]*:)?(Invoice|CreditNote|DebitNote)[\s>]/.test(t) || !/urn:oasis:names:specification:ubl:schema:xsd/.test(t)) return fail("not_einvoice")
      return { ok: true, mime: "application/xml", kind: "structured_einvoice", ext: "xml" }
    }
  }
  return fail("unsupported")
}

/** Scanner apps (CamScanner, Adobe Scan, …) produce image-only PDFs. */
function looksScanned(pdf: string): boolean {
  if (/CamScanner|Adobe Scan|Genius Scan|Microsoft Lens|Office Lens|TurboScan|Tiny Scanner|Scanner Pro|SwiftScan|vFlat|NAPS2/i.test(pdf)) return true
  return /\/Subtype\s*\/Image/.test(pdf) && !/\/Font\b/.test(pdf)
}

function decodeUtf8(b: Uint8Array): string | null {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b) } catch { return null }
}

/** Keeps the user's filename for display/export, without paths or control characters. */
export function safeFilename(name: string | null | undefined, ext: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? ""
  let clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, 180)
  if (!clean || clean === "." || clean === "..") clean = "receipt"
  const want = ext === "jpg" ? /\.(jpe?g)$/i : new RegExp(`\\.${ext}$`, "i")
  if (!want.test(clean)) clean = `${clean.replace(/\.[A-Za-z0-9]{1,5}$/, "")}.${ext}`
  return clean
}

/** Quick client-side pre-check before upload (the server re-validates content). */
export function precheckFile(file: { size: number; name: string; type: string }): Bi | null {
  if (!file.size) return MSG.empty
  if (file.size > MAX_ATTACHMENT_BYTES) return MSG.too_large
  const okType = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|application\/xml|text\/xml)$/i.test(file.type)
  const okExt = /\.(jpe?g|png|webp|heic|heif|pdf|xml)$/i.test(file.name)
  return okType || okExt ? null : MSG.unsupported
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("")
}
