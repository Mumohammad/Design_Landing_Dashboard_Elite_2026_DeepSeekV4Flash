/**
 * Calendar-correct month boundaries for CSV export windows (audit fix FX-04).
 *
 * The end day is derived from real calendar values via Date UTC getters
 * (day 0 of the following month = last day of the month), so leap-year
 * Februaries and 30-day months come out right. The previous code hardcoded
 * "-31" for every month, which made Postgres reject the range filter for
 * Feb/Apr/Jun/Sep/Nov ("date/time field value out of range").
 */
export function monthBounds(
  year: number,
  month: number,
): { start: string; end: string } {
  const mm = String(month).padStart(2, "0")
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  }
}
