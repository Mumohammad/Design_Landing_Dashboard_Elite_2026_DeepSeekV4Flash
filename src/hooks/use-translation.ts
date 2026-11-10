"use client"

import { useContext } from "react"
import { LocaleContext } from "@/contexts/locale-context"
import { translations } from "@/lib/i18n/translations"
import type { TranslationStrings } from "@/lib/i18n/types"

export function useTranslation() {
  const context = useContext(LocaleContext)

  if (!context) {
    throw new Error("useTranslation must be used within a LocaleProvider")
  }

  return {
    locale: context.locale,
    setLocale: context.setLocale,
    t: translations[context.locale] as TranslationStrings,
  }
}
