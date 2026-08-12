import type { Metadata } from "next"
import { LandingPageContent } from "./landing-page-content"
import { landingContent } from "@/lib/landing-content"

const title = "Elite Development | نخبة التطوير — Enterprise Logistics Operations Platform"
const description =
  "Enterprise logistics operations platform for Saudi 3PL and fleet operators: connect drivers, vehicles, orders, payroll, expenses and compliance in one operational system."

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "Enterprise Logistics Platform",
    "3PL Management",
    "Fleet Management",
    "Driver Management",
    "Payroll Management",
    "Saudi Logistics Software",
    "Logistics Operations Platform",
    "Fleet & Driver Management",
    "منصة لوجستية",
    "إدارة الأسطول",
    "إدارة السائقين",
    "نخبة التطوير",
  ],
  alternates: {
    canonical: "/landing",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Elite Development | Enterprise Logistics Operations Platform",
    description:
      "Connect drivers, vehicles, orders, payroll, expenses and compliance in one centralized operational system — built for Saudi logistics operations.",
    type: "website",
    url: "/landing",
    siteName: "Elite Development",
    locale: "ar_SA",
    images: [
      {
        url: "/og-cover.png",
        width: 1200,
        height: 630,
        alt: "Elite Development — Enterprise Logistics Operations Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Elite Development | Enterprise Logistics Operations Platform",
    description:
      "Connect drivers, vehicles, orders, payroll, expenses and compliance in one centralized operational system.",
    images: ["/og-cover.png"],
  },
}

const faqJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Elite Development",
      alternateName: "نخبة التطوير",
      url: "/",
      description:
        "Enterprise logistics operations platform connecting drivers, vehicles, orders, payroll, compliance, expenses and reporting in one system.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Elite Development",
      alternateName: "نخبة التطوير",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Enterprise logistics operations platform for managing drivers, fleet, vehicles, orders, payroll, violations, maintenance, expenses, attendance and reporting.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "SAR",
      },
    },
    {
      "@type": "WebSite",
      name: "Elite Development",
      url: "/",
      inLanguage: ["ar", "en"],
    },
    {
      "@type": "FAQPage",
      mainEntity: landingContent.en.faq.items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.a,
        },
      })),
    },
  ],
}

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LandingPageContent />
    </>
  )
}
