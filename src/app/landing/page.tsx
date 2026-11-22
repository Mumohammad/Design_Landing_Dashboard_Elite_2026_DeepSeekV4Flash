import type { Metadata } from "next"
import { LocaleProvider } from "@/contexts/locale-context"
import { landingContent } from "@/lib/landing-content"
import LandingPageContent from "./landing-page-content"

const publicUrl = process.env.PUBLIC_LANDING_URL || process.env.NEXT_PUBLIC_LANDING_URL ||
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://elite-dashboard-blush.vercel.app"
const siteOrigin = new URL(publicUrl).origin
const landingUrl = new URL("/landing", siteOrigin).href
type LandingProps = { searchParams: Promise<{ lang?: string | string[] }> }

async function requestedLocale({ searchParams }: LandingProps) {
  return (await searchParams).lang === "en" ? "en" : "ar"
}

export async function generateMetadata(props: LandingProps): Promise<Metadata> {
  const locale = await requestedLocale(props)
  const title = locale === "ar"
    ? "نخبة التطوير | إدارة أساطيل التوصيل في السعودية"
    : "Elite Development | Delivery fleet management in Saudi Arabia"
  const description = landingContent[locale].hero.subheadline
  const canonical = locale === "ar" ? landingUrl : landingUrl + "?lang=en"
  const image = new URL("/og-cover.png", siteOrigin).href
  return {
    title, description,
    robots: { index: true, follow: true },
    alternates: { canonical, languages: { ar: landingUrl, en: landingUrl + "?lang=en", "x-default": landingUrl } },
    openGraph: {
      type: "website", title, description, url: canonical, siteName: "Elite Development",
      locale: locale === "ar" ? "ar_SA" : "en_US",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  }
}

export default async function LandingPage(props: LandingProps) {
  const locale = await requestedLocale(props)
  const content = landingContent[locale]
  const name = locale === "ar" ? "نخبة التطوير" : "Elite Development"
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name, url: siteOrigin },
      { "@type": "WebSite", name, url: siteOrigin, inLanguage: ["ar", "en"] },
      { "@type": "SoftwareApplication", name, applicationCategory: "BusinessApplication",
        operatingSystem: "Web", description: content.hero.subheadline },
      { "@type": "FAQPage", inLanguage: locale, mainEntity: content.faq.items.map(({ q, a }) => ({
        "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a },
      })) },
    ],
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <LocaleProvider initialLocale={locale}><LandingPageContent /></LocaleProvider>
    </>
  )
}
