import type { SupabaseClient } from "@supabase/supabase-js"
import { substringFilter } from "@/lib/supabase/search-filter"
import { collectRows } from "@/lib/reports/collect-rows"
import { sumMoney } from "@/lib/accounting/decimal"
import { RECOVERABILITY, type ExpenseVatRecoverability } from "./constants"

export interface ExpenseRow {
  id: string
  expense_code: string | null
  expense_type: string
  category: string | null
  amount: number
  currency: string
  expense_date: string
  description: string | null
  is_approved: boolean
  rejected_at: string | null
  rejection_reason: string | null
  vendor: string | null
  vat_rate: number
  vat_amount: number
  vat_recoverability: string
  coa_account_code: string | null
  driver: { full_name_ar: string; driver_code: string } | null
}

const FIELDS = "id,expense_code,expense_type,category,amount,currency,expense_date,description,is_approved,rejected_at,rejection_reason,vendor,vat_rate,vat_amount,vat_recoverability,coa_account_code,driver:drivers(full_name_ar,driver_code),driver_search:drivers()"

export function expensesQuery(client: SupabaseClient, search: string) {
  let query = client.from("expenses").select(FIELDS, { count: "exact" }).is("deleted_at", null)
  if (search.trim()) query = query
    .or(substringFilter(["full_name_ar", "full_name_en", "driver_code"], search), { referencedTable: "driver_search" })
    .or(`${substringFilter(["expense_code", "vendor", "expense_type", "category", "description"], search)},driver_search.not.is.null`)
  return query.order("expense_date", { ascending: false }).order("id")
}

/** Complete RLS-scoped overview, independent of the rendered page/search.
 * Uses the shared checked 100,000-row budget; never returns partial money totals. */
export async function expensesSummary(client: SupabaseClient, signal: AbortSignal) {
  const rows = await collectRows(() => client.from("expenses")
    .select("id,amount,vat_amount,currency,is_approved,rejected_at", { count: "exact" })
    .is("deleted_at", null).order("id").abortSignal(signal))
  let net = 0, vat = 0, pending = 0
  for (const row of rows) {
    // Do not add currencies together or silently turn missing financial data into zero.
    if (row.currency !== "SAR" || typeof row.is_approved !== "boolean"
      || !(row.rejected_at === null || (typeof row.rejected_at === "string" && Number.isFinite(Date.parse(row.rejected_at))))
      || (row.is_approved && row.rejected_at !== null)
      || ![row.amount, row.vat_amount].every(value =>
        (typeof value === "number" || typeof value === "string") && /^\d+(\.\d{1,2})?$/.test(String(value)))) {
      throw new Error("Could not load expense totals")
    }
    net = sumMoney(net, row.amount as number | string)
    vat = sumMoney(vat, row.vat_amount as number | string)
    if (!row.is_approved && row.rejected_at === null) pending++
  }
  return { count: rows.length, pending, net, vat }
}

export async function expenseDependencies(client: SupabaseClient, signal: AbortSignal) {
  const mappings = await client.from("expense_category_mappings")
    .select("expense_type,coa_account_code,vat_recoverability", { count: "exact" }).abortSignal(signal)
  if (mappings.error || !Array.isArray(mappings.data) || mappings.count !== mappings.data.length) throw new Error("Could not load expense mappings")
  const byType: Record<string, string> = {}
  const recoverabilityByType: Record<string, ExpenseVatRecoverability> = {}
  for (const row of mappings.data) {
    if (typeof row.expense_type !== "string" || typeof row.coa_account_code !== "string"
      || !RECOVERABILITY.includes(row.vat_recoverability as ExpenseVatRecoverability)) throw new Error("Could not load expense mappings")
    byType[row.expense_type] = row.coa_account_code
    recoverabilityByType[row.expense_type] = row.vat_recoverability as ExpenseVatRecoverability
  }
  const codes = [...new Set(Object.values(byType))]
  const names: Record<string, string> = {}
  if (codes.length) {
    const accounts = await client.from("chart_of_accounts")
      .select("account_code,name_ar", { count: "exact" }).is("deleted_at", null)
      .in("account_code", codes).abortSignal(signal)
    if (accounts.error || !Array.isArray(accounts.data) || accounts.count !== accounts.data.length) throw new Error("Could not load expense accounts")
    for (const row of accounts.data) {
      if (typeof row.account_code !== "string" || typeof row.name_ar !== "string") throw new Error("Could not load expense accounts")
      names[row.account_code] = row.name_ar
    }
    if (codes.some(code => !Object.prototype.hasOwnProperty.call(names, code))) throw new Error("Could not load expense accounts")
  }
  return { byType, names, recoverabilityByType }
}
