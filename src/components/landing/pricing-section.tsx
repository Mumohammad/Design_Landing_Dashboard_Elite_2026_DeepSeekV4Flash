"use client"

import Link from "next/link"
import { Check, ArrowLeft, ArrowRight, Sparkles, Zap } from "lucide-react"
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
    <section id="pricing" className="relative scroll-mt-24 overflow-hidden border-y border-border/40 bg-card/40 py-24">
      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading tag={c.pricing.tag} title={c.pricing.title} subtitle={c.pricing.subtitle} />

        <div className="mt-14 grid items-stretch gap-7 lg:grid-cols-3">
          {c.pricing.plans.map((plan, index) => (
            <Reveal key={plan.name} delay={index * 100}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-3xl bg-background p-7 transition-all duration-300 sm:p-8",
                  plan.popular
                    ? "card-premium border-elite-blue-500/50 shadow-2xl shadow-elite-blue-500/15 ring-1 ring-inset ring-elite-blue-500/30 scale-[1.02] z-10"
                    : "card-premium"
                )}
              >
                {plan.popular && (
                  <>
                    <span className="absolute -top-3.5 start-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 px-4 py-1.5 text-[11px] font-bold whitespace-nowrap text-white shadow-xl shadow-elite-blue-500/30 rtl:translate-x-1/2">
                      <Sparkles className="h-3.5 w-3.5" />
                      {locale === "ar" ? "الأكثر شيوعًا" : "Most popular"}
                    </span>
                    {/* Animated glow behind popular card */}
                    <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-elite-blue-500/10 to-elite-orange-500/10 blur-xl opacity-50" />
                  </>
                )}
                <div className="relative">
                  <h3 className="text-xl font-extrabold text-foreground">{plan.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.desc}</p>
                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">{plan.price}</span>
                    <span className="text-sm font-medium text-muted-foreground">{plan.period}</span>
                  </div>
                  <ul className="mt-7 flex-1 space-y-3 border-t border-border/50 pt-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 text-sm text-foreground">
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
                      "mt-7 h-12 w-full rounded-2xl text-sm font-bold transition-all duration-300",
                      plan.popular &&
                        "bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 text-white shadow-xl shadow-elite-blue-500/25 hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40 hover:scale-[1.02] active:scale-[0.98]"
                    )}
                  >
                    <Link href="/auth/sign-in">
                      {plan.popular && <Zap className="h-4 w-4" />}
                      {plan.cta}
                      <Arrow className="h-4 w-4 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <DemoNote>{c.pricing.note}</DemoNote>
      </div>
    </section>
  )
}
