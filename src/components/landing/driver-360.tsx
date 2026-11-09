"use client"

import Image from "next/image"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function Driver360Section() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="driver360" className="scroll-mt-8 bg-elite-blue-950 py-24 text-white lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading dark tag={c.driver360.tag} title={locale === "ar" ? "سائق واحد. ملف متكامل." : "One driver. Every record."} subtitle={c.driver360.subtitle} />
        <div className="mt-14 grid items-start gap-8 lg:grid-cols-[.9fr_1.1fr]">
          <Reveal>
            <div data-ui className="bg-white p-6 text-elite-blue-950 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm">{c.driver360.id}</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight">{c.driver360.name}</h3>
                </div>
                <span className="bg-elite-blue-50 px-3 py-2 text-sm">{c.driver360.status}</span>
              </div>
              <dl className="mt-8 space-y-4 text-base">{[[c.driver360.nationalityLabel, c.driver360.nationality], [c.driver360.contractLabel, c.driver360.contract], [c.driver360.categoryLabel, c.driver360.category], [c.driver360.vehicleLabel, c.driver360.vehicle]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-5 gap-y-1">
                <dt className="text-elite-blue-700">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>)}</dl>
              <dl className="mt-8 grid grid-cols-2 gap-5 bg-elite-blue-50 p-5">{c.driver360.stats.map(stat => <div key={stat.label}>
                <dd className="text-xl font-semibold tabular-nums">{stat.value}</dd>
                <dt className="mt-1 text-sm">{stat.label}</dt>
              </div>)}</dl>
              <DemoNote>{c.driver360.note}</DemoNote>
            </div>
          </Reveal>
          <div>
            <Reveal delay={90}>
              <h3 className="text-2xl font-medium tracking-tight">{c.driver360.relationsTitle}</h3>
              <p className="mt-3 text-base leading-relaxed">{c.driver360.relationsSubtitle}</p>
            </Reveal>
            <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2">{c.driver360.relations.map((relation, index) => <Reveal key={relation.label} delay={index * 65}>
              <div>
                <p className="text-lg font-semibold">{relation.label}</p>
                <p className="mt-2 text-base leading-relaxed text-white/80">{relation.desc}</p>
              </div>
            </Reveal>)}</div>
          </div>
        </div>
        <div className="mt-20 grid items-start gap-10 lg:grid-cols-[1.1fr_.9fr]">
          <Reveal direction="scale">
            <figure>
              <Image src="/Bike-2026.png" alt={c.driver360.note} width={1365} height={768} className="aspect-[16/10] w-full object-cover" sizes="(min-width: 1024px) 55vw, 100vw" />
              <figcaption className="mt-3 text-sm text-white/75">{locale === "ar" ? "الأسطول في الطريق" : "The fleet on the move"}</figcaption>
            </figure>
          </Reveal>
          <div>
            <Reveal>
              <h3 className="text-2xl font-medium tracking-tight">{c.driver360.contractsTitle}</h3>
              <p className="mt-3 text-base leading-relaxed">{c.driver360.contractsSubtitle}</p>
            </Reveal>
            <div className="mt-7 space-y-7">{c.driver360.contracts.map((model, index) => <Reveal key={model.title} delay={index * 70}>
              <div>
                <p className="text-lg font-semibold">{model.title}</p>
                <p className="mt-2 text-base leading-relaxed text-white/80">{model.desc}</p>
                <p className="mt-2 text-sm text-white/75">{model.provided.join(" · ")}</p>
              </div>
            </Reveal>)}</div>
            <DemoNote dark>{c.driver360.contractsNote}</DemoNote>
          </div>
        </div>
      </div>
    </section>
  )
}
