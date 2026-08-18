"use client"

// Financial Phase 13 (IMPLEMENTATION-PLAN Phase 12) — Financial statements
// manager (P&L, Balance Sheet, Cash Flow) embedded in the /accounting page's
// "Statements" tab. Bilingual (AR/EN, RTL-aware).
//
// Reads from the security_invoker views (migration 052) via the server
// actions (src/lib/accounting/statements.ts); CSV + print go through the
// guarded export actions.

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import {
  listStatementPeriods,
  getFinancialStatements,
  exportStatementCsv,
  generateStatementReport,
} from "@/lib/accounting/statements"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react"

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

function fmtMoney(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const dialogBtn = "inline-flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-elite-blue-600 to-elite-blue-700 px-3 text-xs font-medium text-white shadow-sm transition-all hover:from-elite-blue-700 hover:to-elite-blue-800"

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2 text-start text-[11px] font-medium text-muted-foreground ${className}`}>{children}</th>
}

function Td({
  children,
  className = "",
  colSpan,
  dir,
}: {
  children?: React.ReactNode
  className?: string
  colSpan?: number
  dir?: string
}) {
  return (
    <td colSpan={colSpan} dir={dir} className={`px-4 py-2.5 text-xs ${className}`}>
      {children}
    </td>
  )
}

export function StatementsManager() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"
  const [periods, setPeriods] = useState<{ period_year: number; period_month: number }[]>([])
  const [period, setPeriod] = useState("")
  const [loading, setLoading] = useState(true)
  const [pl, setPl] = useState<PlRow[]>([])
  const [bs, setBs] = useState<BsRow[]>([])
  const [cf, setCf] = useState<CfRow[]>([])
  const [exporting, setExporting] = useState<string | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await listStatementPeriods()
      if (res.success && res.periods) {
        setPeriods(res.periods)
        if (res.periods.length > 0) {
          setPeriod((p) => p || `${res.periods![0].period_year}-${String(res.periods![0].period_month).padStart(2, "0")}`)
        }
      }
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (!period) return
    void (async () => {
      setLoading(true)
      const [year, month] = period.split("-").map(Number)
      if (!year || !month) return
      const res = await getFinancialStatements({ period_year: year, period_month: month })
      setLoading(false)
      if (res.success) {
        setPl(res.profitLoss ?? [])
        setBs(res.balanceSheet ?? [])
        setCf(res.cashFlow ?? [])
      } else {
        setPl([])
        setBs([])
        setCf([])
      }
    })()
  }, [period])

  // Balance sheet check
  const assets = bs.filter((r) => r.account_type === "asset").reduce((s, r) => s + Number(r.balance), 0)
  const liabilities = bs.filter((r) => r.account_type === "liability").reduce((s, r) => s + Number(r.balance), 0)
  const equity = bs.filter((r) => r.account_type === "equity").reduce((s, r) => s + Number(r.balance), 0)
  const balanced = Math.abs(assets - (liabilities + equity)) < 0.01

  const income = pl.filter((r) => r.account_type === "income").reduce((s, r) => s + Number(r.net_balance), 0)
  const expense = pl.filter((r) => r.account_type === "expense").reduce((s, r) => s + Number(r.net_balance), 0)
  const netProfit = income + expense

  async function handleExport(kind: "profit_loss" | "balance_sheet" | "cash_flow") {
    if (!period) return
    setExporting(kind)
    const [year, month] = period.split("-").map(Number)
    const res = await exportStatementCsv({ kind, period_year: year, period_month: month })
    setExporting(null)
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-${period}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      alert(res.error ?? "Export failed")
    }
  }

  async function handlePrint(kind: "profit_loss" | "balance_sheet" | "cash_flow") {
    if (!period) return
    setPrinting(kind)
    const [year, month] = period.split("-").map(Number)
    const res = await generateStatementReport({ kind, period_year: year, period_month: month })
    setPrinting(null)
    if (res.success && res.html) {
      const win = window.open("", "_blank")
      if (win) {
        win.document.write(res.html)
        win.document.close()
        setTimeout(() => win.print(), 300)
      }
    } else {
      alert(res.error ?? "Report failed")
    }
  }

  if (loading && periods.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {ar
            ? "القوائم المالية مبنية على القيود المرحّلة فقط"
            : "Statements are built from posted journal entries only"}
        </p>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {periods.length === 0 && <option value="">—</option>}
          {periods.map((p) => (
            <option key={`${p.period_year}-${p.period_month}`} value={`${p.period_year}-${String(p.period_month).padStart(2, "0")}`}>
              {p.period_year}-{String(p.period_month).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>

      {/* P&L */}
      <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
        <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">{ar ? "قائمة الدخل (أرباح وخسائر)" : "Profit & Loss"}</CardTitle>
            <CardDescription>{ar ? "الإيرادات − المصروفات = صافي الربح/الخسارة" : "Revenue − Expenses = Net profit/loss"}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport("profit_loss")} disabled={exporting === "profit_loss"} className={dialogBtn}>
              {exporting === "profit_loss" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
              {ar ? "تصدير CSV" : "CSV"}
            </button>
            <button onClick={() => handlePrint("profit_loss")} disabled={printing === "profit_loss"} className={dialogBtn}>
              {printing === "profit_loss" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              {ar ? "طباعة" : "Print"}
            </button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border/50 bg-muted/30">
              <tr>
                <Th>{ar ? "الحساب" : "Account"}</Th>
                <Th>{ar ? "النوع" : "Type"}</Th>
                <Th className="text-end">{ar ? "المبلغ" : "Amount"}</Th>
              </tr>
            </thead>
            <tbody>
              {pl.length === 0 && (
                <tr><Td colSpan={3} className="text-center text-muted-foreground">{ar ? "لا توجد بيانات." : "No data."}</Td></tr>
              )}
              {pl.map((r) => (
                <tr key={r.account_code} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                  <Td>{r.name_ar} <span dir="ltr" className="font-mono text-[10px] text-muted-foreground">{r.account_code}</span></Td>
                  <Td>{ar ? (r.account_type === "income" ? "إيراد" : "مصروف") : r.account_type}</Td>
                  <Td dir="ltr" className={`text-end font-medium tabular-nums ${r.account_type === "income" ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(r.net_balance)}
                  </Td>
                </tr>
              ))}
              {pl.length > 0 && (
                <tr className="border-t-2 border-border bg-muted/20">
                  <Td className="font-bold">{ar ? "الإيرادات" : "Revenue"}</Td>
                  <Td />
                  <Td dir="ltr" className="text-end font-bold tabular-nums text-emerald-600">{fmtMoney(income)}</Td>
                </tr>
              )}
              {pl.length > 0 && (
                <tr className="bg-muted/20">
                  <Td className="font-bold">{ar ? "المصروفات" : "Expenses"}</Td>
                  <Td />
                  <Td dir="ltr" className="text-end font-bold tabular-nums text-red-600">{fmtMoney(Math.abs(expense))}</Td>
                </tr>
              )}
              {pl.length > 0 && (
                <tr className="bg-gradient-to-r from-elite-blue-600/10 to-elite-blue-700/10">
                  <Td className="font-extrabold">{ar ? "صافي الربح / الخسارة" : "Net Profit / Loss"}</Td>
                  <Td />
                  <Td dir="ltr" className={`text-end font-extrabold tabular-nums ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtMoney(netProfit)}</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Balance Sheet */}
      <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
        <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">{ar ? "الميزانية العمومية" : "Balance Sheet"}</CardTitle>
            <CardDescription>
              {ar ? "الأصول = الخصوم + حقوق الملكية" : "Assets = Liabilities + Equity"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport("balance_sheet")} disabled={exporting === "balance_sheet"} className={dialogBtn}>
              {exporting === "balance_sheet" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
              {ar ? "تصدير CSV" : "CSV"}
            </button>
            <button onClick={() => handlePrint("balance_sheet")} disabled={printing === "balance_sheet"} className={dialogBtn}>
              {printing === "balance_sheet" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              {ar ? "طباعة" : "Print"}
            </button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border/50 bg-muted/30">
              <tr>
                <Th>{ar ? "الحساب" : "Account"}</Th>
                <Th>{ar ? "التصنيف" : "Class"}</Th>
                <Th className="text-end">{ar ? "الرصيد" : "Balance"}</Th>
              </tr>
            </thead>
            <tbody>
              {bs.length === 0 && (
                <tr><Td colSpan={3} className="text-center text-muted-foreground">{ar ? "لا توجد بيانات." : "No data."}</Td></tr>
              )}
              {bs.map((r) => (
                <tr key={r.account_code} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                  <Td>{r.name_ar} <span dir="ltr" className="font-mono text-[10px] text-muted-foreground">{r.account_code}</span></Td>
                  <Td>{ar ? (r.account_type === "asset" ? "أصل" : r.account_type === "liability" ? "التزام" : "حقوق ملكية") : r.account_type}</Td>
                  <Td dir="ltr" className={`text-end font-medium tabular-nums ${r.account_type === "asset" ? "text-emerald-600" : "text-foreground"}`}>
                    {fmtMoney(r.balance)}
                  </Td>
                </tr>
              ))}
              {bs.length > 0 && (
                <>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <Td className="font-bold">{ar ? "الأصول" : "Total Assets"}</Td>
                    <Td />
                    <Td dir="ltr" className="text-end font-bold tabular-nums text-emerald-600">{fmtMoney(assets)}</Td>
                  </tr>
                  <tr className="bg-muted/20">
                    <Td className="font-bold">{ar ? "الخصوم" : "Total Liabilities"}</Td>
                    <Td />
                    <Td dir="ltr" className="text-end font-bold tabular-nums">{fmtMoney(liabilities)}</Td>
                  </tr>
                  <tr className="bg-muted/20">
                    <Td className="font-bold">{ar ? "حقوق الملكية" : "Total Equity"}</Td>
                    <Td />
                    <Td dir="ltr" className="text-end font-bold tabular-nums">{fmtMoney(equity)}</Td>
                  </tr>
                  <tr className="bg-gradient-to-r from-elite-blue-600/10 to-elite-blue-700/10">
                    <Td className="font-extrabold">{ar ? "فرق التوازن" : "Balance Check"}</Td>
                    <Td />
                    <Td dir="ltr" className={`text-end font-extrabold tabular-nums ${balanced ? "text-emerald-600" : "text-red-600"}`}>
                      {balanced ? (ar ? "متوازنة ✓" : "Balanced ✓") : fmtMoney(assets - liabilities - equity)}
                    </Td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cash Flow */}
      <Card className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
        <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">{ar ? "التدفقات النقدية" : "Cash Flow"}</CardTitle>
            <CardDescription>{ar ? "حركة النقد والبنك حسب نوع القيد" : "Cash & bank movement by journal entry type"}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport("cash_flow")} disabled={exporting === "cash_flow"} className={dialogBtn}>
              {exporting === "cash_flow" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
              {ar ? "تصدير CSV" : "CSV"}
            </button>
            <button onClick={() => handlePrint("cash_flow")} disabled={printing === "cash_flow"} className={dialogBtn}>
              {printing === "cash_flow" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              {ar ? "طباعة" : "Print"}
            </button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border/50 bg-muted/30">
              <tr>
                <Th>{ar ? "نوع القيد" : "Entry Type"}</Th>
                <Th className="text-end">{ar ? "داخل" : "In"}</Th>
                <Th className="text-end">{ar ? "خارج" : "Out"}</Th>
                <Th className="text-end">{ar ? "صافي" : "Net"}</Th>
              </tr>
            </thead>
            <tbody>
              {cf.length === 0 && (
                <tr><Td colSpan={4} className="text-center text-muted-foreground">{ar ? "لا توجد بيانات." : "No data."}</Td></tr>
              )}
              {cf.map((r) => (
                <tr key={r.entry_type} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                  <Td className="font-mono text-[11px]" dir="ltr">{r.entry_type}</Td>
                  <Td dir="ltr" className="text-end tabular-nums text-emerald-600">{fmtMoney(r.cash_in)}</Td>
                  <Td dir="ltr" className="text-end tabular-nums text-red-600">{fmtMoney(r.cash_out)}</Td>
                  <Td dir="ltr" className={`text-end font-medium tabular-nums ${Number(r.net_cash_flow) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(r.net_cash_flow)}
                  </Td>
                </tr>
              ))}
              {cf.length > 0 && (
                <tr className="bg-gradient-to-r from-elite-blue-600/10 to-elite-blue-700/10">
                  <Td className="font-extrabold">{ar ? "صافي التدفق" : "Net Cash Flow"}</Td>
                  <Td />
                  <Td />
                  <Td dir="ltr" className={`text-end font-extrabold tabular-nums ${cf.reduce((s, r) => s + Number(r.net_cash_flow), 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(cf.reduce((s, r) => s + Number(r.net_cash_flow), 0))}
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
