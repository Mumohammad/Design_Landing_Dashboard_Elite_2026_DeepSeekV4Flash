import "server-only"

// Tenant logo pipeline: validate → normalise (sharp → PNG ≤512px, metadata
// stripped) → store in the public company-assets bucket under the tenant's
// folder → point tenants.logo_url at it. Invoices embed the stored PNG as a
// data URL (never fetched from arbitrary URLs).

import { createHash } from "crypto"
import sharp from "sharp"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  COMPANY_ASSETS_BUCKET,
  LOGO_MAX_EDGE,
  detectLogoFormat,
  tenantLogoObjectPath,
  tenantLogoPath,
} from "./logo-core"

export class LogoValidationError extends Error {}

/** Normalise an uploaded image to a square-bounded PNG. Rejects non-images. */
export async function normalizeLogo(bytes: Uint8Array): Promise<Buffer> {
  if (!detectLogoFormat(bytes)) {
    throw new LogoValidationError("Logo must be a PNG, JPEG, or WebP image.")
  }
  try {
    return await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer()
  } catch {
    throw new LogoValidationError("The logo image could not be read. Try another PNG or JPEG file.")
  }
}

/**
 * Store a normalised logo for the tenant and update tenants.logo_url.
 * Older logo objects in the tenant folder are removed best-effort.
 * Must be called with the service-role client after authorization.
 */
export async function storeTenantLogo(admin: SupabaseClient, tenantId: string, bytes: Uint8Array): Promise<string> {
  const png = await normalizeLogo(bytes)
  const hash = createHash("sha256").update(png).digest("hex")
  const objectPath = tenantLogoPath(tenantId, hash)
  const bucket = admin.storage.from(COMPANY_ASSETS_BUCKET)
  const { error: uploadError } = await bucket.upload(objectPath, png, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "31536000",
  })
  if (uploadError) throw new Error("Unable to store the logo. Try again.")
  const publicUrl = bucket.getPublicUrl(objectPath).data.publicUrl
  const { error: updateError } = await admin.from("tenants").update({ logo_url: publicUrl }).eq("id", tenantId)
  if (updateError) throw new Error("Unable to save the logo. Try again.")
  await removeOtherLogos(admin, tenantId, objectPath)
  return publicUrl
}

/** Clear the tenant logo (row + stored objects). */
export async function clearTenantLogo(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await admin.from("tenants").update({ logo_url: null }).eq("id", tenantId)
  if (error) throw new Error("Unable to remove the logo. Try again.")
  await removeOtherLogos(admin, tenantId, null)
}

async function removeOtherLogos(admin: SupabaseClient, tenantId: string, keep: string | null) {
  const bucket = admin.storage.from(COMPANY_ASSETS_BUCKET)
  const { data } = await bucket.list(tenantId, { limit: 100, search: "logo-" })
  const stale = (data ?? [])
    .map((o) => `${tenantId}/${o.name}`)
    .filter((p) => p !== keep && /\/logo-[0-9a-f]{16}\.png$/.test(p))
  if (stale.length) await bucket.remove(stale)
}

/**
 * PNG data URL of the tenant's stored logo for PDF/print embedding, or null
 * when the tenant has no uploaded logo (legacy external URLs are ignored).
 */
export async function loadTenantLogoDataUrl(
  admin: SupabaseClient,
  tenantId: string,
  logoUrl: string | null | undefined,
): Promise<string | null> {
  const objectPath = tenantLogoObjectPath(logoUrl, tenantId)
  if (!objectPath) return null
  const { data, error } = await admin.storage.from(COMPANY_ASSETS_BUCKET).download(objectPath)
  if (error || !data) return null
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (detectLogoFormat(bytes) !== "png") return null
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
}
