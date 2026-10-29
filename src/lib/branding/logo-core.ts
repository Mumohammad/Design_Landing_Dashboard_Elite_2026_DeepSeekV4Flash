// Pure helpers for tenant logo handling (no server-only imports so they can be
// unit-tested). The server pipeline lives in ./logo.ts.

export const COMPANY_ASSETS_BUCKET = "company-assets"
/** Raw upload ceiling (decoded bytes) before normalisation. */
export const LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024
/** Longest edge of the stored PNG. */
export const LOGO_MAX_EDGE = 512

export type LogoFormat = "png" | "jpeg" | "webp"

/** Detect PNG/JPEG/WebP by magic bytes. SVG/GIF/anything else → null. */
export function detectLogoFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp"
  return null
}

/**
 * Decode a client-supplied logo payload: either a `data:image/...;base64,`
 * URL or bare base64. Returns null for malformed/oversized input.
 */
export function decodeLogoPayload(payload: string): Uint8Array | null {
  if (typeof payload !== "string" || payload.length === 0) return null
  const match = /^data:image\/(png|jpeg|webp);base64,([\s\S]*)$/.exec(payload)
  const b64 = (match ? match[2] : payload).replace(/\s+/g, "")
  // base64 length ≈ 4/3 of bytes; reject before decoding huge strings.
  if (b64.length > Math.ceil((LOGO_MAX_INPUT_BYTES * 4) / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"))
  if (bytes.length === 0 || bytes.length > LOGO_MAX_INPUT_BYTES) return null
  return bytes
}

/** Object path for a tenant logo: `<tenantId>/logo-<hash>.png`. */
export function tenantLogoPath(tenantId: string, hash: string): string {
  return `${tenantId}/logo-${hash.slice(0, 16)}.png`
}

/**
 * Extract the storage object path from a stored `tenants.logo_url` when it
 * points at this tenant's folder in the public company-assets bucket.
 * External URLs (legacy CDN links) and other tenants' paths → null, so the
 * server never fetches arbitrary URLs (SSRF) or another tenant's asset.
 */
export function tenantLogoObjectPath(logoUrl: string | null | undefined, tenantId: string): string | null {
  if (!logoUrl) return null
  const marker = `/storage/v1/object/public/${COMPANY_ASSETS_BUCKET}/`
  let pathname: string
  try {
    pathname = new URL(logoUrl).pathname
  } catch {
    return null
  }
  const at = pathname.indexOf(marker)
  if (at < 0) return null
  const objectPath = decodeURIComponent(pathname.slice(at + marker.length))
  const re = new RegExp(`^${tenantId.replace(/[^0-9a-f-]/gi, "")}/logo-[0-9a-f]{16}\\.png$`, "i")
  return re.test(objectPath) ? objectPath : null
}
