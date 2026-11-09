import "server-only"
import { createHash } from "crypto"
import sharp from "sharp"
import type { SupabaseClient } from "@supabase/supabase-js"
import { COMPANY_ASSETS_BUCKET, LOGO_MAX_EDGE, LOGO_MAX_INPUT_BYTES, LOGO_MAX_STORED_BYTES, detectLogoFormat, stagedTenantLogoPath, tenantLogoObjectPath, validTenantLogoPath } from "./logo-core"

export class LogoValidationError extends Error {}
export async function normalizeLogo(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length || bytes.length > LOGO_MAX_INPUT_BYTES || !detectLogoFormat(bytes)) throw new LogoValidationError("Logo must be a bounded PNG, JPEG, or WebP image.")
  try {
    for (let edge = LOGO_MAX_EDGE; edge >= 64; edge = Math.floor(edge * .75)) {
      const png = await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000, animated: false }).rotate()
        .resize(edge,edge,{fit:"inside",withoutEnlargement:true}).png({compressionLevel:9}).toBuffer()
      if (png.length <= LOGO_MAX_STORED_BYTES) return png
    }
  } catch { throw new LogoValidationError("The logo image could not be read. Try another file.") }
  throw new LogoValidationError("The logo is too complex. Try a smaller image.")
}
/** Stage with the authenticated caller so Storage records auth.uid() as owner.
 * No overwrite or deletion: an unknown commit may already reference this PNG. */
export async function stageTenantLogo(caller: SupabaseClient, tenantId: string, actorId: string, requestId: string, png: Buffer): Promise<string> {
  const path = stagedTenantLogoPath(tenantId,actorId,requestId,createHash("sha256").update(png).digest("hex"))
  const bucket = caller.storage.from(COMPANY_ASSETS_BUCKET)
  const {error} = await bucket.upload(path,png,{contentType:"image/png",upsert:false,cacheControl:"31536000"})
  // The RPC independently verifies existence, owner, metadata and exact identity.
  if (error) {
    if (String((error as {statusCode?:string}).statusCode) !== "409") throw new Error("SETTINGS_UNAVAILABLE")
    const existing = await bucket.download(path)
    if (existing.error || !existing.data || existing.data.size !== png.length || existing.data.size > LOGO_MAX_STORED_BYTES) throw new Error("SETTINGS_UNAVAILABLE")
    if (!Buffer.from(await existing.data.arrayBuffer()).equals(png)) throw new Error("SETTINGS_UNAVAILABLE")
  }
  return path
}
export async function loadTenantLogoDataUrl(admin: SupabaseClient, tenantId: string, legacyLogoUrl: string | null | undefined, managedPath?: string | null): Promise<string | null> {
  try {
    const bucket = admin.storage.from(COMPANY_ASSETS_BUCKET)
    const origin = bucket.getPublicUrl(`${tenantId}/logo-0000000000000000.png`).data.publicUrl
    const path = managedPath != null ? (validTenantLogoPath(managedPath,tenantId) ? managedPath : null) : tenantLogoObjectPath(legacyLogoUrl,tenantId,origin)
    if (!path) return null
    const {data,error} = await bucket.download(path)
    if (error || !data || !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > LOGO_MAX_STORED_BYTES) return null
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (bytes.length !== data.size || detectLogoFormat(bytes) !== "png") return null
    const meta = await sharp(bytes,{limitInputPixels:LOGO_MAX_EDGE * LOGO_MAX_EDGE,animated:false}).metadata()
    if (!meta.width || !meta.height || meta.width > LOGO_MAX_EDGE || meta.height > LOGO_MAX_EDGE || (meta.pages ?? 1) > 1) return null
    const png = await normalizeLogo(bytes)
    return `data:image/png;base64,${png.toString("base64")}`
  } catch { return null }
}
