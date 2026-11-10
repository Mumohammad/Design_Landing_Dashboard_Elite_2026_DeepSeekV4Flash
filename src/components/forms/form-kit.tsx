"use client"

// Shared building blocks for long create/edit dialogs: sectioned cards with an
// icon + hint, a jump-to-section chip bar, a currency/unit suffix input and the
// sticky header/footer classes. Keeps every module's forms visually identical.

import type { ComponentProps, ComponentType, ReactNode } from "react"
import { Input } from "@/components/ui/input"

type IconType = ComponentType<{ className?: string }>

export const FORM_DIALOG_CLASS =
  "max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-2xl p-0 [&>[data-slot=dialog-close]]:z-20"
export const FORM_HEADER_CLASS =
  "sticky top-0 z-10 min-w-0 border-b border-border/60 bg-background/95 pb-3 pl-4 pr-12 pt-4 backdrop-blur sm:pl-6"
export const FORM_BODY_CLASS = "grid min-w-0 gap-4 px-4 py-4 sm:px-6"
export const FORM_FOOTER_CLASS =
  "sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"

export function FormSection({ id, icon: Icon, title, hint, cols = 2, children }: {
  id: string; icon: IconType; title: string; hint?: string; cols?: 1 | 2 | 3; children: ReactNode
}) {
  const grid = cols === 1 ? "grid gap-2" : cols === 3 ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-4 sm:grid-cols-2"
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-28 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-elite-blue-500/10 text-elite-blue-600 dark:text-elite-blue-300"><Icon className="size-4" /></span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      <div className={grid}>{children}</div>
    </section>
  )
}

export function FormSectionNav({ items, label }: { items: { id: string; icon: IconType; label: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 mt-3 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-0.5">
      {items.map((it) => (
        <a key={it.id} href={`#${it.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" }) }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-elite-blue-500/40 hover:bg-elite-blue-500/10 hover:text-elite-blue-700 dark:hover:text-elite-blue-300">
          <it.icon className="size-3.5" />{it.label}
        </a>
      ))}
    </nav>
  )
}

/** Numeric input with a trailing unit (ر.س / SAR / km …). */
export function SuffixInput({ suffix, className, ...rest }: ComponentProps<typeof Input> & { suffix: string }) {
  return (
    <div className="relative">
      <Input {...rest} className={`h-10 pe-12 text-end tabular-nums ${className ?? ""}`} />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{suffix}</span>
    </div>
  )
}
