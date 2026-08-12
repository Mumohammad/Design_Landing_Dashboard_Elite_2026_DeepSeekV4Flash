"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"
import { Radar } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { formatNum, Reveal, SectionHeading, DemoNote } from "./shared"

const kpiTones = {
  info: "text-elite-blue-600 dark:text-elite-blue-300",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
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
    <section id="operations" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 lg:px-8">
      <SectionHeading tag={c.operations.tag} title={c.operations.title} subtitle={c.operations.subtitle} />

      {/* KPI cards */}
      <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {c.operations.kpis.map((kpi, i) => (
          <Reveal key={kpi.label} delay={i * 60}>
            <div className="rounded-2xl border border-border/50 bg-card p-5 transition-all duration-300 hover:border-elite-blue-500/40 hover:shadow-lg hover:shadow-elite-blue-500/10">
              <p className={cn("text-3xl font-extrabold tabular-nums", kpiTones[kpi.tone as keyof typeof kpiTones])}>
                <KpiValue value={kpi.value} locale={locale} />
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">{kpi.label}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Driver productivity table */}
        <Reveal className="lg:col-span-3">
          <div className="h-full overflow-hidden rounded-2xl border border-border/50 bg-card">
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
                    <tr key={row.driver} className="border-b border-border/40 text-sm last:border-0 hover:bg-muted/40">
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
              className="h-full w-full object-cover object-center"
              sizes="(min-width: 1024px) 33vw, 100vw"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-elite-blue-950/85 via-elite-blue-950/40 to-transparent p-4 pt-12">
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
