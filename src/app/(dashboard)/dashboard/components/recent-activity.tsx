"use client"

import Link from "next/link"
import {
  CarFront,
  FileClock,
  UserPlus,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import type { ActivityEvent } from "@/lib/analytics/types"
import { ChartCard } from "./chart-card"
import { EmptyState } from "./states"
import { formatRelative } from "./format"

const TYPE_META: Record<ActivityEvent["type"], { icon: LucideIcon; chip: string; href: string }> = {
  application: {
    icon: FileClock,
    chip: "bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300",
    href: "/applications",
  },
  violation: {
    icon: TriangleAlert,
    chip: "bg-red-500/10 text-red-600 dark:text-red-400",
    href: "/violations",
  },
  maintenance: {
    icon: CarFront,
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    href: "/maintenance",
  },
  driver: {
    icon: UserPlus,
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    href: "/drivers",
  },
}

export function RecentActivity({ activity }: { activity: ActivityEvent[] }) {
  const { t, locale } = useTranslation()

  if (activity.length === 0) {
    return (
      <ChartCard title={t.dashboard.recentActivity}>
        <EmptyState title={t.dashboard.emptyDashboard} />
      </ChartCard>
    )
  }

  return (
    <ChartCard title={t.dashboard.recentActivity}>
      <ul className="space-y-1">
        {activity.map((a) => {
          const meta = TYPE_META[a.type]
          const Icon = meta.icon
          const label =
            a.type === "application"
              ? t.dashboard.activityApplication
              : a.type === "violation"
                ? t.dashboard.activityViolation
                : a.type === "maintenance"
                  ? t.dashboard.activityMaintenance
                  : t.dashboard.activityDriver
          return (
            <li key={a.id}>
              <Link
                href={meta.href}
                className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent/50"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.chip}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">{label}</p>
                  <p className="truncate text-[11px] text-muted-foreground" dir={a.ref && /[\u0600-\u06FF]/.test(a.ref) ? "rtl" : "ltr"}>
                    {a.ref || "—"}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatRelative(locale, a.time)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
