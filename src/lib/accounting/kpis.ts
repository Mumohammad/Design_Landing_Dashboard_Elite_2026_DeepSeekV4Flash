"use server"

// Financial KPI service (Prompt I — Part 2). The dashboard's #55 gap:
// accounting-sourced aggregates with REAL sources behind them.
//
// Composes existing indexes only — no new RPC justified:
//   * invoices   idx_invoices_tenant_date (tenant_id, issue_date DESC) 038
//   * expenses   idx_expenses_active      (tenant_id, expense_date DESC) 021
// Reads run through the RLS-bound server client, so every row is already
// tenant-scoped by policy — the tenant id never crosses from the browser.
//
// Windowing mirrors the dashboard snapshot (analytics/actions.ts):
// [start, end] ISO dates; "previous" is the immediately preceding window of
// the same length. Money returns rounded SAR numbers.

import { startOfDay, endOfDay, subDays, format } from "date-fns"
import { createClient } from "@/lib/supabase/server"

export type AccountingKpiWindowInput = {
  /** Inclusive period start, ISO date "YYYY-MM-DD". */
  start: string
  /** Inclusive period end, ISO date "YYYY-MM-DD". */
  end: string
}

export type FinancialKpis = {
  /** Sum of TOTAL on finalized sales invoices issued in the window. */
  revenue: number
  revenuePrevious: number
  /** Finalized invoices issued in the window (count). */
  invoicesCount: number
  invoicesCountPrevious: number
  /** Sum of TOTAL on issued+ invoices NOT yet paid/credited (any issue date). */
  pendingInvoicesAmount: number
  /** Count of issued+ invoices NOT yet paid/credited. */
  pendingInvoicesCount: number
  /** Sum of AMOUNT on recorded expenses dated in the window. */
  expenses: number
  expensesPrevious: number
  /** Expenses recorded in the window (count). */
  expensesCount: number
  /** revenue − expenses for the window (informational; revenue is invoice-side). */
  netResult: number
  /** Module reachability — false when a table is missing/unreadable. */
  available: boolean
}

/** Invoice statuses that count as issued (beyond draft) and not settled. */
const ISSUED_NOT_PAID = ["issued", "finalized", "partially_paid", "overdue"] as const

export async function getFinancialKpis(
  input: AccountingKpiWindowInput,
): Promise<FinancialKpis> {
  const supabase = await createClient()

  const empty: FinancialKpis = {
    revenue: 0,
    revenuePrevious: 0,
    invoicesCount: 0,
    invoicesCountPrevious: 0,
    pendingInvoicesAmount: 0,
    pendingInvoicesCount: 0,
    expenses: 0,
    expensesPrevious: 0,
    expensesCount: 0,
    netResult: 0,
    available: false,
  }

  // Derive the previous window from the same wall-clock bounds.
  const start = startOfDay(new Date(`${input.start}T00:00:00`))
  const end = endOfDay(new Date(`${input.end}T00:00:00`))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return empty
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000))
  const prevStart = startOfDay(subDays(start, days))
  const startIso = format(start, "yyyy-MM-dd")
  const prevStartIso = format(prevStart, "yyyy-MM-dd")
  const endIso = format(end, "yyyy-MM-dd")

  // ── Invoices: one read covering current window, previous window, pending ──
  // Selecting from the earliest of (prevStart, pending set needs no date bound)
  // — filter in-app so ONE query serves all four invoice aggregates. The
  // (tenant_id, issue_date DESC) index (038) serves the date predicate; the
  // (tenant_id, status) index serves pending. Rows are header totals only.
  let invoices: { issue_date: string; status: string; total: number | null }[] = []
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("issue_date, status, total")
      .eq("invoice_type", "sales")
      .is("deleted_at", null)
      .gte("issue_date", prevStartIso)
      .lte("issue_date", endIso)
    if (error) throw error
    invoices = (data ?? []) as typeof invoices
  } catch {
    return empty
  }

  // Pending needs the full set, not just the window — separate bounded read.
  let pending: { total: number | null }[] = []
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("total")
      .eq("invoice_type", "sales")
      .is("deleted_at", null)
      .in("status", [...ISSUED_NOT_PAID])
    if (error) throw error
    pending = (data ?? []) as typeof pending
  } catch {
    return empty
  }

  const inWindow = (d: string, from: string) => d >= from && d <= endIso
  const currentRows = invoices.filter((r) => inWindow(r.issue_date, startIso))
  const previousRows = invoices.filter((r) => inWindow(r.issue_date, prevStartIso) && r.issue_date < startIso)
  const revenue = currentRows
    .filter((r) => r.status === "finalized")
    .reduce((s, r) => s + Number(r.total ?? 0), 0)
  const revenuePrevious = previousRows
    .filter((r) => r.status === "finalized")
    .reduce((s, r) => s + Number(r.total ?? 0), 0)

  const pendingInvoicesAmount = Math.round(
    pending.reduce((s, r) => s + Number(r.total ?? 0), 0),
  )

  // ── Expenses ────────────────────────────────────────────────────────────────
  let expenses: { expense_date: string; amount: number | null }[] = []
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("expense_date, amount")
      .is("deleted_at", null)
      .gte("expense_date", prevStartIso)
      .lte("expense_date", endIso)
    if (error) throw error
    expenses = (data ?? []) as typeof expenses
  } catch {
    return empty
  }

  const expensesCurrent = expenses.filter((r) => inWindow(r.expense_date, startIso))
  const expensesPrevious = expenses.filter(
    (r) => inWindow(r.expense_date, prevStartIso) && r.expense_date < startIso,
  )
  const expensesSum = expensesCurrent.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  return {
    revenue: Math.round(revenue),
    revenuePrevious: Math.round(revenuePrevious),
    invoicesCount: currentRows.length,
    invoicesCountPrevious: previousRows.length,
    pendingInvoicesAmount,
    pendingInvoicesCount: pending.length,
    expenses: Math.round(expensesSum),
    expensesPrevious: Math.round(
      expensesPrevious.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    ),
    expensesCount: expensesCurrent.length,
    netResult: Math.round(revenue - expensesSum),
    available: true,
  }
}
