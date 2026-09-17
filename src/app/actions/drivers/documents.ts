"use server"

import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

// Register/remove: operational staff. Verify: approval roles only.
const DOCUMENT_ROLES = new Set(["general_manager", "admin", "supervisor", "operations_officer"])
const VERIFIER_ROLES = new Set(["general_manager", "admin", "supervisor"])

const MAX_FILE_BYTES = 20 * 1024 * 1024 // matches driver-documents bucket limit (011_storage_buckets.sql)

const registerSchema = z.object({
  driverId: z.string().uuid(),
  docType: z.enum(["national_id", "iqama", "health_certificate", "home_delivery_permit", "ajeer_permit"]),
  filePath: z.string().trim().min(5).max(500),
  docNumber: z.string().trim().max(100).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  issuingAuthority: z.string().trim().max(200).optional(),
  fileSize: z.number().int().positive().max(MAX_FILE_BYTES).optional(),
  mimeType: z.string().trim().max(100).optional(),
})

const idSchema = z.object({ documentId: z.string().uuid() })

type Result = { ok: true } | { ok: false; error: string }

async function requireRole(roles: Set<string>, action: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not authenticated" }

  const { data: me } = await supabase
    .from("users")
    .select("id, tenant_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (!me || me.status !== "active" || !roles.has(me.role)) {
    return { ok: false as const, error: `Not authorized to ${action}` }
  }
  return { ok: true as const, supabase, user, me }
}

async function recompute(driverId: string) {
  const admin = createAdminClient()
  const { error } = await admin.rpc("compute_driver_compliance", { p_driver_id: driverId })
  if (error) {
    logger.error({ err: error, driverId }, "compute_driver_compliance failed after document change")
  }
}

export async function registerDriverDocument(input: unknown): Promise<Result> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(DOCUMENT_ROLES, "upload driver documents")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { driverId, docType, filePath, docNumber, expiryDate, issuingAuthority, fileSize, mimeType } = parsed.data

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id")
    .eq("id", driverId)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }

  // The storage object must live under this tenant's folder for this driver
  // (storage RLS, 011_storage_buckets.sql).
  if (!filePath.startsWith(`${driver.tenant_id}/${driverId}/`)) {
    return { ok: false, error: "Invalid file path" }
  }

  const { data: inserted, error } = await supabase
    .from("driver_documents")
    .insert({
      tenant_id: driver.tenant_id,
      driver_id: driverId,
      doc_type: docType,
      doc_number: docNumber ?? null,
      expiry_date: expiryDate ?? null,
      issuing_authority: issuingAuthority ?? null,
      file_url: filePath,
      file_size_bytes: fileSize ?? null,
      mime_type: mimeType ?? null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !inserted) {
    logger.error({ err: error, driverId, docType }, "failed to register driver document")
    return { ok: false, error: "Failed to save document" }
  }

  // The engine reads the latest active row per doc_type: retire predecessors.
  const { error: retireError } = await supabase
    .from("driver_documents")
    .update({ is_active: false, updated_by: user.id })
    .eq("driver_id", driverId)
    .eq("doc_type", docType)
    .eq("is_active", true)
    .is("deleted_at", null)
    .neq("id", inserted.id)
  if (retireError) {
    logger.error({ err: retireError, documentId: inserted.id }, "failed to retire previous documents")
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: driver.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_document",
    entity_id: inserted.id,
    action: "document_uploaded",
    new_values: { driver_id: driverId, doc_type: docType, file_url: filePath, expiry_date: expiryDate ?? null },
  })
  if (auditError) {
    logger.error({ err: auditError, documentId: inserted.id }, "document audit insert failed")
  }

  await recompute(driverId)
  return { ok: true }
}

export async function verifyDriverDocument(input: unknown): Promise<Result> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(VERIFIER_ROLES, "verify driver documents")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { documentId } = parsed.data

  const { data: doc } = await supabase
    .from("driver_documents")
    .select("id, tenant_id, driver_id, doc_type, is_verified")
    .eq("id", documentId)
    .maybeSingle()
  if (!doc || doc.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Document not found" }
  }
  if (doc.is_verified) return { ok: true }

  const { error } = await supabase
    .from("driver_documents")
    .update({ is_verified: true, verified_by: user.id, verified_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", documentId)
  if (error) {
    logger.error({ err: error, documentId }, "failed to verify driver document")
    return { ok: false, error: "Failed to verify document" }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: doc.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_document",
    entity_id: doc.id,
    action: "document_verified",
    new_values: { driver_id: doc.driver_id, doc_type: doc.doc_type },
  })
  if (auditError) {
    logger.error({ err: auditError, documentId: doc.id }, "document verify audit insert failed")
  }

  await recompute(doc.driver_id)
  return { ok: true }
}

export async function removeDriverDocument(input: unknown): Promise<Result> {
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(DOCUMENT_ROLES, "remove driver documents")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { documentId } = parsed.data

  const { data: doc } = await supabase
    .from("driver_documents")
    .select("id, tenant_id, driver_id, doc_type, file_url")
    .eq("id", documentId)
    .maybeSingle()
  if (!doc || doc.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Document not found" }
  }

  const { error } = await supabase
    .from("driver_documents")
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", documentId)
  if (error) {
    logger.error({ err: error, documentId }, "failed to remove driver document")
    return { ok: false, error: "Failed to remove document" }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: doc.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_document",
    entity_id: doc.id,
    action: "document_removed",
    old_values: { driver_id: doc.driver_id, doc_type: doc.doc_type, file_url: doc.file_url },
  })
  if (auditError) {
    logger.error({ err: auditError, documentId: doc.id }, "document remove audit insert failed")
  }

  await recompute(doc.driver_id)
  return { ok: true }
}
