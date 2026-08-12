"use client"

import * as React from "react"
import {
  Users,
  Truck,
  PackageCheck,
  CreditCard,
  CalendarCheck,
  ShieldAlert,
  Wrench,
  Wallet,
  FileText,
  ShieldCheck,
  BarChart3,
  Gauge,
  TrendingDown,
  Lock,
  FileSearch,
  KeyRound,
  Languages,
  ClipboardCheck,
  FileSpreadsheet,
  Download,
  Globe,
  CalendarDays,
  Bell,
  Check,
  Shield,
  Scale,
  Banknote,
  LayoutDashboard,
  Car,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { IconKey } from "@/lib/landing-content"

export const iconMap: Record<IconKey, LucideIcon> = {
  drivers: Users,
  fleet: Truck,
  vehicles: Car,
  orders: PackageCheck,
  payroll: CreditCard,
  attendance: CalendarCheck,
  violations: ShieldAlert,
  maintenance: Wrench,
  expenses: Wallet,
  documents: FileText,
  compliance: ShieldCheck,
  reports: BarChart3,
  performance: Gauge,
  cost: TrendingDown,
  security: Lock,
  audit: FileSearch,
  rbac: KeyRound,
  bilingual: Languages,
  handover: ClipboardCheck,
  wps: FileSpreadsheet,
  export: Download,
  languages: Globe,
  calendar: CalendarDays,
  alert: Bell,
  check: Check,
  shield: Shield,
  scale: Scale,
  banknote: Banknote,
  users: Users,
  car: Car,
  dashboard: LayoutDashboard,
}

export function formatNum(n: number, locale: string) {
  return n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")
}

/* ─── Count-up hook for animated numbers ─── */
export function useCountUp(target: number, duration = 1400, decimals = 0) {
  const [value, setValue] = React.useState(0)
  const ref = React.useRef<HTMLSpanElement>(null)
  const started = React.useRef(false)
  const factor = 10 ** decimals

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true
          const start = performance.now()
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setValue(Math.round(target * eased * factor) / factor)
            if (progress < 1) requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [target, duration, factor])

  return { ref, value }
}

/* ─── Scroll-reveal helper (respects reduced motion via CSS) ─── */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const [visible, setVisible] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn(
        className,
        "min-w-0 transition-all duration-700 ease-out motion-reduce:transition-none",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

/* ─── Section tag (eyebrow pill) ─── */
export function SectionTag({
  children,
  dark = false,
}: {
  children: React.ReactNode
  dark?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold tracking-wide",
        dark
          ? "border-white/15 bg-white/10 text-white"
          : "border-elite-blue-500/30 bg-elite-blue-500/5 text-elite-blue-600 dark:text-elite-blue-300"
      )}
    >
      {children}
    </span>
  )
}

/* ─── Section heading block ─── */
export function SectionHeading({
  tag,
  title,
  subtitle,
  dark = false,
  className,
}: {
  tag: string
  title: string
  subtitle?: string
  dark?: boolean
  className?: string
}) {
  return (
    <Reveal className={cn("mx-auto max-w-3xl text-center", className)}>
      <SectionTag dark={dark}>{tag}</SectionTag>
      <h2
        className={cn(
          "mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl",
          dark ? "text-white" : "text-foreground"
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={cn("mx-auto mt-4 max-w-2xl text-base", dark ? "text-white/70" : "text-muted-foreground")}>
          {subtitle}
        </p>
      )}
    </Reveal>
  )
}

/* ─── Small "demo data" marker ─── */
export function DemoNote({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p
      className={cn(
        "mt-6 flex items-center justify-center gap-2 text-center text-xs",
        dark ? "text-white/45" : "text-muted-foreground"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dark ? "bg-white/40" : "bg-elite-orange-500")} />
      {children}
    </p>
  )
}
