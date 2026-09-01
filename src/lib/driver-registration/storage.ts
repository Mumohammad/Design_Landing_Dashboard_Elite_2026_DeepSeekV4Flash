import { createClient } from "@/lib/supabase/client"

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Anonymous draft upload ──────────────────────────────────────────────────
// Storage RLS allows anonymous inserts ONLY under driver-applications/drafts/
// with UUID-format names. The previous path shape (drafts/<react useId>/<type>/
// <timestamp>-<rand>.<ext>) violated that policy, so every upload was rejected
// before the wizard could continue. Both path segments are now real UUIDs.
export async function uploadApplicationFile(
  draftId: string,
  documentType: string,
  file: File,
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, error: "type" }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "size" }

  const supabase = createClient()
  const rawExt = file.name.includes(".") ? file.name.split(".").pop() ?? "" : ""
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin"
  const safeDraftId = UUID_RE.test(draftId) ? draftId : crypto.randomUUID()
  // documentType stays in the signature for callers; the stored path is kept
  // flat (drafts/<uuid>/<uuid>.<ext>) to match the storage policy exactly.
  void documentType
  const fileName = `${crypto.randomUUID()}.${ext}`
  const path = `drafts/${safeDraftId}/${fileName}`

  const { error } = await supabase.storage
    .from("driver-applications")
    .upload(path, file, {
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
