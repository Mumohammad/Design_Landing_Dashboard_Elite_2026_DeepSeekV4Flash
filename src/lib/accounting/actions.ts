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
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { getErrorDefinition } from "@/lib/errors/error-codes"

type ActionResult = { success: boolean; error?: string }

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense"
export type NormalBalance = "debit" | "credit"

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"]

/** Conventional normal balance per account type (contra accounts opt out). */
export const CONVENTIONAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Unknown error"
}

/**
 * Map a DB-raised financial exception code (e.g. "JRN004: …", "ACC001: …")
 * to its bilingual user-facing message from the error taxonomy. Falls back to
 * the raw message when the code is unknown.
 */
export function mapFinancialError(raw: string): string {
  const code = raw.split(":")[0]?.trim()
  if (!code) return raw
  const def = getErrorDefinition(code)
  return def && def.code !== "ERR_INTERNAL" ? def.messageEn : raw
}

export async function createChartAccount(input: {
  account_code: string
  name_ar: string
  name_en: string
  account_type: AccountType
  normal_balance: NormalBalance
  parent_id?: string | null
  is_contra?: boolean
  description?: string | null
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const code = input.account_code.trim()
    if (!/^\d{3,6}$/.test(code)) {
      return { success: false, error: "Account code must be 3-6 digits." }
    }
    if (!input.name_ar.trim() || !input.name_en.trim()) {
      return { success: false, error: "Arabic and English names are required." }
    }
    if (!ACCOUNT_TYPES.includes(input.account_type)) {
      return { success: false, error: "Invalid account type." }
    }
    const isContra = input.is_contra ?? false
    if (!isContra && CONVENTIONAL_BALANCE[input.account_type] !== input.normal_balance) {
      return {
        success: false,
        error: `A ${input.account_type} account normally carries a ${CONVENTIONAL_BALANCE[input.account_type]} balance. Mark it as a contra account to override.`,
      }
    }

    const admin = createAdminClient()
    const { data: row, error } = await admin
      .from("chart_of_accounts")
      .insert({
        tenant_id: currentUser.tenantId,
        account_code: code,
        name_ar: input.name_ar.trim(),
        name_en: input.name_en.trim(),
        account_type: input.account_type,
        normal_balance: input.normal_balance,
        parent_id: input.parent_id || null,
        is_contra: isContra,
        description: input.description?.trim() || null,
        created_by: currentUser.id,
      })
      .select("id")
      .single()

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "An account with this code already exists." }
      }
      return { success: false, error: mapFinancialError(error.message) }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "account_created",
      entityType: "chart_of_accounts",
      entityId: row.id,
      newValues: {
        account_code: code,
        name_ar: input.name_ar,
        account_type: input.account_type,
        normal_balance: input.normal_balance,
        parent_id: input.parent_id || null,
        is_contra: isContra,
      },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function updateChartAccount(input: {
  account_id: string
  account_code?: string
  name_ar?: string
  name_en?: string
  account_type?: AccountType
  normal_balance?: NormalBalance
  parent_id?: string | null
  is_contra?: boolean
  is_active?: boolean
  description?: string | null
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()

    // Fetch the existing row (service-role client must scope by tenant).
    const { data: existing, error: fetchError } = await admin
      .from("chart_of_accounts")
      .select("id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description,deleted_at")
      .eq("id", input.account_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .maybeSingle()

    if (fetchError || !existing) {
      return { success: false, error: "Account not found." }
    }

    const code = input.account_code !== undefined ? input.account_code.trim() : existing.account_code
    if (!/^\d{3,6}$/.test(code)) {
      return { success: false, error: "Account code must be 3-6 digits." }
    }
    const accountType: AccountType = (input.account_type ?? existing.account_type) as AccountType
    if (!ACCOUNT_TYPES.includes(accountType)) {
      return { success: false, error: "Invalid account type." }
    }
    const isContra = input.is_contra ?? existing.is_contra
    if (!isContra && CONVENTIONAL_BALANCE[accountType] !== input.normal_balance && input.normal_balance !== undefined) {
      return {
        success: false,
        error: `A ${accountType} account normally carries a ${CONVENTIONAL_BALANCE[accountType]} balance. Mark it as a contra account to override.`,
      }
    }

    const { error } = await admin
      .from("chart_of_accounts")
      .update({
        account_code: code,
        name_ar: input.name_ar !== undefined ? input.name_ar.trim() : existing.name_ar,
        name_en: input.name_en !== undefined ? input.name_en.trim() : existing.name_en,
        account_type: accountType,
        normal_balance: input.normal_balance ?? existing.normal_balance,
        parent_id: input.parent_id !== undefined ? input.parent_id || null : existing.parent_id,
        is_contra: isContra,
        is_active: input.is_active ?? existing.is_active,
        description: input.description !== undefined ? input.description?.trim() || null : existing.description,
        updated_by: currentUser.id,
      })
      .eq("id", input.account_id)
      .eq("tenant_id", currentUser.tenantId)

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "An account with this code already exists." }
      }
      return { success: false, error: mapFinancialError(error.message) }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "account_updated",
      entityType: "chart_of_accounts",
      entityId: input.account_id,
      oldValues: {
        account_code: existing.account_code,
        name_ar: existing.name_ar,
        account_type: existing.account_type,
        normal_balance: existing.normal_balance,
        is_active: existing.is_active,
      },
      newValues: {
        account_code: code,
        name_ar: input.name_ar !== undefined ? input.name_ar.trim() : existing.name_ar,
        account_type: accountType,
        normal_balance: input.normal_balance ?? existing.normal_balance,
        is_active: input.is_active ?? existing.is_active,
        is_contra: isContra,
      },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function deactivateChartAccount(input: { account_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { error } = await admin
      .from("chart_of_accounts")
      .update({ is_active: false, updated_by: currentUser.id })
      .eq("id", input.account_id)
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    if (error) {
      return { success: false, error: mapFinancialError(error.message) }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "account_deactivated",
      entityType: "chart_of_accounts",
      entityId: input.account_id,
      newValues: { is_active: false },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── CSV helpers (no external dependency — small, RFC-4180-ish) ────────────
// Exported so the parties module (customers/suppliers) reuses the same
// parser/serializer used by the CoA import/export.

export async function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

export async function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null): string => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")
}

export async function exportChartAccountsCsv(): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("chart_of_accounts")
      .select("id,account_code,name_ar,name_en,account_type,normal_balance,parent_id,is_contra,is_active,description")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("account_code", { ascending: true })

    if (error) return { success: false, error: error.message }

    const byId = new Map((data ?? []).map((a) => [a.id, a] as const))
    const rows = (data ?? []).map((a) => {
      const parent = a.parent_id ? byId.get(a.parent_id) : undefined
      return [
        a.account_code,
        a.name_ar,
        a.name_en,
        a.account_type,
        a.normal_balance,
        parent?.account_code ?? "",
        a.is_contra ? "true" : "false",
        a.is_active ? "true" : "false",
        a.description ?? "",
      ]
    })

    // UTF-8 BOM so Excel renders Arabic correctly.
    const csv = "\uFEFF" + toCsv(
      ["account_code", "name_ar", "name_en", "account_type", "normal_balance", "parent_code", "is_contra", "is_active", "description"],
      rows
    )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "chart_of_accounts_exported",
      entityType: "chart_of_accounts",
      newValues: { rows: (data ?? []).length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export type CsvImportResult = {
  success: boolean
  imported?: number
  skipped?: number
  errors?: string[]
  error?: string
}

export async function importChartAccountsCsv(input: { csv: string }): Promise<CsvImportResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const parsed = parseCsv(input.csv)
    if (parsed.length < 2) {
      return { success: false, error: "CSV must contain a header row and at least one account." }
    }

    const header = parsed[0].map((h) => h.trim().toLowerCase())
    const idx = (name: string) => header.indexOf(name)
    // indexOf returns -1 (never nullish), so plain lookups — no ?? fallbacks.
    const col = {
      code: idx("account_code"),
      ar: idx("name_ar"),
      en: idx("name_en"),
      type: idx("account_type"),
      balance: idx("normal_balance"),
      parent: idx("parent_code"),
      contra: idx("is_contra"),
      active: idx("is_active"),
      desc: idx("description"),
    }
    if (col.code < 0 || col.ar < 0 || col.en < 0 || col.type < 0 || col.balance < 0) {
      return {
        success: false,
        error: "CSV must include columns: account_code, name_ar, name_en, account_type, normal_balance.",
      }
    }

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("chart_of_accounts")
      .select("account_code,id,parent_id")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)

    const codeToId = new Map<string, string>((existing ?? []).map((a) => [a.account_code, a.id]))
    const imported: string[] = []
    const errors: string[] = []

    for (let r = 1; r < parsed.length; r++) {
      const row = parsed[r]
      const code = (row[col.code] ?? "").trim()
      if (!/^\d{3,6}$/.test(code)) {
        errors.push(`Row ${r + 1}: invalid code "${code}"`)
        continue
      }
      if (codeToId.has(code)) {
        // existing rows are skipped (idempotent re-import)
        continue
      }
      const nameAr = (row[col.ar] ?? "").trim()
      const nameEn = (row[col.en] ?? "").trim()
      if (!nameAr || !nameEn) {
        errors.push(`Row ${r + 1}: Arabic and English names are required`)
        continue
      }
      const type = (row[col.type] ?? "").trim() as AccountType
      if (!ACCOUNT_TYPES.includes(type)) {
        errors.push(`Row ${r + 1}: invalid account_type "${row[col.type]}"`)
        continue
      }
      const balance = (row[col.balance] ?? "").trim() as NormalBalance
      if (balance !== "debit" && balance !== "credit") {
        errors.push(`Row ${r + 1}: normal_balance must be debit or credit`)
        continue
      }
      const isContra = col.contra >= 0 ? (row[col.contra] ?? "").trim().toLowerCase() === "true" : false
      if (!isContra && CONVENTIONAL_BALANCE[type] !== balance) {
        errors.push(`Row ${r + 1}: ${type} account normally carries a ${CONVENTIONAL_BALANCE[type]} balance`)
        continue
      }
      // is_active round-trips from export (defaults to true when absent)
      const isActive = col.active < 0 ? true : (row[col.active] ?? "true").trim().toLowerCase() !== "false"
      // parent must resolve within existing accounts or earlier rows in the file
      let parentId: string | null = null
      const parentCode = col.parent >= 0 ? (row[col.parent] ?? "").trim() : ""
      if (parentCode) {
        parentId = codeToId.get(parentCode) ?? null
        if (!parentId) {
          errors.push(`Row ${r + 1}: parent_code "${parentCode}" not found`)
          continue
        }
      }

      const { data: inserted, error } = await admin
        .from("chart_of_accounts")
        .insert({
          tenant_id: currentUser.tenantId,
          account_code: code,
          name_ar: nameAr,
          name_en: nameEn,
          account_type: type,
          normal_balance: balance,
          parent_id: parentId,
          is_contra: isContra,
          is_active: isActive,
          description: col.desc >= 0 ? (row[col.desc] ?? "").trim() || null : null,
          created_by: currentUser.id,
        })
        .select("id")
        .single()

      if (error) {
        errors.push(`Row ${r + 1} (${code}): ${mapFinancialError(error.message)}`)
        continue
      }
      codeToId.set(code, inserted.id)
      imported.push(code)
    }

    const skipped = parsed.length - 1 - imported.length - errors.length
    if (imported.length > 0) {
      await writeAuditLog({
        tenantId: currentUser.tenantId,
        actorId: currentUser.id,
        module: "accounting",
        action: "chart_of_accounts_imported",
        entityType: "chart_of_accounts",
        newValues: { imported: imported.length, skipped, errors: errors.length },
      })
      revalidatePath("/accounting")
    }

    return { success: errors.length === 0, imported: imported.length, skipped, errors }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function initializeDefaultCoa(): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("ensure_default_chart_of_accounts", {
      p_tenant_id: currentUser.tenantId,
    })

    if (error) return { success: false, error: error.message }

    const inserted = Array.isArray(data) ? (data[0] as number | undefined) : (data as number | undefined)
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "default_chart_of_accounts_loaded",
      entityType: "chart_of_accounts",
      newValues: { inserted: inserted ?? 0 },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function postOpeningBalances(input: {
  entry_date: string
  lines: { account_id: string; description?: string; debit: number; credit: number }[]
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0)
    if (lines.length < 2) {
      return { success: false, error: "Opening balances need at least two lines." }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100
    const linesPayload = lines.map((l) => ({
      account_id: l.account_id,
      description: l.description?.trim() || null,
      debit: round2(l.debit),
      credit: round2(l.credit),
    }))

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("post_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_date: input.entry_date,
      p_description_ar: "رصيد افتتاحي",
      p_description_en: "Opening balances",
      p_created_by: currentUser.id,
      p_entry_type: "opening",
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
      actorId: currentUser.id,
      module: "accounting",
      action: "opening_balances_posted",
      entityType: "journal_entries",
      entityId: row.out_entry_id,
      newValues: { entry_ref: row.out_entry_ref, lines: lines.length },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

// ── Phase 3 — Journal Engine actions ──────────────────────────────────────
// Reversal, approval workflow, period close/reopen. All route through atomic
// service-role RPCs (migration 034) — no partial states.

export async function createJournalDraft(input: {
  entry_date: string
  description_ar: string
  description_en?: string | null
  lines: { account_id: string; description?: string; debit: number; credit: number }[]
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0)
    if (lines.length < 2) {
      return { success: false, error: "A journal entry needs at least two lines." }
    }
    if (!input.description_ar.trim()) {
      return { success: false, error: "A description is required." }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100
    const linesPayload = lines.map((l) => ({
      account_id: l.account_id,
      description: l.description?.trim() || null,
      debit: round2(l.debit),
      credit: round2(l.credit),
    }))

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("create_journal_draft", {
      p_tenant_id: currentUser.tenantId,
      p_entry_date: input.entry_date,
      p_description_ar: input.description_ar.trim(),
      p_description_en: input.description_en?.trim() || null,
      p_created_by: currentUser.id,
      p_lines: linesPayload,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.out_entry_id) {
      return { success: false, error: "Saving draft failed." }
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "journal_draft_created",
      entityType: "journal_entries",
      entityId: row.out_entry_id,
      newValues: { entry_ref: row.out_entry_ref },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function submitJournalEntry(input: { entry_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "update")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { error } = await admin.rpc("submit_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_submitted_by: currentUser.id,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "journal_submitted_for_approval",
      entityType: "journal_entries",
      entityId: input.entry_id,
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

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("approve_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_approved_by: currentUser.id,
      p_comment: input.comment?.trim() || null,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = Array.isArray(data) ? data[0] : data
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "journal_approved",
      entityType: "journal_entries",
      entityId: input.entry_id,
      newValues: { entry_ref: row?.out_entry_ref ?? null },
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

    const admin = createAdminClient()
    const { error } = await admin.rpc("reject_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_reason: input.reason.trim(),
      p_rejected_by: currentUser.id,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "journal_rejected",
      entityType: "journal_entries",
      entityId: input.entry_id,
      newValues: { reason: input.reason.trim() },
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

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("reverse_journal_entry", {
      p_tenant_id: currentUser.tenantId,
      p_entry_id: input.entry_id,
      p_description_ar: input.description_ar?.trim() || null,
      p_description_en: input.description_en?.trim() || null,
      p_reversal_date: input.reversal_date || null,
      p_created_by: currentUser.id,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = Array.isArray(data) ? data[0] : data
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
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

    const admin = createAdminClient()
    const { error } = await admin.rpc("close_accounting_period", {
      p_tenant_id: currentUser.tenantId,
      p_period_id: input.period_id,
      p_closed_by: currentUser.id,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
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

    const admin = createAdminClient()
    const { error } = await admin.rpc("reopen_accounting_period", {
      p_tenant_id: currentUser.tenantId,
      p_period_id: input.period_id,
      p_reason: input.reason.trim(),
      p_reopened_by: currentUser.id,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
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

    const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0)
    if (lines.length < 2) {
      return { success: false, error: "A journal entry needs at least two lines." }
    }
    if (!input.description_ar.trim()) {
      return { success: false, error: "A description is required." }
    }

    // Round to 2dp in integer-minor arithmetic so the exact NUMERIC comparison
    // in the DB function never trips on float artifacts (e.g. 0.1 + 0.2).
    const round2 = (n: number) => Math.round(n * 100) / 100
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
      p_created_by: currentUser.id,
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
      actorId: currentUser.id,
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

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

export async function createReceivable(input: {
  invoice_ref: string
  invoice_date: string
  due_date: string
  amount: number
  vat_rate: number
}): Promise<ActionResult> {
  try {
    await requirePermission("accounting", "create")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const amount = Number(input.amount)
    const vatRate = Number(input.vat_rate)
    if (!input.invoice_ref.trim() || amount <= 0 || vatRate < 0 || vatRate > 100) {
      return { success: false, error: "Invoice reference, positive amount, and a valid VAT rate are required." }
    }
    if (new Date(input.due_date) < new Date(input.invoice_date)) {
      return { success: false, error: "Due date cannot be before the invoice date." }
    }

    const vatAmount = Math.round(amount * vatRate) / 100
    const total = amount + vatAmount

    const admin = createAdminClient()
    const { data: row, error } = await admin
      .from("receivables")
      .insert({
        tenant_id: currentUser.tenantId,
        invoice_ref: input.invoice_ref.trim(),
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        amount,
        vat_amount: vatAmount,
        total_amount: total,
        paid_amount: 0,
        status: "open",
        source_entity_type: "manual",
      })
      .select("id")
      .single()

    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.id,
      module: "accounting",
      action: "receivable_created",
      entityType: "receivables",
      entityId: row.id,
      newValues: { invoice_ref: input.invoice_ref, total_amount: total, vat_amount: vatAmount },
    })

    revalidatePath("/accounting")
    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
