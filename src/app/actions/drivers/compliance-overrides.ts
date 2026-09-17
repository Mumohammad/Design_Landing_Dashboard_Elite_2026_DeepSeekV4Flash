"use server"

import { z } from "zod"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

// Roles allowed to approve/revoke compliance overrides (002_enums.sql user_role).
// operations_officer can edit driver records but cannot self-approve overrides.
const APPROVER_ROLES = new Set(["general_manager", "admin", "supervisor"])

const createSchema = z.object({
  driverId: z.string().uuid(),
  requirement: z.enum([
    "identity",
    "driving_license",
    "health_certificate",
    "home_delivery_permit",
    "ajeer_permit",
  ]),
  reason: z.string().trim().min(5).max(500),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  attachmentUrl: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === "" || /^https?:\/\//.test(v))
    .optional(),
})

const revokeSchema = z.object({ overrideId: z.string().uuid() })

type Result = { ok: true } | { ok: false; error: string }

async function requireApprover() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" } as const

  const { data: me } = await supabase
    .from("users")
    .select("id, tenant_id, role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (!me || me.status !== "active" || !APPROVER_ROLES.has(me.role)) {
    return { error: "Not authorized to manage compliance overrides" } as const
  }
  return { supabase, user, me } as const
}

async function recompute(driverId: string) {
  const admin = createAdminClient()
  const { error } = await admin.rpc("compute_driver_compliance", { p_driver_id: driverId })
  if (error) {
    logger.error({ err: error, driverId }, "compute_driver_compliance failed after override change")
  }
}

export async function createComplianceOverride(input: unknown): Promise<Result> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireApprover()
  if ("error" in auth) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { driverId, requirement, reason, days, attachmentUrl } = parsed.data

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id")
    .eq("id", driverId)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }

  const { data: existing } = await supabase
    .from("driver_compliance_overrides")
    .select("id")
    .eq("driver_id", driverId)
    .eq("requirement", requirement)
    .is("revoked_at", null)
    .is("deleted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (existing) {
    return { ok: false, error: "An active override already exists for this requirement" }
  }

  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
  const { data: inserted, error } = await supabase
    .from("driver_compliance_overrides")
    .insert({
      tenant_id: driver.tenant_id,
      driver_id: driverId,
      requirement,
      reason,
      attachment_url: attachmentUrl ? attachmentUrl : null,
      approved_by: user.id,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !inserted) {
    logger.error({ err: error, driverId, requirement }, "failed to insert compliance override")
    return { ok: false, error: "Failed to save override" }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: driver.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_compliance_override",
    entity_id: inserted.id,
    action: "override_created",
    new_values: { driver_id: driverId, requirement, reason, expires_at: expiresAt },
  })
  if (auditError) {
    logger.error({ err: auditError, overrideId: inserted.id }, "override audit insert failed")
  }

  await recompute(driverId)
  return { ok: true }
}

export async function revokeComplianceOverride(input: unknown): Promise<Result> {
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireApprover()
  if ("error" in auth) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { overrideId } = parsed.data

  const { data: override } = await supabase
    .from("driver_compliance_overrides")
    .select("id, tenant_id, driver_id, requirement, reason, expires_at, revoked_at")
    .eq("id", overrideId)
    .maybeSingle()

  if (!override || override.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Override not found" }
  }
  if (override.revoked_at) return { ok: false, error: "Override already revoked" }

  const { error } = await supabase
    .from("driver_compliance_overrides")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", overrideId)

  if (error) {
    logger.error({ err: error, overrideId }, "failed to revoke compliance override")
    return { ok: false, error: "Failed to revoke override" }
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: override.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_compliance_override",
    entity_id: override.id,
    action: "override_revoked",
    old_values: {
      requirement: override.requirement,
      reason: override.reason,
      expires_at: override.expires_at,
    },
  })
  if (auditError) {
    logger.error({ err: auditError, overrideId: override.id }, "override revoke audit insert failed")
  }

  await recompute(override.driver_id)
  return { ok: true }
}
