"use client"

import { cn } from "@/lib/utils"
import { Car, ArrowDown, Gauge } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

const fleetChain =
  (locale: string) =>
  (locale === "ar"
    ? ["المركبة", "السائق", "الصيانة", "التكاليف", "الرواتب"]
    : ["Vehicle", "Driver", "Maintenance", "Costs", "Payroll"])

const kpiTones = {
  good: "text-emerald-600 dark:text-emerald-400",
  info: "text-elite-blue-600 dark:text-elite-blue-300",
  warn: "text-amber-600 dark:text-amber-400",
} as const

export function FleetSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="fleet" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-20">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.fleet.tag} title={c.fleet.title} subtitle={c.fleet.subtitle} />

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
          {/* Vehicle record card */}
          <Reveal className="lg:col-span-3">
            <div className="h-full overflow-hidden rounded-2xl border border-border/50 bg-background shadow-xl shadow-elite-blue-950/5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-blue-700 text-white shadow-lg shadow-elite-blue-500/20">
                    <Car className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-foreground">{c.fleet.vehicleTitle}</p>
                    <p className="text-xs text-muted-foreground">{c.fleet.vehicleId}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  {c.fleet.statusValue}
                </span>
              </div>

              <div className="p-6">
                <p className="text-lg font-extrabold text-foreground">{c.fleet.vehicleName}</p>
                <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {c.fleet.fields.map((field) => (
                    <div key={field.label} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2.5">
                      <span className="text-xs text-muted-foreground">{field.label}</span>
                      <span className="text-sm font-bold text-foreground">{field.value}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5 text-elite-blue-500" />
                      {c.fleet.availabilityLabel}
                    </span>
                    <span className="font-extrabold tabular-nums text-foreground">{c.fleet.availabilityValue}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[96%] rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500" />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Fleet status + chain */}
          <Reveal delay={120} className="lg:col-span-2">
            <div className="flex h-full flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {c.fleet.kpis.map((kpi) => (
                  <div key={kpi.label} className="rounded-2xl border border-border/50 bg-card/70 p-4 text-center backdrop-blur-sm">
                    <p className={cn("text-2xl font-extrabold tabular-nums", kpiTones[kpi.tone as keyof typeof kpiTones])}>
                      {kpi.value}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{kpi.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-1 flex-col justify-center rounded-2xl border border-border/50 bg-card/70 p-6 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {c.hero.flowTitle}
                </p>
                <div className="mt-4 space-y-0">
                  {fleetChain(locale).map((step, i, arr) => (
                    <div key={step} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold",
                          i === arr.length - 1
                            ? "bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white"
                            : "border border-border/60 bg-background text-muted-foreground"
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{step}</span>
                      {i < arr.length - 1 && <ArrowDown className="h-3.5 w-3.5 shrink-0 text-elite-orange-500" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
        <DemoNote>{c.fleet.note}</DemoNote>
      </div>
    </section>
  )
}
