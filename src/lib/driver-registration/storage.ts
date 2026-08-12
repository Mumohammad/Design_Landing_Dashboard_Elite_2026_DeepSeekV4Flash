"use client"

import { createClient } from "@/lib/supabase/client"

// ─────────────────────────────────────────────────────────────────────────────
// Client-side upload helper for the public driver registration.
// Files go to the PRIVATE `driver-applications` bucket under /drafts/{draftId}.
// The anon storage policy allows uploads into that path only — no reads.
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB

export type UploadErrorCode = "type" | "size" | "network" | "unknown"

export interface UploadedFile {
  path: string
  fileName: string
  mimeType: string
  size: number
}

export interface UploadOutcome {
  ok: boolean
  file?: UploadedFile
  error?: UploadErrorCode
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)
  const ext = base.includes(".") ? base.split(".").pop() : "bin"
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
}

export async function uploadApplicationFile(
  draftId: string,
  documentType: string,
  file: File
): Promise<UploadOutcome> {
  if (!ALLOWED_TYPES.includes(file.type)) return { ok: false, error: "type" }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "size" }

  const supabase = createClient()
  const fileName = sanitizeFileName(file.name)
  // Path-scoped to the applicant's own draft id (policy-required prefix).
  const path = `drafts/${draftId}/${documentType}/${fileName}`

  const { error } = await supabase.storage
    .from("driver-applications")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    })

  if (error) {
    return { ok: false, error: error.message.includes("duplicate") ? "unknown" : "network" }
  }

  return { ok: true, file: { path, fileName, mimeType: file.type, size: file.size } }
}

export function draftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
