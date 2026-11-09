import type { Metadata } from "next"
import { LocaleProvider } from "@/contexts/locale-context"
import { loadPortalView, type PortalView } from "@/lib/driver-portal/server"
import { PortalContent, type PortalDisplayView } from "./portal-content"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Driver portal | بوابة السائق",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function DriverPortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ lang?: string | string[] }>
}) {
  const [{ token }, requested] = await Promise.all([params, searchParams])
  const initialLocale = requested.lang === "en" ? "en" : "ar"
  let portalToken = ""
  try { portalToken = decodeURIComponent(token) } catch { /* Malformed bearer links render as invalid. */ }
  let view: PortalView | null = null
  let loadFailed = false
  try { view = await loadPortalView(portalToken) } catch { loadFailed = true }
  // Send only displayed fields across the client boundary, retaining masked ID only.
  const displayView: PortalDisplayView | null = view && {
    company: view.company,
    link: { expires_at: view.link.expires_at },
    driver: {
      full_name_ar: view.driver.full_name_ar, full_name_en: view.driver.full_name_en,
      driver_code: view.driver.driver_code, iqama_last4: view.driver.iqama_last4, photo_url: view.driver.photo_url,
    },
    documents: view.documents.map(({ id, doc_type, expiry_date, is_verified }) => ({ id, doc_type, expiry_date, is_verified })),
    platforms: view.platforms, cards: view.cards, vehicle: view.vehicle, submissions: view.submissions,
  }
  return <LocaleProvider initialLocale={initialLocale}>
    {/* This dynamic server request time is serialized so expiry labels hydrate from the same snapshot. */}
    {/* eslint-disable-next-line react-hooks/purity */}
    <PortalContent token={portalToken} view={displayView} loadFailed={loadFailed} now={Date.now()} />
  </LocaleProvider>
}
