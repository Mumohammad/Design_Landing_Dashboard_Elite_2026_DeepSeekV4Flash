"use server"

// Server Actions for the /settings/* module pages.
//
// - updateCompanyProfile  — settings.manage → updates the tenant row
// - updateSystemSettings  — settings.manage → updates system_settings rows
//
// Every mutation writes an immutable audit_log entry (ADR-007) via the
// service-role admin client. Authorization is enforced server-side with
// requirePermission() — UI hiding is never the boundary.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitSettings } from "@/lib/auth/rate-limit"

type ActionResult = { success: boolean; error?: string }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

export interface CompanyProfileInput {
  name_ar: string
  name_en: string
  legal_name?: string | null
  cr_number?: string | null
  vat_number?: string | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  logo_url?: string | null
  timezone?: string | null
  default_locale?: string | null
}

/**
 * Update the current tenant's company profile. GM / settings.manage only.
 * Writes an audit_log entry with the new values (no sensitive fields here —
 * CR/VAT/contact are company data, safe to log).
 */
export async function updateCompanyProfile(
  input: CompanyProfileInput
): Promise<ActionResult> {
  try {
    await requirePermission("settings", "manage")
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { error } = await admin
      .from("tenants")
      .update({
        name_ar: input.name_ar,
        name_en: input.name_en,
        legal_name: input.legal_name ?? null,
        cr_number: input.cr_number ?? null,
        vat_number: input.vat_number ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        country: input.country ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        logo_url: input.logo_url ?? null,
        timezone: input.timezone ?? null,
        default_locale: input.default_locale ?? null,
      })
      .eq("id", currentUser.tenantId)
      .is("deleted_at", null)

    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "settings",
      action: "updated",
      entityType: "tenant",
      entityId: currentUser.tenantId,
      newValues: { ...input },
    })

    revalidatePath("/settings/company")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Batch-update system_settings values (e.g. the payroll defaults form).
 * GM / settings.manage only. Each key/value pair is upserted for the current
 * tenant (idempotent — ON CONFLICT (tenant_id, key) WHERE deleted_at IS NULL).
 */
export async function updateSystemSettings(
  updates: { key: string; value: string }[]
): Promise<ActionResult> {
  try {
    await requirePermission("settings", "manage")
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()

    for (const u of updates) {
      const { data: existing } = await admin
        .from("system_settings")
        .select("id")
        .eq("tenant_id", currentUser.tenantId)
        .eq("key", u.key)
        .is("deleted_at", null)
        .maybeSingle()

      const payload = {
        tenant_id: currentUser.tenantId,
        key: u.key,
        value: u.value,
        category: u.key.split(".")[0] ?? "system",
      }

      if (existing?.id) {
        const { error } = await admin
          .from("system_settings")
          .update({ value: u.value })
          .eq("id", existing.id)
        if (error) return { success: false, error: error.message }
      } else {
        const { error } = await admin.from("system_settings").insert(payload)
        if (error) return { success: false, error: error.message }
      }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "settings",
      action: "updated",
      entityType: "system_settings",
      newValues: Object.fromEntries(updates.map((u) => [u.key, u.value])),
    })

    revalidatePath("/settings/payroll-defaults")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Save the company WPS (Saudi Wage Protection System) configuration: the
 * Ministry of Labour reference and the company IBAN used in SIF files.
 * GM / settings.manage only. Upserts the two system_settings keys.
 */
export async function updateCompanyWpsSettings(input: {
  molReference: string
  wpsIban: string
}): Promise<ActionResult> {
  try {
    await requirePermission("settings", "manage")
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return { success: false, error: "Not authenticated." }
    }
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const molReference = input.molReference.trim()
    const wpsIban = input.wpsIban.trim().toUpperCase()
    if (!molReference) {
      return { success: false, error: "MOL reference is required." }
    }
    if (!/^SA\d{22}$/.test(wpsIban.replace(/\s/g, ""))) {
      return { success: false, error: "WPS IBAN must be a Saudi IBAN (SA + 22 digits)." }
    }

    const admin = createAdminClient()
    for (const [key, value] of [
      ["company.mol_reference", molReference],
      ["company.wps_iban", wpsIban],
    ] as const) {
      const { data: existing } = await admin
        .from("system_settings")
        .select("id")
        .eq("tenant_id", currentUser.tenantId)
        .eq("key", key)
        .is("deleted_at", null)
        .maybeSingle()

      if (existing?.id) {
        const { error } = await admin
          .from("system_settings")
          .update({ value })
          .eq("id", existing.id)
        if (error) return { success: false, error: error.message }
      } else {
        const { error } = await admin.from("system_settings").insert({
          tenant_id: currentUser.tenantId,
          key,
          value,
          category: "company",
          is_public: false,
        })
        if (error) return { success: false, error: error.message }
      }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "settings",
      action: "updated",
      entityType: "system_settings",
      newValues: { "company.mol_reference": molReference, "company.wps_iban": "****" + wpsIban.slice(-4) },
    })

    revalidatePath("/settings/company")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
