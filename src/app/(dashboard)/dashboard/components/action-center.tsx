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
  critical: { chip: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", dot: "bg-red-500" },
  warning: { chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
  info: { chip: "bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300 border-elite-blue-500/20", dot: "bg-elite-blue-500" },
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
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </span>
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
                  className="group flex items-center gap-3 rounded-xl border border-border/60 p-3 transition-all hover:border-elite-blue-500/40 hover:bg-accent/40"
                >
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", meta.chip)}>
                    <Icon className="h-4 w-4" />
                  </span>
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
