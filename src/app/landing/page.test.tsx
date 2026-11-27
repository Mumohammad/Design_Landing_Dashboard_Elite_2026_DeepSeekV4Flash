import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { landingContent } from "@/lib/landing-content"
import { REDIRECTS, withLocale } from "@/lib/redirects"
import LandingPage, { generateMetadata } from "./page"

describe.each(["ar", "en"] as const)("public landing page in %s", locale => {
  const props = { searchParams: Promise.resolve({ lang: locale }) }

  it("renders localized registration, sign-in and tenant invitation guidance", async () => {
    const html = renderToStaticMarkup(await LandingPage(props))
    expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`)
    expect(html).toContain(`href="${withLocale(REDIRECTS.registerUrl, locale)}"`)
    expect(html).toContain(`href="${withLocale(REDIRECTS.signInUrl, locale)}"`)
    expect(html).toContain('id="driver-applications"')
    expect(html).not.toContain('href="/driver-registration')
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(html).toContain(`id="${id}"`)
  })

  it("uses the active locale for the public description and FAQ schema", async () => {
    expect((await generateMetadata(props)).description).toBe(landingContent[locale].hero.subheadline)
    const html = renderToStaticMarkup(await LandingPage(props))
    const match = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)
    const faq = JSON.parse(match![1])["@graph"].find((item: { "@type": string }) => item["@type"] === "FAQPage")
    expect(faq.mainEntity.map((item: { name: string }) => item.name)).toEqual(landingContent[locale].faq.items.map(item => item.q))
  })
})
