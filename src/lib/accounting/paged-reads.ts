import type { SupabaseClient } from "@supabase/supabase-js"

export type AccountingPageKind = "payments" | "receivables" | "payables" | "open_ar" | "open_ap" | "customers" | "suppliers" | "accounts" | "asset_accounts" | "trial" | "vat_output" | "vat_input" | "vat_review" | "vat_adjustments" | "vat_periods" | "vat_recon" | "vat_months" | "periods" | "events" | "zatca"
export type PaymentSummary = { payment_count: number; inflow: string; outflow: string; unallocated: string; outstanding_ar: string; outstanding_ap: string }
export type AccountingPage<T> = { rows: T[]; total: number; page: number; page_size: number; summary: PaymentSummary | null }
const moneyFields = new Set(["amount","vat_amount","total_amount","paid_amount","outstanding","unallocated_amount","debit_amount","credit_amount","total_debit","total_credit","net_balance","vat_base_amount","base_amount","output_vat","recoverable_input_vat","non_recoverable_vat","pending_review_vat","adjustments_output","adjustments_input","net_position"])
const invalid = () => new Error("Could not load accounting records")
export function parseAccountingPage<T>(data: unknown, page: number, pageSize: number, exporting = false, kind?: AccountingPageKind): AccountingPage<T> {
 if (!data || typeof data !== "object" || Array.isArray(data)) throw invalid()
 const value = data as AccountingPage<T>
 if (!Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page || value.page_size !== pageSize || !Array.isArray(value.rows)
   || value.rows.length !== (exporting ? value.total : Math.min(pageSize,Math.max(0,value.total-(page-1)*pageSize)))) throw invalid()
 for (const row of value.rows) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw invalid()
  const record = row as Record<string,unknown>
  if (kind === "payments" && (typeof record.id !== "string" || typeof record.amount !== "string" || typeof record.unallocated_amount !== "string")) throw invalid()
  for (const [key, amount] of Object.entries(row)) if (moneyFields.has(key) && (typeof amount !== "string" || !/^-?\d{1,40}(?:\.\d{1,2})?$/.test(amount))) throw invalid()
 }
 if (value.summary !== null) {
  if (!value.summary || !Number.isSafeInteger(value.summary.payment_count) || value.summary.payment_count < 0) throw invalid()
  for (const key of ["inflow","outflow","unallocated","outstanding_ar","outstanding_ap"] as const)
   if (typeof value.summary[key] !== "string" || !/^-?\d{1,40}(?:\.\d{1,2})?$/.test(value.summary[key])) throw invalid()
 }
 return value
}
export async function readAccountingPage<T>(client: SupabaseClient, kind: AccountingPageKind, options: { search?: string; page?: number; pageSize?: number; party?: string; exporting?: boolean; signal?: AbortSignal } = {}): Promise<AccountingPage<T>> {
 const { search = "", page = 1, pageSize = 25, party, exporting = false, signal } = options
 let query = client.rpc("read_my_accounting_page",{p_kind:kind,p_search:search,p_page:page,p_page_size:pageSize,p_party:party||null,p_export:exporting})
 if (signal) query=query.abortSignal(signal)
 try {
  const { data, error } = await query
  if (signal?.aborted || error) throw invalid()
  return parseAccountingPage<T>(data,page,pageSize,exporting,kind)
 } catch { throw invalid() }
}

/** Exact display aggregation; keeps large ledger totals out of binary floats. */
export function sumAccountingMoney(...values: (string | number)[]): string {
 let cents=BigInt(0)
 for(const value of values){const text=String(value);if(!/^-?\d{1,40}(?:\.\d{1,2})?$/.test(text))throw invalid();const [whole,fraction=""]=text.replace(/^-/,"").split(".");const amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));cents+=text.startsWith("-")?-amount:amount}
 const amount=cents<BigInt(0)?-cents:cents
 return (cents<BigInt(0)?"-":"")+String(amount/BigInt(100))+"."+String(amount%BigInt(100)).padStart(2,"0")
}
