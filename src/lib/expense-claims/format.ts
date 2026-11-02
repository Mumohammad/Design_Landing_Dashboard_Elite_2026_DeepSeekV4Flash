// Small client-safe formatting helpers (kept apart from the xlsx builder).

/** "YYYY-MM-DD HH:mm" in Asia/Riyadh. */
export function riyadhTimestamp(iso: string | Date | null | undefined): string {
  if (!iso) return ""
  const d = typeof iso === "string" ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return ""
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {})
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
