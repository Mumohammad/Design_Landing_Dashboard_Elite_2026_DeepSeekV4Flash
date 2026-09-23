"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Skeleton } from "@/components/ui/skeleton"
import { Banknote, TrendingUp } from "lucide-react"

type MonthlyOrderRow = {
  period_year: number
  period_month: number
  total_delivered: number
  total_failed: number
  total_returned: number
  total_revenue: number
}

function monthName(month: number, isAr: boolean) {
  const en = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  const ar = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ]
  return isAr ? ar[month - 1] : en[month - 1]
}

/** Payroll-adjacent KPI card fed by monthly_driver_orders (per-platform rows aggregated). */
export function DriverOrdersKpiCard({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [rows, setRows] = useState<MonthlyOrderRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await createClient()
        .from("monthly_driver_orders")
        .select(
          "period_year, period_month, total_delivered, total_failed, total_returned, total_revenue",
        )
        .eq("driver_id", driverId)
        .is("deleted_at", null)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(6)
      if (!cancelled) setRows((data as MonthlyOrderRow[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [driverId])

  if (rows === null) {
    return <Skeleton className="h-40 rounded-2xl lg:col-span-2" />
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
        <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
          <Banknote className="h-4 w-4 text-elite-blue-500" />
          <h3 className="text-sm font-semibold text-foreground">
            {isAr ? "أداء الطلبات (رواتب)" : "Orders Performance (Payroll)"}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "لا توجد بيانات طلبات شهرية — ستظهر مؤشرات الرواتب عند توفرها"
            : "No monthly order data yet — payroll KPIs appear once orders are recorded"}
        </p>
      </div>
    )
  }

  // Aggregate per-platform rows into one row per period.
  const byPeriod = new Map<string, MonthlyOrderRow>()
  for (const r of rows) {
    const key = `${r.period_year}-${r.period_month}`
    const agg = byPeriod.get(key) ?? {
      period_year: r.period_year,
      period_month: r.period_month,
      total_delivered: 0,
      total_failed: 0,
      total_returned: 0,
      total_revenue: 0,
    }
    agg.total_delivered += r.total_delivered ?? 0
    agg.total_failed += r.total_failed ?? 0
    agg.total_returned += r.total_returned ?? 0
    agg.total_revenue += Number(r.total_revenue ?? 0)
    byPeriod.set(key, agg)
  }
  const periods = [...byPeriod.values()]
  const latest = periods[0]

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-4 shadow-sm backdrop-blur-sm lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-3">
        <Banknote className="h-4 w-4 text-elite-blue-500" />
        <h3 className="text-sm font-semibold text-foreground">
          {isAr ? "أداء الطلبات (رواتب)" : "Orders Performance (Payroll)"}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <span className="text-xs text-muted-foreground">
            {isAr ? "فترة" : "Latest period"}
          </span>
          <p className="text-sm font-semibold text-foreground">
            {monthName(latest.period_month, isAr)} {latest.period_year}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {isAr ? "طلبات مُسلَّمة" : "Delivered"}
          </span>
          <p className="text-xl font-extrabold tabular-nums text-foreground" dir="ltr">
            {latest.total_delivered.toLocaleString("en-US")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {isAr ? "فاشلة / مرتجعة" : "Failed / Returned"}
          </span>
          <p className="text-xl font-extrabold tabular-nums text-foreground" dir="ltr">
            {(latest.total_failed + latest.total_returned).toLocaleString("en-US")}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">
            {isAr ? "الإيراد" : "Revenue"}
          </span>
          <p className="text-xl font-extrabold tabular-nums text-foreground" dir="ltr">
            {latest.total_revenue.toLocaleString("en-US")}
          </p>
        </div>
      </div>
      {periods.length > 1 && (
        <ul className="mt-3 space-y-1 border-t border-border/30 pt-3">
          {periods.slice(1).map((p) => (
            <li
              key={`${p.period_year}-${p.period_month}`}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <TrendingUp className="h-3 w-3" />
              {monthName(p.period_month, isAr)} {p.period_year} —{" "}
              <span dir="ltr">
                {p.total_delivered.toLocaleString("en-US")}
              </span>{" "}
              {isAr ? "طلب" : "delivered"}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
