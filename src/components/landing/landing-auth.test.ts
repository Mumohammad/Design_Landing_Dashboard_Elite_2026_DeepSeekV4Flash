import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { translations } from "@/lib/i18n/translations"

const state = vi.hoisted(() => ({ locale: "ar" as "ar" | "en" }))
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }))
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props) }))
vi.mock("@/hooks/use-translation", () => ({ useTranslation: () => ({ locale: state.locale, setLocale: vi.fn(), t: translations[state.locale] }) }))
import { LandingHeader } from "./landing-header"
import { LandingFooter } from "./landing-footer"

beforeEach(() => { state.locale = "ar" })
describe("single landing sign-in entry", () => {
  it.each(["ar", "en"] as const)("renders exactly one platform sign-in link in %s, including the mobile DOM", (locale) => {
    state.locale = locale
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(LandingHeader), React.createElement(LandingFooter)))
    const label = translations[locale].auth.signInButton
    expect(html.split(label).length - 1).toBe(1)
    expect(html).toContain(`href="/platform?lang=${locale}"`)
    expect(html).not.toContain('href="/auth/sign-in"')
    expect(html).not.toContain("hidden rounded-xl sm:inline-flex\" href=\"/platform?")
    expect(readFileSync(new URL("./hero-section.tsx", import.meta.url), "utf8")).not.toMatch(/signInUrl|auth\/sign-in|ctaSecondary/)
  })
})
