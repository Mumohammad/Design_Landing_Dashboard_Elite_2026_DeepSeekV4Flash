"use server"

// Driver Applications — Admin Review Server Actions.
//
// - reviewApplication   hr:approve → update status + reviewed_by/note, audit
// - getDocumentDownloadUrl  hr:read → signed URL for a private document
//
// All reads in the UI go through the tenant-scoped RLS staff SELECT policies
// from migration 029; decisions use the caller-bound review transaction.

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { mutateApplicationReview } from "./review-actions"
import type { ApplicationStatus } from "@/types/applications"

export async function reviewApplication(input: {applicationId:string;expectedVersion:number;status:ApplicationStatus;note?:string|null}) {
 return mutateApplicationReview({applicationId:input.applicationId,expectedVersion:input.expectedVersion,action:input.status,reason:input.note})
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

    // Read-only — rate limit is lighter here (60/min per user).
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
  } catch {
    return { error: "Could not generate a download link." }
  }
}
