"use client"

import * as React from "react"
import { UsersRound, TruckElectric, CarFront, PackageSearch, HandCoins, CalendarClock, Siren, Wrench, WalletCards, FileBadge, ShieldCheck, ChartLine, Target, TrendingDown, Fingerprint, FileSearch, GitBranch, Languages, ClipboardCheck, FileSpreadsheet, Download, Globe, Bell, Check, Shield, Scale, Coins, Navigation, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { IconKey } from "@/lib/landing-content"

export const iconMap: Record<IconKey, LucideIcon> = {
  drivers: UsersRound, fleet: TruckElectric, vehicles: CarFront, orders: PackageSearch,
  payroll: HandCoins, attendance: CalendarClock, violations: Siren, maintenance: Wrench,
  expenses: WalletCards, documents: FileBadge, compliance: ShieldCheck, reports: ChartLine,
  performance: Target, cost: TrendingDown, security: Fingerprint, audit: FileSearch,
  rbac: GitBranch, bilingual: Languages, handover: ClipboardCheck, wps: FileSpreadsheet,
  export: Download, languages: Globe, calendar: CalendarClock, alert: Bell, check: Check,
  shield: Shield, scale: Scale, banknote: Coins, users: UsersRound, car: CarFront, dashboard: Navigation,
}

export function formatNum(n: number, locale: string) {
  return n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")
}

/** Server-rendered content stays visible; motion is a progressive enhancement. */
export function Reveal({ children, className, delay = 0, direction = "up" }: {
  children: React.ReactNode; className?: string; delay?: number;
  direction?: "up" | "down" | "left" | "right" | "scale" | "fade"
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return
    let animation: Animation | undefined
    const transforms = { up: "translateY(20px)", down: "translateY(-20px)", left: "translateX(20px)", right: "translateX(-20px)", scale: "scale(.98)", fade: "none" }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      animation = el.animate([{ opacity: .55, transform: transforms[direction] }, { opacity: 1, transform: "none" }], {
        duration: 700, delay, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards",
      })
      observer.disconnect()
    }, { threshold: .08 })
    observer.observe(el)
    return () => { observer.disconnect(); animation?.cancel() }
  }, [delay, direction])
  return <div ref={ref} className={cn("min-w-0", className)}>{children}</div>
}

export function SectionHeading({ title, subtitle, dark = false, className }: {
  tag: string; title: string; subtitle?: string; dark?: boolean; className?: string
}) {
  return (
    <div className={cn("grid items-start gap-7 lg:grid-cols-[1.1fr_1fr] lg:gap-20", className)}>
      <Reveal>
        <h2 className={cn("max-w-[22ch] text-[clamp(2rem,3.3vw,3.3rem)] font-semibold leading-[1.12] tracking-[-.035em] text-balance", dark ? "text-white" : "text-foreground")}>{title}</h2>
      </Reveal>
      {subtitle && <Reveal delay={90}>
        <p className={cn("max-w-[58ch] text-base leading-relaxed lg:pt-1 lg:text-lg", dark ? "text-white" : "text-foreground")}>{subtitle}</p>
      </Reveal>}
    </div>
  )
}

export function DemoNote({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={cn("mt-6 text-sm leading-relaxed", dark ? "text-white/75" : "text-muted-foreground")}>{children}</p>
}

export function HeadlineLine({ children, delay = 0 }: { children: string; delay?: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const line = ref.current
    if (!line || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const animation = line.animate([{ transform: "translateY(105%)" }, { transform: "translateY(0)" }], {
      duration: 900, delay, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards",
    })
    return () => animation.cancel()
  }, [delay])
  return <span className="block overflow-hidden pb-[.08em]">
    <span ref={ref} className="block">{children}</span>
  </span>
}
