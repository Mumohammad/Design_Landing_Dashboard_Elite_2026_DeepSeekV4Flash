"use client"

import { Download, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/hooks/use-translation"
import { formatDualDate } from "@/lib/formatting/hijri"
import type { DashboardSnapshot } from "@/lib/analytics/types"
import { kpiRowsToCsv, type KpiCsvRow } from "@/lib/analytics/dashboard-utils"

/** Human label + source table + deep link per exported KPI row. */
const KPI_CSV_META: Record<string, { label: string; source: string; link: string }> = {
  totalDrivers: { label: "Total Drivers", source: "drivers", link: "/drivers" },
  activeDrivers: { label: "Active Drivers", source: "drivers", link: "/drivers" },
  totalVehicles: { label: "Total Vehicles", source: "vehicles", link: "/vehicles" },
  inMaintenance: { label: "Vehicles In Maintenance", source: "vehicles", link: "/maintenance" },
  availableVehicles: { label: "Vehicles Available", source: "vehicles", link: "/vehicles" },
  assignedVehicles: { label: "Vehicles Assigned", source: "vehicles", link: "/vehicles" },
  totalOrders: { label: "Total Orders", source: "daily_order_entries", link: "/platforms" },
  completionRate: { label: "Completion Rate (%)", source: "daily_order_entries", link: "/platforms" },
  revenue: { label: "Gross Revenue (SAR)", source: "daily_order_entries", link: "/reports" },
  netPayroll: { label: "Net Payroll — Latest Period (SAR)", source: "driver_payroll_periods", link: "/payroll" },
  openViolations: { label: "Open Violations", source: "violations", link: "/violations" },
  pendingApplications: { label: "Pending Applications", source: "driver_applications", link: "/applications" },
  expiringDocuments: { label: "Expiring Documents (30d)", source: "drivers/vehicles", link: "/drivers" },
  expiredDocuments: { label: "Expired Documents", source: "drivers/vehicles", link: "/drivers" },
  openApprovals: { label: "Open Approvals", source: "fetch_pending_approvals RPC", link: "/approvals" },
  auditEvents: { label: "Audit Events (period)", source: "audit_log", link: "/audit-log" },
  codPendingSessions: { label: "COD Sessions Pending", source: "driver_cod_sessions", link: "/payroll" },
}

/** Dashboard header row: title, dual Gregorian/Hijri date, refresh + CSV export. */
export function DashboardHeader({
  snapshot,
  onRefresh,
  refreshing,
}: {
  snapshot: DashboardSnapshot | null
  onRefresh: () => void
  refreshing: boolean
}) {
  const { t, locale } = useTranslation()
  const isAr = locale === "ar"

  function exportCsv() {
    if (!snapshot) return
    const rows: KpiCsvRow[] = Object.entries(snapshot.kpis).flatMap(([key, m]) => {
      const meta = KPI_CSV_META[key]
      if (!meta) return []
      return [
        {
          metric: meta.label,
          value: m.available ? m.value : null,
          previous: m.available ? m.previous : null,
          delta: m.available ? m.delta : null,
          available: m.available,
          source: meta.source,
          link: meta.link,
        },
      ]
    })
    const csv = kpiRowsToCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `dashboard-kpis-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground lg:text-3xl">
          {t.app.dashboardTitle}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t.dashboard.welcomeMessage} ·{" "}
          <span className="font-medium text-foreground/70">
            {formatDualDate(new Date(), isAr)}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!snapshot}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {isAr ? "تصدير CSV" : "Export CSV"}
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} className="gap-1.5">
          <RefreshCw className={"h-3.5 w-3.5" + (refreshing ? " animate-spin" : "")} />
          {t.dashboard.refresh}
        </Button>
      </div>
    </div>
  )
}
