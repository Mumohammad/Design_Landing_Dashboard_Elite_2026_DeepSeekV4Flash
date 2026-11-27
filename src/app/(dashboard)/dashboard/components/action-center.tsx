"use client"

import Link from "next/link"
import {
  CheckCircle2,
  FileWarning,
  TriangleAlert,
  Wrench,
  FileClock,
  WalletCards,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"
import type { ActionItem } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"

const SEVERITY_META = {
  critical: { dot: "bg-red-600 dark:bg-red-400" },
  warning: { dot: "bg-amber-600 dark:bg-amber-400" },
  info: { dot: "bg-elite-blue-600 dark:bg-elite-blue-300" },
} as const

const MODULE_ICONS: Record<ActionItem["module"], LucideIcon> = {
  documents: FileWarning,
  violations: TriangleAlert,
  applications: FileClock,
  maintenance: Wrench,
  payroll: WalletCards,
}

const MODULE_LABELS: Record<ActionItem["module"], string> = {
  documents: "actionDocuments",
  violations: "actionViolations",
  applications: "actionApplications",
  maintenance: "actionMaintenance",
  payroll: "actionPayroll",
}

export function ActionCenter({ actions }: { actions: ActionItem[] }) {
  const { t } = useTranslation()

  const messageFor = (a: ActionItem): string => {
    const n = String(a.count)
    switch (a.module) {
      case "documents":
        return a.severity === "critical"
          ? t.dashboard.actionExpiredDocs.replace("{n}", n)
          : t.dashboard.actionExpiringDocs.replace("{n}", n)
      case "violations":
        return t.dashboard.actionOpenViolations.replace("{n}", n)
      case "applications":
        return t.dashboard.actionPendingApps.replace("{n}", n)
      case "maintenance":
        return t.dashboard.actionMaintenanceMsg.replace("{n}", n)
      case "payroll":
        return t.dashboard.actionBelowTarget.replace("{n}", n)
    }
  }

  return (
    <ChartCard title={t.dashboard.actionRequired} description={t.dashboard.actionRequiredDesc}>
      {actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{t.dashboard.noActionItems}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => {
            const Icon = MODULE_ICONS[a.module]
            const meta = SEVERITY_META[a.severity]
            return (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="group flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground">{messageFor(a)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.dashboard[MODULE_LABELS[a.module] as keyof typeof t.dashboard]}
                    </p>
                  </div>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </ChartCard>
  )
}
