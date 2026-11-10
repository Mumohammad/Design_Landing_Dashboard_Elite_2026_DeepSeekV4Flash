"use client"

import { useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Award, CalendarCheck, FileCheck2, Gauge, ShieldCheck, Star } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { buildScorecard, type Pillar, type Scorecard } from "@/lib/drivers/scorecard"

const ICONS: Record<Pillar["key"], LucideIcon> = { attendance: CalendarCheck, conduct: ShieldCheck, productivity: Gauge, compliance: FileCheck2, review: Star }
const LABELS: Record<Pillar["key"], { en: string; ar: string }> = {
  attendance: { en: "Attendance", ar: "الانضباط والحضور" },
  conduct: { en: "Conduct & safety", ar: "السلوك والسلامة" },
  productivity: { en: "Productivity", ar: "الإنتاجية" },
  compliance: { en: "Document compliance", ar: "اكتمال الوثائق" },
  review: { en: "Manager review", ar: "تقييم المدير" },
}
const TONE = {
  elite: { ring: "#10b981", bg: "from-emerald-500/15", text: "text-emerald-600" },
  good: { ring: "#0ea5e9", bg: "from-sky-500/15", text: "text-sky-600" },
  ok: { ring: "#f59e0b", bg: "from-amber-500/15", text: "text-amber-600" },
  risk: { ring: "#ef4444", bg: "from-rose-500/15", text: "text-rose-600" },
  none: { ring: "#94a3b8", bg: "from-muted", text: "text-muted-foreground" },
} as const

function barColor(v: number | null) {
  if (v === null) return "bg-muted"
  return v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-rose-500"
}

function shift(iso: string, days: number) { return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) }

type OrderRow = { total_delivered: number | null; total_failed: number | null; total_returned: number | null; working_days: number | null; period_year: number; period_month: number }
type DriverDocs = { iqama_expiry_date: string | null; license_expiry_date: string | null; passport_expiry_date: string | null }

/** Composite 0-100 driver scorecard from attendance, violations, orders, documents and reviews. */
export function DriverScorecard({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const [card, setCard] = useState<Scorecard | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())
    const db = createClient()
    const [y, m] = today.split("-").map(Number)
    const months = [0, 1, 2].map((k) => { const d = new Date(Date.UTC(y, m - 1 - k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } })
    void Promise.all([
      db.from("driver_attendance").select("status").eq("driver_id", driverId).is("deleted_at", null).gte("attendance_date", shift(today, -90)).limit(200),
      db.from("violations").select("severity,status").eq("driver_id", driverId).is("deleted_at", null).gte("incident_date", shift(today, -180)).limit(200),
      db.from("monthly_driver_orders").select("total_delivered,total_failed,total_returned,working_days,period_year,period_month").eq("driver_id", driverId).is("deleted_at", null).gte("period_year", months[2].y).limit(60),
      db.from("drivers").select("iqama_expiry_date,license_expiry_date,passport_expiry_date").eq("id", driverId).maybeSingle(),
      db.from("performance_reviews").select("overall_score").eq("driver_id", driverId).eq("status", "completed").is("deleted_at", null).order("review_date", { ascending: false }).limit(1),
    ]).then(([att, vio, ord, drv, rev]) => {
      if (cancelled) return
      const keys = new Set(months.map((x) => `${x.y}-${x.m}`))
      const d = (drv.data ?? null) as DriverDocs | null
      setCard(buildScorecard({
        todayIso: today,
        attendance: (att.data ?? []) as { status: string }[],
        violations: (vio.data ?? []) as { severity: string | null; status: string | null }[],
        orders: ((ord.data ?? []) as OrderRow[]).filter((o) => keys.has(`${o.period_year}-${o.period_month}`)),
        documents: d ? [d.iqama_expiry_date, d.license_expiry_date, d.passport_expiry_date] : [],
        latestReview: (rev.data?.[0]?.overall_score as number | null | undefined) ?? null,
      }))
    })
    return () => { cancelled = true }
  }, [driverId])

  if (!card) return <Skeleton className="h-56 w-full rounded-2xl" />
  const tone = TONE[card.tier.tone]
  const r = 52, c = 2 * Math.PI * r, pct = (card.overall ?? 0) / 100

  return (
    <section data-testid="driver-scorecard" aria-label={isAr ? "بطاقة أداء السائق" : "Driver scorecard"}
      className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br via-background to-background p-5", tone.bg)}>
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex items-center gap-5">
          <div className="relative size-36 shrink-0">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/60" />
              <circle cx="60" cy="60" r={r} fill="none" stroke={tone.ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: "stroke-dasharray 0.8s ease" }} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-3xl font-black tabular-nums">{card.overall ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">/ 100</p>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Award className="size-3.5" />{isAr ? "بطاقة الأداء" : "Performance scorecard"}</p>
            <p className={cn("text-4xl font-black", tone.text)}>{card.grade}</p>
            <p className="font-semibold">{isAr ? card.tier.ar : card.tier.en}</p>
            <p className="max-w-[16rem] text-xs text-muted-foreground">{isAr ? "تُحسب تلقائياً من الحضور والمخالفات والطلبات والوثائق والتقييمات." : "Calculated automatically from attendance, violations, orders, documents and reviews."}</p>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {card.pillars.map((p) => {
            const Icon = ICONS[p.key]
            return (
              <li key={p.key} className="rounded-xl border bg-background/80 p-3 backdrop-blur">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{isAr ? LABELS[p.key].ar : LABELS[p.key].en}</span>
                  <span className="text-sm font-bold tabular-nums">{p.score ?? "—"}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-all duration-700", barColor(p.score))} style={{ width: `${p.score ?? 0}%` }} /></div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{isAr ? p.detail.ar : p.detail.en} · {isAr ? "الوزن" : "weight"} {Math.round(p.weight * 100)}%</p>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
