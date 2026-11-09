"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function FleetSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const chain = locale === "ar" ? ["المركبة", "السائق", "الصيانة", "التكاليف", "الرواتب"] : ["Vehicle", "Driver", "Maintenance", "Costs", "Payroll"]
  return (
    <section id="fleet" className="scroll-mt-8 bg-muted py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading tag={c.fleet.tag} title={locale === "ar" ? "كل مركبة، بكل تفاصيلها." : "Every vehicle, accounted for."} subtitle={c.fleet.subtitle} />
        <div className="mt-14 grid gap-10 lg:grid-cols-[1.15fr_.85fr]">
          <Reveal>
            <div data-ui className="bg-background p-6 sm:p-8">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">{c.fleet.vehicleTitle}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{c.fleet.vehicleId}</p>
                </div>
                <span className="bg-muted px-3 py-2 text-sm">{c.fleet.statusValue}</span>
              </div>
              <p className="mt-8 text-3xl font-medium tracking-tight">{c.fleet.vehicleName}</p>
              <dl className="mt-7 space-y-5">{c.fleet.fields.map(field => <div key={field.label} className="flex flex-wrap justify-between gap-3 text-base">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="font-medium">{field.value}</dd>
              </div>)}</dl>
              <div className="mt-8">
                <p className="flex justify-between gap-4 text-base">
                  <span>{c.fleet.availabilityLabel}</span>
                  <strong className="tabular-nums">{c.fleet.availabilityValue}</strong>
                </p>
                <div className="mt-3 h-3 bg-muted" role="img" aria-label={`${c.fleet.availabilityLabel}: ${c.fleet.availabilityValue}`}>
                  <div className="h-full w-[96%] bg-elite-blue-500" />
                </div>
              </div>
            </div>
          </Reveal>
          <div>
            <div data-ui className="grid grid-cols-3 gap-5">{c.fleet.kpis.map((kpi, index) => <Reveal key={kpi.label} delay={index * 80}>
              <p className="text-[clamp(2rem,4vw,4rem)] font-medium tracking-tight tabular-nums">{kpi.value}</p>
              <p className="mt-2 text-base">{kpi.label}</p>
            </Reveal>)}</div>
            <Reveal delay={140}>
              <div className="mt-10 bg-elite-blue-950 p-6 text-white sm:p-8">
                <p className="text-base leading-relaxed">{c.hero.flowTitle}</p>
                <ol className="mt-6 space-y-3 text-2xl font-medium tracking-tight">{chain.map(step => <li key={step}>{step}</li>)}</ol>
              </div>
            </Reveal>
          </div>
        </div>
        <DemoNote>{c.fleet.note}</DemoNote>
      </div>
    </section>
  )
}
