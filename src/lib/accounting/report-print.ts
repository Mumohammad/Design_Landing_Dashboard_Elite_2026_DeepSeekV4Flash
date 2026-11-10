import { printDocument } from "@/lib/print-document"

export type ReportPrintResult = "opened" | "blocked" | "failed"

/** Invoke directly from the user's click, before any await in the caller.
 * A successful result means a preview was prepared for printing, not that a
 * physical print or a save completed. The generator returns escaped app HTML. */
export async function printReportFromGesture(
  generate: () => Promise<{ success: boolean; html?: string }>,
): Promise<ReportPrintResult> {
  let preview: Window | null
  try { preview = window.open("", "_blank") } catch { return "blocked" }
  if (!preview) return "blocked"
  let opened = false
  try {
    preview.opener = null
    const result = await generate()
    if (!result.success || !result.html || preview.closed) return "failed"
    await printDocument(preview, result.html)
    opened = true
    return "opened"
  } catch {
    return "failed"
  } finally {
    if (!opened && !preview.closed) { try { preview.close() } catch { /* Keep failed result even if the browser refuses close. */ } }
  }
}
