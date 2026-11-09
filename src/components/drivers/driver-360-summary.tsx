"use client"

import { useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Bike, CalendarCheck, Car, HandCoins, Package, Receipt, Wallet, Wrench } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { PlatformDot } from "@/components/drivers/platform-ids-editor"
import { fetchDriverPlatformAccounts, sortAccounts, type DriverPlatformAccount } from "@/lib/drivers/platform-accounts"
import { platformLabel } from "@/lib/drivers/platforms"
import type { Driver } from "@/types/drivers"

type Snapshot = {
  vehicle: { id: string; plate: string; label: string } | null | undefined
  ordersThisMonth: number | null
  attendanceDays: number | null
  openViolations: { count: number; amount: number } | null
  openMaintenance: number | null
  lastNet: { amount: number; month: string } | null | undefined
  expensesThisMonth: number | null
  outstandingAdvances: number | null
  platforms: DriverPlatformAccount[] | null
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0
const riyadhToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())

async function settle<T>(p: PromiseLike<T>): Promise<T | null> {
  try { return await p } catch { return null }
}

async function loadSnapshot(driver: Driver): Promise<Snapshot> {
  const db = createClient()
  const today = riyadhToday()
  const monthStart = today.slice(0, 8) + "01"
  const [vehicle, orders, attendance, violations, results, expenses, advances, platforms] = await Promise.all([
    settle(db.from("vehicle_assignments").select("vehicle_id, vehicles(id, plate_number, make, model)").eq("driver_id", driver.id).eq("is_current", true).is("deleted_at", null).limit(1).then((r) => {
      if (r.error) throw r.error
      const row = r.data?.[0] as unknown as { vehicle_id: string; vehicles: { id: string; plate_number: string | null; make: string | null; model: string | null } | null } | undefined
      if (!row) return null
      const v = row.vehicles
      return { id: row.vehicle_id, plate: v?.plate_number ?? "—", label: [v?.make, v?.model].filter(Boolean).join(" ") }
    })),
    settle(db.from("daily_order_entries").select("orders_delivered").eq("driver_id", driver.id).gte("entry_date", monthStart).lte("entry_date", today).is("deleted_at", null).then((r) => {
      if (r.error) throw r.error
      return (r.data ?? []).reduce((s, x) => s + num((x as { orders_delivered: unknown }).orders_delivered), 0)
    })),
    settle(db.from("driver_attendance").select("id", { count: "exact", head: true }).eq("driver_id", driver.id).gte("attendance_date", monthStart).lte("attendance_date", today).in("status", ["present", "late", "half_day"]).is("deleted_at", null).then((r) => {
      if (r.error) throw r.error
      return r.count ?? 0
    })),
    settle(db.from("violations").select("deduction_amount,status").eq("driver_id", driver.id).is("deleted_at", null).in("status", ["open", "acknowledged", "under_review", "disputed", "escalated"]).then((r) => {
      if (r.error) throw r.error
      const rows = (r.data ?? []) as { deduction_amount: unknown }[]
      return { count: rows.length, amount: rows.reduce((s, x) => s + num(x.deduction_amount), 0) }
    })),
    settle(db.from("payroll_engine_results").select("final_net_salary, payroll_engine_runs(month_key,status)").eq("driver_id", driver.id).limit(24).then((r) => {
      if (r.error) throw r.error
      const rows = ((r.data ?? []) as unknown as { final_net_salary: unknown; payroll_engine_runs: { month_key: string; status: string } | null }[])
        .filter((x) => x.payroll_engine_runs && x.payroll_engine_runs.status !== "cancelled")
        .sort((a, b) => (b.payroll_engine_runs!.month_key).localeCompare(a.payroll_engine_runs!.month_key))
      return rows[0] ? { amount: num(rows[0].final_net_salary), month: rows[0].payroll_engine_runs!.month_key } : null
    })),
    settle(db.from("expenses").select("amount").eq("driver_id", driver.id).gte("expense_date", monthStart).lte("expense_date", today).is("deleted_at", null).is("cancelled_at", null).then((r) => {
      if (r.error) throw r.error
      return (r.data ?? []).reduce((s, x) => s + num((x as { amount: unknown }).amount), 0)
    })),
    settle(db.from("payroll_advances").select("amount").eq("driver_id", driver.id).eq("status", "approved").is("repaid_at", null).is("deleted_at", null).then((r) => {
      if (r.error) throw r.error
      return (r.data ?? []).reduce((s, x) => s + num((x as { amount: unknown }).amount), 0)
    })),
    settle(fetchDriverPlatformAccounts(driver.id).then(sortAccounts)),
  ])
  let openMaintenance: number | null = null
  if (vehicle?.id) {
    openMaintenance = await settle(db.from("vehicle_maintenance_events").select("id", { count: "exact", head: true }).eq("vehicle_id", vehicle.id).is("deleted_at", null).in("status", ["open", "in_progress"]).then((r) => {
      if (r.error) throw r.error
      return r.count ?? 0
    }))
  } else if (vehicle === null) openMaintenance = 0
  return { vehicle: vehicle ?? null, ordersThisMonth: orders, attendanceDays: attendance, openViolations: violations, openMaintenance, lastNet: results, expensesThisMonth: expenses, outstandingAdvances: advances, platforms }
}

function Tile({ icon: Icon, label, value, sub, tone = "blue", onClick }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "blue" | "green" | "amber" | "red" | "violet" | "slate"; onClick?: () => void }) {
  const tones: Record<string, string> = {
    blue: "bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300",
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    slate: "bg-muted text-muted-foreground",
  }
  const Comp = onClick ? "button" : "div"
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick}
      className={cn("flex min-w-0 items-start gap-3 rounded-xl border border-border/50 bg-card p-3 text-start shadow-xs transition-colors", onClick && "hover:border-elite-blue-500/40 hover:bg-elite-blue-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tones[tone])}><Icon className="size-4" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="block truncate text-base font-bold tabular-nums text-foreground">{value}</span>
        {sub ? <span className="block truncate text-[11px] text-muted-foreground">{sub}</span> : null}
      </span>
    </Comp>
  )
}

/** Driver 360: one glance across fleet, operations, payroll and finance. */
export function Driver360Summary({ driver, isAr, onNavigate }: { driver: Driver; isAr: boolean; onNavigate: (tab: string) => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadSnapshot(driver).then((s) => { if (!cancelled) setSnap(s) })
    return () => { cancelled = true }
  }, [driver])

  const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString(isAr ? "ar-SA" : "en-US", { maximumFractionDigits: 2 })} ${isAr ? "ر.س" : "SAR"}`)
  const count = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(isAr ? "ar-SA" : "en-US"))

  if (!snap) {
    return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy="true">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)}</div>
  }
  const primary = snap.platforms?.find((p) => p.is_primary)
  const v = snap.openViolations
  return (
    <section aria-label={isAr ? "ملخص السائق 360" : "Driver 360 summary"} className="space-y-3" data-testid="driver-360-summary">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Bike} tone="violet" label={isAr ? "المنصة الرئيسية" : "Primary platform"} onClick={() => onNavigate("platforms")}
          value={primary ? <span dir="ltr" className="font-mono">{primary.platform_driver_id}</span> : "—"}
          sub={primary ? platformLabel(primary.platform_code, isAr) : snap.platforms ? (isAr ? "أضف رقم مندوب" : "Add a rider ID") : undefined} />
        <Tile icon={Car} label={isAr ? "المركبة الحالية" : "Current vehicle"} onClick={() => onNavigate("assignments")}
          value={snap.vehicle ? <span dir="ltr">{snap.vehicle.plate}</span> : snap.vehicle === null ? (isAr ? "لا توجد" : "None") : "—"} sub={snap.vehicle?.label || undefined} />
        <Tile icon={Package} tone="green" label={isAr ? "طلبات هذا الشهر" : "Orders this month"} value={count(snap.ordersThisMonth)} onClick={() => onNavigate("performance")} />
        <Tile icon={CalendarCheck} tone="green" label={isAr ? "أيام الحضور (الشهر)" : "Attendance days (month)"} value={count(snap.attendanceDays)} onClick={() => onNavigate("attendance")} />
        <Tile icon={Wallet} label={isAr ? "آخر صافي راتب" : "Last net pay"} value={snap.lastNet ? money(snap.lastNet.amount) : "—"} sub={snap.lastNet?.month} onClick={() => onNavigate("payslips")} />
        <Tile icon={AlertTriangle} tone={v && v.count > 0 ? "red" : "slate"} label={isAr ? "مخالفات مفتوحة" : "Open violations"} value={count(v?.count)} sub={v && v.amount > 0 ? money(v.amount) : undefined} onClick={() => onNavigate("violations")} />
        <Tile icon={Wrench} tone={snap.openMaintenance ? "amber" : "slate"} label={isAr ? "صيانة مفتوحة" : "Open maintenance"} value={count(snap.openMaintenance)} onClick={() => onNavigate("maintenance")} />
        <Tile icon={HandCoins} tone={num(driver.cod_outstanding_amount) > 0 ? "amber" : "slate"} label={isAr ? "رصيد COD المستحق" : "COD outstanding"} value={money(num(driver.cod_outstanding_amount))} onClick={() => onNavigate("cod")} />
        <Tile icon={Receipt} tone="slate" label={isAr ? "مصروفات هذا الشهر" : "Expenses this month"} value={money(snap.expensesThisMonth)} />
        <Tile icon={Wallet} tone={snap.outstandingAdvances ? "amber" : "slate"} label={isAr ? "سلف قائمة" : "Outstanding advances"} value={money(snap.outstandingAdvances)} onClick={() => onNavigate("salary")} />
      </div>
      {snap.platforms && snap.platforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {snap.platforms.map((p) => (
            <button key={p.id} type="button" onClick={() => onNavigate("platforms")}
              className={cn("inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs", p.status !== "active" && "opacity-60")}>
              <PlatformDot code={p.platform_code} />
              <span className="font-medium">{platformLabel(p.platform_code, isAr)}</span>
              <span dir="ltr" className="font-mono text-muted-foreground">{p.platform_driver_id}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
