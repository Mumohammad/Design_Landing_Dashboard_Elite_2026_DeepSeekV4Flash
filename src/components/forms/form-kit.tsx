"use client"

// Shared building blocks for long create/edit dialogs: sectioned cards with an
// icon + hint, a jump-to-section chip bar, a currency/unit suffix input and the
// sticky header/footer classes. Keeps every module's forms visually identical.

import type { ComponentProps, ComponentType, ReactNode } from "react"
import { Input } from "@/components/ui/input"

type IconType = ComponentType<{ className?: string }>

export const FORM_DIALOG_CLASS =
  "max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-lg p-0 [&>[data-slot=dialog-close]]:z-20"
export const FORM_HEADER_CLASS =
  "sticky top-0 z-10 min-w-0 border-b border-border bg-background pb-3 ps-4 pe-12 pt-4 sm:ps-6"
export const FORM_BODY_CLASS = "grid min-w-0 gap-4 px-4 py-4 sm:px-6"
export const FORM_FOOTER_CLASS =
  "sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 sm:-mx-6 sm:px-6"

export function FormSection({ id, icon: Icon, title, hint, cols = 2, children }: {
  id: string; icon: IconType; title: string; hint?: string; cols?: 1 | 2 | 3; children: ReactNode
}) {
  const grid = cols === 1 ? "grid gap-2" : cols === 3 ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-4 sm:grid-cols-2"
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-28 rounded-lg bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
        <a key={it.id} href={`#${it.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(it.id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }) }}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
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
