export const BUSINESS_TIME_ZONE = "Asia/Riyadh"

/** Stable ISO day for the Saudi business calendar, regardless of host timezone. */
export function businessDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value
  return `${get("year")}-${get("month")}-${get("day")}`
}
