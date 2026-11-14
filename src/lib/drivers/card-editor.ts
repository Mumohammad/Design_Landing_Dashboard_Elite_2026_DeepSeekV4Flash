// Pure helpers for the rider card designer: auto-fill a card draft from a
// driver profile (+ platform accounts), and turn a draft into printable
// card data. Edits only affect the printed card, never the driver record.
import type { DriverCardPerson } from "./cards"
import type { RiderCardFace } from "./card-print"
import { DEFAULT_CARD_PLATFORM, RIDER_ID_PATTERN, platformByCode, platformLabel, platformTheme } from "./platforms"

export const CUSTOM_PLATFORM = "custom"

export interface CardProfileSource {
  id: string
  driver_code: string | null
  full_name_en: string | null
  full_name_ar: string | null
  primary_mobile: string | null
  secondary_mobile: string | null
  iqama_number: string | null
  rider_id?: string | null
  photo_url?: string | null
}

export interface CardAccountSource { platform_code: string; platform_driver_id: string; status: string; is_primary: boolean }

export interface CardDraft {
  platform: string
  /** Wordmark for a custom (unlisted) platform. */
  customName: string
  name: string
  phone: string
  idNumber: string
  riderId: string
  photoUrl: string | null
  /** Driver profile the draft came from (null = manual card). */
  driverId: string | null
  footerRef: string | null
}

export const emptyDraft = (): CardDraft => ({ platform: DEFAULT_CARD_PLATFORM, customName: "", name: "", phone: "", idNumber: "", riderId: "", photoUrl: null, driverId: null, footerRef: null })

/**
 * Card fields from a profile. Platform preference: explicit → primary active
 * account → any active account → default design. Only an active account for
 * that exact platform supplies an ID; otherwise it must be entered manually.
 */
export function draftFromProfile(driver: CardProfileSource, photoUrl: string | null, accounts: CardAccountSource[] = [], platform?: string): CardDraft {
  const active = accounts.filter((a) => a.status === "active")
  const chosen = platform ?? (active.find((a) => a.is_primary) ?? active[0])?.platform_code ?? DEFAULT_CARD_PLATFORM
  return {
    ...emptyDraft(),
    platform: chosen,
    name: driver.full_name_en?.trim() || driver.full_name_ar?.trim() || "",
    phone: (driver.primary_mobile || driver.secondary_mobile || "").trim(),
    idNumber: (driver.iqama_number ?? "").trim(),
    riderId: riderIdFor(chosen, accounts),
    photoUrl,
    driverId: driver.id,
    footerRef: driver.driver_code ?? null,
  }
}

export function riderIdFor(platform: string, accounts: CardAccountSource[]): string {
  return (accounts.find(account => account.platform_code === platform && account.status === "active")?.platform_driver_id ?? "").trim()
}

export interface BoundCardProfile { driver: CardProfileSource; photoUrl: string | null; accounts: CardAccountSource[] }

/** Commit a profile and its dependencies together, only for the current selection. */
export async function loadProfileCardDraft(
  driver: CardProfileSource,
  readAccounts: () => Promise<CardAccountSource[]>,
  readPhoto: () => Promise<string | null>,
  isCurrent: () => boolean,
  platform?: string,
): Promise<{ profile: BoundCardProfile; draft: CardDraft } | null> {
  const [accounts, photoUrl] = await Promise.all([readAccounts(), readPhoto()])
  if (!isCurrent()) return null
  if (driver.photo_url && !photoUrl) throw new Error("Configured driver photo is unavailable")
  return { profile: { driver, photoUrl, accounts }, draft: draftFromProfile(driver, photoUrl, accounts, platform) }
}

export type DraftIssue = "name" | "riderId" | "riderIdFormat" | "customName"

export function draftIssues(d: CardDraft): DraftIssue[] {
  const out: DraftIssue[] = []
  if (!d.name.trim()) out.push("name")
  if (!d.riderId.trim()) out.push("riderId")
  else if (!RIDER_ID_PATTERN.test(d.riderId.trim())) out.push("riderIdFormat")
  if (d.platform === CUSTOM_PLATFORM && !d.customName.trim()) out.push("customName")
  return out
}

export function draftPlatformName(d: CardDraft): string {
  return d.platform === CUSTOM_PLATFORM ? d.customName.trim() || "Platform" : platformLabel(d.platform, false)
}

/** Draft → the exact inputs the card renderer / print / PDF use. */
export function draftToCard(d: CardDraft): { face: RiderCardFace; person: DriverCardPerson } {
  const riderId = d.riderId.trim() || "—"
  const theme = d.platform === CUSTOM_PLATFORM || !platformByCode(d.platform)
    ? platformTheme(null, d.customName.trim() || "PLATFORM")
    : platformTheme(d.platform)
  return {
    face: { theme, riderId, footerRef: d.footerRef, title: `${draftPlatformName(d)} rider card ${riderId}` },
    person: { name: d.name.trim() || "—", phone: d.phone.trim() || null, idNumber: d.idNumber.trim() || null, photoUrl: d.photoUrl },
  }
}
