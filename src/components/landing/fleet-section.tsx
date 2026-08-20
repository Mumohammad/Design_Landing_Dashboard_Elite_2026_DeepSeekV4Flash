"use client"

import { cn } from "@/lib/utils"
import { CarFront, ArrowDown, Gauge, Fuel, Wrench, DollarSign, Activity } from "lucide-react"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

const fleetChain =
  (locale: string) =>
  (locale === "ar"
    ? ["المركبة", "السائق", "الصيانة", "التكاليف", "الرواتب"]
    : ["Vehicle", "Driver", "Maintenance", "Costs", "Payroll"])

const kpiIcons = [CarFront, Activity, Wrench]
const kpiColors = [
  "text-emerald-600 dark:text-emerald-400",
  "text-blue-600 dark:text-blue-400",
  "text-amber-600 dark:text-amber-400",
]
const kpiBgs = [
  "bg-emerald-500/10",
  "bg-blue-500/10",
  "bg-amber-500/10",
]

export function FleetSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="fleet" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-24">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.fleet.tag} title={c.fleet.title} subtitle={c.fleet.subtitle} />

        <div className="mt-14 grid gap-6 lg:grid-cols-5">
          {/* Vehicle record card */}
          <Reveal className="lg:col-span-3">
            <div className="card-premium h-full overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/20">
                    <CarFront className="h-5 w-5" />
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
                <p className="text-xl font-extrabold text-foreground">{c.fleet.vehicleName}</p>
                <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {c.fleet.fields.map((field, i) => (
                    <div key={field.label} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2.5">
                      <span className="text-xs text-muted-foreground">{field.label}</span>
                      <span className="text-sm font-bold text-foreground">{field.value}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5 text-elite-blue-500" />
                      {c.fleet.availabilityLabel}
                    </span>
                    <span className="font-extrabold tabular-nums text-foreground">{c.fleet.availabilityValue}</span>
                  </div>
                  <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[96%] rounded-full bg-gradient-to-r from-elite-blue-500 via-elite-blue-400 to-elite-orange-500 transition-all duration-1000 ease-out" />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Fleet status + chain */}
          <Reveal delay={120} className="lg:col-span-2">
            <div className="flex h-full flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {c.fleet.kpis.map((kpi, i) => (
                  <div key={kpi.label} className="card-premium p-4 text-center">
                    <div className={cn("mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl", kpiBgs[i])}>
                      {(() => { const I = kpiIcons[i]; return <I className={cn("h-4 w-4", kpiColors[i])} /> })()}
                    </div>
                    <p className={cn("text-2xl font-extrabold tabular-nums", kpiColors[i])}>
                      {kpi.value}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{kpi.label}</p>
                  </div>
                ))}
              </div>

              <div className="card-premium flex flex-1 flex-col justify-center p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {c.hero.flowTitle}
                </p>
                <div className="mt-4 space-y-0">
                  {fleetChain(locale).map((step, i, arr) => (
                    <div key={step} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-extrabold transition-all duration-300",
                          i === arr.length - 1
                            ? "bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-white shadow-lg shadow-elite-blue-500/25"
                            : "border border-border/60 bg-background text-muted-foreground"
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{step}</span>
                      {i < arr.length - 1 && (
                        <ArrowDown className="h-3.5 w-3.5 shrink-0 text-elite-orange-500 animate-pulse" />
                      )}
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
