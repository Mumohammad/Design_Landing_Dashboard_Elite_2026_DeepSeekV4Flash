"use server"

import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

// Issue/print: operational staff. Revoke: approval roles only.
const ISSUE_ROLES = new Set(["general_manager", "admin", "supervisor", "operations_officer"])
const REVOKE_ROLES = new Set(["general_manager", "admin", "supervisor"])

const issueSchema = z.object({ driverId: z.string().uuid() })
const revokeSchema = z.object({
  cardId: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
})
const printSchema = z.object({
  cardId: z.string().uuid(),
  format: z.enum(["pvc", "a4", "screen"]),
  batchRef: z.string().trim().max(100).optional(),
})

type Result = { ok: true; serial?: string } | { ok: false; error: string }

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
    logger.error({ err: error, driverId }, "compute_driver_compliance failed after card change")
  }
}

function makeSerial(): string {
  return `EL-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export async function issueDriverCard(input: unknown): Promise<Result> {
  const parsed = issueSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(ISSUE_ROLES, "issue driver cards")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { driverId } = parsed.data

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, tenant_id, status")
    .eq("id", driverId)
    .maybeSingle()
  if (!driver || driver.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Driver not found" }
  }
  if (["terminated", "blacklisted", "suspended"].includes(driver.status)) {
    return { ok: false, error: `Cannot issue a card while the driver is ${driver.status}` }
  }

  const { data: existing } = await supabase
    .from("driver_cards")
    .select("id")
    .eq("driver_id", driverId)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle()
  if (existing) {
    return { ok: false, error: "An active card already exists for this driver" }
  }

  const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString()

  // card_serial is globally UNIQUE: retry on the rare collision.
  let inserted: { id: string; card_serial: string } | null = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const { data, error } = await supabase
      .from("driver_cards")
      .insert({
        tenant_id: driver.tenant_id,
        driver_id: driverId,
        card_serial: makeSerial(),
        status: "active",
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select("id, card_serial")
      .single()
    if (!error && data) {
      inserted = data
    } else {
      lastError = error
    }
  }
  if (!inserted) {
    logger.error({ err: lastError, driverId }, "failed to issue driver card")
    return { ok: false, error: "Failed to issue card" }
  }

  const { error: syncError } = await supabase
    .from("drivers")
    .update({ card_status: "active", updated_by: user.id })
    .eq("id", driverId)
  if (syncError) {
    logger.error({ err: syncError, driverId }, "failed to sync drivers.card_status after issue")
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: driver.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_card",
    entity_id: inserted.id,
    action: "card_issued",
    new_values: { driver_id: driverId, card_serial: inserted.card_serial, expires_at: expiresAt },
  })
  if (auditError) {
    logger.error({ err: auditError, cardId: inserted.id }, "card issue audit insert failed")
  }

  await recompute(driverId)
  return { ok: true, serial: inserted.card_serial }
}

export async function revokeDriverCard(input: unknown): Promise<Result> {
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(REVOKE_ROLES, "revoke driver cards")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { cardId, reason } = parsed.data

  const { data: card } = await supabase
    .from("driver_cards")
    .select("id, tenant_id, driver_id, card_serial, status")
    .eq("id", cardId)
    .maybeSingle()
  if (!card || card.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Card not found" }
  }
  if (card.status !== "active") {
    return { ok: false, error: "Only an active card can be revoked" }
  }

  const { error } = await supabase
    .from("driver_cards")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoke_reason: reason, updated_by: user.id })
    .eq("id", cardId)
  if (error) {
    logger.error({ err: error, cardId }, "failed to revoke driver card")
    return { ok: false, error: "Failed to revoke card" }
  }

  const { error: syncError } = await supabase
    .from("drivers")
    .update({ card_status: "revoked", updated_by: user.id })
    .eq("id", card.driver_id)
  if (syncError) {
    logger.error({ err: syncError, driverId: card.driver_id }, "failed to sync drivers.card_status after revoke")
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: card.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_card",
    entity_id: card.id,
    action: "card_revoked",
    old_values: { card_serial: card.card_serial, status: "active" },
    new_values: { reason },
  })
  if (auditError) {
    logger.error({ err: auditError, cardId: card.id }, "card revoke audit insert failed")
  }

  await recompute(card.driver_id)
  return { ok: true }
}

export async function recordCardPrint(input: unknown): Promise<Result> {
  const parsed = printSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input" }

  const auth = await requireRole(ISSUE_ROLES, "record card prints")
  if (!auth.ok) return { ok: false, error: auth.error }
  const { supabase, user, me } = auth
  const { cardId, format, batchRef } = parsed.data

  const { data: card } = await supabase
    .from("driver_cards")
    .select("id, tenant_id, driver_id, card_serial, status, reprint_count")
    .eq("id", cardId)
    .maybeSingle()
  if (!card || card.tenant_id !== me.tenant_id) {
    return { ok: false, error: "Card not found" }
  }
  if (card.status !== "active") {
    return { ok: false, error: "Only an active card can be printed" }
  }

  const { error: printError } = await supabase.from("driver_card_prints").insert({
    tenant_id: card.tenant_id,
    card_id: cardId,
    printed_by: user.id,
    format,
    batch_ref: batchRef ?? null,
  })
  if (printError) {
    logger.error({ err: printError, cardId }, "failed to record card print")
    return { ok: false, error: "Failed to record print" }
  }

  const { error: countError } = await supabase
    .from("driver_cards")
    .update({ reprint_count: (card.reprint_count ?? 0) + 1, updated_by: user.id })
    .eq("id", cardId)
  if (countError) {
    logger.error({ err: countError, cardId }, "failed to increment reprint_count")
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    tenant_id: card.tenant_id,
    actor_id: user.id,
    module: "drivers",
    entity_type: "driver_card",
    entity_id: card.id,
    action: "card_printed",
    new_values: { card_serial: card.card_serial, format },
  })
  if (auditError) {
    logger.error({ err: auditError, cardId: card.id }, "card print audit insert failed")
  }

  return { ok: true }
}
