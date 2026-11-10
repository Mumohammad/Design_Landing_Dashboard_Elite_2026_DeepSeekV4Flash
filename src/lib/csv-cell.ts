/** CSVs here are human-facing spreadsheet exports. Formula-like text must
 * remain inert when opened in Excel; numeric balances keep their cell values.
 * See https://community.owasp.org/attacks/CSV_Injection (Excel mitigation).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)
  const formula = !numeric && /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text)
  const safe = formula ? `\t${text}` : text
  return formula || /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
