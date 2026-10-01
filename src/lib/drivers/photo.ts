/**
 * Driver photo — single source of truth.
 *
 * drivers.photo_url stores the STORAGE OBJECT PATH inside the "driver-photos"
 * bucket (e.g. "<tenant_id>/<driver_id>/photo-1727...-portrait.jpg"), never a
 * signed URL. Display surfaces resolve a short-lived signed URL via
 * DriverPhotoProvider (photo-provider.tsx). Legacy rows that hold a full
 * http(s) URL keep rendering directly.
 */
export const DRIVER_PHOTO_BUCKET = "driver-photos"

/**
 * Hard limit enforced by the driver-photos storage bucket (5 MiB).
 * Client checks must match this or Supabase rejects the upload with a
 * generic "payload too large" error.
 */
export const DRIVER_PHOTO_MAX_BYTES = 5 * 1024 * 1024

/**
 * Bucket-level allowed MIME types (storage.buckets.allowed_mime_types on
 * driver-photos). SVG is deliberately excluded — it can carry active content
 * and is rendered inline by the app.
 */
export const DRIVER_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
])

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
}

export type ImageMeta = { ok: true; contentType: string } | { ok: false }

/**
 * Resolve the effective MIME type for an image File, falling back to the
 * extension when the browser reports an empty type (common for .heic/.avif
 * picks on Windows/Android). Returns ok:false for anything that is not an
 * image the bucket accepts.
 */
export function driverPhotoImageMeta(file: File): ImageMeta {
  const type = (file.type ?? "").toLowerCase()
  if (type === "image/svg+xml" || type === "image/svg") return { ok: false }
  if (DRIVER_PHOTO_MIME_TYPES.has(type)) return { ok: true, contentType: type }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "svg" || ext === "svgz") return { ok: false }
  const mime = EXT_MIME[ext]
  if (mime && DRIVER_PHOTO_MIME_TYPES.has(mime)) return { ok: true, contentType: mime }

  return { ok: false }
}

/**
 * Resolve the tenant folder for a photo upload path. The DRIVER row is the
 * single source of truth; the session's user_metadata.tenant_id is only a
 * fallback because it is not guaranteed to exist on every account (prod
 * users created before metadata backfills have none — relying on it made
 * profile-header uploads fail while the compliance-engine surface worked).
 */
export function driverPhotoTenantId(
  driver: { tenant_id?: string | null },
  sessionTenantId?: string | null,
): string {
  if (typeof driver.tenant_id === "string" && driver.tenant_id !== "") {
    return driver.tenant_id
  }
  return sessionTenantId ?? ""
}

/** Strips everything that could break the object path (slashes, "..", unicode). */
export function driverPhotoSafeName(name: string): string {
  const cleaned = name
    .replace(/[^\w.\-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .toLowerCase()
  return cleaned.length > 0 ? cleaned : "image.jpg"
}

/** "<tenant>/<driver>/photo-<ts>-<name>" — matches the server-side prefix check. */
export function driverPhotoPath(tenantId: string, driverId: string, fileName: string): string {
  return `${tenantId}/${driverId}/photo-${Date.now()}-${driverPhotoSafeName(fileName)}`
}

/**
 * Server-side validation mirrored by updateDriverPhoto: the path must sit
 * inside this driver's tenant/driver prefix and never traverse upward.
 */
export function isDriverPhotoPathValid(
  filePath: string,
  tenantId: string,
  driverId: string,
): boolean {
  const prefix = `${tenantId}/${driverId}/photo-`
  return filePath.startsWith(prefix) && !filePath.includes("..")
}

/**
 * True when the stored value is a raw object path (bucket-managed, can be
 * deleted). Legacy rows holding a full http(s) URL return false.
 */
export function isDriverPhotoObjectPath(photoUrl: string | null | undefined): photoUrl is string {
  return typeof photoUrl === "string" && photoUrl.trim() !== "" && !/^https?:\/\//i.test(photoUrl)
}
