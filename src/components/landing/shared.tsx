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
/** Icons sit on the surface in the one accent colour: no tinted squares, no per-module hues. */
const ICON_PLAIN = "bg-transparent text-elite-blue-600! dark:text-elite-blue-300! shadow-none h-auto! w-auto! justify-start! rounded-none"
export const iconGradients: Record<string, string> = {
  drivers: ICON_PLAIN,
  fleet: ICON_PLAIN,
  vehicles: ICON_PLAIN,
  orders: ICON_PLAIN,
  payroll: ICON_PLAIN,
  attendance: ICON_PLAIN,
  violations: ICON_PLAIN,
  maintenance: ICON_PLAIN,
  expenses: ICON_PLAIN,
  documents: ICON_PLAIN,
  compliance: ICON_PLAIN,
  reports: ICON_PLAIN,
  performance: ICON_PLAIN,
  cost: ICON_PLAIN,
  security: ICON_PLAIN,
  audit: ICON_PLAIN,
  rbac: ICON_PLAIN,
  bilingual: ICON_PLAIN,
  check: ICON_PLAIN,
  banknote: ICON_PLAIN,
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

/* ─── Plain outline icon (no tinted container, no glow) ─── */
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
  const iconSize = { sm: "h-5 w-5", md: "h-5 w-5", lg: "h-6 w-6" }[size]
  return (
    <span className={cn("inline-flex", className)} aria-hidden>
      <Icon className={cn(iconSize, dark ? "text-white/80" : "text-elite-blue-600 dark:text-elite-blue-300")} strokeWidth={1.75} />
    </span>
  )
}

/* ─── Section tag: kept for API compatibility; eyebrow pills are not rendered. ─── */
export function SectionTag(_props: { children: React.ReactNode; dark?: boolean }) {
  return null
}

/* ─── Section heading block ─── */
export function SectionHeading({
  title,
  subtitle,
  dark = false,
  className,
}: {
  tag?: string
  title: string
  subtitle?: string
  dark?: boolean
  className?: string
}) {
  return (
    <Reveal className={cn("max-w-3xl text-start", className)}>
      <h2
        className={cn(
          "text-3xl font-bold leading-tight sm:text-4xl",
          dark ? "text-white" : "text-foreground"
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={cn("mt-4 max-w-2xl text-lg leading-relaxed", dark ? "text-white/85" : "text-foreground/80")}>
          {subtitle}
        </p>
      )}
    </Reveal>
  )
}

/* ─── Small "demo data" marker ─── */
export function DemoNote({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <p className={cn("mt-6 text-sm", dark ? "text-white/75" : "text-muted-foreground")}>
      {children}
    </p>
  )
}
