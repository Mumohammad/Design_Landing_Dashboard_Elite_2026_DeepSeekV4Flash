"use server"

// Accounting Module 9 — Server Actions.
//
// - createChartAccount        accounting:create → add a chart of accounts row
// - updateChartAccount        accounting:update → edit an account
// - deactivateChartAccount    accounting:update → soft-disable an account
// - importChartAccountsCsv    accounting:create → bulk CSV import
// - exportChartAccountsCsv    accounting:export → CSV export
// - initializeDefaultCoa      accounting:create → seed per-tenant defaults
// - postOpeningBalances       accounting:create → post an 'opening' journal
// - postJournalEntry          accounting:create → post a balanced manual entry
// - createReceivable          accounting:create → AR invoice (net + VAT + total)
//
// All mutations write immutable audit_log entries and revalidate /accounting.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
// Sync helpers live in a plain module (a "use server" file can only export
// async functions, which would force awaits at every call site).
import { mapFinancialError, parseCsv, toCsv } from "@/lib/accounting/csv-utils"
// Round decimal values before persistence; VAT multiplication must also use
// decimal arithmetic rather than rounding an already-imprecise float product.
import { round2 } from "@/lib/accounting/invoice-math"
import { calculateVat, sumMoney } from "@/lib/accounting/decimal"
import { rateLimitAccounting, rateLimitAccountingImport } from "@/lib/auth/rate-limit"
import { moduleLogger, logPerformance } from "@/lib/logger"
import { emit } from "@/lib/webhooks/events"
import { cacheInvalidate } from "@/lib/cache"

import { MASTER_EXPORT_MAX_BYTES, MASTER_IMPORT_MAX_BYTES, MASTER_IMPORT_MAX_ROWS, classifyMasterError, isMasterDate, isMasterId, isMasterIntent, isMasterReview, masterFailure, parseMasterMutationResult, readMasterPage, utf8ByteLength, type ChartMasterRow, type MasterActionFailure, type MasterActionResult, type MasterIntent, type MasterReview } from "./master-contract"

type ActionResult = { success: boolean; error?: string }

const log = moduleLogger("accounting")

// Types + the CONVENTIONAL_BALANCE map live in csv-utils.ts (a plain module)
// because they are imported by client components — a "use server" file can
// only export async functions. Type-only exports are erased, so re-exporting
// the types here is safe; the const must NOT be re-exported from this file.
export type { AccountType, NormalBalance } from "@/lib/accounting/csv-utils"
import { CONVENTIONAL_BALANCE, type AccountType, type NormalBalance } from "@/lib/accounting/csv-utils"

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"]

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

export type ChartAccountInput = {
  account_code: string; name_ar: string; name_en: string; account_type: AccountType
  normal_balance: NormalBalance; parent_id?: string | null; is_contra?: boolean; description?: string | null
}
export type ChartAccountUpdate = Partial<ChartAccountInput> & { account_id: string; is_active?: boolean } & MasterReview
type MasterOperationResult<T> = ({ success: true } & T) | MasterActionFailure
function masterText(value: unknown, maximum: number, required = false): string | null | false {
  if (value == null) return required ? false : null
  if (typeof value !== "string") return false
  const normalized = value.trim()
  return Array.from(normalized).length > maximum || (required && !normalized) ? false : normalized || null
}
function normalizeChartInput(input: Partial<ChartAccountInput> & { is_active?: boolean }, creating: boolean): Record<string, unknown> | MasterActionFailure {
  if (!input || typeof input !== "object" || Array.isArray(input)) return masterFailure("MASTER_INVALID")
  const payload: Record<string, unknown> = {}
  if (creating || input.account_code !== undefined) {
    const code = masterText(input.account_code, 6, true)
    if (!code || !/^\d{3,6}$/.test(code)) return masterFailure("MASTER_CODE_INVALID")
    payload.account_code = code
  }
  for (const field of ["name_ar", "name_en"] as const) if (creating || input[field] !== undefined) {
    const name = masterText(input[field], 200, true)
    if (!name) return masterFailure("MASTER_INVALID")
    payload[field] = name
  }
  if (creating || input.account_type !== undefined) {
    if (!ACCOUNT_TYPES.includes(input.account_type as AccountType)) return masterFailure("MASTER_INVALID")
    payload.account_type = input.account_type
  }
  if (creating || input.normal_balance !== undefined) {
    if (input.normal_balance !== "debit" && input.normal_balance !== "credit") return masterFailure("MASTER_INVALID")
    payload.normal_balance = input.normal_balance
  }
  if (creating || input.is_contra !== undefined) {
    if (input.is_contra !== undefined && typeof input.is_contra !== "boolean") return masterFailure("MASTER_INVALID")
    payload.is_contra = input.is_contra ?? false
  }
  if ((creating || input.is_contra === false) && payload.account_type && payload.normal_balance
    && !payload.is_contra && CONVENTIONAL_BALANCE[payload.account_type as AccountType] !== payload.normal_balance) return masterFailure("MASTER_INVALID")
  if (creating || input.parent_id !== undefined) {
    if (!(input.parent_id == null || input.parent_id === "" || isMasterId(input.parent_id))) return masterFailure("MASTER_PARENT")
    payload.parent_id = input.parent_id || null
  }
  if (creating || input.description !== undefined) {
    const description = masterText(input.description, 1000)
    if (description === false) return masterFailure("MASTER_INVALID")
    payload.description = description
  }
  if (!creating && input.is_active !== undefined) {
    if (typeof input.is_active !== "boolean") return masterFailure("MASTER_INVALID")
    payload.is_active = input.is_active
  }
  return payload
}
async function refreshMasterChart(tenantId: string): Promise<void> {
  // The validated receipt is authoritative even if ancillary refresh fails.
  try { await cacheInvalidate("coa:" + tenantId) } catch { /* UI reload uses the uncached caller RPC */ }
  try { revalidatePath("/accounting") } catch { /* never misreport the confirmed transaction */ }
}
async function mutateChart(
  action: "create" | "update" | "set_active" | "archive",
  input: (Partial<ChartAccountInput> & { account_id?: string; is_active?: boolean }) & MasterIntent & Partial<MasterReview>,
): Promise<MasterActionResult> {
  try {
    await requirePermission("accounting", action === "create" ? "create" : "update")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!isMasterIntent(input)) return masterFailure("MASTER_REQUEST_REQUIRED")
    if (action !== "create" && (!isMasterId(input.account_id) || !isMasterReview(input))) return masterFailure("MASTER_STALE")
    const payload = action === "set_active" ? { is_active: false } : action === "archive" ? {} : normalizeChartInput(input, action === "create")
    if ("success" in payload) return payload as MasterActionFailure
    if (input.account_id && payload.parent_id === input.account_id) return masterFailure("MASTER_PARENT")
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("mutate_my_accounting_master", {
      p_kind: "accounts", p_action: action, p_input: payload, p_id: action === "create" ? null : input.account_id,
      p_expected_updated_at: action === "create" ? null : input.expected_updated_at, p_request_id: input.request_id,
    })
    if (error) return masterFailure(classifyMasterError(error))
    const receipt = parseMasterMutationResult(data, "accounts")
    if ((action !== "create" && receipt.id.toLowerCase() !== input.account_id?.toLowerCase()) || (payload.account_code && receipt.code !== payload.account_code)
      || (typeof payload.is_active === "boolean" && receipt.is_active !== payload.is_active) || receipt.archived !== (action === "archive")
      || (action === "set_active" && receipt.is_active)) return masterFailure("MASTER_UNAVAILABLE")
    await refreshMasterChart(user.tenantId)
    return { success: true, ...receipt }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export async function createChartAccount(input: ChartAccountInput & MasterIntent): Promise<MasterActionResult> {
  return mutateChart("create", input)
}
export async function updateChartAccount(input: ChartAccountUpdate): Promise<MasterActionResult> {
  return mutateChart("update", input)
}
export async function deactivateChartAccount(input: { account_id: string } & MasterReview): Promise<MasterActionResult> {
  return mutateChart("set_active", input)
}
export async function archiveChartAccount(input: { account_id: string } & MasterReview): Promise<MasterActionResult> {
  return mutateChart("archive", input)
}
export async function exportChartAccountsCsv(search = ""): Promise<MasterOperationResult<{ csv: string }>> {
  try {
    await requirePermission("accounting", "export")
    await requirePermission("accounting", "read")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const page = await readMasterPage<ChartMasterRow>(caller, "accounts", { search, exporting: true })
    const csv = "\uFEFF" + toCsv(
      ["account_code", "name_ar", "name_en", "account_type", "normal_balance", "parent_code", "is_contra", "is_active", "description"],
      page.rows.map(row => [row.account_code, row.name_ar, row.name_en, row.account_type, row.normal_balance,
        row.parent_code, row.is_contra ? "true" : "false", row.is_active ? "true" : "false", row.description]),
    )
    if (utf8ByteLength(csv) > MASTER_EXPORT_MAX_BYTES) return masterFailure("MASTER_EXPORT_LIMIT")
    return { success: true, csv }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export type CsvImportResult = {
  success: boolean; imported?: number; skipped?: number; errors?: string[]
  error?: string; errorAr?: string; errorCode?: MasterActionFailure["errorCode"]
}
export async function importChartAccountsCsv(csvText: string, intent: MasterIntent): Promise<CsvImportResult> {
  try {
    await requirePermission("accounting", "create")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!isMasterIntent(intent)) return masterFailure("MASTER_REQUEST_REQUIRED")
    if (typeof csvText !== "string") return masterFailure("MASTER_INVALID")
    if (utf8ByteLength(csvText) > MASTER_IMPORT_MAX_BYTES) return masterFailure("MASTER_IMPORT_LIMIT")
    const parsed = parseCsv(csvText)
    if (parsed.length < 2) return masterFailure("MASTER_INVALID")
    if (parsed.length - 1 > MASTER_IMPORT_MAX_ROWS) return masterFailure("MASTER_IMPORT_LIMIT")
    const header = parsed[0].map(value => value.trim().toLowerCase())
    if (new Set(header).size !== header.length || ["account_code", "name_ar", "name_en", "account_type", "normal_balance"].some(column => !header.includes(column))) return masterFailure("MASTER_INVALID")
    const cell = (row: string[], name: string) => { const index = header.indexOf(name); return index < 0 ? "" : (row[index] ?? "").trim() }
    const booleanCell = (row: string[], name: string, fallback: boolean) => {
      if (!header.includes(name)) return fallback
      const value = cell(row, name).toLowerCase()
      return value === "true" ? true : value === "false" ? false : value
    }
    // Invalid rows stay in the batch for explicit per-row SQL errors. No
    // application-level insert loop can commit a prefix before the batch audit.
    const rows = parsed.slice(1).map(row => ({
      account_code: cell(row, "account_code"), name_ar: cell(row, "name_ar"), name_en: cell(row, "name_en"),
      account_type: cell(row, "account_type"), normal_balance: cell(row, "normal_balance"),
      parent_code: cell(row, "parent_code") || null, is_contra: booleanCell(row, "is_contra", false),
      is_active: booleanCell(row, "is_active", true), description: cell(row, "description") || null,
    }))
    if (utf8ByteLength(JSON.stringify(rows)) > MASTER_IMPORT_MAX_BYTES) return masterFailure("MASTER_IMPORT_LIMIT")
    if (!(await rateLimitAccountingImport(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("import_my_chart_accounts", { p_rows: rows, p_request_id: intent.request_id })
    if (error) return masterFailure(classifyMasterError(error))
    if (!data || !Number.isSafeInteger(data.imported) || data.imported < 0 || !Number.isSafeInteger(data.skipped) || data.skipped < 0
      || !Array.isArray(data.errors) || data.errors.some((item: unknown) => typeof item !== "string" || item.length === 0 || item.length > 1000)
      || data.imported + data.skipped + data.errors.length !== rows.length) return masterFailure("MASTER_UNAVAILABLE")
    if (data.imported > 0) await refreshMasterChart(user.tenantId)
    return { success: data.errors.length === 0, imported: data.imported, skipped: data.skipped, errors: data.errors }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export async function initializeDefaultCoa(intent: MasterIntent): Promise<MasterOperationResult<{ inserted: number }>> {
  try {
    await requirePermission("accounting", "create")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!isMasterIntent(intent)) return masterFailure("MASTER_REQUEST_REQUIRED")
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("initialize_my_chart_accounts", { p_request_id: intent.request_id })
    if (error) return masterFailure(classifyMasterError(error))
    if (!data || !Number.isSafeInteger(data.inserted) || data.inserted < 0 || data.inserted > 28) return masterFailure("MASTER_UNAVAILABLE")
    await refreshMasterChart(user.tenantId)
    return { success: true, inserted: data.inserted }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
export async function postOpeningBalances(input: {
  entry_date: string; lines: { account_id: string; description?: string; debit: number; credit: number }[]; request_id: string
}): Promise<MasterOperationResult<{ out_entry_id: string; out_entry_ref: string }>> {
  try {
    await requirePermission("accounting", "create")
    const user = await getCurrentUser()
    if (!user) return masterFailure("MASTER_FORBIDDEN")
    if (!isMasterIntent(input)) return masterFailure("MASTER_REQUEST_REQUIRED")
    if (!isMasterDate(input.entry_date) || !Array.isArray(input.lines) || input.lines.length > 1000) return masterFailure("MASTER_INVALID")
    const lines: { account_id: string; description: string | null; debit: number; credit: number }[] = []
    for (const line of input.lines) {
      if (!line || typeof line.debit !== "number" || typeof line.credit !== "number" || !Number.isFinite(line.debit)
        || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0 || round2(line.debit) !== line.debit
        || round2(line.credit) !== line.credit || (line.debit > 0 && line.credit > 0)) return masterFailure("MASTER_INVALID")
      const description = masterText(line.description, 1000)
      if (description === false) return masterFailure("MASTER_INVALID")
      if (line.debit === 0 && line.credit === 0) continue
      if (!isMasterId(line.account_id)) return masterFailure("MASTER_INVALID")
      lines.push({ account_id: line.account_id, description, debit: line.debit, credit: line.credit })
    }
    if (lines.length < 2 || sumMoney(...lines.map(line => line.debit)) !== sumMoney(...lines.map(line => line.credit))
      || utf8ByteLength(JSON.stringify(lines)) > MASTER_IMPORT_MAX_BYTES) return masterFailure("MASTER_INVALID")
    if (!(await rateLimitAccounting(user.id)).success) return masterFailure("MASTER_RATE_LIMIT")
    const caller = await createClient()
    const { data, error } = await caller.rpc("post_my_opening_balances", {
      p_entry_date: input.entry_date, p_lines: lines, p_request_id: input.request_id,
    })
    if (error) return masterFailure(classifyMasterError(error))
    if (!data || !isMasterId(data.out_entry_id) || typeof data.out_entry_ref !== "string"
      || !data.out_entry_ref.trim() || data.out_entry_ref.length > 200) return masterFailure("MASTER_UNAVAILABLE")
    await refreshMasterChart(user.tenantId)
    return { success: true, out_entry_id: data.out_entry_id, out_entry_ref: data.out_entry_ref }
  } catch (error) { return masterFailure(classifyMasterError(error)) }
}
// ── Phase 3 — Journal Engine actions ──────────────────────────────────────
// Reversal, approval workflow, period close/reopen. All route through atomic
// service-role RPCs (migration 034) — no partial states.

type JournalDraftInput = {
  entry_date: string
  description_ar: string
  description_en?: string | null
  lines: { account_id: string; description?: string; debit: number; credit: number }[]
}

async function saveJournalDraft(input: JournalDraftInput, id?: string, expectedUpdatedAt?: string): Promise<ActionResult> {
  try {
    await requirePermission("accounting", id ? "update" : "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const client = await createClient()
    const { error } = await client.rpc("save_journal_draft", {
      p_input: input,
      p_entry_id: id ?? null,
      p_expected_updated_at: expectedUpdatedAt ?? null,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: mapFinancialError(errorMessage(e)) }
  }
}

export async function createJournalDraft(input: JournalDraftInput): Promise<ActionResult> {
  return saveJournalDraft(input)
}

export async function updateJournalDraft(input: JournalDraftInput & { id: string; expected_updated_at: string }): Promise<ActionResult> {
  const { id, expected_updated_at, ...draft } = input
  return saveJournalDraft(draft, id, expected_updated_at)
}

export async function deleteJournalDraft(input: { id: string; expected_updated_at: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "delete")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }
    const client = await createClient()
    const { error } = await client.rpc("delete_journal_draft", {
      p_entry_id: input.id, p_expected_updated_at: input.expected_updated_at,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: mapFinancialError(errorMessage(e)) }
  }
}

export async function submitJournalEntry(input: { entry_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { error } = await admin.rpc("submit_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_submitted_by: currentUser.authUserId,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "journal_submitted_for_approval",
      entityType: "journal_entries",
      entityId: input.entry_id,
    })

    emit("journal_entry.submitted", currentUser.tenantId, {
      id: input.entry_id,
      referenceNumber: "",
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function approveJournalEntry(input: {
  entry_id: string
  comment?: string | null
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("approve_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_approved_by: currentUser.authUserId,
      p_comment: input.comment?.trim() || null,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = Array.isArray(data) ? data[0] : data
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "journal_approved",
      entityType: "journal_entries",
      entityId: input.entry_id,
      newValues: { entry_ref: row?.out_entry_ref ?? null },
    })

    emit("journal_entry.approved", currentUser.tenantId, {
      id: input.entry_id,
      referenceNumber: row?.out_entry_ref ?? "",
      approvedBy: currentUser.id,
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function rejectJournalEntry(input: {
  entry_id: string
  reason: string
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { error } = await admin.rpc("reject_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_reason: input.reason.trim(),
      p_rejected_by: currentUser.authUserId,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "journal_rejected",
      entityType: "journal_entries",
      entityId: input.entry_id,
      newValues: { reason: input.reason.trim() },
    })

    emit("journal_entry.rejected", currentUser.tenantId, {
      id: input.entry_id,
      referenceNumber: "",
      rejectedBy: currentUser.id,
      reason: input.reason.trim(),
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function reverseJournalEntry(input: {
  entry_id: string
  description_ar?: string | null
  description_en?: string | null
  reversal_date?: string | null
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("reverse_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_description_ar: input.description_ar?.trim() || null,
      p_description_en: input.description_en?.trim() || null,
      p_reversal_date: input.reversal_date || null,
      p_created_by: currentUser.authUserId,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = Array.isArray(data) ? data[0] : data
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "journal_reversed",
      entityType: "journal_entries",
      entityId: input.entry_id,
      newValues: { reversal_entry_ref: row?.out_entry_ref ?? null },
    })
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function closeAccountingPeriod(input: { period_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { error } = await admin.rpc("close_accounting_period", {
      p_tenant_id: currentUser.tenantId,
      p_period_id: input.period_id,
      p_closed_by: currentUser.authUserId,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "accounting_period_closed",
      entityType: "accounting_periods",
      entityId: input.period_id,
    })
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function reopenAccountingPeriod(input: {
  period_id: string
  reason: string
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { error } = await admin.rpc("reopen_accounting_period", {
      p_tenant_id: currentUser.tenantId,
      p_period_id: input.period_id,
      p_reason: input.reason.trim(),
      p_reopened_by: currentUser.authUserId,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "accounting_period_reopened",
      entityType: "accounting_periods",
      entityId: input.period_id,
      newValues: { reason: input.reason.trim() },
    })
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function postJournalEntry(input: {
  entry_date: string
  description_ar: string
  description_en?: string | null
  lines: { account_id: string; description?: string; debit: number; credit: number }[]
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const t0 = Date.now()
    log.info({ userId: currentUser.id, tenantId: currentUser.tenantId }, "postJournalEntry started")

    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0)
    if (lines.length < 2) {
      return { success: false, error: "A journal entry needs at least two lines." }
    }
    if (!input.description_ar.trim()) {
      return { success: false, error: "A description is required." }
    }

    // Round to 2dp in integer-minor arithmetic so the exact NUMERIC comparison
    // in the DB function never trips on float artifacts (e.g. 0.1 + 0.2).
    const linesPayload = lines.map((l) => ({
      account_id: l.account_id,
      description: l.description?.trim() || null,
      debit: round2(l.debit),
      credit: round2(l.credit),
    }))

    // Single atomic RPC call: journal header + lines + balance + period checks
    // all inside one DB transaction (migration 031). No orphaned entries.
    const admin = createAdminClient()
    const { data, error } = await admin.rpc("post_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_date: input.entry_date,
      p_description_ar: input.description_ar.trim(),
      p_description_en: input.description_en?.trim() || null,
      p_created_by: currentUser.authUserId,
      p_lines: linesPayload,
    })

    if (error) {
      return { success: false, error: mapFinancialError(error.message) }
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.out_entry_id) {
      return { success: false, error: "Posting failed: no journal entry returned." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "journal_entry_posted",
      entityType: "journal_entries",
      entityId: row.out_entry_id,
      newValues: {
        entry_ref: row.out_entry_ref,
        entry_date: input.entry_date,
        lines: lines.length,
        total: linesPayload.reduce((s, l) => s + l.debit, 0),
      },
    })

    emit("journal_entry.created", currentUser.tenantId, {
      id: row.out_entry_id,
      referenceNumber: row.out_entry_ref,
      totalDebit: linesPayload.reduce((s, l) => s + l.debit, 0),
      totalCredit: linesPayload.reduce((s, l) => s + l.credit, 0),
    })

    log.info({ userId: currentUser.id, tenantId: currentUser.tenantId, durationMs: Date.now() - t0 }, "postJournalEntry completed")
    logPerformance("postJournalEntry", Date.now() - t0, { tenantId: currentUser.tenantId })
    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function createReceivable(input: {
  request_id: string
  invoice_ref: string
  invoice_date: string
  due_date: string
  amount: number
  vat_rate: number
}): Promise<ActionResult & { errorAr?: string; id?: string; replayed?: boolean }> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitAccounting(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const t0 = Date.now()
    log.info({ userId: currentUser.id, tenantId: currentUser.tenantId }, "createReceivable started")

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.request_id ?? "")) return { success: false, error: "Reopen the form to start a new receivable.", errorAr: "أعد فتح النموذج لبدء ذمة مدينة جديدة." }
    const amount = input.amount
    const vatRate = input.vat_rate
    if (typeof input.invoice_ref !== "string" || !input.invoice_ref.trim() || input.invoice_ref.trim().length > 200
      || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99
      || typeof vatRate !== "number"
      || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return { success: false, error: "Invoice reference, positive amount, and a valid VAT rate are required.", errorAr: "أدخل مرجع الفاتورة ومبلغاً موجباً ونسبة ضريبة صحيحة." }
    }
    if ([input.invoice_date, input.due_date].some(value => {
      const date = new Date(value)
      return !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value
    })) {
      return { success: false, error: "Valid invoice and due dates are required.", errorAr: "أدخل تاريخ فاتورة وتاريخ استحقاق صحيحين." }
    }
    if (input.due_date < input.invoice_date) {
      return { success: false, error: "Due date cannot be before the invoice date.", errorAr: "لا يمكن أن يسبق الاستحقاق تاريخ الفاتورة." }
    }

    const amountR = round2(amount)
    const vatAmount = calculateVat(amountR, vatRate)
    const total = sumMoney(amountR, vatAmount)
    if (amountR <= 0 || total > 9_999_999_999.99) {
      return { success: false, error: "Receivable amounts must fit the supported monetary range.", errorAr: "المبلغ يتجاوز النطاق المالي المدعوم." }
    }

    // Keep the caller's JWT/MFA context. The database derives tenant/actor and
    // commits the receivable, request identity and audit evidence together.
    const supabase = await createClient()
    const { data: row, error } = await supabase.rpc("create_manual_receivable_atomic", {
      p_request_id: input.request_id,
      p_receivable: {
        invoice_ref: input.invoice_ref.trim(),
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        amount: amountR,
        vat_rate: vatRate,
      },
    })
    if (error?.message?.startsWith("AR_RETRY_UNAVAILABLE:")) return {
      success: false, error: "The original receivable changed or was removed. Reload and review it before creating another.",
      errorAr: "تغيرت الذمة الأصلية أو حُذفت. أعد تحميلها وراجعها قبل إنشاء ذمة أخرى.",
    }
    if (error?.message?.startsWith("AR_RETRY:")) return {
      success: false, error: "This request already saved different details. Reload and review the original receivable before starting a new one.",
      errorAr: "حُفظ هذا الطلب بتفاصيل مختلفة. أعد تحميل الذمة الأصلية وراجعها قبل بدء طلب جديد.",
    }
    if (error || !row || !uuid.test(row.id ?? "") || typeof row.replayed !== "boolean") return {
      success: false, error: "Unable to confirm this receivable. Retry with unchanged details.",
      errorAr: "تعذر تأكيد حفظ الذمة. أعد المحاولة بالتفاصيل نفسها.",
    }

    revalidatePath("/accounting")
    return { success: true, id: row.id, replayed: row.replayed }
  } catch (e) {
    void e
    return { success: false, error: "Unable to confirm this receivable. Retry with unchanged details.", errorAr: "تعذر تأكيد حفظ الذمة. أعد المحاولة بالتفاصيل نفسها." }
  }
}
