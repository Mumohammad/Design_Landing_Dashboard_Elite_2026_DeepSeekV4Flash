"use server"

// Accounting Module 9 — Phase 4: Customers & Suppliers (parties).
//
// - createCustomer / createSupplier          accounting:create
// - updateCustomer / updateSupplier          accounting:update
// - setCustomerActive / setSupplierActive    accounting:update (toggle)
// - deleteCustomer / deleteSupplier          accounting:update (soft-delete)
// - exportCustomersCsv / exportSuppliersCsv  accounting:export
//
// Tables `customers`/`suppliers` exist since migration 027 (4-policy RLS,
// codes defaulted from finance_doc_ref_seq). Validation is enforced at the
// app layer here AND defensively by the validate_party() trigger (037):
//   name_ar required · code 3-12 chars · tax_number 15 digits · limit ≥ 0
//
// All mutations write immutable audit_log rows and revalidate /accounting.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import { cacheGet, cacheInvalidate, CACHE_TTL } from "@/lib/cache"

type ActionResult = { success: boolean; error?: string }

export type PartyKind = "customers" | "suppliers"

export type PartyInput = {
  /** Optional on create — leave empty to let the DB sequence assign the code. */
  code?: string | null
  name_ar: string
  name_en?: string | null
  phone?: string | null
  email?: string | null
  /** ZATCA VAT registration number — exactly 15 digits when provided. */
  tax_number?: string | null
  address?: string | null
  credit_limit?: number | null
  /** Update-only — toggles the record's active state. */
  is_active?: boolean
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,11}$/
const TAX_RE = /^\d{15}$/

const PARTY_LABEL: Record<PartyKind, { ar: string; en: string }> = {
  customers: { ar: "العميل", en: "customer" },
  suppliers: { ar: "المورد", en: "supplier" },
}

function codeColumn(kind: PartyKind): string {
  return kind === "customers" ? "customer_code" : "supplier_code"
}

/**
 * Normalize + validate a party payload. Mirrors the DB trigger so most bad
 * input is caught before a round-trip; the trigger stays as defense-in-depth.
 */
function normalizeInput(
  input: PartyInput
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const nameAr = (input.name_ar ?? "").trim()
  if (!nameAr) {
    return { ok: false, error: "An Arabic name is required." }
  }

  // Code: optional on create (DB default), validated whenever provided.
  const code = (input.code ?? "").trim()
  if (code && !CODE_RE.test(code)) {
    return { ok: false, error: "Code must be 3-12 characters (letters, digits, dashes)." }
  }

  const tax = (input.tax_number ?? "").trim()
  if (tax && !TAX_RE.test(tax)) {
    return { ok: false, error: "Tax number must be exactly 15 digits." }
  }

  const limit = input.credit_limit
  // NaN/Infinity must be rejected too — Postgres NUMERIC accepts NaN, and
  // neither `NaN < 0` nor the DB trigger (NaN <> NaN) would catch it here.
  if (limit != null && (!Number.isFinite(limit) || limit < 0)) {
    return { ok: false, error: "Credit limit must be zero or a positive number." }
  }

  const payload: Record<string, unknown> = {
    name_ar: nameAr,
    name_en: (input.name_en ?? "").trim() || null,
    phone: (input.phone ?? "").trim() || null,
    email: (input.email ?? "").trim() || null,
    tax_number: tax || null,
    address: (input.address ?? "").trim() || null,
    credit_limit: limit,
  }
  if (code) payload.code = code.toUpperCase()
  return { ok: true, payload }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/** Bilingual not-found message from the taxonomy (CUS001 / SUP001). */
function notFoundMessage(kind: PartyKind): string {
  return mapFinancialError(`${kind === "customers" ? "CUS001" : "SUP001"}: not found`)
}

// ── Create ────────────────────────────────────────────────────────────────

async function createParty(kind: PartyKind, input: PartyInput): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const label = PARTY_LABEL[kind]
    const norm = normalizeInput(input)
    if (!norm.ok) return { success: false, error: norm.error }

    const admin = createAdminClient()
    const insertPayload: Record<string, unknown> = {
      tenant_id: currentUser.tenantId,
      ...norm.payload,
      created_by: currentUser.authUserId,
    }
    // Only set the code column when the caller supplied one — otherwise the
    // column DEFAULT (finance_doc_ref_seq) assigns the next number.
    if (norm.payload.code) {
      insertPayload[codeColumn(kind)] = norm.payload.code
      delete insertPayload.code
    }

    const { data: row, error } = await admin.from(kind).insert(insertPayload).select("id").single()
    if (error) {
      if (error.code === "23505") {
        return { success: false, error: `A ${label.en} with this code already exists.` }
      }
      return { success: false, error: mapFinancialError(error.message) }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: `${kind.slice(0, -1)}_created`,
      entityType: kind,
      entityId: row.id,
      newValues: {
        code: insertPayload[codeColumn(kind)] ?? null,
        name_ar: norm.payload.name_ar,
        tax_number: norm.payload.tax_number,
        credit_limit: norm.payload.credit_limit,
      },
    })

    revalidatePath("/accounting")
    await cacheInvalidate(`parties:${kind}:${currentUser.tenantId}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}


export async function createCustomer(input: PartyInput): Promise<ActionResult> {
  return createParty("customers", input)
}

export async function createSupplier(input: PartyInput): Promise<ActionResult> {
  return createParty("suppliers", input)
}

// ── Update ────────────────────────────────────────────────────────────────

async function updateParty(
  kind: PartyKind,
  input: PartyInput & { id: string }
): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const label = PARTY_LABEL[kind]
    const norm = normalizeInput(input)
    if (!norm.ok) return { success: false, error: norm.error }

    const admin = createAdminClient()
    // Fetch existing row (service-role must scope by tenant + soft-delete).
    const { data: existing, error: fetchError } = await admin
      .from(kind)
      .select("id,tenant_id,name_ar,name_en,tax_number,credit_limit,is_active")
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()

    if (fetchError || !existing) {
      return { success: false, error: notFoundMessage(kind) }
    }

    const updatePayload: Record<string, unknown> = {
      ...norm.payload,
      updated_by: currentUser.authUserId,
      is_active: input.is_active ?? existing.is_active,
    }
    if (norm.payload.code) {
      updatePayload[codeColumn(kind)] = norm.payload.code
    }
    delete updatePayload.code

    const { error } = await admin
      .from(kind)
      .update(updatePayload)
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: `A ${label.en} with this code already exists.` }
      }
      return { success: false, error: mapFinancialError(error.message) }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: `${kind.slice(0, -1)}_updated`,
      entityType: kind,
      entityId: input.id,
      oldValues: {
        name_ar: existing.name_ar,
        tax_number: existing.tax_number,
        credit_limit: existing.credit_limit,
        is_active: existing.is_active,
      },
      newValues: {
        name_ar: norm.payload.name_ar,
        tax_number: norm.payload.tax_number,
        credit_limit: norm.payload.credit_limit,
        is_active: updatePayload.is_active,
      },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function updateCustomer(input: PartyInput & { id: string }): Promise<ActionResult> {
  return updateParty("customers", input)
}

export async function updateSupplier(input: PartyInput & { id: string }): Promise<ActionResult> {
  return updateParty("suppliers", input)
}

// ── Toggle active ─────────────────────────────────────────────────────────

async function setPartyActive(
  kind: PartyKind,
  input: { id: string; is_active: boolean }
): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: updated, error } = await admin
      .from(kind)
      .update({ is_active: input.is_active, updated_by: currentUser.authUserId })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()

    if (error) return { success: false, error: mapFinancialError(error.message) }
    if (!updated) return { success: false, error: notFoundMessage(kind) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: input.is_active ? `${kind.slice(0, -1)}_activated` : `${kind.slice(0, -1)}_deactivated`,
      entityType: kind,
      entityId: input.id,
      newValues: { is_active: input.is_active },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function setCustomerActive(input: { id: string; is_active: boolean }): Promise<ActionResult> {
  return setPartyActive("customers", input)
}

export async function setSupplierActive(input: { id: string; is_active: boolean }): Promise<ActionResult> {
  return setPartyActive("suppliers", input)
}

// ── Soft-delete ───────────────────────────────────────────────────────────

async function deleteParty(kind: PartyKind, input: { id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data: updated, error } = await admin
      .from(kind)
      .update({ deleted_at: new Date().toISOString(), updated_by: currentUser.authUserId })
      .eq("id", input.id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()

    if (error) return { success: false, error: mapFinancialError(error.message) }
    if (!updated) return { success: false, error: notFoundMessage(kind) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: `${kind.slice(0, -1)}_deleted`,
      entityType: kind,
      entityId: input.id,
      newValues: { deleted_at: new Date().toISOString() },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function deleteCustomer(input: { id: string }): Promise<ActionResult> {
  return deleteParty("customers", input)
}

export async function deleteSupplier(input: { id: string }): Promise<ActionResult> {
  return deleteParty("suppliers", input)
}

// ── CSV export (BOM-prefixed so Excel renders Arabic) ─────────────────────

async function exportPartiesCsv(kind: PartyKind): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const codeCol = kind === "customers" ? "customer_code" : "supplier_code"
    const admin = createAdminClient()

    // Cache parties list for 2 min (hot path — read on accounting page visit)
    const data = await cacheGet(
      `parties:${kind}:${currentUser.tenantId}`,
      async () => {
        const { data, error } = await admin
          .from(kind)
          .select(`id,${codeCol},name_ar,name_en,phone,email,tax_number,address,credit_limit,is_active`)
          .eq("tenant_id", currentUser.tenantId)
          .is("deleted_at", null)
          .order(codeCol, { ascending: true })
        if (error) throw new Error(error.message)
        return data ?? []
      },
      CACHE_TTL.chartOfAccounts
    )

    const rows = (data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>
      return [
        row[codeCol],
        row.name_ar,
        row.name_en ?? "",
        row.phone ?? "",
        row.email ?? "",
        row.tax_number ?? "",
        row.address ?? "",
        row.credit_limit ?? "",
        row.is_active ? "true" : "false",
      ] as (string | number | boolean | null)[]
    })

    const csv = "\uFEFF" + toCsv(
      ["code", "name_ar", "name_en", "phone", "email", "tax_number", "address", "credit_limit", "is_active"],
      rows
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: `${kind.slice(0, -1)}_list_exported`,
      entityType: kind,
      newValues: { rows: (data ?? []).length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function exportCustomersCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  return exportPartiesCsv("customers")
}

export async function exportSuppliersCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  return exportPartiesCsv("suppliers")
}
