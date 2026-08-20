"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"
import { Radar, UsersRound, CalendarClock, CarFront, Wrench } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { formatNum, Reveal, SectionHeading, DemoNote } from "./shared"

const kpiIcons = [UsersRound, CalendarClock, CarFront, Wrench]
const kpiTones = {
  info: "text-blue-600 dark:text-blue-400",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
} as const
const kpiBgs = {
  info: "bg-blue-500/10",
  good: "bg-emerald-500/10",
  warn: "bg-amber-500/10",
} as const

function KpiValue({ value, locale }: { value: string; locale: string }) {
  const raw = value.replace(/,/g, "")
  const isPct = raw.endsWith("%")
  const num = Number(raw.replace("%", ""))
  return (
    <>
      {isPct ? `${formatNum(num, locale)}%` : formatNum(num, locale)}
    </>
  )
}

export function OperationsSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="operations" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-24 lg:px-8">
      <SectionHeading tag={c.operations.tag} title={c.operations.title} subtitle={c.operations.subtitle} />

      {/* KPI cards */}
      <div className="mt-14 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {c.operations.kpis.map((kpi, i) => {
          const tone = kpi.tone as keyof typeof kpiTones
          const Icon = kpiIcons[i]
          return (
            <Reveal key={kpi.label} delay={i * 80}>
              <div className="card-premium p-6 group">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", kpiBgs[tone])}>
                    <Icon className={cn("h-5 w-5", kpiTones[tone])} />
                  </div>
                </div>
                <p className={cn("text-3xl font-extrabold tabular-nums", kpiTones[tone])}>
                  <KpiValue value={kpi.value} locale={locale} />
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{kpi.label}</p>
                <div className="mt-4 h-px w-0 bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 transition-all duration-500 group-hover:w-full opacity-0 group-hover:opacity-40" />
              </div>
            </Reveal>
          )
        })}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* Driver productivity table */}
        <Reveal className="lg:col-span-3">
          <div className="card-premium h-full overflow-hidden p-0">
            <div className="border-b border-border/50 px-6 py-4">
              <p className="text-sm font-bold text-foreground">{c.operations.tableTitle}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-start">
                <thead>
                  <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.operations.tableHeaders.map((h) => (
                      <th key={h} className="px-6 py-2.5 text-start font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.operations.tableRows.map((row) => (
                    <tr key={row.driver} className="border-b border-border/40 text-sm last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-6 py-3 font-semibold text-foreground">{row.driver}</td>
                      <td className="px-6 py-3 tabular-nums text-foreground">{row.productivity}</td>
                      <td className="px-6 py-3 tabular-nums text-muted-foreground">{row.attendance}</td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold",
                            row.warn
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          <span className={cn("h-1 w-1 rounded-full", row.warn ? "bg-amber-500" : "bg-emerald-500")} />
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        {/* Drone visual */}
        <Reveal delay={120} className="lg:col-span-2">
          <div className="relative h-full min-h-[260px] overflow-hidden rounded-2xl border border-border/50 bg-card">
            <Image
              src="/Banner.png"
              alt={c.operations.droneCaption}
              width={1024}
              height={1024}
              className="h-full w-full object-cover object-center transition-transform duration-700 hover:scale-105"
              sizes="(min-width: 1024px) 33vw, 100vw"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-elite-blue-950/90 via-elite-blue-950/50 to-transparent p-5 pt-14">
              <p className="flex items-center gap-2 text-xs font-semibold text-white">
                <Radar className="h-4 w-4 shrink-0 text-elite-orange-400" />
                {c.operations.droneCaption}
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      <DemoNote>{c.operations.note}</DemoNote>
    </section>
  )
}
