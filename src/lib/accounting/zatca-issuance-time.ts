/** Riyadh-local `YYYY-MM-DDTHH:mm:ss` (UTC+3, no DST) for an absolute instant. */
export function riyadhLocal(isoUtc: string): string {
  const t = Date.parse(isoUtc)
  if (!Number.isFinite(t)) throw new Error("Invalid ZATCA issuance time.")
  return new Date(t + 3 * 3600_000).toISOString().slice(0, 19)
}
