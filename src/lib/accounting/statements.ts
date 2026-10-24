"use server"

// Financial Phase 13 (IMPLEMENTATION-PLAN Phase 12): financial statements.
//
// - getFinancialStatements({period_year, period_month})  read P&L, Balance
//   Sheet and Cash Flow rows for one period from the security_invoker views
// - listStatementPeriods()                               available periods
// - exportStatementCsv({kind, period_year, period_month}) BOM CSV export
// - generateStatementReport({kind, period_year, period_month}) printable A4
//
// The views include posted originals and their dated reversal entries, while
// excluding drafts and deleted entries. security_invoker means the caller's
// RLS applies for browser reads; these server actions use the admin client
// only for tenant branding; financial reads use the authenticated invoker RPC.

import { decimalRound, sumMoney, sumMoneyValues, type DecimalInput } from "@/lib/accounting/decimal"
import { journalLabel } from "@/lib/accounting/journal-labels"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { mapFinancialError, toCsv } from "@/lib/accounting/csv-utils"
import {
  buildStatementHtml,
  type StatementKind,
  type StatementReportData,
  type StatementRow,
} from "@/lib/accounting/statement-html"

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && e.code === "AUTH007") return "You do not have permission to perform this accounting action."
  return "The accounting operation could not be completed. Reload and try again."
}

// ── Row shapes (mirror the 052 views) ───────────────────────────────────
type PlRow = {
  account_code: string
  name_ar: string
  name_en: string
  account_type: "income" | "expense"
  normal_balance: "debit" | "credit"
  total_debit: DecimalInput
  total_credit: DecimalInput
  net_balance: DecimalInput
}

type BsRow = {
  account_code: string
  name_ar: string
  name_en: string
  account_type: "asset" | "liability" | "equity"
  normal_balance: "debit" | "credit"
  total_debit: DecimalInput
  total_credit: DecimalInput
  balance: DecimalInput
}

type CfRow = {
  entry_type: string
  entry_count: number
  cash_in: DecimalInput
  cash_out: DecimalInput
  net_cash_flow: DecimalInput
}

const KIND_LABELS: Record<StatementKind, { ar: string; en: string }> = {
  profit_loss: { ar: "قائمة الدخل", en: "Profit & Loss" },
  balance_sheet: { ar: "الميزانية العمومية", en: "Balance Sheet" },
  cash_flow: { ar: "التدفقات النقدية", en: "Cash Flow" },
}

/** Distinct (year, month) periods that have statement data for the tenant. */
export async function listStatementPeriods(): Promise<{
  success: boolean
  periods?: { period_year: number; period_month: number }[]
  error?: string
}> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data, error } = await caller.rpc("read_my_financial_report", { p_kind: "periods" })
    if (error || !Array.isArray(data)) return { success: false, error: "Financial periods could not be loaded. Please retry." }
    const periods = data as { period_year: number; period_month: number }[]
    return { success: true, periods }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Read the three statement row sets for one period. */
export async function getFinancialStatements(input: {
  period_year: number
  period_month: number
}): Promise<{
  success: boolean
  profitLoss?: PlRow[]
  balanceSheet?: BsRow[]
  cashFlow?: CfRow[]
  error?: string
}> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const caller = await createClient()
    const { data, error } = await caller.rpc("read_my_financial_report", {
      p_kind: "statements", p_year: input.period_year, p_month: input.period_month,
    })
    if (error || !data || !Array.isArray(data.profit_loss) || !Array.isArray(data.balance_sheet) || !Array.isArray(data.cash_flow)) {
      return { success: false, error: "Financial statements could not be loaded completely. Please retry." }
    }
    const profitLoss = data.profit_loss as PlRow[]
    const balanceSheet = data.balance_sheet as BsRow[]
    const cashFlow = data.cash_flow as CfRow[]
    // Keep exact decimal text in transit; validate every display amount and
    // subtotal before the client renders, so invalid/oversized aggregates fail
    // visibly rather than crashing the page or silently losing cents.
    for (const row of profitLoss) for (const amount of [row.total_debit, row.total_credit, row.net_balance]) decimalRound(amount)
    for (const row of balanceSheet) for (const amount of [row.total_debit, row.total_credit, row.balance]) decimalRound(amount)
    for (const row of cashFlow) for (const amount of [row.cash_in, row.cash_out, row.net_cash_flow]) decimalRound(amount)
    const income = sumMoneyValues(profitLoss.filter(row => row.account_type === "income").map(row => row.net_balance))
    const expense = sumMoneyValues(profitLoss.filter(row => row.account_type === "expense").map(row => row.net_balance))
    sumMoney(income, expense)
    const assets = sumMoneyValues(balanceSheet.filter(row => row.account_type === "asset").map(row => row.balance))
    const liabilities = sumMoneyValues(balanceSheet.filter(row => row.account_type === "liability").map(row => row.balance))
    const equity = sumMoneyValues(balanceSheet.filter(row => row.account_type === "equity").map(row => row.balance))
    sumMoney(assets, -liabilities, -equity)
    sumMoneyValues(cashFlow.map(row => row.net_cash_flow))
    return { success: true, profitLoss, balanceSheet, cashFlow }

  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Export one statement as BOM CSV. */
export async function exportStatementCsv(input: {
  kind: StatementKind
  period_year: number
  period_month: number
}): Promise<{ success: boolean; csv?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const res = await getFinancialStatements({
      period_year: input.period_year,
      period_month: input.period_month,
    })
    if (!res.success) return { success: false, error: res.error }

    let headers: string[]
    let rows: (string | number)[][]
    if (input.kind === "profit_loss") {
      headers = ["account_code", "name_ar", "name_en", "account_type", "normal_balance", "total_debit", "total_credit", "net_balance"]
      rows = (res.profitLoss ?? []).map((r) => [
        r.account_code, r.name_ar, r.name_en, r.account_type, r.normal_balance,
        r.total_debit, r.total_credit, r.net_balance,
      ])
    } else if (input.kind === "balance_sheet") {
      headers = ["account_code", "name_ar", "name_en", "account_type", "normal_balance", "total_debit", "total_credit", "balance"]
      rows = (res.balanceSheet ?? []).map((r) => [
        r.account_code, r.name_ar, r.name_en, r.account_type, r.normal_balance,
        r.total_debit, r.total_credit, r.balance,
      ])
    } else {
      headers = ["entry_type", "entry_count", "cash_in", "cash_out", "net_cash_flow"]
      rows = (res.cashFlow ?? []).map((r) => [
        r.entry_type, r.entry_count, r.cash_in, r.cash_out, r.net_cash_flow,
      ])
    }

    if (rows.length === 0) {
      return { success: false, error: mapFinancialError("STMT001: no financial statement data for this period") }
    }

    const csv = "\uFEFF" + toCsv(headers, rows)

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "statement_exported",
      entityType: "financial_statement",
      newValues: {
        kind: input.kind,
        period_year: input.period_year,
        period_month: input.period_month,
        rows: rows.length,
      },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/** Printable bilingual A4 statement report for one period. */
export async function generateStatementReport(input: {
  kind: StatementKind
  period_year: number
  period_month: number
}): Promise<{ success: boolean; html?: string; error?: string }> {
  try {
    await requirePermission("accounting", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const res = await getFinancialStatements({
      period_year: input.period_year,
      period_month: input.period_month,
    })
    if (!res.success) return { success: false, error: res.error }

    const admin = createAdminClient()
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string | null; name_en: string | null; vat_number: string | null }>()
    if (tenantError || !tenant) return { success: false, error: "Company details could not be loaded for this report." }

    const period = `${input.period_year}-${String(input.period_month).padStart(2, "0")}`
    const fmt = (n: DecimalInput | null | undefined) => Number(n ?? 0)

    let rows: StatementRow[] = []
    let totals: StatementReportData["totals"] = []
    let balanceOk: boolean | undefined

    if (input.kind === "profit_loss") {
      const pl = res.profitLoss ?? []
      if (pl.length === 0) {
        return { success: false, error: mapFinancialError("STMT001: no financial statement data for this period") }
      }
      rows = pl.map((r) => ({
        code: r.account_code,
        nameAr: r.name_ar,
        nameEn: r.name_en,
        amount: r.account_type === "expense" ? -fmt(r.net_balance) : fmt(r.net_balance),
        kind: fmt(r.net_balance)>=0 ? "positive" : "negative",
      }))
      const income = sumMoneyValues(pl.filter((r) => r.account_type === "income").map((r) => r.net_balance))
      const expense = sumMoneyValues(pl.filter((r) => r.account_type === "expense").map((r) => r.net_balance))
      const net = sumMoney(income, expense) // expense net_balance is negative (debit side)
      totals = [
        { labelAr: "الإيرادات", labelEn: "Total Revenue", amount: income, positive: income>=0, negative: income<0 },
        { labelAr: "المصروفات", labelEn: "Total Expenses", amount: -expense, negative: expense<=0, positive: expense>0 },
        { labelAr: "صافي الربح / الخسارة", labelEn: "Net Profit / Loss", amount: net, bold: true, positive: net >= 0, negative: net < 0 },
      ]
    } else if (input.kind === "balance_sheet") {
      const bs = res.balanceSheet ?? []
      if (bs.length === 0) {
        return { success: false, error: mapFinancialError("STMT001: no financial statement data for this period") }
      }
      rows = bs.map((r) => ({
        code: r.account_code,
        nameAr: r.name_ar,
        nameEn: r.name_en,
        amount: fmt(r.balance),
        kind: fmt(r.balance)<0 ? "negative" : r.account_type === "asset" ? "positive" : "neutral",
      }))
      const assets = sumMoneyValues(bs.filter((r) => r.account_type === "asset").map((r) => r.balance))
      const liabilities = sumMoneyValues(bs.filter((r) => r.account_type === "liability").map((r) => r.balance))
      const equity = sumMoneyValues(bs.filter((r) => r.account_type === "equity").map((r) => r.balance))
      const balanced = sumMoney(assets, -liabilities, -equity) === 0
      totals = [
        { labelAr: "الأصول", labelEn: "Total Assets", amount: assets, positive: true, bold: true },
        { labelAr: "الخصوم", labelEn: "Total Liabilities", amount: liabilities, negative: true },
        { labelAr: "حقوق الملكية", labelEn: "Total Equity", amount: equity },
        {
          labelAr: balanced ? "متوازنة" : "غير متوازنة",
          labelEn: balanced ? "Balanced" : "NOT Balanced",
          amount: sumMoney(assets, -liabilities, -equity),
          bold: true,
          positive: balanced,
        },
      ]
      balanceOk = balanced
    } else {
      const cf = res.cashFlow ?? []
      if (cf.length === 0) {
        return { success: false, error: mapFinancialError("STMT001: no financial statement data for this period") }
      }
      rows = cf.map((r) => ({
        code: r.entry_type,
        nameAr: journalLabel(r.entry_type, "ar"),
        nameEn: journalLabel(r.entry_type, "en"),
        amount: fmt(r.net_cash_flow),
        kind: fmt(r.net_cash_flow) >= 0 ? "positive" : "negative",
      }))
      const net = sumMoneyValues(cf.map((r) => r.net_cash_flow))
      totals = [
        { labelAr: "صافي التدفق النقدي", labelEn: "Net Cash Flow", amount: net, bold: true, positive: net >= 0, negative: net < 0 },
      ]
    }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "statement_report_generated",
      entityType: "financial_statement",
      newValues: {
        kind: input.kind,
        period_year: input.period_year,
        period_month: input.period_month,
      },
    })

    return {
      success: true,
      html: buildStatementHtml({
        companyNameAr: tenant.name_ar ?? "",
        companyNameEn: tenant.name_en ?? "",
        companyVatNumber: tenant?.vat_number ?? "—",
        generatedAt: new Date().toISOString(),
        kind: input.kind,
        period,
        rows,
        totals,
        balanceOk,
        note: KIND_LABELS[input.kind].ar,
      }),
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
