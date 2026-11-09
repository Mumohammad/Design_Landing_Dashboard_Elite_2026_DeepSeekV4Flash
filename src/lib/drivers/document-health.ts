export type DocumentHealth = "missing" | "unverified" | "valid" | "expiring" | "expired" | "no_expiry"
export function documentHealth(expires: boolean, row: { expiry_date: string | null; is_verified: boolean; file_url: string | null } | undefined, todayIso: string): { state: DocumentHealth; days: number | null } {
  if (!row) return { state: "missing", days: null }
  if (!row.file_url || !row.is_verified) return { state: "unverified", days: null }
  if (!row.expiry_date) return { state: expires ? "no_expiry" : "valid", days: null }
  const date = Date.parse(row.expiry_date + "T00:00:00Z")
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== row.expiry_date) return { state: "no_expiry", days: null }
  const days = Math.round((date - Date.parse(todayIso + "T00:00:00Z")) / 86_400_000)
  return { state: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid", days }
}
