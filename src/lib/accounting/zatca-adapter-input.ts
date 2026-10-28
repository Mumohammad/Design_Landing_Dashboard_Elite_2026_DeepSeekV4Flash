// Pure helpers for the event-driven ZATCA adapter (zatca.ts). Kept outside the
// "use server" module so they can be unit-tested and reused by previews.
import type { ZatcaParty } from "./zatca-ubl"

export type TenantPartyRow = {
  name_ar: string
  name_en: string | null
  legal_name: string | null
  vat_number: string | null
  cr_number: string | null
  address: string | null
  city: string | null
  region?: string | null
  district?: string | null
  building_number?: string | null
  additional_number?: string | null
  postal_code?: string | null
  country?: string | null
}

export type CustomerPartyRow = {
  name_ar: string
  name_en: string | null
  tax_number: string | null
  address: string | null
  city?: string | null
  district?: string | null
  building_number?: string | null
  additional_number?: string | null
  postal_code?: string | null
  country_code?: string | null
}

export const ZATCA_VAT_RE = /^3\d{13}3$/

export function sellerParty(t: TenantPartyRow): ZatcaParty {
  return {
    name: t.legal_name || t.name_ar || t.name_en || "",
    vatNumber: t.vat_number ?? null,
    crNumber: t.cr_number ?? null,
    address: t.address ?? null,
    city: t.city ?? null,
    region: t.region ?? null,
    district: t.district ?? null,
    buildingNumber: t.building_number ?? null,
    additionalNumber: t.additional_number ?? null,
    postalCode: t.postal_code ?? null,
    countryCode: (t.country || "SA").toUpperCase().slice(0, 2),
  }
}

export function buyerParty(c: CustomerPartyRow | null): ZatcaParty {
  if (!c) return { name: "عميل نقدي", vatNumber: null, countryCode: "SA" }
  return {
    name: c.name_ar || c.name_en || "",
    vatNumber: c.tax_number ?? null,
    address: c.address ?? null,
    city: c.city ?? null,
    district: c.district ?? null,
    buildingNumber: c.building_number ?? null,
    additionalNumber: c.additional_number ?? null,
    postalCode: c.postal_code ?? null,
    countryCode: (c.country_code || "SA").toUpperCase(),
  }
}

/**
 * B2B documents (buyer has a VAT registration) are standard tax invoices that
 * must be cleared; B2C documents are simplified and reported within 24h.
 */
export function invoiceKindFor(buyer: ZatcaParty): "standard" | "simplified" {
  return buyer.vatNumber && ZATCA_VAT_RE.test(buyer.vatNumber) ? "standard" : "simplified"
}

/**
 * National Address fields ZATCA validates before accepting a document:
 * the seller always (BR-KSA-09/37/66), a Saudi buyer on standard invoices
 * (BR-KSA-63). Returns the missing field names (empty when complete).
 */
export function missingNationalAddress(party: ZatcaParty, role: "seller" | "buyer", kind: "standard" | "simplified"): string[] {
  if (role === "buyer" && (kind === "simplified" || (party.countryCode ?? "SA") !== "SA")) return []
  const missing: string[] = []
  if (!party.address?.trim()) missing.push("street")
  if (!/^\d{4}$/.test(party.buildingNumber ?? "")) missing.push("building_number")
  if (!party.city?.trim()) missing.push("city")
  if (!party.district?.trim()) missing.push("district")
  if (!/^\d{5}$/.test(party.postalCode ?? "")) missing.push("postal_code")
  if (role === "seller" && !ZATCA_VAT_RE.test(party.vatNumber ?? "")) missing.push("vat_number")
  return missing
}

export type SubmissionOutcome = {
  success: boolean
  status?: "reported" | "cleared" | "rejected"
  pipeline?: string
  error?: string
  warnings?: unknown[]
  errors?: unknown[]
}

/** Map a prepared-document submission result to a zatca_transmissions status. */
export function transmissionStatusFor(result: SubmissionOutcome): "reported" | "cleared" | "rejected" | "failed" {
  if (result.status === "reported" || result.status === "cleared") return result.status
  if (result.status === "rejected") return "rejected"
  return "failed"
}
