"use client"

import { useTranslation } from "@/hooks/use-translation"
import { translateUi } from "@/lib/i18n/ui-copy"

/** Explicit static UI copy; user-entered content is never translated. */
export function LocalizedText({ text }: { text: string }) {
  const { locale } = useTranslation()
  return translateUi(locale, text)
}

export function useUiText() {
  const { locale } = useTranslation()
  return (text: string) => translateUi(locale, text)
}

export function BilingualText({ ar, en }: { ar: string; en: string }) {
  const { locale } = useTranslation()
  return locale === "ar" ? ar : en
}
