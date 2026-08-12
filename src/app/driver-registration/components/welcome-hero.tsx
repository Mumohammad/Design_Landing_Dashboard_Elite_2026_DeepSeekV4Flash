"use client"

import { ArrowRight } from "lucide-react"
import { DotPattern } from "@/components/dot-pattern"
import { Button } from "@/components/ui/button"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import { RegistrationHeader } from "./fields"

export function WelcomeHero({ onStart }: { onStart: () => void }) {
  const { dict } = useDriverRegistration()
  const Arrow = ArrowRight

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Brand backdrop */}
      <div className="absolute inset-0 bg-gradient-to-b from-elite-blue-50 via-background to-background dark:from-elite-blue-950/30 dark:via-background dark:to-background" />
      <DotPattern size="md" opacity="low" fadeStyle="ellipse" />

      {/* Animated logistics route lines */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-60"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="route-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1E5A99" stopOpacity="0" />
            <stop offset="50%" stopColor="#1E5A99" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#E87D3E" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#route-grad)" strokeWidth="1.5">
          <path d="M-50 620 C 250 520, 420 700, 720 600 S 1180 480, 1500 560" />
          <path d="M-50 320 C 300 420, 560 240, 860 360 S 1260 300, 1500 380" strokeOpacity="0.6" />
          <path d="M100 900 C 400 700, 640 820, 940 700 S 1300 620, 1500 700" strokeOpacity="0.4" />
        </g>
        {[
          [720, 600],
          [860, 360],
          [940, 700],
        ].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="4" fill="#E87D3E" className="animate-pulse" style={{ animationDelay: `${i * 400}ms` }} />
            <circle cx={cx} cy={cy} r="10" fill="#E87D3E" opacity="0.2" className="animate-ping" style={{ animationDelay: `${i * 400}ms`, transformOrigin: `${cx}px ${cy}px` }} />
          </g>
        ))}
      </svg>

      <RegistrationHeader />

      <main className="relative mx-auto flex max-w-4xl flex-col items-center px-4 pb-16 pt-14 text-center lg:px-8 lg:pt-20">
        <div className="flex items-center gap-3 rounded-full border border-elite-blue-500/30 bg-elite-blue-500/5 px-4 py-1.5 text-xs font-bold text-elite-blue-600 dark:text-elite-blue-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {dict.welcome.badge}
        </div>

        <h1 className="mt-6 max-w-2xl text-4xl font-extrabold leading-[1.15] tracking-tight text-foreground sm:text-5xl">
          {dict.welcome.title}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {dict.welcome.subtitle}
        </p>

        <Button
          onClick={onStart}
          size="lg"
          className="group mt-9 h-14 gap-2.5 rounded-2xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-10 text-base font-bold text-white shadow-xl shadow-elite-blue-500/30 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/50"
        >
          {dict.welcome.ctaStart}
          <Arrow className="h-5 w-5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
        </Button>

        <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-elite-orange-500" />
          {dict.welcome.steps}
        </p>

        <div className="mt-12 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
          {dict.welcome.trustPoints.map((point, i) => (
            <div
              key={point}
              className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3.5 text-[13px] font-semibold text-foreground shadow-sm backdrop-blur-sm"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
                  <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {point}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
