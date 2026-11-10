import { createClient } from "@/lib/supabase/client"
import { authorizeApplicationUpload } from "./upload-actions"

// ── Upload constraints ──────────────────────────────────────────────────────
// Keep in sync with the storage RLS allowlist (migrations 059/060).
export const ALLOWED_TYPES: string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]
export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

export interface UploadedFile {
  path: string
  fileName: string
  mimeType: string
  size: number
}

// NOTE: keep the original "bag" shape (optional fields) rather than a
// discriminated union — callers access result.error/result.file after a
// combined `!result.ok || !result.file` guard, which only typechecks when
// both members are always present (optionally) on the type.
export interface UploadResult {
  ok: boolean
  file?: UploadedFile
  error?: "type" | "size" | "network" | "unknown"
}

// Upload grants are rate limited and bound to a server-issued HttpOnly draft cookie.
export async function uploadApplicationFile(
  draftId: string,
  documentType: string,
  file: File,
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, error: "type" }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "size" }

  const supabase = createClient()
  void draftId
  void documentType
  const grant = await authorizeApplicationUpload(file.type, file.size)
  if (!grant) return { ok: false, error: "network" }
  const { path, token } = grant
  const fileName = path.split("/").pop()!

  const { error } = await supabase.storage
    .from("driver-applications")
    .uploadToSignedUrl(path, token, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    })

  if (error) {
    // Surface the real rejection reason (RLS / missing bucket / size) in the
    // browser console — the UI message is deliberately generic.
    console.error("[registration] document upload failed:", error)
    return {
      ok: false,
      error: error.message.includes("duplicate") ? "unknown" : "network",
    }
  }

  return {
    ok: true,
    file: { path, fileName, mimeType: file.type, size: file.size },
  }
}
