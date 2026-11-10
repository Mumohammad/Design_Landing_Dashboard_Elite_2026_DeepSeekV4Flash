"use client"

// Inline SVG flags for language switchers across the app (landing, dashboard,
// and the driver registration portal).
// Emoji flags (🇸🇦 🇬🇧 🇵🇰 🇧🇩) do NOT render on Windows — they show as
// two-letter codes — so real vector flags are used instead. Simplified but
// recognizable geometry, 3:2 aspect, rendered at a fixed size.

import type { ComponentType } from "react"

/** Locale codes supported by the shared flag set (superset of the app's ar/en). */
export type FlagCode = "ar" | "en" | "ur" | "bn"

function SaudiFlag() {
  return (
    <svg viewBox="0 0 90 60" className="h-full w-full" aria-hidden>
      {/* Green field */}
      <rect width="90" height="60" fill="#165d31" />
      {/* Shahada text (simplified band) */}
      <g fill="#ffffff">
        <rect x="16" y="14" width="58" height="6" rx="3" />
        <rect x="22" y="24" width="46" height="6" rx="3" />
      </g>
      {/* Sword */}
      <path
        d="M45 34 L57 40 L45 44 L33 40 Z"
        fill="#ffffff"
        transform="translate(-2 2)"
      />
      <rect x="44" y="33" width="4" height="22" rx="2" fill="#ffffff" transform="translate(-2 2)" />
    </svg>
  )
}

function UkFlag() {
  return (
    <svg viewBox="0 0 90 60" className="h-full w-full" aria-hidden>
      {/* Blue field */}
      <rect width="90" height="60" fill="#012169" />
      {/* White diagonals (St Andrew) */}
      <path d="M-8 -10 L64 52" stroke="#ffffff" strokeWidth="10" />
      <path d="M98 -10 L26 52" stroke="#ffffff" strokeWidth="10" />
      {/* Red diagonals (St Patrick) */}
      <path d="M-8 -10 L64 52" stroke="#C8102E" strokeWidth="5" />
      <path d="M98 -10 L26 52" stroke="#C8102E" strokeWidth="5" />
      {/* White cross (St George) */}
      <rect x="38" y="-10" width="14" height="80" fill="#ffffff" />
      <rect x="-10" y="23" width="110" height="14" fill="#ffffff" />
      {/* Red cross */}
      <rect x="41" y="-10" width="8" height="80" fill="#C8102E" />
      <rect x="-10" y="26" width="110" height="8" fill="#C8102E" />
    </svg>
  )
}

function PakistanFlag() {
  return (
    <svg viewBox="0 0 90 60" className="h-full w-full" aria-hidden>
      {/* White hoist stripe */}
      <rect width="22.5" height="60" fill="#ffffff" />
      {/* Green field */}
      <rect x="22.5" width="67.5" height="60" fill="#01411C" />
      {/* Crescent + star */}
      <g fill="#ffffff">
        <circle cx="55" cy="30" r="15" />
        <circle cx="61" cy="27" r="13" fill="#01411C" />
        <path d="M66 18 l2.6 5.6 6.1 0.7 -4.6 4.1 1.3 6 -5.4 -3 -5.4 3 1.3 -6 -4.6 -4.1 6.1 -0.7 Z" />
      </g>
    </svg>
  )
}

function BangladeshFlag() {
  return (
    <svg viewBox="0 0 90 60" className="h-full w-full" aria-hidden>
      {/* Green field */}
      <rect width="90" height="60" fill="#006A4E" />
      {/* Red disc (slightly toward the hoist) */}
      <circle cx="38" cy="30" r="16" fill="#F42A41" />
    </svg>
  )
}

const FLAGS: Record<FlagCode, ComponentType> = {
  ar: SaudiFlag,
  en: UkFlag,
  ur: PakistanFlag,
  bn: BangladeshFlag,
}

export function FlagIcon({ code, className = "" }: { code: FlagCode; className?: string }) {
  const Flag = FLAGS[code]
  return (
    <span
      className={`inline-block h-4 w-6 shrink-0 overflow-hidden rounded-[3px] shadow-sm ring-1 ring-black/10 ${className}`}
      role="img"
      aria-label={code}
    >
      <Flag />
    </span>
  )
}
