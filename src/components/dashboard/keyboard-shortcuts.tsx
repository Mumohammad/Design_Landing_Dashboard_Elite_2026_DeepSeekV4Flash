"use client"

// Global keyboard shortcuts: "?" opens this help, "g" then a letter jumps to a
// module (Gmail/Linear style). Ignored while typing in a field.

import * as React from "react"
import { useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/hooks/use-translation"

export const GO_SHORTCUTS: { key: string; href: string; ar: string; en: string }[] = [
  { key: "d", href: "/dashboard", ar: "لوحة التحكم", en: "Dashboard" },
  { key: "r", href: "/drivers", ar: "السائقون", en: "Drivers" },
  { key: "v", href: "/vehicles", ar: "المركبات", en: "Vehicles" },
  { key: "m", href: "/maintenance", ar: "الصيانة", en: "Maintenance" },
  { key: "i", href: "/invoices", ar: "الفواتير", en: "Invoices" },
  { key: "a", href: "/accounting", ar: "المحاسبة", en: "Accounting" },
  { key: "p", href: "/payroll", ar: "الرواتب", en: "Payroll" },
  { key: "e", href: "/expenses", ar: "المصروفات", en: "Expenses" },
  { key: "o", href: "/approvals", ar: "الموافقات", en: "Approvals" },
  { key: "s", href: "/settings", ar: "الإعدادات", en: "Settings" },
]

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</kbd>
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const { locale } = useTranslation()
  const ar = locale === "ar"
  const [open, setOpen] = React.useState(false)
  const pendingG = React.useRef<number | null>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      if (e.key === "?") {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      const k = e.key.toLowerCase()
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current)
        pendingG.current = null
        const hit = GO_SHORTCUTS.find((s) => s.key === k)
        if (hit) {
          e.preventDefault()
          setOpen(false)
          router.push(hit.href)
        }
        return
      }
      if (k === "g") pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent dir={ar ? "rtl" : "ltr"} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{ar ? "اختصارات لوحة المفاتيح" : "Keyboard shortcuts"}</DialogTitle>
          <DialogDescription>{ar ? "تنقّل أسرع دون الفأرة." : "Move faster without the mouse."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between"><span>{ar ? "البحث والأوامر" : "Search & commands"}</span><span className="flex gap-1" dir="ltr"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span></div>
          <div className="flex items-center justify-between"><span>{ar ? "عرض هذه القائمة" : "Show this list"}</span><Kbd>?</Kbd></div>
          <div className="my-2 border-t" />
          {GO_SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span>{ar ? `الانتقال إلى ${s.ar}` : `Go to ${s.en}`}</span>
              <span className="flex gap-1" dir="ltr"><Kbd>G</Kbd><Kbd>{s.key.toUpperCase()}</Kbd></span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
