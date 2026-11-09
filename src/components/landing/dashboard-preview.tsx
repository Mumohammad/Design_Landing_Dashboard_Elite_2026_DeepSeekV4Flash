"use client"

import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { formatNum } from "./shared"

export function DashboardPreview({ className }: { className?: string }) {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const kpis = [[c.kpi.drivers, formatNum(1248, locale)], [c.kpi.vehicles, formatNum(386, locale)], [c.kpi.orders, formatNum(18420, locale)], [c.kpi.payroll, `${formatNum(2.4, locale)}M SAR`]]
  const maxOrders = Math.max(...c.preview.chartValues)
  return (
    <div data-ui dir={locale === "ar" ? "rtl" : "ltr"} role="region" aria-label={c.hero.demoLabel} tabIndex={0} className={cn("max-h-[44rem] overflow-x-hidden overflow-y-auto bg-muted p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:max-h-none sm:overflow-hidden sm:p-8", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-semibold">{c.hero.demoLabel}</p>
        <p className="text-sm text-muted-foreground">{c.preview.note}</p>
      </div>
      <dl className="mt-7 grid grid-cols-2 gap-5 lg:grid-cols-4">{kpis.map(([label, value], index) => <div key={label} className="bg-background p-4">
        <dt className="text-sm">{label}</dt>
        <dd className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</dd>
        <dd className="mt-2 text-sm text-muted-foreground">{c.preview.kpiDeltas[index]}</dd>
      </div>)}</dl>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
        <div className="bg-background p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-semibold">{c.preview.chartTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.preview.chartSubtitle}</p>
            </div>
            <p className="text-sm">{c.preview.last7Days}</p>
          </div>
          <div className="mt-7 flex h-40 items-end gap-3">{c.preview.chartValues.map((value, index) => <div key={c.preview.chartLabels[index]} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2">
            <div className="flex min-h-0 flex-1 items-end">
              <div className={cn("w-full", value === maxOrders ? "bg-elite-orange-500" : "bg-elite-blue-500")} style={{ height: `${value / maxOrders * 100}%` }} role="img" aria-label={`${c.preview.chartLabels[index]}: ${formatNum(value, locale)}`} title={formatNum(value, locale)} />
            </div>
            <p aria-hidden="true" className={cn("whitespace-nowrap text-center text-xs", index % 2 !== 0 && "invisible sm:visible")}>{c.preview.chartLabels[index]}</p>
          </div>)}</div>
        </div>
        <div className="bg-background p-5">
          <p className="font-semibold">{c.preview.alertsTitle}</p>
          <div className="mt-5 space-y-5">{c.preview.alerts.map(alert => <div key={alert.title}>
            <p className="text-sm font-medium">{alert.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{alert.meta}</p>
          </div>)}</div>
        </div>
      </div>
      <div className="mt-6 bg-background p-5">
        <p className="font-semibold">{c.preview.tableTitle}</p>
        <div role="region" aria-label={c.preview.tableTitle} tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <table className="w-full min-w-[680px] text-start text-sm">
            <thead>
              <tr>{c.preview.tableHeaders.map(header => <th key={header} className="py-3 pe-4 text-start font-medium text-muted-foreground">{header}</th>)}</tr>
            </thead>
            <tbody>{c.preview.tableRows.map(row => <tr key={row.id}>
              <td className="py-3 pe-4">
                <p className="font-medium">{row.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
              </td>
              <td className="py-3 pe-4 tabular-nums">{row.orders}</td>
              <td className="py-3 pe-4 tabular-nums">{row.bonus}</td>
              <td className="py-3 pe-4 tabular-nums">{row.deductions}</td>
              <td className="py-3 pe-4 font-semibold tabular-nums">{row.net}</td>
              <td className="py-3">{row.status}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
