import type { SupabaseClient } from "@supabase/supabase-js"
import { substringFilter } from "@/lib/supabase/search-filter"

export type LedgerKind = "journal" | "receivables" | "payables"
export function isLedgerKind(value: string): value is LedgerKind {
  return value === "journal" || value === "receivables" || value === "payables"
}

/** Browser reads retain tenant/RBAC policies; no privileged client or ID cap. */
export function ledgerQuery(client: SupabaseClient, kind: LedgerKind, search: string) {
  if (kind === "journal") {
    let query = client.from("journal_entries")
      .select("id,entry_ref,entry_date,entry_type,status,description_ar,description_en,posted_at,updated_at,journal_approvals(status)", { count: "exact" })
      .is("deleted_at", null)
    if (search.trim()) query = query.or(substringFilter(["entry_ref", "description_ar", "description_en"], search))
    return query.order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("id")
  }
  if (kind !== "receivables" && kind !== "payables") throw new Error("Unsupported ledger")
  let query = client.from(kind)
    .select("id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status", { count: "exact" })
    .is("deleted_at", null)
  if (search.trim()) query = query.or(substringFilter(["invoice_ref"], search))
  return query.order("due_date", { ascending: true }).order("id")
}
