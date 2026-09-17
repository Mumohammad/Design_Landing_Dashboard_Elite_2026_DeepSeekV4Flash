// Shared types for driver cards (20260915120000_drivers_module_foundation.sql
// driver_cards + driver_card_prints). Client-safe: type-only.

export type DriverCardStatus = "active" | "suspended" | "revoked" | "expired"

export interface DriverCard {
  id: string
  driver_id: string
  card_serial: string
  status: DriverCardStatus
  issued_at: string
  expires_at: string | null
  reprint_count: number
}

export type CardPrintFormat = "pvc" | "a4" | "screen"

export interface DriverCardPrint {
  id: string
  card_id: string
  format: CardPrintFormat
  printed_at: string
  batch_ref: string | null
}

// Person details rendered on the printable card. Resolved client-side with
// fallbacks because driver column naming varies across deployments.
export interface DriverCardPerson {
  name: string
  phone: string | null
  idNumber: string | null
  photoUrl: string | null
}
