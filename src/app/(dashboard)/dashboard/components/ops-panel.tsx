"use client"

import Link from "next/link"
import {
  CarFront,
  ClipboardCheck,
  HandCoins,
  History,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { DashboardSnapshot } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState, OfflineState } from "./states"
import { formatCurrency, formatNumber } from "./format"

type OpsTile = {
  key: "fleet" | "approvals" | "cod" | "audit"
  icon: LucideIcon
  href: string
  titleKey: "opsFleet" | "opsApprovals" | "opsCod" | "opsAudit"
  descKey: "opsFleetDesc" | "opsApprovalsDesc" | "opsCodDesc" | "opsAuditDesc"
  available: boolean
  /** Headline number (already localized by the renderer). */
  headline: number
  headlineIsCurrency?: boolean
  /** Secondary lines (label key suffix → value string). */
  rows: { label: string; value: string; tone?: "good" | "bad" }[]
}

export function OpsPanel({
  kpis,
  approvals,
  cod,
}: {
  kpis: DashboardSnapshot["kpis"]
  approvals: DashboardSnapshot["approvals"]
  cod: DashboardSnapshot["cod"]
}) {
  const { t, locale } = useTranslation()

  const n = (v: number) => formatNumber(locale, v)
  const sar = (v: number) => `${formatCurrency(locale, v)} ${locale === "ar" ? "ر.س" : "SAR"}`

  const fleetAvailable = kpis.availableVehicles.available
  const approvalsAvailable = approvals.available
  const codAvailable = cod.available
  const auditAvailable = kpis.auditEvents.available

  const tiles: OpsTile[] = [
    {
      key: "fleet",
      icon: CarFront,
      href: "/vehicles",
      titleKey: "opsFleet",
      descKey: "opsFleetDesc",
      available: fleetAvailable,
      headline: kpis.assignedVehicles.value,
      rows: [
        {
          label: locale === "ar" ? "متاحة للإسناد" : "Available to assign",
          value: n(kpis.availableVehicles.value),
          tone: "good",
        },
        {
          label: locale === "ar" ? "قيد الصيانة" : "In maintenance",
          value: n(kpis.inMaintenance.value),
          tone: kpis.inMaintenance.value > 0 ? "bad" : undefined,
        },
      ],
    },
    {
      key: "approvals",
      icon: ClipboardCheck,
      href: "/approvals",
      titleKey: "opsApprovals",
      descKey: "opsApprovalsDesc",
      available: approvalsAvailable,
      headline: approvals.total,
      rows: [
        { label: locale === "ar" ? "مصروفات" : "Expenses", value: n(approvals.expenses) },
        { label: locale === "ar" ? "طلبات إجازة" : "Leave requests", value: n(approvals.leaves) },
        {
          label: locale === "ar" ? "طلبات توظيف" : "Applications",
          value: n(approvals.applications),
        },
        {
          label: locale === "ar" ? "متأخرة +٧ أيام" : "Stale > 7 days",
          value: n(approvals.stale),
          tone: approvals.stale > 0 ? "bad" : "good",
        },
      ],
    },
    {
      key: "cod",
      icon: HandCoins,
      href: "/payroll",
      titleKey: "opsCod",
      descKey: "opsCodDesc",
      available: codAvailable,
      headline: cod.pendingSessions,
      rows: [
        {
          label: locale === "ar" ? "فرق غير محسوم" : "Unresolved variance",
          value: sar(cod.pendingVariance),
          tone: cod.pendingVariance > 0 ? "bad" : "good",
        },
        { label: locale === "ar" ? "محصّل" : "Collected", value: sar(cod.collected) },
        { label: locale === "ar" ? "مُسلّم" : "Submitted", value: sar(cod.submitted) },
      ],
    },
    {
      key: "audit",
      icon: History,
      href: "/audit-log",
      titleKey: "opsAudit",
      descKey: "opsAuditDesc",
      available: auditAvailable,
      headline: kpis.auditEvents.value,
      rows: [
        {
          label: locale === "ar" ? "أحداث من بداية الفترة" : "Events since period start",
          value: n(kpis.auditEvents.value),
        },
      ],
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon
        const body = !tile.available ? (
          <OfflineState />
        ) : (
          <div className="space-y-2">
            <span className="block text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
              {tile.headlineIsCurrency ? sar(tile.headline) : n(tile.headline)}
            </span>
            {tile.rows.length === 0 && tile.key === "audit" ? (
              <EmptyState
                title={t.dashboard.emptyDashboard}
                description={t.dashboard.opsAuditDesc}
              />
            ) : (
              tile.rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      r.tone === "good" && "text-emerald-600 dark:text-emerald-400",
                      r.tone === "bad" && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {r.value}
                  </span>
                </div>
              ))
            )}
          </div>
        )

        return (
          <Link
            key={tile.key}
            href={tile.href}
            className="block rounded-2xl focus-visible:outline-none"
            aria-label={t.dashboard[tile.titleKey]}
          >
            <ChartCard title={t.dashboard[tile.titleKey]} description={t.dashboard[tile.descKey]}>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-400">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              {body}
            </ChartCard>
          </Link>
        )
      })}
    </div>
  )
}
