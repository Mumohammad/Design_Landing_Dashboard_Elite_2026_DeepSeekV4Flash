"use server"

// Financial Phase 13 (IMPLEMENTATION-PLAN Phase 12): financial statements.
//
// - getFinancialStatements({period_year, period_month})  read P&L, Balance
//   Sheet and Cash Flow rows for one period from the security_invoker views
// - listStatementPeriods()                               available periods
// - exportStatementCsv({kind, period_year, period_month}) BOM CSV export
// - generateStatementReport({kind, period_year, period_month}) printable A4
//
// The views (migration 052) compute over POSTED entries only, so draft
// entries never leak into statements. security_invoker means the caller's
// RLS applies for browser reads; these server actions use the admin client
// for the guarded exports/reports.

import { createAdminClient } from "@/lib/supabase/admin"
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
  return e instanceof Error ? e.message : "Unknown error"
}

// ── Row shapes (mirror the 052 views) ───────────────────────────────────
type PlRow = {
  account_code: string
  name_ar: string
  name_en: string
  account_type: "income" | "expense"
  normal_balance: "debit" | "credit"
  total_debit: number
  total_credit: number
  net_balance: number
}

type BsRow = {
  account_code: string
  name_ar: string
  name_en: string
  account_type: "asset" | "liability" | "equity"
  normal_balance: "debit" | "credit"
  total_debit: number
  total_credit: number
  balance: number
}

type CfRow = {
  entry_type: string
  entry_count: number
  cash_in: number
  cash_out: number
  net_cash_flow: number
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
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const [pl, bs, cf] = await Promise.all([
      admin.from("profit_loss").select("period_year,period_month").eq("tenant_id", currentUser.tenantId),
      admin.from("balance_sheet").select("period_year,period_month").eq("tenant_id", currentUser.tenantId),
      admin.from("cash_flow").select("period_year,period_month").eq("tenant_id", currentUser.tenantId),
    ])
    if (pl.error) return { success: false, error: pl.error.message }

    const map = new Map<string, { period_year: number; period_month: number }>()
    const add = (rows: unknown[] | null) => {
      for (const r of rows ?? []) {
        const row = r as { period_year: number; period_month: number }
        map.set(`${row.period_year}-${row.period_month}`, {
          period_year: Number(row.period_year),
          period_month: Number(row.period_month),
        })
      }
    }
    add(pl.data)
    add(bs.data)
    add(cf.data)

    const periods = [...map.values()].sort((a, b) =>
      b.period_year - a.period_year || b.period_month - a.period_month
    )
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
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const tenantEq = { tenant_id: currentUser.tenantId }
    const periodEq = { period_year: input.period_year, period_month: input.period_month }

    const [pl, bs, cf] = await Promise.all([
      admin
        .from("profit_loss")
        .select("account_code,name_ar,name_en,account_type,normal_balance,total_debit,total_credit,net_balance")
        .match({ ...tenantEq, ...periodEq })
        .order("account_code", { ascending: true }),
      admin
        .from("balance_sheet")
        .select("account_code,name_ar,name_en,account_type,normal_balance,total_debit,total_credit,balance")
        .match({ ...tenantEq, ...periodEq })
        .order("account_type", { ascending: true })
        .order("account_code", { ascending: true }),
      admin
        .from("cash_flow")
        .select("entry_type,entry_count,cash_in,cash_out,net_cash_flow")
        .match({ ...tenantEq, ...periodEq })
        .order("entry_type", { ascending: true }),
    ])
    if (pl.error) return { success: false, error: pl.error.message }
    if (bs.error) return { success: false, error: bs.error.message }
    if (cf.error) return { success: false, error: cf.error.message }

    return {
      success: true,
      profitLoss: (pl.data ?? []) as unknown as PlRow[],
      balanceSheet: (bs.data ?? []) as unknown as BsRow[],
      cashFlow: (cf.data ?? []) as unknown as CfRow[],
    }
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
    const { data: tenant } = await admin
      .from("tenants")
      .select("name_ar,name_en,vat_number")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{ name_ar: string | null; name_en: string | null; vat_number: string | null }>()

    const period = `${input.period_year}-${String(input.period_month).padStart(2, "0")}`
    const fmt = (n: number | null | undefined) => Number(n ?? 0)

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
        amount: Math.abs(fmt(r.net_balance)),
        kind: r.account_type === "income" ? "positive" : "negative",
      }))
      const income = pl.filter((r) => r.account_type === "income").reduce((s, r) => s + fmt(r.net_balance), 0)
      const expense = pl.filter((r) => r.account_type === "expense").reduce((s, r) => s + fmt(r.net_balance), 0)
      const net = income + expense // expense net_balance is negative (debit side)
      totals = [
        { labelAr: "الإيرادات", labelEn: "Total Revenue", amount: income, positive: true },
        { labelAr: "المصروفات", labelEn: "Total Expenses", amount: Math.abs(expense), negative: true },
        { labelAr: "صافي الربح / الخسارة", labelEn: "Net Profit / Loss", amount: net, bold: true, positive: net >= 0 },
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
        amount: Math.abs(fmt(r.balance)),
        kind: r.account_type === "asset" ? "positive" : "neutral",
      }))
      const assets = bs.filter((r) => r.account_type === "asset").reduce((s, r) => s + fmt(r.balance), 0)
      const liabilities = bs.filter((r) => r.account_type === "liability").reduce((s, r) => s + fmt(r.balance), 0)
      const equity = bs.filter((r) => r.account_type === "equity").reduce((s, r) => s + fmt(r.balance), 0)
      const balanced = Math.abs(assets - (liabilities + equity)) < 0.01
      totals = [
        { labelAr: "الأصول", labelEn: "Total Assets", amount: assets, positive: true, bold: true },
        { labelAr: "الخصوم", labelEn: "Total Liabilities", amount: liabilities, negative: true },
        { labelAr: "حقوق الملكية", labelEn: "Total Equity", amount: equity },
        {
          labelAr: balanced ? "متوازنة" : "غير متوازنة",
          labelEn: balanced ? "Balanced" : "NOT Balanced",
          amount: assets - (liabilities + equity),
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
        nameAr: r.entry_type,
        nameEn: r.entry_type,
        amount: fmt(r.net_cash_flow),
        kind: fmt(r.net_cash_flow) >= 0 ? "positive" : "negative",
      }))
      const net = cf.reduce((s, r) => s + fmt(r.net_cash_flow), 0)
      totals = [
        { labelAr: "صافي التدفق النقدي", labelEn: "Net Cash Flow", amount: net, bold: true, positive: net >= 0 },
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
        companyNameAr: tenant?.name_ar ?? "نخبة التطوير",
        companyNameEn: tenant?.name_en ?? "Elite Development",
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
