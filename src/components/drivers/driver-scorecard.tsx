"use client"

import { useCallback } from "react"
import type { LucideIcon } from "lucide-react"
import { Award, CalendarCheck, FileCheck2, Gauge, ShieldCheck, Star } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import type { Pillar } from "@/lib/drivers/scorecard"
import { Button } from "@/components/ui/button"
import { useDriverPanelRead } from "@/hooks/use-driver-panel-read"
import { readDriverScorecard } from "@/lib/drivers/profile-operational-reads"

const ICONS: Record<Pillar["key"], LucideIcon> = { attendance: CalendarCheck, conduct: ShieldCheck, productivity: Gauge, compliance: FileCheck2, review: Star }
const LABELS: Record<Pillar["key"], { en: string; ar: string }> = {
  attendance: { en: "Attendance", ar: "الانضباط والحضور" },
  conduct: { en: "Conduct & safety", ar: "السلوك والسلامة" },
  productivity: { en: "Productivity", ar: "الإنتاجية" },
  compliance: { en: "Document compliance", ar: "اكتمال الوثائق" },
  review: { en: "Manager review", ar: "تقييم المدير" },
}
const TONE = {
  elite: { ring: "#047857", text: "text-emerald-700 dark:text-emerald-400" },
  good: { ring: "currentColor", text: "text-foreground" },
  ok: { ring: "#b45309", text: "text-amber-700 dark:text-amber-400" },
  risk: { ring: "#be123c", text: "text-rose-700 dark:text-rose-400" },
  none: { ring: "currentColor", text: "text-muted-foreground" },
} as const

function barColor(v: number | null) {
  if (v === null) return "bg-muted"
  return v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-rose-500"
}

/** Render a score only after every source has been checked. */
export function DriverScorecard({ driverId, isAr }: { driverId: string; isAr: boolean }) {
  const load = useCallback((signal: AbortSignal) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())
    return readDriverScorecard(createClient(), driverId, today, signal)
  }, [driverId])
  const { data: card, error, reload } = useDriverPanelRead(load)

  if (error) return <section className="space-y-3 rounded-lg border bg-card p-5" data-testid="driver-scorecard-error" role="alert">
    <h3 className="text-sm font-semibold">{isAr ? "بطاقة أداء السائق" : "Driver scorecard"}</h3>
    <p className="text-sm text-muted-foreground">{isAr ? "تعذر تحميل بيانات الأداء كاملة. أعد المحاولة لاحتساب الدرجة." : "Could not load complete performance data. Retry to calculate the score."}</p>
    <Button variant="outline" size="sm" onClick={reload}>{isAr ? "أعد المحاولة" : "Retry"}</Button>
  </section>
  if (!card) return <Skeleton className="h-56 w-full rounded-lg" />
  const tone = TONE[card.tier.tone]
  const r = 52, c = 2 * Math.PI * r, pct = (card.overall ?? 0) / 100

  return (
    <section data-testid="driver-scorecard" aria-label={isAr ? "بطاقة أداء السائق" : "Driver scorecard"}
      className="rounded-lg border bg-card p-5">
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex items-center gap-5">
          <div className="relative size-32 shrink-0">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/60" />
              <circle cx="60" cy="60" r={r} fill="none" stroke={tone.ring} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-3xl font-semibold tabular-nums">{card.overall ?? "—"}</p>
                <p className="text-xs text-muted-foreground">/ 100</p>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><Award className="size-3.5" />{isAr ? "بطاقة الأداء" : "Performance scorecard"}</p>
            <p className={cn("text-3xl font-semibold", tone.text)}>{card.grade}</p>
            <p className="font-semibold">{isAr ? card.tier.ar : card.tier.en}</p>
            <p className="max-w-[16rem] text-xs text-muted-foreground">{isAr ? "تُحسب تلقائياً من الحضور والمخالفات والطلبات والوثائق والتقييمات." : "Calculated automatically from attendance, violations, orders, documents and reviews."}</p>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {card.pillars.map((p) => {
            const Icon = ICONS[p.key]
            return (
              <li key={p.key} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{isAr ? LABELS[p.key].ar : LABELS[p.key].en}</span>
                  <span className="text-sm font-bold tabular-nums">{p.score ?? "—"}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full ", barColor(p.score))} style={{ width: `${p.score ?? 0}%` }} /></div>
                <p className="mt-1.5 text-xs text-muted-foreground">{isAr ? p.detail.ar : p.detail.en} · {isAr ? "الوزن" : "weight"} {Math.round(p.weight * 100)}%</p>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
