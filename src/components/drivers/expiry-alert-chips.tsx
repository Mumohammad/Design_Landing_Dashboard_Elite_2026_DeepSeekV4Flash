"use client"

import { cn } from "@/lib/utils"
import { formatDualDate } from "@/lib/formatting/hijri"
import { CalendarOff } from "lucide-react"

/**
 * Saudi compliance alert chips for expat documents (iqama) alongside licence
 * expiry. Renders nothing when there is nothing expiring within 30 days.
 */
export function ExpiryAlertChips({
  iqamaExpiry,
  licenseExpiry,
  nationality,
  isAr,
  className,
}: {
  iqamaExpiry: string | null | undefined
  licenseExpiry: string | null | undefined
  nationality: string | null | undefined
  isAr: boolean
  className?: string
}) {
  const isSaudi =
    (nationality ?? "").toLowerCase().includes("saudi") ||
    (nationality ?? "").includes("سعودي")

  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)

  const alerts: { label: string; date: string }[] = []
  if (!isSaudi && iqamaExpiry) {
    const d = new Date(iqamaExpiry)
    if (!Number.isNaN(d.getTime()) && d <= in30) {
      alerts.push({ label: isAr ? "انتهاء الإقامة" : "Iqama expiring", date: iqamaExpiry })
    }
  }
  if (licenseExpiry) {
    const d = new Date(licenseExpiry)
    if (!Number.isNaN(d.getTime()) && d <= in30) {
      alerts.push({ label: isAr ? "انتهاء الرخصة" : "License expiring", date: licenseExpiry })
    }
  }

  if (alerts.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {alerts.map((a) => (
        <span
          key={a.label}
          className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400"
        >
          <CalendarOff className="h-3 w-3" />
          {a.label}: <span dir="ltr">{formatDualDate(a.date, isAr)}</span>
        </span>
      ))}
    </div>
  )
}
