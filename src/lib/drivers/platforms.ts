// Catalog of delivery / mobility platforms operating in Saudi Arabia, used for
// driver platform accounts (rider IDs) and platform-branded rider ID cards.
// Colours approximate each platform's public brand palette; adjust here and
// every card, chip and print updates.
export interface CardTheme {
  /** Card body background (top area). */
  body: string
  /** Curved bottom band background. */
  band: string
  /** Photo frame and back-panel border. */
  frame: string
  /** Field label colour on the body. */
  label: string
  /** Field value colour on the body. */
  value: string
  /** Wordmark/text colour on the band. */
  bandText: string
  /** Highlight colour on the band (email line). */
  bandAccent: string
  /** Wordmark lines (stacked like the HungerStation card). */
  wordmark: string[]
}

export interface DeliveryPlatform {
  code: string
  en: string
  ar: string
  kind: "food" | "grocery" | "courier" | "mobility" | "ecommerce"
  /** Chip colour for lists. */
  color: string
  theme: CardTheme
}

const theme = (t: Omit<CardTheme, "bandAccent"> & { bandAccent?: string }): CardTheme => ({ bandAccent: t.body, ...t })

export const DELIVERY_PLATFORMS: readonly DeliveryPlatform[] = [
  { code: "hungerstation", en: "HungerStation", ar: "هنقرستيشن", kind: "food", color: "#F8C400",
    theme: theme({ body: "#F8E71C", band: "#0AA9CE", frame: "#5C2E2E", label: "#0AA9CE", value: "#8B3A2F", bandText: "#FFFFFF", wordmark: ["HUNGER", "STATION"] }) },
  { code: "keeta", en: "Keeta", ar: "كيتا", kind: "food", color: "#FFD100",
    theme: theme({ body: "#FFD100", band: "#1F1F1F", frame: "#1F1F1F", label: "#1F1F1F", value: "#4A3B00", bandText: "#FFD100", bandAccent: "#FFFFFF", wordmark: ["KEETA"] }) },
  { code: "jahez", en: "Jahez", ar: "جاهز", kind: "food", color: "#E4002B",
    theme: theme({ body: "#FFFFFF", band: "#E4002B", frame: "#E4002B", label: "#E4002B", value: "#3A0A12", bandText: "#FFFFFF", bandAccent: "#FFE1E6", wordmark: ["JAHEZ", "جاهز"] }) },
  { code: "mrsool", en: "Mrsool", ar: "مرسول", kind: "courier", color: "#10B26C",
    theme: theme({ body: "#E9FBF2", band: "#10B26C", frame: "#0B7A4A", label: "#0B7A4A", value: "#0F2E22", bandText: "#FFFFFF", bandAccent: "#D7FFE9", wordmark: ["MRSOOL", "مرسول"] }) },
  { code: "toyou", en: "ToYou", ar: "تويو", kind: "courier", color: "#FF6A13",
    theme: theme({ body: "#FFF3EA", band: "#FF6A13", frame: "#B84505", label: "#E85A08", value: "#3B1A06", bandText: "#FFFFFF", bandAccent: "#FFE3CF", wordmark: ["TOYOU", "تويو"] }) },
  { code: "thechefz", en: "The Chefz", ar: "ذا شفز", kind: "food", color: "#E2264D",
    theme: theme({ body: "#FFF0F3", band: "#E2264D", frame: "#9E1532", label: "#C81E42", value: "#3A0812", bandText: "#FFFFFF", bandAccent: "#FFD6DF", wordmark: ["THE", "CHEFZ"] }) },
  { code: "ninja", en: "Ninja", ar: "نينجا", kind: "grocery", color: "#6A1B9A",
    theme: theme({ body: "#F5EDFB", band: "#6A1B9A", frame: "#45106A", label: "#6A1B9A", value: "#250838", bandText: "#FFFFFF", bandAccent: "#F3D9FF", wordmark: ["NINJA", "نينجا"] }) },
  { code: "nana", en: "Nana", ar: "نعناع", kind: "grocery", color: "#5DAE3B",
    theme: theme({ body: "#F0F9EA", band: "#5DAE3B", frame: "#3B7A22", label: "#4C9A2E", value: "#1C3510", bandText: "#FFFFFF", bandAccent: "#E2F7D5", wordmark: ["NANA", "نعناع"] }) },
  { code: "noon", en: "Noon", ar: "نون", kind: "ecommerce", color: "#FEEE00",
    theme: theme({ body: "#FEEE00", band: "#1D1D1B", frame: "#1D1D1B", label: "#1D1D1B", value: "#3A3600", bandText: "#FEEE00", bandAccent: "#FFFFFF", wordmark: ["NOON"] }) },
  { code: "careem", en: "Careem", ar: "كريم", kind: "mobility", color: "#00A651",
    theme: theme({ body: "#EAF8F0", band: "#00A651", frame: "#006B35", label: "#00843F", value: "#0B2A19", bandText: "#FFFFFF", bandAccent: "#D3F5E2", wordmark: ["CAREEM", "كريم"] }) },
  { code: "uber", en: "Uber", ar: "أوبر", kind: "mobility", color: "#000000",
    theme: theme({ body: "#FFFFFF", band: "#000000", frame: "#000000", label: "#000000", value: "#333333", bandText: "#FFFFFF", bandAccent: "#06C167", wordmark: ["UBER"] }) },
  { code: "shgardi", en: "Shgardi", ar: "شقردي", kind: "courier", color: "#F15A24",
    theme: theme({ body: "#FFF1EB", band: "#F15A24", frame: "#A83A12", label: "#D94C1A", value: "#3A1406", bandText: "#FFFFFF", bandAccent: "#FFE0D3", wordmark: ["SHGARDI", "شقردي"] }) },
  { code: "lugmety", en: "Lugmety", ar: "لقمتي", kind: "food", color: "#D7262E",
    theme: theme({ body: "#FFF0F0", band: "#D7262E", frame: "#8E1218", label: "#C21F27", value: "#3A0A0C", bandText: "#FFFFFF", bandAccent: "#FFD9DB", wordmark: ["LUGMETY", "لقمتي"] }) },
  { code: "amazon", en: "Amazon Flex", ar: "أمازون فليكس", kind: "ecommerce", color: "#FF9900",
    theme: theme({ body: "#FFF6E8", band: "#232F3E", frame: "#232F3E", label: "#232F3E", value: "#3A2600", bandText: "#FF9900", bandAccent: "#FFFFFF", wordmark: ["AMAZON", "FLEX"] }) },
  { code: "aramex", en: "Aramex", ar: "أرامكس", kind: "courier", color: "#E2231A",
    theme: theme({ body: "#FFFFFF", band: "#E2231A", frame: "#9C1510", label: "#E2231A", value: "#3A0906", bandText: "#FFFFFF", bandAccent: "#FFDAD8", wordmark: ["ARAMEX"] }) },
  { code: "smsa", en: "SMSA Express", ar: "سمسا", kind: "courier", color: "#1B2B6B",
    theme: theme({ body: "#EEF1FB", band: "#1B2B6B", frame: "#1B2B6B", label: "#1B2B6B", value: "#121A3A", bandText: "#FFFFFF", bandAccent: "#F7B500", wordmark: ["SMSA", "EXPRESS"] }) },
  { code: "spl", en: "SPL (Saudi Post)", ar: "سبل", kind: "courier", color: "#00843D",
    theme: theme({ body: "#EDF8F1", band: "#00843D", frame: "#005A29", label: "#00843D", value: "#0B2A17", bandText: "#FFFFFF", bandAccent: "#FFD200", wordmark: ["SPL"] }) },
  { code: "jeeny", en: "Jeeny", ar: "جيني", kind: "mobility", color: "#00B2A9",
    theme: theme({ body: "#E9FAF9", band: "#00B2A9", frame: "#007A74", label: "#00918A", value: "#06302E", bandText: "#FFFFFF", bandAccent: "#D2F7F5", wordmark: ["JEENY", "جيني"] }) },
]

export const DEFAULT_CARD_PLATFORM = "hungerstation"

const byCode = new Map(DELIVERY_PLATFORMS.map((p) => [p.code, p]))

export function platformByCode(code: string | null | undefined): DeliveryPlatform | undefined {
  return code ? byCode.get(code.trim().toLowerCase()) : undefined
}

/** Unknown / tenant-custom platforms fall back to a neutral EliteDev theme. */
export function platformTheme(code: string | null | undefined, fallbackName?: string): CardTheme {
  const p = platformByCode(code)
  if (p) return p.theme
  const name = (fallbackName ?? code ?? "PLATFORM").toUpperCase().slice(0, 14)
  return { body: "#EEF4FB", band: "#1E5A99", frame: "#123A66", label: "#1E5A99", value: "#0F1E33", bandText: "#FFFFFF", bandAccent: "#BFE0FF", wordmark: [name] }
}

export function platformLabel(code: string, isAr: boolean): string {
  const p = platformByCode(code)
  return p ? (isAr ? p.ar : p.en) : code
}

/** Rider IDs printed on cards / matched in payroll imports. */
export const RIDER_ID_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/

/** EliteDev staff card used when a driver has no active platform account yet. */
export const COMPANY_CARD_THEME: CardTheme = { ...platformTheme(null, "ELITEDEV"), wordmark: ["ELITEDEV", "إيليت ديف"] }
