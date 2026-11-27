import { createHash, randomBytes } from "crypto"

/** 256-bit random portal token (64 hex chars). Only its SHA-256 hash is stored. */
export function generatePortalToken(): string { return randomBytes(32).toString("hex") }
export function hashPortalToken(token: string): string { return createHash("sha256").update(token).digest("hex") }
export function isPortalToken(token: string): boolean { return /^[0-9a-f]{64}$/.test(token) }

/** Check the file header before a public upload can become a submission. */
export function matchesPortalFileSignature(bytes: Uint8Array, mime: string): boolean {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  if (mime === "image/webp") return bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP"
  if (mime === "application/pdf") return text(0, 5) === "%PDF-"
  if (mime === "image/heic" || mime === "image/heif") {
    if (bytes.length < 16 || text(4, 8) !== "ftyp") return false
    const brands = mime === "image/heic" ? ["heic", "heix", "hevc", "hevx"] : ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"]
    return brands.includes(text(8, 12))
  }
  return false
}
