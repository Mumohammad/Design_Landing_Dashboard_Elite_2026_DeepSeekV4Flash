"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"
import { DotPattern } from "@/components/dot-pattern"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote, iconMap } from "./shared"

const statTones = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
} as const

export function Driver360Section() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]

  return (
    <section id="driver360" className="relative scroll-mt-24 overflow-hidden bg-elite-blue-950 py-20">
      <DotPattern
        size="lg"
        opacity="low"
        fadeStyle="ellipse"
        className="!bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading dark tag={c.driver360.tag} title={c.driver360.title} subtitle={c.driver360.subtitle} />

        <div className="mt-12 grid gap-6 lg:grid-cols-5">
          {/* Driver profile card */}
          <Reveal className="lg:col-span-2">
            <div className="h-full overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-xl shadow-black/20 backdrop-blur-md">
              <div className="relative h-20 bg-gradient-to-r from-elite-blue-600/60 to-elite-orange-500/60">
                <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.2)_1px,transparent_1px)] bg-[length:14px_14px]" />
              </div>
              <div className="px-6 pb-6">
                <div className="-mt-9 flex items-end justify-between">
                  <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border-4 border-elite-blue-950 bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-2xl font-extrabold text-white shadow-lg">
                    {c.driver360.name.trim()[0]}
                  </div>
                  <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    {c.driver360.status}
                  </span>
                </div>
                <h3 className="mt-3 text-xl font-extrabold text-white">{c.driver360.name}</h3>
                <p className="text-xs font-semibold text-white/60">{c.driver360.id}</p>

                <dl className="mt-4 space-y-2 border-t border-white/15 pt-4 text-sm">
                  {[
                    [c.driver360.nationalityLabel, c.driver360.nationality],
                    [c.driver360.contractLabel, c.driver360.contract],
                    [c.driver360.categoryLabel, c.driver360.category],
                    [c.driver360.vehicleLabel, c.driver360.vehicle],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-white/60">{label}</dt>
                      <dd className="text-end text-xs font-bold text-white">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {c.driver360.stats.map((stat) => {
                    const Icon = iconMap[stat.icon]
                    return (
                      <div key={stat.label} className="rounded-xl border border-white/15 bg-white/10 p-2.5 text-center">
                        <Icon className={cn("mx-auto h-4 w-4", statTones[stat.tone ?? "good"])} />
                        <p className="mt-1.5 text-sm font-extrabold tabular-nums text-white">{stat.value}</p>
                        <p className="text-[10px] text-white/60">{stat.label}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Reveal>

          {/* Relations diagram */}
          <Reveal delay={120} className="lg:col-span-3">
            <div className="flex h-full flex-col rounded-2xl border border-white/15 bg-white/[0.08] p-6 shadow-xl shadow-black/20 backdrop-blur-md sm:p-8">
              <h3 className="text-lg font-extrabold text-white">{c.driver360.relationsTitle}</h3>
              <p className="mt-1 text-sm text-white/70">{c.driver360.relationsSubtitle}</p>

              <div className="mt-6 flex justify-center">
                <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-gradient-to-r from-elite-blue-500/30 to-elite-orange-500/30 px-5 py-3 shadow-lg">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-sm font-extrabold text-white">
                    {c.driver360.name.trim()[0]}
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-white">{c.driver360.name}</p>
                    <p className="text-[10px] text-white/60">{c.driver360.id}</p>
                  </div>
                </div>
              </div>
              <div className="mx-auto h-8 w-px bg-gradient-to-b from-white/50 to-white/15" />

              <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {c.driver360.relations.map((relation, i) => {
                  const Icon = iconMap[relation.icon]
                  return (
                    <div
                      key={relation.label}
                      className="group rounded-xl border border-white/15 bg-white/10 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/50 hover:bg-white/15"
                      style={{ transitionDelay: `${i * 20}ms` }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/20 text-emerald-300 transition-colors group-hover:bg-emerald-400/30 group-hover:text-emerald-200">
                          <Icon className="h-4 w-4" />
                        </span>
                        <p className="text-sm font-bold text-white">{relation.label}</p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-white/70">{relation.desc}</p>
                    </div>
                  )
                })}
              </div>

              {/* Fleet on the move visual */}
              <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/15 shadow-lg shadow-black/30">
                <Image
                  src="/Bike-2026.png"
                  alt={c.driver360.note}
                  width={1365}
                  height={768}
                  className="aspect-[16/9] w-full object-cover object-center"
                  sizes="(min-width: 1024px) 60vw, 100vw"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-elite-blue-950/80 to-transparent px-4 pb-3 pt-10">
                  <p className="text-xs font-bold text-white">
                    {locale === "ar" ? "الأسطول في الطريق" : "The fleet on the move"}
                  </p>
                </div>
              </div>

              <DemoNote dark>{c.driver360.note}</DemoNote>
            </div>
          </Reveal>
        </div>

        {/* Configurable contract models */}
        <div className="mt-14">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h3 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {c.driver360.contractsTitle}
            </h3>
            <p className="mt-3 text-sm text-white/70">{c.driver360.contractsSubtitle}</p>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {c.driver360.contracts.map((model, index) => (
              <Reveal key={model.title} delay={index * 80}>
                <div className="group h-full rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/50 hover:bg-white/15">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/40 to-elite-blue-500/40 text-lg font-extrabold text-white">
                      {index + 1}
                    </span>
                    <p className="font-bold text-white">{model.title}</p>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-white/70">{model.desc}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {model.provided.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/80"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-white/50">{c.driver360.contractsNote}</p>
        </div>
      </div>
    </section>
  )
}
