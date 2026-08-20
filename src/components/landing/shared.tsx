"use client"

import * as React from "react"
import {
  UsersRound,
  TruckElectric,
  CarFront,
  PackageSearch,
  HandCoins,
  CalendarClock,
  Siren,
  Wrench,
  WalletCards,
  FileBadge,
  ShieldCheck,
  ChartLine,
  Target,
  TrendingDown,
  Fingerprint,
  FileSearch,
  GitBranch,
  Languages,
  ClipboardCheck,
  FileSpreadsheet,
  Download,
  Globe,
  Bell,
  Check,
  Shield,
  Scale,
  Coins,
  Navigation,
  Sparkles,
  Hexagon,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { IconKey } from "@/lib/landing-content"

/** Modern 2026 icon map — trendy, rounded, visually rich icons */
export const iconMap: Record<IconKey, LucideIcon> = {
  drivers: UsersRound,
  fleet: TruckElectric,
  vehicles: CarFront,
  orders: PackageSearch,
  payroll: HandCoins,
  attendance: CalendarClock,
  violations: Siren,
  maintenance: Wrench,
  expenses: WalletCards,
  documents: FileBadge,
  compliance: ShieldCheck,
  reports: ChartLine,
  performance: Target,
  cost: TrendingDown,
  security: Fingerprint,
  audit: FileSearch,
  rbac: GitBranch,
  bilingual: Languages,
  handover: ClipboardCheck,
  wps: FileSpreadsheet,
  export: Download,
  languages: Globe,
  calendar: CalendarClock,
  alert: Bell,
  check: Check,
  shield: Shield,
  scale: Scale,
  banknote: Coins,
  users: UsersRound,
  car: CarFront,
  dashboard: Navigation,
}

/** Per-icon gradient color tones for animated icon containers */
export const iconGradients: Record<string, string> = {
  drivers: "from-blue-500 to-cyan-500",
  fleet: "from-emerald-500 to-teal-500",
  vehicles: "from-violet-500 to-purple-500",
  orders: "from-amber-500 to-orange-500",
  payroll: "from-emerald-500 to-green-500",
  attendance: "from-blue-500 to-indigo-500",
  violations: "from-red-500 to-rose-500",
  maintenance: "from-orange-500 to-amber-500",
  expenses: "from-cyan-500 to-blue-500",
  documents: "from-indigo-500 to-violet-500",
  compliance: "from-emerald-500 to-cyan-500",
  reports: "from-blue-500 to-purple-500",
  performance: "from-red-500 to-orange-500",
  cost: "from-emerald-500 to-teal-500",
  security: "from-violet-500 to-fuchsia-500",
  audit: "from-blue-500 to-indigo-500",
  rbac: "from-amber-500 to-orange-500",
  bilingual: "from-cyan-500 to-blue-500",
  check: "from-emerald-500 to-green-500",
  banknote: "from-emerald-500 to-cyan-500",
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
  direction = "up",
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  direction?: "up" | "down" | "left" | "right" | "scale" | "fade"
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
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const dirClass = {
    up: visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
    down: visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-8",
    left: visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8",
    right: visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8",
    scale: visible ? "opacity-100 scale-100" : "opacity-0 scale-95",
    fade: visible ? "opacity-100" : "opacity-0",
  }[direction]

  return (
    <div
      ref={ref}
      className={cn(
        className,
        "min-w-0 transition-all duration-700 ease-out motion-reduce:transition-none",
        dirClass
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

/* ─── Animated icon container with gradient and glow ─── */
export function IconBadge({
  iconKey,
  className,
  size = "md",
  dark = false,
}: {
  iconKey: string
  className?: string
  size?: "sm" | "md" | "lg"
  dark?: boolean
}) {
  const Icon = iconMap[iconKey as IconKey] || ShieldCheck
  const gradient = iconGradients[iconKey] || "from-blue-500 to-cyan-500"

  const sizeClasses = {
    sm: "h-10 w-10 rounded-xl",
    md: "h-12 w-12 rounded-2xl",
    lg: "h-14 w-14 rounded-2xl",
  }[size]

  const iconSize = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  }[size]

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl",
          sizeClasses,
          gradient,
          dark ? "shadow-black/30 text-white" : "shadow-current/10 text-white"
        )}
      >
        <Icon className={iconSize} />
      </div>
      <div
        className={cn(
          "absolute inset-0 -z-10 rounded-2xl opacity-0 blur-xl transition-all duration-500 group-hover:opacity-40",
          dark ? "bg-white/20" : "bg-gradient-to-br",
          !dark && gradient
        )}
      />
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
          ? "border-white/15 bg-white/10 text-white backdrop-blur-sm"
          : "border-elite-blue-500/30 bg-elite-blue-500/5 text-elite-blue-600 dark:text-elite-blue-300"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dark ? "bg-elite-orange-400 animate-pulse" : "bg-elite-blue-500 animate-pulse")} />
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
          "mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl",
          dark ? "text-white" : "text-foreground"
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={cn("mx-auto mt-4 max-w-2xl text-base leading-relaxed", dark ? "text-white/60" : "text-muted-foreground")}>
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
        dark ? "text-white/40" : "text-muted-foreground"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dark ? "bg-white/40" : "bg-elite-orange-500")} />
      {children}
    </p>
  )
}
