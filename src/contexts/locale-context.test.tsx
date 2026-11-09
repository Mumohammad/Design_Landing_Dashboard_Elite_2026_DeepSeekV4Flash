import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { LocaleProvider } from "./locale-context"
import { useTranslation } from "@/hooks/use-translation"
import { translations } from "@/lib/i18n/translations"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

function PublicContent() {
  const { locale, t } = useTranslation()
  return <main lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><h1>{t.nav.dashboard}</h1></main>
}

it.each(["en", "ar"] as const)("renders requested %s content on the server without browser storage", locale => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}><PublicContent /></LocaleProvider>)
  expect(html).toContain(`lang="${locale}"`)
  expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`)
  expect(html).toContain(translations[locale].nav.dashboard)
  expect(html).not.toContain("Loading")
})

it("lets public requested-language content override a surrounding default provider", () => {
  const html = renderToStaticMarkup(<LocaleProvider><LocaleProvider initialLocale="en"><PublicContent /></LocaleProvider></LocaleProvider>)
  expect(html).toContain('lang="en"')
  expect(html).toContain(translations.en.nav.dashboard)
})

it.each(["en", "ar"] as const)("gives Radix tab controls the actual %s reading direction", locale => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale={locale}>
    <Tabs defaultValue="invoices"><TabsList><TabsTrigger value="invoices">Invoices</TabsTrigger></TabsList><TabsContent value="invoices">Records</TabsContent></Tabs>
  </LocaleProvider>)
  const root = html.match(/<div\b[^>]*data-slot="tabs"[^>]*>/)?.[0]
  expect(root).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`)
})
