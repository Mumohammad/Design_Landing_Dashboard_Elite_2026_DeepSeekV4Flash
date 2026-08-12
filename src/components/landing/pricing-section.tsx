"use client"

import Link from "next/link"
import { Check, ArrowLeft, ArrowRight, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { landingContent } from "@/lib/landing-content"
import { useTranslation } from "@/hooks/use-translation"
import { Reveal, SectionHeading, DemoNote } from "./shared"

export function PricingSection() {
  const { locale } = useTranslation()
  const c = landingContent[locale as "en" | "ar"]
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight

  return (
    <section id="pricing" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-20">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.pricing.tag} title={c.pricing.title} subtitle={c.pricing.subtitle} />

        <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3">
          {c.pricing.plans.map((plan, index) => (
            <Reveal key={plan.name} delay={index * 80}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border bg-background p-6 transition-all duration-300 sm:p-7",
                  plan.popular
                    ? "border-elite-blue-500/50 shadow-xl shadow-elite-blue-500/15 ring-1 ring-inset ring-elite-blue-500/30"
                    : "border-border/50 hover:border-elite-blue-500/30 hover:shadow-lg hover:shadow-elite-blue-500/10"
                )}
              >
                {plan.popular && (
                  <span className="absolute -top-3 start-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 px-3 py-1 text-[10px] font-bold whitespace-nowrap text-white shadow-md rtl:translate-x-1/2">
                    <Sparkles className="h-3 w-3" />
                    {locale === "ar" ? "الأكثر شيوعًا" : "Most popular"}
                  </span>
                )}
                <h3 className="text-lg font-extrabold text-foreground">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.desc}</p>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">{plan.price}</span>
                  <span className="text-sm font-medium text-muted-foreground">{plan.period}</span>
                </div>
                <ul className="mt-6 flex-1 space-y-2.5 border-t border-border/50 pt-5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3 w-3" />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  variant={plan.popular ? "default" : "outline"}
                  className={cn(
                    "mt-6 h-11 w-full rounded-xl text-sm font-bold",
                    plan.popular &&
                      "bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-lg shadow-elite-blue-500/25 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
                  )}
                >
                  <Link href="/auth/sign-in">
                    {plan.cta}
                    <Arrow className="h-4 w-4 rtl:-scale-x-100" />
                  </Link>
                </Button>
              </div>
            </Reveal>
          ))}
        </div>

        <DemoNote>{c.pricing.note}</DemoNote>
      </div>
    </section>
  )
}
