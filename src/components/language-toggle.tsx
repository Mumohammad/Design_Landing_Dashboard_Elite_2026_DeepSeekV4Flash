"use client"

import { Languages } from "lucide-react"
import { useTranslation } from "@/hooks/use-translation"
import { cn } from "@/lib/utils"

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useTranslation()
  return (
    <button type="button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
      aria-label={locale === "ar" ? "Switch language to English" : "تغيير اللغة إلى العربية"}
      className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring", className)}>
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span>{locale === "ar" ? "English" : "العربية"}</span>
    </button>
  )
}
