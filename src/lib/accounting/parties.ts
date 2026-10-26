"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitAccounting } from "@/lib/auth/rate-limit"
import { cacheInvalidate } from "@/lib/cache"
import { toCsv } from "./csv-utils"
import { round2 } from "./invoice-math"
import {
  MASTER_EXPORT_MAX_BYTES, classifyMasterError, isMasterId, isMasterIntent, isMasterReview,
  masterFailure, parseMasterMutationResult, readMasterPage, utf8ByteLength,
  type MasterActionFailure, type MasterActionResult, type MasterIntent, type MasterReview, type PartyMasterRow,
} from "./master-contract"

export type PartyKind = "customers" | "suppliers"
export type PartyInput = {
  code?: string | null; name_ar: string; name_en?: string | null; phone?: string | null
  email?: string | null; tax_number?: string | null; address?: string | null
  credit_limit?: number | null; is_active?: boolean
}
type NormalizedParty = { code: string | null; name_ar: string; name_en: string | null; phone: string | null
  email: string | null; tax_number: string | null; address: string | null; credit_limit: number | null; is_active?: boolean }
function normalizedText(value: unknown, maximum: number): string | null | false {
  if (value == null) return null
  if (typeof value !== "string") return false
  const text = value.trim()
  return Array.from(text).length > maximum ? false : text || null
}
function normalizeParty(input: PartyInput): NormalizedParty | MasterActionFailure {
  if (!input || typeof input !== "object" || Array.isArray(input)) return masterFailure("MASTER_INVALID")
  const nameAr = normalizedText(input.name_ar, 200), nameEn = normalizedText(input.name_en, 200)
  const phone = normalizedText(input.phone, 50), email = normalizedText(input.email, 254)
  const address = normalizedText(input.address, 2000), tax = normalizedText(input.tax_number, 15)
  const code = normalizedText(input.code, 12)
  if (!nameAr || [nameEn, phone, email, address].includes(false)) return masterFailure("MASTER_INVALID")
  if (code === false || (code && !/^[A-Za-z0-9][A-Za-z0-9-]{2,11}$/.test(code))) return masterFailure("MASTER_CODE_INVALID")
  if (tax === false || (tax && !/^\d{15}$/.test(tax))) return masterFailure("MASTER_TAX_INVALID")
  const credit = input.credit_limit ?? null
  if (credit !== null) {
    if (typeof credit !== "number" || !Number.isFinite(credit) || credit < 0) return masterFailure("MASTER_CREDIT_INVALID")
    try { if (round2(credit) !== credit) return masterFailure("MASTER_CREDIT_INVALID") }
    catch { return masterFailure("MASTER_CREDIT_INVALID") }
  }
  if (input.is_active !== undefined && typeof input.is_active !== "boolean") return masterFailure("MASTER_INVALID")
  return { code: code ? code.toUpperCase() : null, name_ar: nameAr, name_en: nameEn as string | null,
    phone: phone as string | null, email: email as string | null, tax_number: tax || null,
    address: address as string | null, credit_limit: credit,
    ...(input.is_active === undefined ? {} : { is_active: input.is_active }) }
}
async function refreshParties(kind: PartyKind, tenantId: string): Promise<void> {
  // The receipt already confirms the transaction. A cache failure must not
  // misreport committed business data; the UI reloads its uncached caller page.
  try { await cacheInvalidate("parties:" + kind + ":" + tenantId) } catch { /* best-effort invalidation */ }
  try { revalidatePath("/accounting") } catch { /* the confirmed receipt remains retry-safe */ }
}
async function mutateParty(kind: PartyKind, action: "create" | "update" | "set_active" | "archive",
  input: PartyInput | { is_active: boolean } | Record<string, never>, intent: MasterIntent | MasterReview, id?: string,
): Promise<MasterActionResult> {
  try {
    await requirePermission("accounting", action === "create" ? "create" : "update")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!isMasterIntent(intent)) return masterFailure("MASTER_REQUEST_REQUIRED")
    if (action !== "create" && (!isMasterId(id) || !isMasterReview(intent))) return masterFailure("MASTER_STALE")
    let payload: NormalizedParty | { is_active: boolean } | Record<string, never>
    if (action === "create" || action === "update") {
      const normalized = normalizeParty(input as PartyInput)
      if ("success" in normalized) return normalized
      payload = normalized
    } else if (action === "set_active") {
      if (typeof (input as { is_active?: unknown }).is_active !== "boolean") return masterFailure("MASTER_INVALID")
      payload = { is_active: (input as { is_active: boolean }).is_active }
    } else payload = {}
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("mutate_my_accounting_master", {
      p_kind: kind, p_action: action, p_input: payload, p_id: id ?? null,
      p_expected_updated_at: action === "create" ? null : (intent as MasterReview).expected_updated_at,
      p_request_id: intent.request_id,
    })
    if (error) return masterFailure(classifyMasterError(error))
    const receipt = parseMasterMutationResult(data, kind)
    if ((id && receipt.id.toLowerCase() !== id.toLowerCase()) || ("code" in payload && payload.code && receipt.code !== payload.code)
      || ("is_active" in payload && receipt.is_active !== payload.is_active) || receipt.archived !== (action === "archive")
      || (action === "set_active" && receipt.is_active !== (payload as { is_active: boolean }).is_active)) return masterFailure("MASTER_UNAVAILABLE")
    await refreshParties(kind, user.tenantId)
    return { success: true, ...receipt }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export async function createCustomer(input: PartyInput, intent: MasterIntent): Promise<MasterActionResult> { return mutateParty("customers", "create", input, intent) }
export async function createSupplier(input: PartyInput, intent: MasterIntent): Promise<MasterActionResult> { return mutateParty("suppliers", "create", input, intent) }
export async function updateCustomer(id: string, input: PartyInput, review: MasterReview): Promise<MasterActionResult> { return mutateParty("customers", "update", input, review, id) }
export async function updateSupplier(id: string, input: PartyInput, review: MasterReview): Promise<MasterActionResult> { return mutateParty("suppliers", "update", input, review, id) }
export async function setCustomerActive(id: string, active: boolean, review: MasterReview): Promise<MasterActionResult> { return mutateParty("customers", "set_active", { is_active: active }, review, id) }
export async function setSupplierActive(id: string, active: boolean, review: MasterReview): Promise<MasterActionResult> { return mutateParty("suppliers", "set_active", { is_active: active }, review, id) }
export async function deleteCustomer(id: string, review: MasterReview): Promise<MasterActionResult> { return mutateParty("customers", "archive", {}, review, id) }
export async function deleteSupplier(id: string, review: MasterReview): Promise<MasterActionResult> { return mutateParty("suppliers", "archive", {}, review, id) }
type PartyExportResult = { success: true; csv: string } | MasterActionFailure
async function exportParties(kind: PartyKind, search = ""): Promise<PartyExportResult> {
  try {
    await requirePermission("accounting", "export")
    await requirePermission("accounting", "read")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const result = await readMasterPage<PartyMasterRow>(caller, kind, { search, exporting: true })
    const csv = "\uFEFF" + toCsv(
      ["code", "name_ar", "name_en", "phone", "email", "tax_number", "address", "credit_limit", "is_active"],
      result.rows.map(row => [row.code, row.name_ar, row.name_en, row.phone, row.email, row.tax_number, row.address, row.credit_limit, row.is_active ? "true" : "false"]),
    )
    if (utf8ByteLength(csv) > MASTER_EXPORT_MAX_BYTES) return masterFailure("MASTER_EXPORT_LIMIT")
    return { success: true, csv }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export async function exportCustomersCsv(search = ""): Promise<PartyExportResult> { return exportParties("customers", search) }
export async function exportSuppliersCsv(search = ""): Promise<PartyExportResult> { return exportParties("suppliers", search) }