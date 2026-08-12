"use server"

// Reports Server Action — v2.0 M7 async generation worker.
//
// The flow mirrors the report_generation_log job queue:
//   1. requirePermission("reports", "export") + rate limit (10/hour)
//   2. insert a row with status 'generating'
//   3. collect rows (service-role), serialize to CSV, upload to the
//      `generated-reports` storage bucket under <tenant_id>/
//   4. mark the row 'completed' with file_url/file_name/file_size_bytes
//   5. on failure mark the row 'failed' with error_message
//
// Generation is synchronous inside the action (fine for fleet-scale data);
// the queue table still records every job for future background workers.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitReports } from "@/lib/auth/rate-limit"
import { writeAuditLog } from "@/lib/auth/sessions"
import { collectReportData, buildCsv, type ReportType } from "./generator"

type ActionResult = { success: boolean; error?: string; reportId?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

export async function generateReportAction(
  reportType: ReportType,
  params?: Record<string, unknown>
): Promise<ActionResult> {
  try {
    await requirePermission("reports", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const limit = await rateLimitReports(currentUser.id)
    if (!limit.success) {
      return { success: false, error: "Rate limit exceeded (10 reports/hour). Try again later." }
    }

    const admin = createAdminClient()
    const safeParams = params ?? {}

    // 1. Queue the job
    const { data: logRow, error: insErr } = await admin
      .from("report_generation_log")
      .insert({
        tenant_id: currentUser.tenantId,
        report_type: reportType,
        report_params: safeParams,
        output_format: "csv",
        generated_by: currentUser.id,
        status: "generating",
      })
      .select("id")
      .single()

    if (insErr || !logRow) {
      return { success: false, error: insErr?.message ?? "Failed to queue report." }
    }
    const reportId = logRow.id

    try {
      // 2. Collect + serialize
      const output = await collectReportData(admin, currentUser.tenantId, reportType, safeParams)
      const content = buildCsv(output.headers, output.rows)
      const fileName = output.filename
      const filePath = `${currentUser.tenantId}/${fileName}`

      // 3. Upload to the generated-reports bucket
      const { error: upErr } = await admin.storage
        .from("generated-reports")
        .upload(filePath, content, { contentType: "text/csv", upsert: true })
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`)

      // 4. Mark completed
      const { error: updErr } = await admin
        .from("report_generation_log")
        .update({
          status: "completed",
          file_url: filePath,
          file_name: fileName,
          file_size_bytes: Buffer.byteLength(content, "utf8"),
          error_message: null,
        })
        .eq("id", reportId)
      if (updErr) throw new Error(updErr.message)

      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.id,
        module: "reports",
        action: "report_generated",
        entityType: "report_generation_log",
        entityId: reportId,
        newValues: { report_type: reportType, file_name: fileName, rows: output.rows.length },
      })

      return { success: true, reportId }
    } catch (e) {
      const msg = errorMessage(e)
      await admin
        .from("report_generation_log")
        .update({ status: "failed", error_message: msg })
        .eq("id", reportId)
      return { success: false, error: msg }
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
