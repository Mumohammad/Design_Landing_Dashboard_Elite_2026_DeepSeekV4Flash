"use client"

import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal } from "./shared"

export function WorkflowSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  return (
    <section id="workflow" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-24 lg:px-8 lg:py-32">
      <div className="grid items-start gap-12 md:grid-cols-[.85fr_1.15fr] md:gap-8 lg:grid-cols-[.8fr_1.2fr] lg:gap-24">
        <Reveal className="lg:sticky lg:top-10">
          <h2 className="max-w-[16ch] text-[clamp(2rem,3.8vw,3.6rem)] font-semibold leading-[1.1] tracking-[-.035em]">{locale === "ar" ? "من التوظيف إلى الراتب." : "From hiring to payroll."}</h2>
          <p className="mt-7 max-w-[35ch] text-lg leading-relaxed">{c.workflow.subtitle}</p>
          <p className="mt-10 max-w-[20ch] text-2xl leading-snug tracking-tight">{c.hero.flowTitle}</p>
        </Reveal>
        <ol className="space-y-9">{c.workflow.steps.map((step, index) => <li key={step.title}>
          <Reveal delay={index % 3 * 60}>
            <h3 className="text-[clamp(1.5rem,2.5vw,2.4rem)] font-medium leading-tight tracking-tight">{step.title}</h3>
            <p className="mt-3 text-base leading-relaxed">{step.desc}</p>
          </Reveal>
        </li>)}</ol>
      </div>
    </section>
  )
}
