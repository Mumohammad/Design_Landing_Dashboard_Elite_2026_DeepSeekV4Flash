"use client"

import * as React from "react"
import {
  Search,
  Bell,
  Settings,
  PanelLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  Truck,
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { useCountUp, formatNum } from "./shared"
import { LogoMark } from "@/components/logo"

function CountUpNumber({
  target,
  locale,
  prefix = "",
  suffix = "",
}: {
  target: number
  locale: string
  prefix?: string
  suffix?: string
}) {
  const decimals = Number.isInteger(target) ? 0 : 1
  const { ref, value } = useCountUp(target, 1400, decimals)
  const formatted = value.toLocaleString(locale === "ar" ? "ar-SA" : "en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return (
    <span className="tabular-nums">
      <span ref={ref}>
        {prefix}
        {formatted}
        {suffix}
      </span>
    </span>
  )
}

const toneStyles = {
  info: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
  warn: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  danger: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
} as const

export function DashboardPreview({ className }: { className?: string }) {
  const { t, locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const isRtl = locale === "ar"

  const kpis = [
    { label: c.kpi.drivers, prefix: "", suffix: "", target: 1248 },
    { label: c.kpi.vehicles, prefix: "", suffix: "", target: 386 },
    { label: c.kpi.orders, prefix: "", suffix: "", target: 18420 },
    { label: c.kpi.payroll, prefix: "SAR ", suffix: "M", target: 2.4 },
  ]
  const maxOrders = Math.max(...c.preview.chartValues)

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl shadow-elite-blue-950/10",
        className
      )}
    >
      <div className="flex h-[520px] sm:h-[560px]">
        {/* ── Sidebar (start side — right in Arabic) ── */}
        <aside className="sidebar-gradient hidden w-52 shrink-0 flex-col text-white md:flex">
          <div className="flex items-center gap-2.5 px-4 pt-4">
            <LogoMark size={26} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold">{t.app.companyNameArabic}</p>
              <p className="truncate text-[10px] text-white/50">{t.app.companyName}</p>
            </div>
          </div>
          <nav className="mt-4 flex-1 space-y-0.5 overflow-hidden px-2">
            {c.preview.sidebar.map((item, i) => {
              const active = i === 0
              return (
                <div
                  key={item}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white ring-1 ring-inset ring-white/10"
                      : "text-white/60 hover:bg-white/5 hover:text-white/85"
                  )}
                >
                  {i === 0 ? (
                    <LayoutDot />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                  )}
                  <span className="truncate">{item}</span>
                </div>
              )
            })}
          </nav>
          <div className="border-t border-white/10 p-3 text-[10px] text-white/45">
            {t.app.companyNameArabic}
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          {/* Top bar */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <span className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground md:hidden">
              <Menu className="h-3 w-3" />
              <LogoMark size={14} />
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{c.preview.searchPlaceholder}</span>
              <kbd className="ms-auto hidden rounded border border-border/60 bg-background px-1.5 text-[9px] sm:block">
                ⌘K
              </kbd>
            </div>
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
              <Bell className="h-3 w-3" />
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
              <Settings className="h-3 w-3" />
            </span>
            <span className="hidden rounded-md border border-elite-blue-500/30 bg-elite-blue-500/10 px-2 py-1 text-[10px] font-semibold text-elite-blue-600 dark:text-elite-blue-300 sm:block">
              {locale === "ar" ? "EN" : "عربي"}
            </span>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {kpis.map((kpi, i) => {
                const up = i !== 3
                return (
                  <div
                    key={kpi.label}
                    className="group rounded-xl border border-border/60 bg-card/70 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-elite-blue-500/30 hover:shadow-md hover:shadow-elite-blue-500/10"
                  >
                    <p className="text-[10px] font-medium text-muted-foreground">{kpi.label}</p>
                    <p className="mt-1 text-lg font-extrabold text-foreground sm:text-xl">
                      <CountUpNumber target={kpi.target} locale={locale} prefix={kpi.prefix} suffix={kpi.suffix} />
                    </p>
                    <p
                      className={cn(
                        "mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                      {c.preview.kpiDeltas[i]}
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Chart + alerts */}
            <div className="grid gap-2.5 lg:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-card/70 p-3 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">{c.preview.chartTitle}</p>
                    <p className="text-[10px] text-muted-foreground">{c.preview.chartSubtitle}</p>
                  </div>
                  <span className="rounded-md border border-border/60 px-2 py-0.5 text-[9px] text-muted-foreground">
                    {c.preview.last7Days}
                  </span>
                </div>
                <div className="mt-3 flex h-28 min-w-0 items-end gap-1.5 sm:gap-2">
                  {c.preview.chartValues.map((v, i) => {
                    const h = Math.max(12, Math.round((v / maxOrders) * 100))
                    const peak = v === maxOrders
                    return (
                      <div key={i} className="group/bar flex min-w-0 flex-1 flex-col items-center gap-1">
                        <div className="relative flex w-full min-w-0 flex-1 items-end">
                          <div
                            title={formatNum(v, locale)}
                            className={cn(
                              "w-full rounded-t-md transition-all duration-500",
                              peak
                                ? "bg-gradient-to-t from-elite-blue-600 to-elite-orange-500"
                                : "bg-gradient-to-t from-elite-blue-500/70 to-elite-blue-400/70 group-hover/bar:from-elite-blue-500 group-hover/bar:to-elite-blue-400"
                            )}
                            style={{ height: `${h}%` }}
                          />
                        </div>
                        <span className="max-w-full truncate text-[9px] text-muted-foreground">{c.preview.chartLabels[i]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Bell className="h-3.5 w-3.5 text-elite-orange-500" />
                  {c.preview.alertsTitle}
                </p>
                <div className="mt-2.5 space-y-2">
                  {c.preview.alerts.map((alert) => {
                    const AlertIcon = alert.tone === "danger" ? AlertTriangle : alert.tone === "warn" ? AlertTriangle : Info
                    return (
                      <div
                        key={alert.title}
                        className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/60 p-2"
                      >
                        <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md", toneStyles[alert.tone])}>
                          <AlertIcon className="h-3 w-3" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold text-foreground">{alert.title}</p>
                          <p className="text-[9px] text-muted-foreground">{alert.meta}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Driver table */}
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Truck className="h-3.5 w-3.5 text-elite-blue-500" />
                  {c.preview.tableTitle}
                </p>
                <span className="rounded-md border border-border/60 px-2 py-0.5 text-[9px] text-muted-foreground">
                  {c.preview.note}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-start">
                  <thead>
                    <tr className="border-b border-border/50 text-[9px] uppercase tracking-wide text-muted-foreground">
                      {c.preview.tableHeaders.map((h) => (
                        <th key={h} className="px-3 py-1.5 text-start font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.preview.tableRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border/40 text-[10px] last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-[8px] font-bold text-white">
                              {row.name.trim()[0]}
                            </span>
                            <div className="min-w-0 leading-tight">
                              <p className="truncate font-semibold text-foreground">{row.name}</p>
                              <p className="text-[9px] text-muted-foreground">{row.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-foreground">{row.orders}</td>
                        <td className={cn("px-3 py-1.5 tabular-nums", row.bonus.startsWith("+") ? "text-emerald-600 dark:text-emerald-400" : row.bonus.startsWith("−") ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                          {row.bonus}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{row.deductions}</td>
                        <td className="px-3 py-1.5 font-bold tabular-nums text-foreground">{row.net}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold",
                              row.warn
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            <span className={cn("h-1 w-1 rounded-full", row.warn ? "bg-amber-500" : "bg-emerald-500")} />
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LayoutDot() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white">
      <PanelLeft className="h-2.5 w-2.5 rtl:-scale-x-100" />
    </span>
  )
}
