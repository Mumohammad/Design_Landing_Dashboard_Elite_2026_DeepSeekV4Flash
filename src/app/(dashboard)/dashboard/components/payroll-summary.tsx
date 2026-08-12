"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, WalletCards } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatCurrency, formatNumber } from "./format"
import type { DashboardSnapshot } from "@/lib/analytics/types"

export function PayrollSummary({ payroll }: { payroll: DashboardSnapshot["payroll"] }) {
  const { t, locale } = useTranslation()

  const items = [
    { label: t.dashboard.grossPayroll, value: payroll.gross, tone: "text-foreground" },
    { label: t.dashboard.bonuses, value: payroll.bonuses, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: t.dashboard.deductions, value: payroll.deductions, tone: "text-red-600 dark:text-red-400" },
    { label: t.dashboard.netPayroll, value: payroll.net, tone: "text-foreground font-bold" },
  ] as const

  const chips = [
    { label: t.dashboard.avgNet, value: `${formatCurrency(locale, payroll.avgNet)}`, good: true },
    { label: t.dashboard.aboveTarget, value: formatNumber(locale, payroll.aboveTarget), good: true },
    { label: t.dashboard.belowTarget, value: formatNumber(locale, payroll.belowTarget), good: false },
    { label: t.dashboard.negativeBalance, value: formatNumber(locale, payroll.negativeBalance), good: false },
  ]

  if (!payroll.available)
    return (
      <ChartCard title={t.dashboard.payrollSummary} description={`${t.dashboard.payrollSummaryDesc} — ${payroll.period}`}>
        <OfflineState />
      </ChartCard>
    )
  if (payroll.net === 0 && payroll.gross === 0)
    return (
      <ChartCard title={t.dashboard.payrollSummary} description={`${t.dashboard.payrollSummaryDesc} — ${payroll.period}`}>
        <EmptyState title={t.dashboard.emptyDashboard} description={t.dashboard.payrollSummaryDesc} />
      </ChartCard>
    )

  return (
    <ChartCard
      title={t.dashboard.payrollSummary}
      description={`${t.dashboard.payrollSummaryDesc} · ${payroll.period}`}
      action={
        <Link
          href="/payroll"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-elite-blue-500/40 hover:text-elite-blue-600 dark:hover:text-elite-blue-300"
        >
          <WalletCards className="h-3.5 w-3.5" />
          {t.nav.payroll}
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">{it.label}</p>
            <p className={`mt-1 text-lg tabular-nums tracking-tight ${it.tone}`}>
              {formatCurrency(locale, it.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c.label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              c.good
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                : "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400"
            }`}
          >
            {c.good ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {c.label} · {c.value}
          </span>
        ))}
      </div>
    </ChartCard>
  )
}
