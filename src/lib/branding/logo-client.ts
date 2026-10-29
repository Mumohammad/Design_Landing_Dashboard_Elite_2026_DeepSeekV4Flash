"use client"

// Browser-side logo preparation: accept PNG/JPEG/WebP up to 5 MB, downscale to
// ≤512 px on a canvas and return a PNG data URL (keeps the request small).
// The server re-validates and re-encodes; this is only a UX/bandwidth step.

export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp"
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 512

export type LogoPrepError = "type" | "size" | "decode"

export async function prepareLogoFile(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: LogoPrepError }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return { ok: false, error: "type" }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "size" }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return { ok: false, error: "decode" }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return { ok: true, dataUrl: canvas.toDataURL("image/png") }
  } catch {
    return { ok: false, error: "decode" }
  }
}

export function logoPrepMessage(error: LogoPrepError, ar: boolean): string {
  if (error === "type") return ar ? "الشعار يجب أن يكون صورة PNG أو JPEG أو WebP." : "Logo must be a PNG, JPEG, or WebP image."
  if (error === "size") return ar ? "حجم الشعار يجب ألا يتجاوز 5 ميجابايت." : "Logo must be 5 MB or smaller."
  return ar ? "تعذر قراءة الصورة. جرّب ملفاً آخر." : "The image could not be read. Try another file."
}
