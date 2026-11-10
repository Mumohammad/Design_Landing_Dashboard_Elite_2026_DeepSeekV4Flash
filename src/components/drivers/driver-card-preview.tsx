"use client"

import { useId, useMemo } from "react"
import type { DriverCard, DriverCardPerson } from "@/lib/drivers/cards"
import { riderCardFaceSvg } from "@/lib/drivers/card-print"
import { DEFAULT_CARD_PLATFORM, platformTheme, type CardTheme } from "@/lib/drivers/platforms"


export interface RiderCardProps {
  theme: CardTheme
  riderId: string
  person: DriverCardPerson | null
  footerRef?: string | null
  expiresAt?: string | null
}

// Renders the exact SVG used by the print window, so screen == print.
function CardSvg({ side, theme, riderId, person, footerRef, expiresAt }: RiderCardProps & { side: "front" | "back" }) {
  const seed = useId()
  const html = useMemo(
    () => riderCardFaceSvg({ theme, riderId, footerRef, expiresAt }, person, side, `${side}${seed}`),
    [theme, riderId, footerRef, expiresAt, person, side, seed],
  )
  return <div style={{ width: 300, height: 476, borderRadius: 15.5, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: html }} />
}

const FrontCard = (props: RiderCardProps) => <CardSvg side="front" {...props} />
const BackCard = (props: RiderCardProps) => <CardSvg side="back" {...props} />

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
