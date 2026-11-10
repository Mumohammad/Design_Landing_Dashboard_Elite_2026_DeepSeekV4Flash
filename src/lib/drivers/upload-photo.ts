"use client"
// Shared client flow: validate → upload to the driver-photos bucket → persist
// the pointer via the evidence RPC. Used by the profile header and the
// create-driver form so both behave identically.
import { createClient } from "@/lib/supabase/client"
import { updateDriverPhoto } from "@/app/actions/drivers/driver-photo"
import { DRIVER_PHOTO_BUCKET, DRIVER_PHOTO_MAX_BYTES, driverPhotoImageMeta, driverPhotoPath, driverPhotoTenantId } from "@/lib/drivers/photo"

export type PhotoUploadResult =
  | { ok: true; filePath: string; profileVersion: number }
  | { ok: false; error: string; errorAr: string }

export function validateDriverPhoto(file: File): { ok: true; contentType: string } | { ok: false; error: string; errorAr: string } {
  const meta = driverPhotoImageMeta(file)
  if (!meta.ok) return { ok: false, error: "Only image files are allowed (JPG/PNG/WebP/GIF/AVIF/HEIC — max 5MB)", errorAr: "يسمح بالصور فقط (JPG/PNG/WebP/GIF/AVIF/HEIC — الحد الأقصى 5MB)" }
  if (file.size > DRIVER_PHOTO_MAX_BYTES) return { ok: false, error: "Image is too large (max 5MB)", errorAr: "الصورة كبيرة جدًا (الحد الأقصى 5MB)" }
  return { ok: true, contentType: meta.contentType }
}

export async function uploadDriverPhoto(driver: { id: string; tenant_id?: string | null; profile_version: number }, file: File): Promise<PhotoUploadResult> {
  const valid = validateDriverPhoto(file)
  if (!valid.ok) return valid
  const supabase = createClient()
  let tenantId = driverPhotoTenantId(driver)
  if (!tenantId) {
    const { data } = await supabase.from("drivers").select("tenant_id").eq("id", driver.id).maybeSingle()
    tenantId = (data?.tenant_id as string | undefined) ?? ""
  }
  if (!tenantId) {
    const { data: { session } } = await supabase.auth.getSession()
    tenantId = driverPhotoTenantId({}, session?.user?.user_metadata?.tenant_id as string | undefined)
  }
  if (!tenantId) return { ok: false, error: "Could not resolve the company for this driver.", errorAr: "تعذر تحديد الشركة لهذا السائق." }
  const path = driverPhotoPath(tenantId, driver.id, file.name)
  const { error: uploadError } = await supabase.storage.from(DRIVER_PHOTO_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false, contentType: valid.contentType })
  if (uploadError) return { ok: false, error: `Photo upload failed: ${uploadError.message}`, errorAr: `فشل رفع الصورة: ${uploadError.message}` }
  const result = await updateDriverPhoto({ driverId: driver.id, expectedDriverVersion: driver.profile_version, filePath: path, contentType: valid.contentType, size: file.size })
  if (!result.ok) return result
  return { ok: true, filePath: result.filePath ?? path, profileVersion: result.profileVersion }
}
