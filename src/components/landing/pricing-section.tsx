"use client"

import Link from "next/link"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { cn } from "@/lib/utils"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function PricingSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="pricing" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <SectionHeading tag={c.pricing.tag} title={locale === "ar" ? "خطط بحجم أسطولك." : "Plans for your fleet."} subtitle={c.pricing.subtitle} />
      <div className="mt-14 space-y-3">{c.pricing.plans.map((plan, index) => <Reveal key={plan.name} delay={index * 80}>
        <article className={cn("grid items-start gap-7 p-6 sm:p-8 lg:grid-cols-[.8fr_1fr_1.2fr] lg:gap-10", plan.popular ? "bg-elite-blue-950 text-white" : "bg-muted")}>
          <div className="contents lg:block">
            <h3 className="order-first text-2xl font-semibold tracking-tight">{plan.name}</h3>
            <Link href="/platform/register" className={cn("order-last inline-flex min-h-12 items-center justify-center px-5 text-sm font-semibold transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-4 lg:mt-7", plan.popular ? "bg-white text-elite-blue-950" : "bg-elite-blue-950 text-white")}>{plan.cta}</Link>
          </div>
          <div>
            <p className={cn("font-medium leading-none tracking-[-.05em]", index === 2 ? "text-4xl sm:text-5xl" : "text-6xl sm:text-7xl")}>{plan.price}</p>
            <p className="mt-3 text-base">{plan.period}</p>
            <p className="mt-5 text-base leading-relaxed">{plan.desc}</p>
          </div>
          <ul className="space-y-3 text-base leading-relaxed">{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </article>
      </Reveal>)}</div>
      <DemoNote>{c.pricing.note}</DemoNote>
    </section>
  )
}
export default PricingSection
