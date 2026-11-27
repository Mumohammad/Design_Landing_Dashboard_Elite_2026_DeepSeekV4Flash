export const COMPANY_ASSETS_BUCKET = "company-assets"
export const LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024
export const LOGO_MAX_STORED_BYTES = 512 * 1024
// Leave ample room for the Server Action envelope below Next's default 1 MiB.
export const LOGO_MAX_PAYLOAD_CHARS = 700_000
export const LOGO_MAX_EDGE = 512
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export type LogoFormat = "png" | "jpeg" | "webp"
export function detectLogoFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "png"
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg"
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0,4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8,12)) === "WEBP") return "webp"
  return null
}
export function decodeLogoPayload(payload: string): Uint8Array | null {
  if (typeof payload !== "string" || !payload || payload.length > LOGO_MAX_PAYLOAD_CHARS) return null
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload)
  const b64 = match ? match[2] : payload
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return null
  const bytes = Buffer.from(b64, "base64")
  if (!bytes.length || bytes.length > LOGO_MAX_INPUT_BYTES || bytes.toString("base64") !== b64) return null
  return new Uint8Array(bytes)
}
export function tenantLogoPath(tenantId: string, hash: string): string {
  return `${tenantId}/logo-${hash.slice(0,16)}.png`
}
export function stagedTenantLogoPath(tenantId: string, actorId: string, requestId: string, hash: string): string {
  if (![tenantId,actorId,requestId].every(v => UUID_PATTERN.test(v)) || !/^[0-9a-f]{16,64}$/.test(hash)) throw new Error("Invalid logo identity")
  return `${tenantId}/logos/${actorId}/${requestId}/logo-${hash.slice(0,16)}.png`
}
export function validTenantLogoPath(path: unknown, tenantId: string): path is string {
  if (typeof path !== "string" || !UUID_PATTERN.test(tenantId) || !path.startsWith(`${tenantId}/`)) return false
  const rest = path.slice(tenantId.length + 1)
  if (/^logo-[0-9a-f]{16}\.png$/.test(rest)) return true
  const parts = rest.split("/")
  return parts.length === 4 && parts[0] === "logos" && UUID_PATTERN.test(parts[1]) && UUID_PATTERN.test(parts[2]) && /^logo-[0-9a-f]{16}\.png$/.test(parts[3])
}
/** Only configured Storage URLs are read; arbitrary URLs are never fetched. */
export function tenantLogoObjectPath(logoUrl: string | null | undefined, tenantId: string, configuredOrigin?: string): string | null {
  if (!logoUrl || /%|\\|\/\.{1,2}(?:\/|$)/.test(logoUrl)) return null
  try {
    const url = new URL(logoUrl)
    if (url.username || url.password || url.search || url.hash) return null
    if (configuredOrigin ? url.origin !== new URL(configuredOrigin).origin : url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) return null
    const marker = `/storage/v1/object/public/${COMPANY_ASSETS_BUCKET}/`
    if (!url.pathname.startsWith(marker) || /%/.test(url.pathname)) return null
    const path = url.pathname.slice(marker.length)
    return validTenantLogoPath(path,tenantId) ? path : null
  } catch { return null }
}
