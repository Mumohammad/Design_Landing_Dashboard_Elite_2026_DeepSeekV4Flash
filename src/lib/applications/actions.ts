"use server"

// Driver Applications — Admin Review Server Actions.
//
// - reviewApplication   hr:approve → update status + reviewed_by/note, audit
// - getDocumentDownloadUrl  hr:read → signed URL for a private document
//
// All reads in the UI go through the tenant-scoped RLS staff SELECT policies
// from migration 029; mutations go through the service-role admin client after
// a permission check. See docs/phase-2-auth-plan.md section 7.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import type { ApplicationStatus } from "@/types/applications"

type ActionResult = { success: boolean; error?: string }

const VALID_STATUSES: ApplicationStatus[] = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
]

export async function reviewApplication(input: {
  applicationId: string
  status: ApplicationStatus
  note?: string | null
}): Promise<ActionResult> {
  try {
    await requirePermission("hr", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    if (!VALID_STATUSES.includes(input.status)) {
      return { success: false, error: "Invalid application status." }
    }
    if (input.status === "submitted") {
      return { success: false, error: "Cannot move an application back to submitted." }
    }

    const admin = createAdminClient()

    // Load the current row first (for the audit trail + tenant scoping).
    const { data: app, error: fetchErr } = await admin
      .from("driver_applications")
      .select("id, tenant_id, status")
      .eq("id", input.applicationId)
      .maybeSingle()

    if (fetchErr || !app) {
      return { success: false, error: "Application not found." }
    }
    // Belt-and-braces tenant check: never allow cross-tenant status changes.
    if (app.tenant_id !== currentUser.tenantId) {
      return { success: false, error: "Application not found." }
    }

    const { error: updateErr } = await admin
      .from("driver_applications")
      .update({
        status: input.status,
        reviewed_by: currentUser.id,
        reviewed_at: new Date().toISOString(),
        review_note: input.note?.trim() || null,
      })
      .eq("id", app.id)
      .eq("tenant_id", currentUser.tenantId)

    if (updateErr) {
      return { success: false, error: updateErr.message }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "hr",
      action: "application_reviewed",
      entityType: "driver_applications",
      entityId: app.id,
      oldValues: { status: app.status },
      newValues: { status: input.status, note: input.note?.trim() || null },
    })

    return { success: true }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }
  }
}

/**
 * Generate a short-lived signed URL for a private application document.
 * Requires hr:read. The bucket is private (no anon SELECT), so files are only
 * reachable through these expiring URLs.
 */
export async function getDocumentDownloadUrl(
  documentId: string
): Promise<{ url?: string; error?: string }> {
  try {
    await requirePermission("hr", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { error: "Not authenticated." }

    const admin = createAdminClient()

    const { data: doc, error: fetchErr } = await admin
      .from("driver_application_documents")
      .select("id, tenant_id, application_id, storage_path, file_name, mime_type")
      .eq("id", documentId)
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle()

    if (fetchErr || !doc) {
      return { error: "Document not found." }
    }

    const { data, error: signedErr } = await admin.storage
      .from("driver-applications")
      .createSignedUrl(doc.storage_path, 300, {
        download: doc.file_name || undefined,
      })

    if (signedErr || !data?.signedUrl) {
      return { error: "Could not generate a download link." }
    }

    return { url: data.signedUrl }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error" }
  }
}
