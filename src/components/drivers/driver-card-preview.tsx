"use client"

import { useState } from "react"
import type { DriverCard, DriverCardPerson } from "@/lib/drivers/cards"
import { logPhotoRenderFailure } from "@/lib/drivers/photo"
import { DEFAULT_CARD_PLATFORM, platformTheme, type CardTheme } from "@/lib/drivers/platforms"
import { User } from "lucide-react"

const CONTACT_EMAIL = "Info@elitedev.com.sa"

function expiryText(expiresAt: string | null | undefined): string {
  return expiresAt ? new Date(expiresAt).toLocaleDateString("en-GB") : ""
}

// Stacked brand wordmark, as on the reference card.
function BrandMark({ theme, color, fontSize }: { theme: CardTheme; color: string; fontSize: number }) {
  return (
    <div style={{ color, fontWeight: 800, fontSize, letterSpacing: 1.5, lineHeight: 1.05, textAlign: "center" }}>
      {theme.wordmark.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
    </div>
  )
}

export interface RiderCardProps {
  theme: CardTheme
  riderId: string
  person: DriverCardPerson | null
  footerRef?: string | null
  expiresAt?: string | null
}

function FrontCard({ theme: t, riderId, person, expiresAt }: RiderCardProps) {
  const expiry = expiryText(expiresAt)
  // Signed URLs expire or the object may have been removed — fall back to
  // the user icon instead of a broken image on the card face.
  const [imgFailed, setImgFailed] = useState(false)
  const field = (label: string, value: string, ltr = false) => (
    <div>
      <span style={{ color: t.label }}>{label}: </span>
      <span style={{ color: t.value }} dir={ltr ? "ltr" : undefined}>{value}</span>
    </div>
  )
  return (
    <div data-testid="rider-card-front" style={{ width: 300, height: 476, background: t.body, borderRadius: 24, overflow: "hidden", position: "relative", border: "1px solid #d9d9d9" }}>
      <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", width: 64, height: 12, borderRadius: 8, background: "rgba(0,0,0,0.12)" }} />
      <div style={{ margin: "50px auto 0", width: 118, height: 118, borderRadius: 18, background: "#ffffff", border: `5px solid ${t.frame}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {person?.photoUrl && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic signed URL, not optimizable at build time
          <img
            src={person.photoUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={() => {
              logPhotoRenderFailure(person.photoUrl)
              setImgFailed(true)
            }}
          />
        ) : (
          <User style={{ width: 52, height: 52, color: "#cbd5e1" }} />
        )}
      </div>
      <div style={{ padding: "14px 24px 0", fontSize: 14.5, fontWeight: 700, lineHeight: 1.85 }}>
        {field("Name", person?.name ?? "—")}
        {field("Mobile", person?.phone ?? "—", true)}
        {field("ID Number", person?.idNumber ?? "—", true)}
        {field("Rider ID", riderId, true)}
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <svg viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 26, marginBottom: -1 }}>
          <path d="M0,20 C70,0 230,26 300,8 L300,26 L0,26 Z" fill={t.band} />
        </svg>
        <div style={{ background: t.band, padding: "6px 0 16px", textAlign: "center" }}>
          <BrandMark theme={t} color={t.bandText} fontSize={19} />
          <div style={{ color: t.bandText, opacity: 0.9, fontSize: 9.5, marginTop: 3 }} dir="ltr">
            {expiry ? `Valid thru ${expiry}` : ""}
          </div>
        </div>
      </div>
    </div>
  )
}

function BackCard({ theme: t, footerRef }: RiderCardProps) {
  return (
    <div data-testid="rider-card-back" style={{ width: 300, height: 476, background: t.body, borderRadius: 24, overflow: "hidden", position: "relative", border: "1px solid #d9d9d9" }}>
      <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", width: 64, height: 12, borderRadius: 8, background: "rgba(0,0,0,0.12)" }} />
      <div style={{ margin: "70px auto 0", width: 178, padding: "14px 0", background: "#ffffff", border: `6px solid ${t.frame}`, borderRadius: 18, textAlign: "center" }}>
        <BrandMark theme={t} color={t.frame} fontSize={19} />
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <svg viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 26, marginBottom: -1 }}>
          <path d="M0,8 C70,26 230,0 300,20 L300,26 L0,26 Z" fill={t.band} />
        </svg>
        <div style={{ background: t.band, padding: "14px 24px 24px", textAlign: "center" }}>
          <p dir="rtl" style={{ color: t.bandText, fontWeight: 700, fontSize: 15, margin: 0 }}>
            إذا وجدت هذه البطاقة يرجى التواصل معنا
          </p>
          <p style={{ color: t.bandText, fontSize: 12, margin: "6px 0 0" }}>
            If this card is found, please contact us.
          </p>
          <p style={{ color: t.bandAccent, fontWeight: 700, fontSize: 12.5, margin: "8px 0 0" }} dir="ltr">
            Email: {CONTACT_EMAIL}
          </p>
          <p style={{ color: t.bandText, opacity: 0.85, fontSize: 9.5, margin: "6px 0 0" }} dir="ltr">
            {footerRef ?? ""}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Platform-branded rider card (front + back). */
export function RiderCardPreview(props: RiderCardProps & { scale?: number }) {
  const { scale = 1 } = props
  return (
    <div className="flex flex-wrap items-start justify-center gap-4" dir="ltr">
      {[FrontCard, BackCard].map((Face, i) => (
        <div key={i} style={scale === 1 ? undefined : { width: 300 * scale, height: 476 * scale }}>
          <div style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <Face {...props} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Issued EliteDev card; Rider ID is the primary platform ID when known. */
export function DriverCardPreview({
  card,
  person,
  platform,
}: {
  card: DriverCard
  person: DriverCardPerson | null
  platform?: { code: string; riderId: string } | null
}) {
  return (
    <RiderCardPreview
      theme={platformTheme(platform?.code ?? DEFAULT_CARD_PLATFORM)}
      riderId={platform?.riderId || card.card_serial}
      footerRef={card.card_serial}
      expiresAt={card.expires_at}
      person={person}
    />
  )
}

export { buildCardPrintHtml, buildRiderCardsPrintHtml } from "@/lib/drivers/card-print"

/** A single scaled card face — used by the overview spotlight and live previews. */
export function RiderCardFace({ side = "front", scale = 1, ...props }: RiderCardProps & { side?: "front" | "back"; scale?: number }) {
  const Face = side === "front" ? FrontCard : BackCard
  return (
    <div dir="ltr" style={{ width: 300 * scale, height: 476 * scale }}>
      <div style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <Face {...props} />
      </div>
    </div>
  )
}
