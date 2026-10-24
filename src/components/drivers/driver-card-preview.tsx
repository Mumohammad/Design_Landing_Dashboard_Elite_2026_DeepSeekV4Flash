"use client"

import { useState } from "react"
import type { DriverCard, DriverCardPerson } from "@/lib/drivers/cards"
import { logPhotoRenderFailure } from "@/lib/drivers/photo"
import { User } from "lucide-react"

// Palette sampled from the rider-card reference (HungerStation badge).
const YELLOW = "#F8E71C"
const BLUE = "#0AA9CE"
const BROWN = "#8B3A2F"
const MAROON = "#5C2E2E"
const CONTACT_EMAIL = "Info@elitedev.com.sa"

function expiryText(card: DriverCard): string {
  if (!card.expires_at) return ""
  return new Date(card.expires_at).toLocaleDateString("en-GB")
}

// Stacked two-line brand mark, as on the reference card.
function BrandMark({ color, fontSize, letterSpacing }: { color: string; fontSize: number; letterSpacing: number }) {
  return (
    <div style={{ color, fontWeight: 800, fontSize, letterSpacing, lineHeight: 1.05, textAlign: "center" }}>
      HUNGER
      <br />
      STATION
    </div>
  )
}

function FrontCard({ card, person }: { card: DriverCard; person: DriverCardPerson | null }) {
  const expiry = expiryText(card)
  // Signed URLs expire or the object may have been removed — fall back to
  // the user icon instead of a broken image on the card face.
  const [imgFailed, setImgFailed] = useState(false)
  const field = (label: string, value: string, ltr = false) => (
    <div>
      <span style={{ color: BLUE }}>{label}: </span>
      <span style={{ color: BROWN }} dir={ltr ? "ltr" : undefined}>{value}</span>
    </div>
  )
  return (
    <div style={{ width: 300, height: 476, background: YELLOW, borderRadius: 24, overflow: "hidden", position: "relative", border: "1px solid #d9d9d9" }}>
      <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", width: 64, height: 12, borderRadius: 8, background: "rgba(0,0,0,0.12)" }} />
      <div style={{ margin: "50px auto 0", width: 118, height: 118, borderRadius: 18, background: "#ffffff", border: `5px solid ${MAROON}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
        {field("Rider ID", card.card_serial, true)}
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <svg viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 26 }}>
          <path d="M0,20 C70,0 230,26 300,8 L300,26 L0,26 Z" fill={BLUE} />
        </svg>
        <div style={{ background: BLUE, padding: "6px 0 16px", textAlign: "center" }}>
          <BrandMark color="#ffffff" fontSize={19} letterSpacing={1.5} />
          <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 9.5, marginTop: 3 }} dir="ltr">
            {expiry ? `Valid thru ${expiry}` : ""}
          </div>
        </div>
      </div>
    </div>
  )
}

function BackCard({ card }: { card: DriverCard }) {
  return (
    <div style={{ width: 300, height: 476, background: YELLOW, borderRadius: 24, overflow: "hidden", position: "relative", border: "1px solid #d9d9d9" }}>
      <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", width: 64, height: 12, borderRadius: 8, background: "rgba(0,0,0,0.12)" }} />
      <div style={{ margin: "70px auto 0", width: 178, padding: "14px 0", background: "#ffffff", border: `6px solid ${MAROON}`, borderRadius: 18, textAlign: "center" }}>
        <BrandMark color={MAROON} fontSize={19} letterSpacing={1.5} />
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
        <svg viewBox="0 0 300 26" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 26 }}>
          <path d="M0,8 C70,26 230,0 300,20 L300,26 L0,26 Z" fill={BLUE} />
        </svg>
        <div style={{ background: BLUE, padding: "14px 24px 24px", textAlign: "center" }}>
          <p dir="rtl" style={{ color: "#ffffff", fontWeight: 700, fontSize: 15, margin: 0 }}>
            إذا وجدت هذه البطاقة يرجى التواصل معنا
          </p>
          <p style={{ color: "#ffffff", fontSize: 12, margin: "6px 0 0" }}>
            If this card is found, please contact us.
          </p>
          <p style={{ color: YELLOW, fontWeight: 700, fontSize: 12.5, margin: "8px 0 0" }} dir="ltr">
            Email: {CONTACT_EMAIL}
          </p>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: 9.5, margin: "6px 0 0" }} dir="ltr">
            {card.card_serial}
          </p>
        </div>
      </div>
    </div>
  )
}

export function DriverCardPreview({ card, person }: { card: DriverCard; person: DriverCardPerson | null }) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-4" dir="ltr">
      <FrontCard card={card} person={person} />
      <BackCard card={card} />
    </div>
  )
}

export {buildCardPrintHtml} from "@/lib/drivers/card-print"
